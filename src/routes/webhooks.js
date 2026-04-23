import express from "express";
import { getStripeClient } from "../lib/stripe.js";
import { renderConfirmationEmail, sendConfirmationEmail } from "../lib/email.js";
import { broadcastPaymentEvent } from "../feed.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

function mapStripeStatusToTxStatus(stripeStatus) {
  if (stripeStatus === "succeeded") return "success";
  if (stripeStatus === "canceled" || stripeStatus === "requires_payment_method") return "failed";
  if (stripeStatus === "processing" || stripeStatus === "requires_action") return "pending";
  return "pending";
}

function inferMethodFromStripeIntent(pi) {
  const pmTypes = pi.payment_method_types || [];
  if (pmTypes.includes("us_bank_account")) return "ach";
  if (pmTypes.some((type) => ["card", "link"].includes(type))) return "card";
  return "wallet";
}

export function registerStripeWebhook(app) {
  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(503).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    try {
      const stripe = getStripeClient();
      const sig = req.headers["stripe-signature"];
      const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

      const paymentIntentId =
        event.data?.object?.id?.startsWith?.("pi_")
          ? event.data.object.id
          : event.data?.object?.payment_intent || null;

      const { data: existingEvent, error: existingError } = await supabaseAdmin
        .from("webhook_events")
        .select("id")
        .eq("id", event.id)
        .eq("processor", "stripe")
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingEvent) {
        return res.json({ received: true, duplicate: true });
      }
      const { error: ledgerError } = await supabaseAdmin.from("webhook_events").insert({
        id: event.id,
        processor: "stripe",
        event_type: event.type,
        payment_intent_id: paymentIntentId,
        received_at: new Date().toISOString(),
      });
      if (ledgerError) throw ledgerError;

      if (
        event.type.startsWith("payment_intent.") ||
        event.type === "charge.refunded" ||
        event.type === "charge.dispute.created"
      ) {
        const { data: tx, error: txError } = await supabaseAdmin
          .from("transactions")
          .select("*,payment_pages!inner(title,slug,email_template)")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .maybeSingle();
        if (txError) throw txError;

        if (tx) {
          let nextStatus = tx.status;
          let nextMethod = tx.payment_method;

          if (event.type.startsWith("payment_intent.")) {
            const pi = event.data.object;
            nextStatus = mapStripeStatusToTxStatus(pi.status);
            nextMethod = inferMethodFromStripeIntent(pi);
          } else if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
            nextStatus = "failed";
          }

          const { error: updateError } = await supabaseAdmin
            .from("transactions")
            .update({
              status: nextStatus,
              processor_ref: paymentIntentId || tx.processor_ref,
              payment_method: nextMethod,
            })
            .eq("id", tx.id);
          if (updateError) throw updateError;
          const pageDetails = Array.isArray(tx.payment_pages) ? tx.payment_pages[0] : tx.payment_pages;

          if (event.type === "payment_intent.succeeded" && tx.status !== "success") {
            broadcastPaymentEvent({
              type: "payment_succeeded",
              transaction_id: tx.id,
              amount: tx.amount,
              currency: "usd",
              payer_name: tx.payer_name || "Anonymous",
              page_title: pageDetails?.title,
              page_slug: pageDetails?.slug,
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
              const emailBody = renderConfirmationEmail(pageDetails?.email_template, context);
              await sendConfirmationEmail({
                to: tx.payer_email,
                subject: `Payment confirmation - ${pageDetails?.title || "Payment"}`,
                body: emailBody,
              });
            }
          }
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  });
}
