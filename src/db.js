import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sqlite3 from "sqlite3";
import { promisify } from "node:util";

const dbPath = process.env.DB_PATH || "./data/app.db";
const resolvedPath = path.resolve(dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

sqlite3.verbose();
const rawDb = new sqlite3.Database(resolvedPath);

export const db = {
  run: (sql, params = []) =>
    new Promise((resolve, reject) => {
      rawDb.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, changes: this.changes });
      });
    }),
  get: promisify(rawDb.get.bind(rawDb)),
  all: promisify(rawDb.all.bind(rawDb)),
};

export async function initDb() {
  await db.run("PRAGMA foreign_keys = ON");

  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS payment_pages (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT,
      logo_url TEXT,
      brand_color TEXT,
      header_message TEXT,
      footer_message TEXT,
      amount_mode TEXT NOT NULL CHECK (amount_mode IN ('fixed', 'range', 'user_entered')),
      fixed_amount REAL,
      min_amount REAL,
      max_amount REAL,
      gl_codes_json TEXT NOT NULL DEFAULT '[]',
      email_template TEXT,
      draft_config_json TEXT,
      current_version INTEGER NOT NULL DEFAULT 1,
      last_published_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS payment_page_versions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      published_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(page_id) REFERENCES payment_pages(id) ON DELETE CASCADE
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS custom_fields (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('text', 'number', 'dropdown', 'date', 'checkbox')),
      options_json TEXT,
      required INTEGER NOT NULL DEFAULT 0,
      placeholder TEXT,
      helper_text TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(page_id) REFERENCES payment_pages(id) ON DELETE CASCADE
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
      payer_name TEXT,
      payer_email TEXT,
      processor_ref TEXT,
      stripe_payment_intent_id TEXT,
      gl_codes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY(page_id) REFERENCES payment_pages(id)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS field_responses (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      value TEXT,
      FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
      FOREIGN KEY(field_id) REFERENCES custom_fields(id)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS page_views (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      visited_at TEXT NOT NULL,
      FOREIGN KEY(page_id) REFERENCES payment_pages(id) ON DELETE CASCADE
    )
  `);

  const txColumns = await db.all("PRAGMA table_info(transactions)");
  const hasStripeIntentId = txColumns.some((c) => c.name === "stripe_payment_intent_id");
  if (!hasStripeIntentId) {
    await db.run("ALTER TABLE transactions ADD COLUMN stripe_payment_intent_id TEXT");
  }

  await db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_stripe_intent_id ON transactions(stripe_payment_intent_id)",
  );

  const adminColumns = await db.all("PRAGMA table_info(admin_users)");
  const hasRoleColumn = adminColumns.some((c) => c.name === "role");
  if (!hasRoleColumn) {
    await db.run("ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'");
  }
  await db.run("UPDATE admin_users SET role = 'owner' WHERE role IS NULL OR role = ''");

  const pageColumns = await db.all("PRAGMA table_info(payment_pages)");
  const pageColumnNames = new Set(pageColumns.map((c) => c.name));
  if (!pageColumnNames.has("draft_config_json")) {
    await db.run("ALTER TABLE payment_pages ADD COLUMN draft_config_json TEXT");
  }
  if (!pageColumnNames.has("current_version")) {
    await db.run("ALTER TABLE payment_pages ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1");
  }
  if (!pageColumnNames.has("last_published_at")) {
    await db.run("ALTER TABLE payment_pages ADD COLUMN last_published_at TEXT");
  }
  await db.run("UPDATE payment_pages SET current_version = 1 WHERE current_version IS NULL OR current_version < 1");

  const pages = await db.all("SELECT * FROM payment_pages");
  for (const page of pages) {
    const versionCount = await db.get(
      "SELECT COUNT(*) AS count FROM payment_page_versions WHERE page_id = ?",
      [page.id],
    );
    if (Number(versionCount.count || 0) > 0) continue;

    const customFields = await db.all(
      "SELECT * FROM custom_fields WHERE page_id = ? ORDER BY display_order ASC",
      [page.id],
    );
    const config = {
      slug: page.slug,
      title: page.title,
      subtitle: page.subtitle,
      description: page.description,
      logoUrl: page.logo_url,
      brandColor: page.brand_color,
      headerMessage: page.header_message,
      footerMessage: page.footer_message,
      amountMode: page.amount_mode,
      fixedAmount: page.fixed_amount,
      minAmount: page.min_amount,
      maxAmount: page.max_amount,
      glCodes: JSON.parse(page.gl_codes_json || "[]"),
      emailTemplate: page.email_template,
      isActive: Boolean(page.is_active),
      customFields: customFields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        options: f.options_json ? JSON.parse(f.options_json) : [],
        required: Boolean(f.required),
        placeholder: f.placeholder,
        helperText: f.helper_text,
        order: f.display_order,
      })),
    };
    await db.run(
      `INSERT INTO payment_page_versions (id, page_id, version_number, config_json, published_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), page.id, Number(page.current_version || 1), JSON.stringify(config), null, new Date().toISOString()],
    );
    if (!page.last_published_at) {
      await db.run("UPDATE payment_pages SET last_published_at = ? WHERE id = ?", [
        page.updated_at || page.created_at,
        page.id,
      ]);
    }
  }
}
