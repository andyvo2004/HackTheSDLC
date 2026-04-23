import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "../db.js";

const customFieldSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  type: z.enum(["text", "number", "dropdown", "date", "checkbox"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  helperText: z.string().optional(),
  order: z.number().int().nonnegative().default(0),
});

const pageSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  brandColor: z.string().regex(/^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/).optional(),
  headerMessage: z.string().optional(),
  footerMessage: z.string().optional(),
  amountMode: z.enum(["fixed", "range", "user_entered"]),
  fixedAmount: z.number().nonnegative().optional(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().nonnegative().optional(),
  glCodes: z.array(z.string()).default([]),
  emailTemplate: z.string().optional(),
  isActive: z.boolean().default(true),
  customFields: z.array(customFieldSchema).max(10).default([]),
});

export const pagesRouter = Router();

async function listFields(pageId) {
  const fields = await db.all(
    "SELECT * FROM custom_fields WHERE page_id = ? ORDER BY display_order ASC",
    [pageId],
  );
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    options: field.options_json ? JSON.parse(field.options_json) : [],
    required: Boolean(field.required),
    placeholder: field.placeholder,
    helperText: field.helper_text,
    order: field.display_order,
  }));
}

function mapPage(row, customFields) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    logoUrl: row.logo_url,
    brandColor: row.brand_color,
    headerMessage: row.header_message,
    footerMessage: row.footer_message,
    amountMode: row.amount_mode,
    fixedAmount: row.fixed_amount,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    glCodes: JSON.parse(row.gl_codes_json || "[]"),
    emailTemplate: row.email_template,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customFields,
  };
}

pagesRouter.get("/", async (req, res, next) => {
  try {
    const rows = await db.all("SELECT * FROM payment_pages ORDER BY created_at DESC");
    const out = await Promise.all(
      rows.map(async (row) => mapPage(row, await listFields(row.id))),
    );
    res.json(out);
  } catch (err) {
    next(err);
  }
});

pagesRouter.get("/:id", async (req, res, next) => {
  try {
    const row = await db.get("SELECT * FROM payment_pages WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Page not found" });
    return res.json(mapPage(row, await listFields(row.id)));
  } catch (err) {
    next(err);
  }
});

pagesRouter.post("/", async (req, res, next) => {
  try {
    const parsed = pageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const now = new Date().toISOString();
    const pageId = uuidv4();
    const body = parsed.data;

    await db.run(
      `INSERT INTO payment_pages (
        id, slug, title, subtitle, description, logo_url, brand_color, header_message, footer_message,
        amount_mode, fixed_amount, min_amount, max_amount, gl_codes_json, email_template, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pageId,
        body.slug,
        body.title,
        body.subtitle || null,
        body.description || null,
        body.logoUrl || null,
        body.brandColor || null,
        body.headerMessage || null,
        body.footerMessage || null,
        body.amountMode,
        body.fixedAmount ?? null,
        body.minAmount ?? null,
        body.maxAmount ?? null,
        JSON.stringify(body.glCodes || []),
        body.emailTemplate || null,
        body.isActive ? 1 : 0,
        now,
        now,
      ],
    );

    for (const field of body.customFields) {
      await db.run(
        `INSERT INTO custom_fields
        (id, page_id, label, type, options_json, required, placeholder, helper_text, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          pageId,
          field.label,
          field.type,
          JSON.stringify(field.options || []),
          field.required ? 1 : 0,
          field.placeholder || null,
          field.helperText || null,
          field.order ?? 0,
        ],
      );
    }

    const row = await db.get("SELECT * FROM payment_pages WHERE id = ?", [pageId]);
    return res.status(201).json(mapPage(row, await listFields(pageId)));
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE constraint failed: payment_pages.slug")) {
      return res.status(409).json({ error: "Slug already exists" });
    }
    next(err);
  }
});

pagesRouter.put("/:id", async (req, res, next) => {
  try {
    const parsed = pageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const existing = await db.get("SELECT * FROM payment_pages WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ error: "Page not found" });

    const body = parsed.data;
    const now = new Date().toISOString();
    await db.run(
      `UPDATE payment_pages SET
        slug = ?, title = ?, subtitle = ?, description = ?, logo_url = ?, brand_color = ?,
        header_message = ?, footer_message = ?, amount_mode = ?, fixed_amount = ?,
        min_amount = ?, max_amount = ?, gl_codes_json = ?, email_template = ?, is_active = ?, updated_at = ?
      WHERE id = ?`,
      [
        body.slug,
        body.title,
        body.subtitle || null,
        body.description || null,
        body.logoUrl || null,
        body.brandColor || null,
        body.headerMessage || null,
        body.footerMessage || null,
        body.amountMode,
        body.fixedAmount ?? null,
        body.minAmount ?? null,
        body.maxAmount ?? null,
        JSON.stringify(body.glCodes || []),
        body.emailTemplate || null,
        body.isActive ? 1 : 0,
        now,
        req.params.id,
      ],
    );

    await db.run("DELETE FROM custom_fields WHERE page_id = ?", [req.params.id]);
    for (const field of body.customFields) {
      await db.run(
        `INSERT INTO custom_fields
        (id, page_id, label, type, options_json, required, placeholder, helper_text, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          field.id || uuidv4(),
          req.params.id,
          field.label,
          field.type,
          JSON.stringify(field.options || []),
          field.required ? 1 : 0,
          field.placeholder || null,
          field.helperText || null,
          field.order ?? 0,
        ],
      );
    }

    const row = await db.get("SELECT * FROM payment_pages WHERE id = ?", [req.params.id]);
    return res.json(mapPage(row, await listFields(req.params.id)));
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE constraint failed: payment_pages.slug")) {
      return res.status(409).json({ error: "Slug already exists" });
    }
    next(err);
  }
});

pagesRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const isActive = Boolean(req.body?.isActive);
    const updated = await db.run(
      "UPDATE payment_pages SET is_active = ?, updated_at = ? WHERE id = ?",
      [isActive ? 1 : 0, new Date().toISOString(), req.params.id],
    );
    if (updated.changes === 0) return res.status(404).json({ error: "Page not found" });
    const row = await db.get("SELECT * FROM payment_pages WHERE id = ?", [req.params.id]);
    return res.json(mapPage(row, await listFields(req.params.id)));
  } catch (err) {
    next(err);
  }
});

pagesRouter.get("/:id/share", async (req, res, next) => {
  try {
    const row = await db.get("SELECT * FROM payment_pages WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Page not found" });
    const base = process.env.BASE_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;
    const publicUrl = `${base.replace(/\/$/, "")}/public/pay/${row.slug}`;
    const iframeSnippet = `<iframe src="${publicUrl}" title="${row.title}" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
    const qrCodeDataUrl = await QRCode.toDataURL(publicUrl);

    return res.json({ publicUrl, iframeSnippet, qrCodeDataUrl });
  } catch (err) {
    next(err);
  }
});
