import express from "express";
import { db } from "../db.js";
import { getStripeClient } from "../lib/stripe.js";
import { renderConfirmationEmail, sendConfirmationEmail } from "../lib/email.js";

function mapStripeStatusToTxStatus(stripeStatus) {
  if (stripeStatus === "succeeded") return "success";
  if (stripeStatus === "canceled" || stripeStatus === "requires_payment_method") return "failed";
  return "pending";
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

      if (event.type.startsWith("payment_intent.")) {
        const pi = event.data.object;
        const status = mapStripeStatusToTxStatus(pi.status);
        const tx = await db.get(
          "SELECT t.*, p.title AS page_title, p.email_template AS page_email_template FROM transactions t JOIN payment_pages p ON p.id = t.page_id WHERE t.stripe_payment_intent_id = ?",
          [pi.id],
        );

        if (tx) {
          await db.run("UPDATE transactions SET status = ?, processor_ref = ? WHERE id = ?", [
            status,
            pi.id,
            tx.id,
          ]);

          if (status === "success" && tx.payer_email) {
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

      return res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  });
}
