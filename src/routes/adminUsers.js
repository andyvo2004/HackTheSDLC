import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { isUniqueViolation, supabaseAdmin } from "../lib/supabaseAdmin.js";

const roleSchema = z.enum(["viewer", "editor", "owner"]);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: roleSchema.default("viewer"),
});

const updateRoleSchema = z.object({
  role: roleSchema,
});

const resetPasswordSchema = z.object({
  password: z.string().min(8),
});

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

export const adminUsersRouter = Router();

adminUsersRouter.get("/", async (_req, res, next) => {
  try {
    const { data: users, error } = await supabaseAdmin
      .from("admin_users")
      .select("id,email,role,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.json(users.map(mapUser));
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const { email, password, role } = parsed.data;
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const { error: insertError } = await supabaseAdmin.from("admin_users").insert({
      id,
      email: email.trim().toLowerCase(),
      password_hash: hash,
      role,
      created_at: createdAt,
    });
    if (insertError) throw insertError;

    const { data: created, error: createdError } = await supabaseAdmin
      .from("admin_users")
      .select("id,email,role,created_at")
      .eq("id", id)
      .single();
    if (createdError) throw createdError;
    return res.status(201).json(mapUser(created));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "User with this email already exists" });
    }
    next(err);
  }
});

adminUsersRouter.patch("/:id/role", async (req, res, next) => {
  try {
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { data: target, error: targetError } = await supabaseAdmin
      .from("admin_users")
      .select("id,role")
      .eq("id", req.params.id)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return res.status(404).json({ error: "User not found" });

    if (target.id === req.user.sub && parsed.data.role !== "owner") {
      return res.status(400).json({ error: "You cannot demote your own owner account" });
    }

    const { error: updateError } = await supabaseAdmin
      .from("admin_users")
      .update({ role: parsed.data.role })
      .eq("id", req.params.id);
    if (updateError) throw updateError;

    const { data: updated, error: updatedError } = await supabaseAdmin
      .from("admin_users")
      .select("id,email,role,created_at")
      .eq("id", req.params.id)
      .single();
    if (updatedError) throw updatedError;
    return res.json(mapUser(updated));
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.patch("/:id/password", async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const { data: target, error: targetError } = await supabaseAdmin
      .from("admin_users")
      .select("id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return res.status(404).json({ error: "User not found" });

    const hash = await bcrypt.hash(parsed.data.password, 10);
    const { error: updateError } = await supabaseAdmin
      .from("admin_users")
      .update({ password_hash: hash })
      .eq("id", req.params.id);
    if (updateError) throw updateError;
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
