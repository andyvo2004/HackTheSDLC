import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { signToken } from "../lib/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await db.get("SELECT * FROM admin_users WHERE email = ?", [email]);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken({ sub: user.id, email: user.email, role: user.role || "owner" });
    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role || "owner" },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await db.get("SELECT id, email, role, created_at FROM admin_users WHERE id = ?", [
      req.user.sub,
    ]);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({
      id: user.id,
      email: user.email,
      role: user.role || "viewer",
      createdAt: user.created_at,
    });
  } catch (err) {
    next(err);
  }
});
