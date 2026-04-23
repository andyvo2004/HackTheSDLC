import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;

export function getStripeClient() {
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return new Stripe(key);
}

export function stripeEnabled() {
  return Boolean(key);
}

export function dollarsToCents(amount) {
  return Math.round(Number(amount) * 100);
}
