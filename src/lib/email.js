import nodemailer from "nodemailer";

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
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || "no-reply@example.com";

  if (!smtpHost || !smtpUser || !smtpPass) {
    // Safe fallback for hackathon local development.
    console.log("EMAIL_STUB", { to, subject, body });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    text: body,
  });
}
