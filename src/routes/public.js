import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { db } from "../db.js";
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
    const page = await db.get("SELECT * FROM payment_pages WHERE slug = ?", [req.params.slug]);
    if (!page || !page.is_active) return res.status(404).json({ error: "Payment page not found" });
    await db.run("INSERT INTO page_views (id, page_id, visited_at) VALUES (?, ?, ?)", [
      uuidv4(),
      page.id,
      new Date().toISOString(),
    ]);

    const fields = await db.all(
      "SELECT * FROM custom_fields WHERE page_id = ? ORDER BY display_order ASC",
      [page.id],
    );

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

    const page = await db.get("SELECT * FROM payment_pages WHERE slug = ?", [req.params.slug]);
    if (!page || !page.is_active) return res.status(404).json({ error: "Payment page not found" });

    const fields = await db.all("SELECT * FROM custom_fields WHERE page_id = ?", [page.id]);
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
    const intent = await stripe.paymentIntents.create({
      amount: dollarsToCents(amount),
      currency: "usd",
      receipt_email: parsed.data.payerEmail,
      description: `QPP payment for ${page.title}`,
      metadata: {
        transaction_id: txnId,
        page_id: page.id,
        page_slug: page.slug,
      },
      automatic_payment_methods: { enabled: true },
    });

    await db.run(
      `INSERT INTO transactions
      (id, page_id, amount, payment_method, status, payer_name, payer_email, processor_ref, stripe_payment_intent_id, gl_codes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txnId,
        page.id,
        amount,
        parsed.data.paymentMethod,
        "pending",
        parsed.data.payerName || null,
        parsed.data.payerEmail,
        intent.id,
        intent.id,
        page.gl_codes_json || "[]",
        now,
      ],
    );

    for (const field of fields) {
      const val = parsed.data.fieldResponses[field.id];
      if (val !== undefined) {
        await db.run(
          "INSERT INTO field_responses (id, transaction_id, field_id, value) VALUES (?, ?, ?, ?)",
          [uuidv4(), txnId, field.id, String(val)],
        );
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

    const tx = await db.get(
      "SELECT t.*, p.title AS page_title, p.slug AS page_slug, p.email_template AS page_email_template FROM transactions t JOIN payment_pages p ON p.id = t.page_id WHERE t.stripe_payment_intent_id = ?",
      [paymentIntentId],
    );
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const mappedStatus =
      intent.status === "succeeded"
        ? "success"
        : intent.status === "canceled" || intent.status === "requires_payment_method"
          ? "failed"
          : "pending";

    await db.run(
      "UPDATE transactions SET status = ?, processor_ref = ?, payment_method = ? WHERE id = ?",
      [mappedStatus, intent.id, inferMethodFromStripeIntent(intent), tx.id],
    );

    if (mappedStatus === "success") {
      broadcastPaymentEvent({
        type: "payment_succeeded",
        transaction_id: tx.id,
        amount: tx.amount,
        currency: "usd",
        payer_name: tx.payer_name || "Anonymous",
        page_title: tx.page_title,
        page_slug: tx.page_slug,
        created_at: new Date().toISOString(),
      });

      if (tx.payer_email) {
        const context = {
          payerName: tx.payer_name,
          amount: tx.amount,
          transactionId: tx.id,
          date: tx.created_at,
          customFields: {},
        };
        const emailBody = renderConfirmationEmail(tx.page_email_template, context);
        await sendConfirmationEmail({
          to: tx.payer_email,
          subject: `Payment confirmation - ${tx.page_title}`,
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
