import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { db } from "../db.js";

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
    const users = await db.all(
      "SELECT id, email, role, created_at FROM admin_users ORDER BY created_at DESC",
    );
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
    await db.run(
      "INSERT INTO admin_users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, email, hash, role, createdAt],
    );

    const created = await db.get(
      "SELECT id, email, role, created_at FROM admin_users WHERE id = ?",
      [id],
    );
    return res.status(201).json(mapUser(created));
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE constraint failed: admin_users.email")) {
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

    const target = await db.get("SELECT id, role FROM admin_users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });

    if (target.id === req.user.sub && parsed.data.role !== "owner") {
      return res.status(400).json({ error: "You cannot demote your own owner account" });
    }

    await db.run("UPDATE admin_users SET role = ? WHERE id = ?", [parsed.data.role, req.params.id]);
    const updated = await db.get(
      "SELECT id, email, role, created_at FROM admin_users WHERE id = ?",
      [req.params.id],
    );
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
    const target = await db.get("SELECT id FROM admin_users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });

    const hash = await bcrypt.hash(parsed.data.password, 10);
    await db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", [hash, req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
