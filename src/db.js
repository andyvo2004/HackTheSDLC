import crypto from "node:crypto";
import { supabaseAdmin, supabaseConfigured } from "./lib/supabaseAdmin.js";

async function maybeSeedDemoData(defaultOwnerUserId = null) {
  const { data: existingPage } = await supabaseAdmin
    .from("payment_pages")
    .select("id")
    .eq("slug", "yoga-class")
    .maybeSingle();
  if (existingPage) return;

  const now = new Date().toISOString();
  const yogaPageId = crypto.randomUUID();
  const parkingPageId = crypto.randomUUID();

  const { error: pagesError } = await supabaseAdmin.from("payment_pages").insert([
    {
      id: yogaPageId,
      owner_user_id: defaultOwnerUserId,
      slug: "yoga-class",
      title: "Yoga Class Payment",
      subtitle: "Secure class fee checkout",
      description: "Use this page to pay for your upcoming yoga class.",
      logo_url: "",
      brand_color: "#0f63ff",
      header_message: "Thank you for choosing our organization",
      footer_message: "Need help? Reach our billing support team.",
      amount_mode: "fixed",
      fixed_amount: 25,
      gl_codes_json: "[]",
      current_version: 1,
      last_published_at: now,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: parkingPageId,
      owner_user_id: defaultOwnerUserId,
      slug: "parking-fee",
      title: "Parking Fee Payment",
      subtitle: "Pay parking balances online",
      description: "Enter your amount and complete payment for parking services.",
      logo_url: "",
      brand_color: "#1f7a5a",
      header_message: "Complete your secure payment below.",
      footer_message: "Questions? Contact parking support.",
      amount_mode: "range",
      min_amount: 10,
      max_amount: 500,
      gl_codes_json: "[]",
      current_version: 1,
      last_published_at: now,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
  ]);
  if (pagesError) throw pagesError;

  const { error: fieldError } = await supabaseAdmin.from("custom_fields").insert({
    id: crypto.randomUUID(),
    page_id: parkingPageId,
    label: "License Plate",
    type: "text",
    options_json: "[]",
    required: true,
    placeholder: "ABC-1234",
    helper_text: "Enter your vehicle plate number",
    display_order: 0,
  });
  if (fieldError) throw fieldError;
}

export async function initDb({ defaultOwnerUserId = null } = {}) {
  if (!supabaseConfigured()) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  await maybeSeedDemoData(defaultOwnerUserId);
}
