import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { initDb } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { pagesRouter } from "./routes/pages.js";
import { publicRouter } from "./routes/public.js";
import { reportsRouter } from "./routes/reports.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireRole, Roles } from "./middleware/requireRole.js";
import { registerStripeWebhook } from "./routes/webhooks.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { feedClients } from "./feed.js";
import { verifyToken } from "./lib/auth.js";
import { supabaseAdmin } from "./lib/supabaseAdmin.js";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(helmet());
app.use(cors());
registerStripeWebhook(app);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "qpp-backend", timestamp: new Date().toISOString() });
});

// QPP public checkout pages are intentionally embeddable via iframe.
// Override helmet's frame-blocking headers for the /pay frontend route.
app.use("/pay", (req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

app.use("/auth", authRouter);
app.use("/admin/pages", requireAuth, pagesRouter);
app.use(
  "/admin/reports",
  requireAuth,
  requireRole([Roles.VIEWER, Roles.EDITOR, Roles.OWNER]),
  reportsRouter,
);
app.use("/admin/users", requireAuth, requireRole([Roles.OWNER]), adminUsersRouter);
app.use("/public", publicRouter);

app.get("/api/feed", (req, res) => {
  const token = req.query.token;
  let userPayload = null;
  try {
    if (!token) throw new Error("Missing token");
    userPayload = verifyToken(token);
  } catch {
    return res.status(401).end();
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30000);

  feedClients.set(res, userPayload.sub);

  req.on("close", () => {
    clearInterval(keepAlive);
    feedClients.delete(res);
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return null;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("admin_users")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing.id;

  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  const { error } = await supabaseAdmin.from("admin_users").insert({
    id,
    email: email.trim().toLowerCase(),
    password_hash: hash,
    role: "owner",
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
  console.log(`Seeded admin user: ${email}`);
  return id;
}

async function bootstrap() {
  const seededAdminId = await seedAdmin();
  await initDb({ defaultOwnerUserId: seededAdminId || null });
  app.listen(port, () => {
    console.log(`QPP backend listening on http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to boot server", err);
  process.exit(1);
});
