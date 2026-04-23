import { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { useI18n } from "../i18n.js";

export default function AchForm({ amount, onSuccess, onError }) {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [mandateAccepted, setMandateAccepted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || !mandateAccepted) return;

    setLoading(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/pay/success` },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <div className="ach-mandate" role="region" aria-label={t("achAuthorization", { defaultValue: "ACH Authorization" })}>
        <h3 className="ach-mandate__title">{t("bankTransferAuthorization", { defaultValue: "Bank Transfer Authorization" })}</h3>
        <p className="ach-mandate__text">
          {t("achMandateIntro", {
            defaultValue:
              'By clicking "Initiate Transfer", you authorize this organization to initiate an ACH debit entry to your bank account for',
          })}{" "}
          <strong>${(amount / 100).toFixed(2)}</strong>.
        </p>
        <p className="ach-mandate__processing-time">
          {t("achProcessingTime", { defaultValue: "ACH transfers take" })} <strong>{t("twoToThreeBusinessDays", { defaultValue: "2–3 business days" })}</strong> {t("toProcess", { defaultValue: "to process." })}
        </p>
        <label className="ach-mandate__checkbox-row">
          <input
            type="checkbox"
            checked={mandateAccepted}
            onChange={(e) => setMandateAccepted(e.target.checked)}
            required
          />
          <span>{t("achAuthorization", { defaultValue: "I authorize this bank transfer and accept the terms above." })} *</span>
        </label>
      </div>

      <PaymentElement options={{ layout: 'tabs' }} />

      <button
        type="submit"
        disabled={loading || !mandateAccepted}
        className="btn btn-primary btn-full pay-btn"
      >
        {loading
          ? t("processing", { defaultValue: "Processing..." })
          : t("initiateBankTransfer", { defaultValue: "Initiate Bank Transfer" })}
      </button>
    </form>
  );
}
