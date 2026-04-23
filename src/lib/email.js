export function renderConfirmationEmail(template, context) {
  const fallback = [
    `Hi ${context.payerName || "payer"},`,
    "",
    `We received your payment of $${Number(context.amount).toFixed(2)}.`,
    `Transaction ID: ${context.transactionId}`,
    `Date: ${context.date}`,
    "",
    "Thank you.",
  ].join("\n");

  if (!template) return fallback;

  return template
    .replaceAll("{{payer_name}}", context.payerName || "")
    .replaceAll("{{amount}}", Number(context.amount).toFixed(2))
    .replaceAll("{{transaction_id}}", context.transactionId)
    .replaceAll("{{date}}", context.date)
    .replaceAll("{{custom_fields}}", JSON.stringify(context.customFields || {}, null, 2));
}

export async function sendConfirmationEmail({ to, subject, body }) {
  // Hackathon-safe stub: logs payload while preserving async call boundary.
  console.log("EMAIL_STUB", { to, subject, body });
}
