import express from "express";
import { db } from "../db.js";
import { getStripeClient } from "../lib/stripe.js";
import { renderConfirmationEmail, sendConfirmationEmail } from "../lib/email.js";
import { broadcastPaymentEvent } from "../feed.js";

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

      const ledgerResult = await db.run(
        "INSERT OR IGNORE INTO webhook_events (id, processor, event_type, payment_intent_id, received_at) VALUES (?, ?, ?, ?, ?)",
        [event.id, "stripe", event.type, paymentIntentId, new Date().toISOString()],
      );
      if (Number(ledgerResult.changes || 0) === 0) {
        return res.json({ received: true, duplicate: true });
      }

      if (
        event.type.startsWith("payment_intent.") ||
        event.type === "charge.refunded" ||
        event.type === "charge.dispute.created"
      ) {
        const tx = await db.get(
          "SELECT t.*, p.title AS page_title, p.slug AS page_slug, p.email_template AS page_email_template FROM transactions t JOIN payment_pages p ON p.id = t.page_id WHERE t.stripe_payment_intent_id = ?",
          [paymentIntentId],
        );

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

          await db.run(
            "UPDATE transactions SET status = ?, processor_ref = COALESCE(?, processor_ref), payment_method = ? WHERE id = ?",
            [nextStatus, paymentIntentId, nextMethod, tx.id],
          );

          if (event.type === "payment_intent.succeeded" && tx.status !== "success") {
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
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  });
}
