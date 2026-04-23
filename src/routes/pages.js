import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import { z } from "zod";
import { isUniqueViolation, supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireRole, Roles } from "../middleware/requireRole.js";

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

const glCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Invalid GL code format");

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
  glCodes: z.array(glCodeSchema).default([]),
  emailTemplate: z.string().optional(),
  isActive: z.boolean().default(true),
  customFields: z.array(customFieldSchema).max(10).default([]),
});

export const pagesRouter = Router();

function isMissingOwnerColumnError(err) {
  return err?.code === "42703" && String(err?.message || "").includes("owner_user_id");
}

function ownedPageQuery(userId) {
  return supabaseAdmin.from("payment_pages").select("*").eq("owner_user_id", userId);
}

async function requireOwnedPage(userId, pageId) {
  const { data: page, error } = await ownedPageQuery(userId).eq("id", pageId).maybeSingle();
  if (error && isMissingOwnerColumnError(error)) {
    const { data: legacyPage, error: legacyError } = await supabaseAdmin
      .from("payment_pages")
      .select("*")
      .eq("id", pageId)
      .maybeSingle();
    if (legacyError) throw legacyError;
    return legacyPage;
  }
  if (error) throw error;
  return page;
}

function serializePageConfig(body) {
  return {
    slug: body.slug,
    title: body.title,
    subtitle: body.subtitle || null,
    description: body.description || null,
    logoUrl: body.logoUrl || null,
    brandColor: body.brandColor || null,
    headerMessage: body.headerMessage || null,
    footerMessage: body.footerMessage || null,
    amountMode: body.amountMode,
    fixedAmount: body.fixedAmount ?? null,
    minAmount: body.minAmount ?? null,
    maxAmount: body.maxAmount ?? null,
    glCodes: body.glCodes || [],
    emailTemplate: body.emailTemplate || null,
    isActive: body.isActive ? 1 : 0,
    customFields: body.customFields || [],
  };
}

async function createVersionSnapshot(pageId, versionNumber, configJson, userId) {
  const { error } = await supabaseAdmin.from("payment_page_versions").insert({
    id: uuidv4(),
    page_id: pageId,
    version_number: versionNumber,
    config_json: JSON.stringify(configJson),
    published_by: userId || null,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function applyPageConfig(pageId, config) {
  const now = new Date().toISOString();
  const { error: pageError } = await supabaseAdmin
    .from("payment_pages")
    .update({
      slug: config.slug,
      title: config.title,
      subtitle: config.subtitle,
      description: config.description,
      logo_url: config.logoUrl,
      brand_color: config.brandColor,
      header_message: config.headerMessage,
      footer_message: config.footerMessage,
      amount_mode: config.amountMode,
      fixed_amount: config.fixedAmount,
      min_amount: config.minAmount,
      max_amount: config.maxAmount,
      gl_codes_json: JSON.stringify(config.glCodes || []),
      email_template: config.emailTemplate,
      is_active: Boolean(config.isActive),
      updated_at: now,
    })
    .eq("id", pageId);
  if (pageError) throw pageError;

  const { error: deleteError } = await supabaseAdmin.from("custom_fields").delete().eq("page_id", pageId);
  if (deleteError) throw deleteError;
  for (const field of config.customFields || []) {
    const { error } = await supabaseAdmin.from("custom_fields").insert({
      id: field.id || uuidv4(),
      page_id: pageId,
      label: field.label,
      type: field.type,
      options_json: JSON.stringify(field.options || []),
      required: Boolean(field.required),
      placeholder: field.placeholder || null,
      helper_text: field.helperText || null,
      display_order: field.order ?? 0,
    });
    if (error) throw error;
  }
}

async function listFields(pageId) {
  const { data: fields, error } = await supabaseAdmin
    .from("custom_fields")
    .select("*")
    .eq("page_id", pageId)
    .order("display_order", { ascending: true });
  if (error) throw error;
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
    hasDraft: Boolean(row.draft_config_json),
    currentVersion: Number(row.current_version || 1),
    lastPublishedAt: row.last_published_at,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customFields,
  };
}

pagesRouter.get("/", async (req, res, next) => {
  try {
    let { data: rows, error } = await ownedPageQuery(req.user.sub).order("created_at", { ascending: false });
    if (error && isMissingOwnerColumnError(error)) {
      ({ data: rows, error } = await supabaseAdmin
        .from("payment_pages")
        .select("*")
        .order("created_at", { ascending: false }));
    }
    if (error) throw error;
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
    const row = await requireOwnedPage(req.user.sub, req.params.id);
    if (!row) return res.status(404).json({ error: "Page not found" });
    return res.json(mapPage(row, await listFields(row.id)));
  } catch (err) {
    next(err);
  }
});

pagesRouter.post("/", requireRole([Roles.EDITOR, Roles.OWNER]), async (req, res, next) => {
  try {
    const parsed = pageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const now = new Date().toISOString();
    const pageId = uuidv4();
    const body = parsed.data;

    let { error: pageError } = await supabaseAdmin.from("payment_pages").insert({
      id: pageId,
      owner_user_id: req.user.sub,
      slug: body.slug,
      title: body.title,
      subtitle: body.subtitle || null,
      description: body.description || null,
      logo_url: body.logoUrl || null,
      brand_color: body.brandColor || null,
      header_message: body.headerMessage || null,
      footer_message: body.footerMessage || null,
      amount_mode: body.amountMode,
      fixed_amount: body.fixedAmount ?? null,
      min_amount: body.minAmount ?? null,
      max_amount: body.maxAmount ?? null,
      gl_codes_json: JSON.stringify(body.glCodes || []),
      email_template: body.emailTemplate || null,
      current_version: 1,
      last_published_at: now,
      is_active: Boolean(body.isActive),
      created_at: now,
      updated_at: now,
    });
    if (pageError && isMissingOwnerColumnError(pageError)) {
      ({ error: pageError } = await supabaseAdmin.from("payment_pages").insert({
        id: pageId,
        slug: body.slug,
        title: body.title,
        subtitle: body.subtitle || null,
        description: body.description || null,
        logo_url: body.logoUrl || null,
        brand_color: body.brandColor || null,
        header_message: body.headerMessage || null,
        footer_message: body.footerMessage || null,
        amount_mode: body.amountMode,
        fixed_amount: body.fixedAmount ?? null,
        min_amount: body.minAmount ?? null,
        max_amount: body.maxAmount ?? null,
        gl_codes_json: JSON.stringify(body.glCodes || []),
        email_template: body.emailTemplate || null,
        current_version: 1,
        last_published_at: now,
        is_active: Boolean(body.isActive),
        created_at: now,
        updated_at: now,
      }));
    }
    if (pageError) throw pageError;

    for (const field of body.customFields) {
      const { error } = await supabaseAdmin.from("custom_fields").insert({
        id: uuidv4(),
        page_id: pageId,
        label: field.label,
        type: field.type,
        options_json: JSON.stringify(field.options || []),
        required: Boolean(field.required),
        placeholder: field.placeholder || null,
        helper_text: field.helperText || null,
        display_order: field.order ?? 0,
      });
      if (error) throw error;
    }

    await createVersionSnapshot(pageId, 1, serializePageConfig(body), req.user?.sub);
    const row = await requireOwnedPage(req.user.sub, pageId);
    if (!row) return res.status(404).json({ error: "Page not found" });
    return res.status(201).json(mapPage(row, await listFields(pageId)));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "Slug already exists" });
    }
    next(err);
  }
});

pagesRouter.put("/:id", requireRole([Roles.EDITOR, Roles.OWNER]), async (req, res, next) => {
  try {
    const parsed = pageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const existing = await requireOwnedPage(req.user.sub, req.params.id);
    if (!existing) return res.status(404).json({ error: "Page not found" });

    const body = parsed.data;
    const mode = req.query.mode === "draft" ? "draft" : "publish";
    const config = serializePageConfig(body);

    if (mode === "draft") {
      const { error } = await supabaseAdmin
        .from("payment_pages")
        .update({ draft_config_json: JSON.stringify(config), updated_at: new Date().toISOString() })
        .eq("id", req.params.id);
      if (error) throw error;
    } else {
      const nextVersion = Number(existing.current_version || 1) + 1;
      await applyPageConfig(req.params.id, config);
      const { error } = await supabaseAdmin
        .from("payment_pages")
        .update({
          draft_config_json: null,
          current_version: nextVersion,
          last_published_at: new Date().toISOString(),
        })
        .eq("id", req.params.id);
      if (error) throw error;
      await createVersionSnapshot(req.params.id, nextVersion, config, req.user?.sub);
    }

    const row = await requireOwnedPage(req.user.sub, req.params.id);
    if (!row) return res.status(404).json({ error: "Page not found" });
    return res.json(mapPage(row, await listFields(req.params.id)));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "Slug already exists" });
    }
    next(err);
  }
});

pagesRouter.patch(
  "/:id/status",
  requireRole([Roles.EDITOR, Roles.OWNER]),
  async (req, res, next) => {
    try {
      const isActive = Boolean(req.body?.isActive);
      let { data: row, error } = await supabaseAdmin
        .from("payment_pages")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("owner_user_id", req.user.sub)
        .eq("id", req.params.id)
        .select("*")
        .maybeSingle();
      if (error && isMissingOwnerColumnError(error)) {
        ({ data: row, error } = await supabaseAdmin
          .from("payment_pages")
          .update({ is_active: isActive, updated_at: new Date().toISOString() })
          .eq("id", req.params.id)
          .select("*")
          .maybeSingle());
      }
      if (error) throw error;
      if (!row) return res.status(404).json({ error: "Page not found" });
      return res.json(mapPage(row, await listFields(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

pagesRouter.get("/:id/versions", async (req, res, next) => {
  try {
    const ownedPage = await requireOwnedPage(req.user.sub, req.params.id);
    if (!ownedPage) return res.status(404).json({ error: "Page not found" });
    const { data: rows, error } = await supabaseAdmin
      .from("payment_page_versions")
      .select("version_number,published_by,created_at")
      .eq("page_id", req.params.id)
      .order("version_number", { ascending: false });
    if (error) throw error;
    return res.json(
      rows.map((v) => ({
        versionNumber: v.version_number,
        publishedBy: v.published_by,
        createdAt: v.created_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});

pagesRouter.post("/:id/publish", requireRole([Roles.EDITOR, Roles.OWNER]), async (req, res, next) => {
  try {
    const row = await requireOwnedPage(req.user.sub, req.params.id);
    if (!row) return res.status(404).json({ error: "Page not found" });
    if (!row.draft_config_json) return res.status(400).json({ error: "No draft changes to publish" });

    const config = JSON.parse(row.draft_config_json);
    const nextVersion = Number(row.current_version || 1) + 1;
    await applyPageConfig(req.params.id, config);
    const { error: updateError } = await supabaseAdmin
      .from("payment_pages")
      .update({
        draft_config_json: null,
        current_version: nextVersion,
        last_published_at: new Date().toISOString(),
      })
      .eq("id", req.params.id);
    if (updateError) throw updateError;
    await createVersionSnapshot(req.params.id, nextVersion, config, req.user?.sub);

    const updated = await requireOwnedPage(req.user.sub, req.params.id);
    if (!updated) return res.status(404).json({ error: "Page not found" });
    return res.json(mapPage(updated, await listFields(req.params.id)));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "Slug already exists. Update draft slug before publishing." });
    }
    next(err);
  }
});

pagesRouter.post("/:id/rollback", requireRole([Roles.EDITOR, Roles.OWNER]), async (req, res, next) => {
  try {
    const { versionNumber } = req.body || {};
    if (!versionNumber) return res.status(400).json({ error: "versionNumber is required" });

    const page = await requireOwnedPage(req.user.sub, req.params.id);
    if (!page) return res.status(404).json({ error: "Page not found" });

    const { data: version, error: versionError } = await supabaseAdmin
      .from("payment_page_versions")
      .select("*")
      .eq("page_id", req.params.id)
      .eq("version_number", Number(versionNumber))
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version) return res.status(404).json({ error: "Version not found" });

    const config = JSON.parse(version.config_json);
    const nextVersion = Number(page.current_version || 1) + 1;
    await applyPageConfig(req.params.id, config);
    const { error: updateError } = await supabaseAdmin
      .from("payment_pages")
      .update({
        draft_config_json: null,
        current_version: nextVersion,
        last_published_at: new Date().toISOString(),
      })
      .eq("id", req.params.id);
    if (updateError) throw updateError;
    await createVersionSnapshot(req.params.id, nextVersion, config, req.user?.sub);

    const updated = await requireOwnedPage(req.user.sub, req.params.id);
    if (!updated) return res.status(404).json({ error: "Page not found" });
    return res.json(mapPage(updated, await listFields(req.params.id)));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "Rollback slug conflicts with an existing page slug." });
    }
    next(err);
  }
});

pagesRouter.get("/:id/share", async (req, res, next) => {
  try {
    const row = await requireOwnedPage(req.user.sub, req.params.id);
    if (!row) return res.status(404).json({ error: "Page not found" });
    const base = process.env.BASE_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;
    const publicUrl = `${base.replace(/\/$/, "")}/pay/${row.slug}`;
    const iframeSnippet = [
      `<iframe`,
      `  src="${publicUrl}"`,
      `  title="${row.title}"`,
      `  width="100%"`,
      `  height="720"`,
      `  style="border:0;max-width:100%;border-radius:12px;"`,
      `  loading="lazy"`,
      `  referrerpolicy="strict-origin-when-cross-origin"`,
      `></iframe>`,
    ].join("\n");
    const qrCodeDataUrl = await QRCode.toDataURL(publicUrl);

    return res.json({ publicUrl, iframeSnippet, qrCodeDataUrl });
  } catch (err) {
    next(err);
  }
});
