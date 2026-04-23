export function localizeSeededText(text, t) {
  const source = String(text || "").trim();
  if (!source) return text;

  const keyBySeededEnglish = {
    "Demo Payment Page": "demoPaymentPageTitle",
    "Secure, self-service payment experience": "secureSelfServiceExperience",
    "Thank you for choosing our organization": "thankYouChoosingOrg",
    "Need help? Reach our billing support team.": "needHelpBillingSupport",
  };

  const key = keyBySeededEnglish[source];
  if (!key) return text;
  return t(key, { defaultValue: text });
}
