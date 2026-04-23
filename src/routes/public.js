import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { renderConfirmationEmail, sendConfirmationEmail } from "../lib/email.js";
import { dollarsToCents, getStripeClient, stripeEnabled } from "../lib/stripe.js";
import { broadcastPaymentEvent } from "../feed.js";

export const publicRouter = Router();

function mapField(field) {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    options: field.options_json ? JSON.parse(field.options_json) : [],
    required: Boolean(field.required),
    placeholder: field.placeholder,
    helperText: field.helper_text,
    order: field.display_order,
  };
}

function resolveAmount(page, inputAmount) {
  if (page.amount_mode === "fixed") return Number(page.fixed_amount || 0);
  const amount = Number(inputAmount);
  if (Number.isNaN(amount)) return null;
  if (page.amount_mode === "range") {
    if (page.min_amount != null && amount < page.min_amount) return null;
    if (page.max_amount != null && amount > page.max_amount) return null;
  }
  return amount;
}

publicRouter.get("/pay/:slug", async (req, res, next) => {
  try {
    const { data: page, error: pageError } = await supabaseAdmin
      .from("payment_pages")
      .select("*")
      .eq("slug", req.params.slug)
      .maybeSingle();
    if (pageError) throw pageError;
    if (!page || !page.is_active) return res.status(404).json({ error: "Payment page not found" });
    const { error: viewError } = await supabaseAdmin.from("page_views").insert({
      id: uuidv4(),
      page_id: page.id,
      visited_at: new Date().toISOString(),
    });
    if (viewError) throw viewError;

    const { data: fields, error: fieldsError } = await supabaseAdmin
      .from("custom_fields")
      .select("*")
      .eq("page_id", page.id)
      .order("display_order", { ascending: true });
    if (fieldsError) throw fieldsError;

    return res.json({
      id: page.id,
      slug: page.slug,
      title: page.title,
      subtitle: page.subtitle,
      description: page.description,
      logoUrl: page.logo_url,
      brandColor: page.brand_color,
      headerMessage: page.header_message,
      footerMessage: page.footer_message,
      amountMode: page.amount_mode,
      fixedAmount: page.fixed_amount,
      minAmount: page.min_amount,
      maxAmount: page.max_amount,
      customFields: fields.map(mapField),
    });
  } catch (err) {
    if (err?.type?.startsWith?.("Stripe")) {
      return res.status(502).json({
        error: "Stripe request failed",
        details: err.message,
      });
    }
    next(err);
  }
});

const submitSchema = z.object({
  amount: z.number().optional(),
  payerName: z.string().optional(),
  payerEmail: z.string().email(),
  paymentMethod: z.enum(["card", "wallet", "ach"]).default("card"),
  achAuthorizationAccepted: z.boolean().optional(),
  fieldResponses: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

function inferMethodFromStripeIntent(intent) {
  const pmTypes = intent.payment_method_types || [];
  if (pmTypes.includes("us_bank_account")) return "ach";
  if (pmTypes.some((type) => ["card", "link"].includes(type))) return "card";
  return "wallet";
}

publicRouter.post("/pay/:slug/create-payment-intent", async (req, res, next) => {
  try {
    if (!stripeEnabled()) {
      return res.status(503).json({ error: "Stripe is not configured" });
    }
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { data: page, error: pageError } = await supabaseAdmin
      .from("payment_pages")
      .select("*")
      .eq("slug", req.params.slug)
      .maybeSingle();
    if (pageError) throw pageError;
    if (!page || !page.is_active) return res.status(404).json({ error: "Payment page not found" });

    const { data: fields, error: fieldsError } = await supabaseAdmin
      .from("custom_fields")
      .select("*")
      .eq("page_id", page.id);
    if (fieldsError) throw fieldsError;
    const amount = resolveAmount(page, parsed.data.amount);
    if (amount == null || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount for this payment page" });
    }
    if (parsed.data.paymentMethod === "ach" && !parsed.data.achAuthorizationAccepted) {
      return res.status(400).json({
        error: "ACH authorization must be accepted before submission",
      });
    }

    for (const field of fields) {
      const val = parsed.data.fieldResponses[field.id];
      if (field.required && (val === undefined || val === null || val === "")) {
        return res.status(400).json({ error: `Field "${field.label}" is required` });
      }
    }

    const txnId = uuidv4();
    const now = new Date().toISOString();
    const stripe = getStripeClient();
    const requestedMethod = parsed.data.paymentMethod === "ach" ? "us_bank_account" : "card";

    const intentParams = {
      amount: dollarsToCents(amount),
      currency: "usd",
      payment_method_types: [requestedMethod],
      receipt_email: parsed.data.payerEmail,
      description: `QPP payment for ${page.title}`,
      metadata: {
        transaction_id: txnId,
        page_id: page.id,
        page_slug: page.slug,
        payment_type: parsed.data.paymentMethod,
      },
    };

    if (requestedMethod === "us_bank_account") {
      intentParams.payment_method_options = {
        us_bank_account: {
          financial_connections: { permissions: ["payment_method"] },
          verification_method: "automatic",
        },
      };
    }

    const intent = await stripe.paymentIntents.create(intentParams);

    const { error: txError } = await supabaseAdmin.from("transactions").insert({
      id: txnId,
      page_id: page.id,
      amount,
      payment_method: parsed.data.paymentMethod,
      status: "pending",
      payer_name: parsed.data.payerName || null,
      payer_email: parsed.data.payerEmail,
      processor_ref: intent.id,
      stripe_payment_intent_id: intent.id,
      gl_codes_json: page.gl_codes_json || "[]",
      created_at: now,
    });
    if (txError) throw txError;

    for (const field of fields) {
      const val = parsed.data.fieldResponses[field.id];
      if (val !== undefined) {
        const { error } = await supabaseAdmin.from("field_responses").insert({
          id: uuidv4(),
          transaction_id: txnId,
          field_id: field.id,
          value: String(val),
        });
        if (error) throw error;
      }
    }

    return res.status(201).json({
      transactionId: txnId,
      status: "pending",
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
    });
  } catch (err) {
    if (err?.type?.startsWith?.("Stripe")) {
      return res.status(502).json({
        error: "Stripe request failed",
        details: err.message,
      });
    }
    next(err);
  }
});

publicRouter.post("/pay/:slug/confirm", async (req, res, next) => {
  try {
    if (!stripeEnabled()) {
      return res.status(503).json({ error: "Stripe is not configured" });
    }
    const { paymentIntentId } = req.body || {};
    if (!paymentIntentId) {
      return res.status(400).json({ error: "paymentIntentId is required" });
    }

    const { data: tx, error: txError } = await supabaseAdmin
      .from("transactions")
      .select("*,payment_pages!inner(title,slug,email_template,owner_user_id)")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (txError) throw txError;
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const mappedStatus =
      intent.status === "succeeded"
        ? "success"
        : intent.status === "canceled" || intent.status === "requires_payment_method"
          ? "failed"
          : "pending";

    const { error: updateError } = await supabaseAdmin
      .from("transactions")
      .update({
        status: mappedStatus,
        processor_ref: intent.id,
        payment_method: inferMethodFromStripeIntent(intent),
      })
      .eq("id", tx.id);
    if (updateError) throw updateError;

    const pageDetails = Array.isArray(tx.payment_pages) ? tx.payment_pages[0] : tx.payment_pages;

    if (mappedStatus === "success") {
      broadcastPaymentEvent({
        ownerUserId: pageDetails?.owner_user_id || null,
        type: "payment_succeeded",
        transaction_id: tx.id,
        amount: tx.amount,
        currency: "usd",
        payer_name: tx.payer_name || "Anonymous",
        page_title: pageDetails?.title,
        page_slug: pageDetails?.slug,
        created_at: new Date().toISOString(),
      });

      if (tx.payer_email && pageDetails?.title) {
        const { data: fieldRows, error: fieldRowsError } = await supabaseAdmin
          .from("field_responses")
          .select("value,custom_fields!inner(label)")
          .eq("transaction_id", tx.id);
        if (fieldRowsError) throw fieldRowsError;
        const customFields = {};
        for (const row of fieldRows || []) {
          const field = Array.isArray(row.custom_fields) ? row.custom_fields[0] : row.custom_fields;
          if (field?.label) {
            customFields[field.label] = row.value;
          }
        }
        const context = {
          payerName: tx.payer_name,
          amount: tx.amount,
          transactionId: tx.id,
          date: tx.created_at,
          customFields,
        };
        const emailBody = renderConfirmationEmail(pageDetails?.email_template, context);
        await sendConfirmationEmail({
          to: tx.payer_email,
          subject: `Payment confirmation - ${pageDetails.title}`,
          body: emailBody,
        });
      }
    }

    return res.json({
      transactionId: tx.id,
      status: mappedStatus,
      paymentIntentId: intent.id,
      stripeStatus: intent.status,
      paymentMethod: inferMethodFromStripeIntent(intent),
    });
  } catch (err) {
    next(err);
  }
});
