import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db.js";
import { signToken } from "../lib/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();
const SUPABASE_PASSWORD_MARKER = "__supabase_managed__";
const DEFAULT_COMPANY_ROLE = "owner";

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

async function supabaseSignUp(email, password, metadata = null) {
  if (!hasSupabaseConfig) return null;
  const body = { email, password };
  if (metadata && typeof metadata === "object") {
    body.data = metadata;
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseApiKey,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = payload?.msg || payload?.error_description || payload?.error || "Signup failed";
    throw new Error(errorMessage);
  }
  return payload;
}

async function ensureLocalUser({
  email,
  supabaseUserId,
  role = DEFAULT_COMPANY_ROLE,
  companyName = null,
  companyLogoUrl = null,
}) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.get("SELECT id, email, role, password_hash FROM admin_users WHERE email = ?", [
    normalizedEmail,
  ]);
  if (existing) {
    if (existing.password_hash !== SUPABASE_PASSWORD_MARKER) {
      await db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", [SUPABASE_PASSWORD_MARKER, existing.id]);
    }
    await db.run(
      "UPDATE admin_users SET role = ?, company_name = ?, company_logo_url = ? WHERE id = ?",
      [role, companyName, companyLogoUrl, existing.id],
    );
    return { id: existing.id, email: existing.email, role };
  }

  const userId = supabaseUserId || uuidv4();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO admin_users
     (id, email, password_hash, role, company_name, company_logo_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, normalizedEmail, SUPABASE_PASSWORD_MARKER, role, companyName, companyLogoUrl, createdAt],
  );
  return { id: userId, email: normalizedEmail, role };
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
    const loginIdentifier = typeof email === "string" ? email.trim() : "";
    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = loginIdentifier.toLowerCase();
    const supabaseAuth = await supabasePasswordSignIn(normalizedEmail, password);
    if (!supabaseAuth?.user) return res.status(401).json({ error: "Invalid credentials" });
    const normalizedSupabaseEmail = (supabaseAuth.user.email || normalizedEmail).toLowerCase();
    let resolvedUser = await db.get("SELECT id, email, role FROM admin_users WHERE email = ?", [
      normalizedSupabaseEmail,
    ]);
    if (!resolvedUser) {
      resolvedUser = await ensureLocalUser({
        email: normalizedSupabaseEmail,
        supabaseUserId: supabaseAuth.user.id,
        role: DEFAULT_COMPANY_ROLE,
        companyName: supabaseAuth.user.user_metadata?.company_name || null,
        companyLogoUrl: supabaseAuth.user.user_metadata?.company_logo_url || null,
      });
    } else {
      resolvedUser = {
        id: resolvedUser.id,
        email: resolvedUser.email,
        role: resolvedUser.role || "viewer",
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
    const {
      companyName,
      companyLogoUrl,
      email,
      password,
    } = req.body || {};
    if (!companyName || !companyLogoUrl || !email || !password) {
      return res.status(400).json({
        error: "Company name, company logo, email, and password are required",
      });
    }
    if (!hasSupabaseConfig) {
      return res.status(500).json({ error: "Supabase auth is not configured on the backend" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    let supabaseUser = null;
    try {
      const signupPayload = await supabaseSignUp(normalizedEmail, password, {
        account_type: "company",
        company_name: companyName.trim(),
        company_logo_url: companyLogoUrl,
      });
      supabaseUser = signupPayload?.user || null;
    } catch (err) {
      const message = String(err?.message || "");
      if (message.toLowerCase().includes("already registered")) {
        return res.status(409).json({
          error: "An account with this email already exists. Please sign in instead.",
        });
      }
      if (message.toLowerCase().includes("rate limit")) {
        return res.status(429).json({
          error:
            "Signup rate limit reached. Please wait a minute before creating another account.",
        });
      }
      throw err;
    }

    if (!supabaseUser?.id) {
      return res.status(502).json({
        error: "Supabase signup did not return a user. Please try again.",
      });
    }

    const user = await ensureLocalUser({
      email: supabaseUser?.email || normalizedEmail,
      supabaseUserId: supabaseUser?.id,
      role: DEFAULT_COMPANY_ROLE,
      companyName: companyName.trim(),
      companyLogoUrl,
    });
    const localPasswordHash = await bcrypt.hash(password, 10);
    await db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", [
      localPasswordHash,
      user.id,
    ]);

    return res.status(201).json({
      message: "Account created successfully. You can now sign in.",
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/supabase/exchange", async (req, res, next) => {
  try {
    const { accessToken } = req.body || {};
    if (!accessToken) {
      return res.status(400).json({ error: "Supabase access token is required" });
    }

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

    const newUser = await ensureLocalUser({
      email: supabaseUser.email,
      supabaseUserId: supabaseUser.id,
      role: DEFAULT_COMPANY_ROLE,
      companyName: supabaseUser.user_metadata?.company_name || null,
      companyLogoUrl: supabaseUser.user_metadata?.company_logo_url || null,
    });
    const token = signToken({ sub: newUser.id, email: newUser.email, role: newUser.role });
    return res.status(201).json({ token, user: newUser });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/dev-login", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Disabled in production" });
    }

    const email = "admin@example.com";
    const existing = await db.get("SELECT id, email, role FROM admin_users WHERE email = ?", [email]);
    let user = existing;

    if (!user) {
      const id = uuidv4();
      const createdAt = new Date().toISOString();
      await db.run(
        `INSERT INTO admin_users
         (id, email, password_hash, role, company_name, company_logo_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, email, SUPABASE_PASSWORD_MARKER, "owner", "Demo Company", null, createdAt],
      );
      user = { id, email, role: "owner" };
    }

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role || "owner",
    });
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role || "owner",
      },
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
