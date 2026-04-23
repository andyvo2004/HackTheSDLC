import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("Supabase env vars are missing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}

export const supabaseAdmin = createClient(
  supabaseUrl || "https://invalid-project.supabase.co",
  supabaseServiceRoleKey || "missing-key",
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

export function supabaseConfigured() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

export function isUniqueViolation(error) {
  return error?.code === "23505";
}
