import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db.js";
import { signToken } from "../lib/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();
const SUPABASE_PASSWORD_MARKER = "__supabase_managed__";
const ALLOWED_ROLES = new Set(["viewer", "editor", "owner"]);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseApiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseApiKey);

async function supabasePasswordSignIn(email, password) {
  if (!hasSupabaseConfig) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseApiKey,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return null;
  return response.json();
}

async function supabaseSignUp(email, password) {
  if (!hasSupabaseConfig) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseApiKey,
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = payload?.msg || payload?.error_description || payload?.error || "Signup failed";
    throw new Error(errorMessage);
  }
  return payload;
}

function normalizeRequestedRole(role) {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

async function ensureLocalUser({ email, supabaseUserId }) {
  const existing = await db.get("SELECT id, email, role, password_hash FROM admin_users WHERE email = ?", [email]);
  if (existing) {
    if (existing.password_hash !== SUPABASE_PASSWORD_MARKER) {
      await db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", [SUPABASE_PASSWORD_MARKER, existing.id]);
    }
    return { id: existing.id, email: existing.email, role: existing.role || "owner" };
  }

  const userId = supabaseUserId || uuidv4();
  const createdAt = new Date().toISOString();
  await db.run(
    "INSERT INTO admin_users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    [userId, email, SUPABASE_PASSWORD_MARKER, "owner", createdAt],
  );
  return { id: userId, email, role: "owner" };
}

async function ensureLocalUserWithRole({ email, supabaseUserId, role }) {
  const existing = await db.get("SELECT id, email, role, password_hash FROM admin_users WHERE email = ?", [email]);
  if (existing) {
    if (existing.password_hash !== SUPABASE_PASSWORD_MARKER) {
      await db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", [SUPABASE_PASSWORD_MARKER, existing.id]);
    }
    if (existing.role !== role) {
      await db.run("UPDATE admin_users SET role = ? WHERE id = ?", [role, existing.id]);
    }
    return { id: existing.id, email: existing.email, role };
  }

  const userId = supabaseUserId || uuidv4();
  const createdAt = new Date().toISOString();
  await db.run(
    "INSERT INTO admin_users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    [userId, email, SUPABASE_PASSWORD_MARKER, role, createdAt],
  );
  return { id: userId, email, role };
}

async function fetchSupabaseUserFromAccessToken(accessToken) {
  if (!hasSupabaseConfig) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseApiKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;
  return response.json();
}

authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await db.get("SELECT * FROM admin_users WHERE email = ?", [email]);
    let resolvedUser = null;

    // Keep existing local password flow for legacy users.
    if (user && user.password_hash !== SUPABASE_PASSWORD_MARKER) {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: "Invalid credentials" });
      resolvedUser = { id: user.id, email: user.email, role: user.role || "owner" };
    } else {
      // Supabase-backed flow.
      const supabaseAuth = await supabasePasswordSignIn(email, password);
      if (!supabaseAuth?.user) return res.status(401).json({ error: "Invalid credentials" });
      const existingSupabaseUser = await db.get("SELECT id, email, role FROM admin_users WHERE email = ?", [
        supabaseAuth.user.email || email,
      ]);
      if (!existingSupabaseUser) {
        return res.status(403).json({
          error: "No app profile found. Please sign up and select an account type first.",
        });
      }
      resolvedUser = {
        id: existingSupabaseUser.id,
        email: existingSupabaseUser.email,
        role: existingSupabaseUser.role || "viewer",
      };
    }

    const token = signToken({ sub: resolvedUser.id, email: resolvedUser.email, role: resolvedUser.role });
    return res.json({
      token,
      user: resolvedUser,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/signup", async (req, res, next) => {
  try {
    const { email, password, role } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const normalizedRole = normalizeRequestedRole(role);
    if (!ALLOWED_ROLES.has(normalizedRole)) {
      return res.status(400).json({ error: "A valid account type is required (viewer, editor, owner)" });
    }
    if (!hasSupabaseConfig) {
      return res.status(500).json({ error: "Supabase auth is not configured on the backend" });
    }

    const signupPayload = await supabaseSignUp(email, password);
    const supabaseUser = signupPayload?.user;

    await ensureLocalUserWithRole({
      email: supabaseUser?.email || email,
      supabaseUserId: supabaseUser?.id,
      role: normalizedRole,
    });

    return res.status(201).json({
      message: "Signup successful. Please confirm your email before signing in.",
      requiresEmailConfirmation: true,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/supabase/exchange", async (req, res, next) => {
  try {
    const { accessToken, role } = req.body || {};
    if (!accessToken) {
      return res.status(400).json({ error: "Supabase access token is required" });
    }
    const normalizedRole = normalizeRequestedRole(role);

    const supabaseUser = await fetchSupabaseUserFromAccessToken(accessToken);
    if (!supabaseUser?.email) {
      return res.status(401).json({ error: "Invalid Supabase session" });
    }

    const existing = await db.get("SELECT id, email, role FROM admin_users WHERE email = ?", [supabaseUser.email]);
    if (existing) {
      const token = signToken({
        sub: existing.id,
        email: existing.email,
        role: existing.role || "viewer",
      });
      return res.json({
        token,
        user: { id: existing.id, email: existing.email, role: existing.role || "viewer" },
      });
    }

    if (!ALLOWED_ROLES.has(normalizedRole)) {
      return res.status(400).json({
        error: "Account type required for first login",
        code: "ROLE_REQUIRED",
      });
    }

    const newUser = await ensureLocalUserWithRole({
      email: supabaseUser.email,
      supabaseUserId: supabaseUser.id,
      role: normalizedRole,
    });
    const token = signToken({ sub: newUser.id, email: newUser.email, role: newUser.role });
    return res.status(201).json({ token, user: newUser });
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
