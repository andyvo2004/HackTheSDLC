import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db.js";
import { signToken } from "../lib/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();
const SUPABASE_PASSWORD_MARKER = "__supabase_managed__";
const DEFAULT_COMPANY_ROLE = "owner";
const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME || "admin";
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "superadmin";

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

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "super_admin") {
    return res.status(403).json({ error: "Super admin access required" });
  }
  return next();
}

authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const loginIdentifier = typeof email === "string" ? email.trim() : "";
    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (loginIdentifier === SUPER_ADMIN_USERNAME && password === SUPER_ADMIN_PASSWORD) {
      const token = signToken({
        sub: "super_admin",
        email: SUPER_ADMIN_USERNAME,
        role: "super_admin",
      });
      return res.json({
        token,
        user: { id: "super_admin", email: SUPER_ADMIN_USERNAME, role: "super_admin" },
      });
    }

    const normalizedEmail = loginIdentifier.toLowerCase();
    const user = await db.get("SELECT * FROM admin_users WHERE email = ?", [normalizedEmail]);
    let resolvedUser = null;

    if (user && user.password_hash !== SUPABASE_PASSWORD_MARKER) {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: "Invalid credentials" });
      resolvedUser = { id: user.id, email: user.email, role: user.role || "owner" };
    } else {
      const supabaseAuth = await supabasePasswordSignIn(normalizedEmail, password);
      if (!supabaseAuth?.user) return res.status(401).json({ error: "Invalid credentials" });
      const existingSupabaseUser = await db.get("SELECT id, email, role FROM admin_users WHERE email = ?", [
        (supabaseAuth.user.email || normalizedEmail).toLowerCase(),
      ]);
      if (!existingSupabaseUser) {
        const pending = await db.get(
          "SELECT id FROM company_account_requests WHERE email = ? AND status = 'pending'",
          [(supabaseAuth.user.email || normalizedEmail).toLowerCase()],
        );
        return res.status(403).json({
          error: pending
            ? "Your account request is pending super admin approval."
            : "No approved company account found.",
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
    const {
      companyName,
      companyLogoUrl,
      email,
      password,
      authMethod = "password",
    } = req.body || {};
    if (!companyName || !companyLogoUrl || !email || !password) {
      return res.status(400).json({
        error: "Company name, company logo, email, and password are required",
      });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existingPending = await db.get(
      "SELECT id FROM company_account_requests WHERE email = ? AND status = 'pending'",
      [normalizedEmail],
    );
    if (existingPending) {
      return res.status(409).json({ error: "A pending request already exists for this email." });
    }
    await db.run("DELETE FROM company_account_requests WHERE email = ?", [normalizedEmail]);

    const now = new Date().toISOString();
    const requestId = uuidv4();
    await db.run(
      `INSERT INTO company_account_requests
       (id, company_name, company_logo_url, email, password_hash, plain_password, auth_method, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        requestId,
        companyName.trim(),
        companyLogoUrl,
        normalizedEmail,
        password,
        password,
        authMethod,
        now,
      ],
    );

    return res.status(201).json({
      message: "Request submitted. A super admin must approve this account before login.",
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

    return res.status(403).json({
      error: "Account pending approval or not found.",
      code: "APPROVAL_REQUIRED",
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/company-requests", requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    const requests = await db.all(
      `SELECT id, company_name, company_logo_url, email, auth_method, status, created_at
       FROM company_account_requests
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
    );
    return res.json(
      requests.map((row) => ({
        id: row.id,
        companyName: row.company_name,
        companyLogoUrl: row.company_logo_url,
        email: row.email,
        authMethod: row.auth_method,
        status: row.status,
        createdAt: row.created_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  "/company-requests/:id/approve",
  requireAuth,
  requireSuperAdmin,
  async (req, res, next) => {
    try {
      const request = await db.get(
        "SELECT * FROM company_account_requests WHERE id = ? AND status = 'pending'",
        [req.params.id],
      );
      if (!request) {
        return res.status(404).json({ error: "Pending request not found" });
      }
      if (!hasSupabaseConfig) {
        return res.status(500).json({ error: "Supabase auth is not configured on the backend" });
      }

      let supabaseUser = null;
      let approvalWarning = "";
      try {
        const signupPayload = await supabaseSignUp(
          request.email,
          request.plain_password || request.password_hash,
        );
        supabaseUser = signupPayload?.user || null;
      } catch (err) {
        const message = String(err?.message || "");
        if (
          message.toLowerCase().includes("rate limit") ||
          message.toLowerCase().includes("already registered")
        ) {
          approvalWarning =
            "Supabase user provisioning was skipped due to provider limits. Local access is active.";
        } else {
          throw err;
        }
      }
      const user = await ensureLocalUser({
        email: supabaseUser?.email || request.email,
        supabaseUserId: supabaseUser?.id,
        role: DEFAULT_COMPANY_ROLE,
        companyName: request.company_name,
        companyLogoUrl: request.company_logo_url,
      });
      const localPasswordHash = await bcrypt.hash(
        request.plain_password || request.password_hash,
        10,
      );
      await db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", [
        localPasswordHash,
        user.id,
      ]);

      await db.run(
        `UPDATE company_account_requests
         SET status = 'approved', reviewed_at = ?, reviewed_by = ?, plain_password = ''
         WHERE id = ?`,
        [new Date().toISOString(), req.user.sub, request.id],
      );
      return res.json({ approved: true, user, warning: approvalWarning || undefined });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === "super_admin") {
      return res.json({
        id: "super_admin",
        email: SUPER_ADMIN_USERNAME,
        role: "super_admin",
        createdAt: null,
      });
    }
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
