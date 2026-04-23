import fs from "node:fs";
import path from "node:path";
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
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
}
