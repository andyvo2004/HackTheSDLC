import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Keep the app running with legacy auth, but surface a clear setup error when auth is used.
  console.warn("Supabase env vars are missing: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY");
}

const fallbackError = new Error(
  "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
);

const fallbackSupabaseClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInWithPassword: async () => ({ data: null, error: fallbackError }),
    signInWithOAuth: async () => ({ data: null, error: fallbackError }),
  },
};

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : fallbackSupabaseClient;
