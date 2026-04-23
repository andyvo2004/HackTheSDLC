import { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { useI18n } from "../i18n.js";

export default function CardWalletForm({ onSuccess, onError }) {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/pay/success` },
      redirect: 'if_required',
    });

    if (error) {
      // 2.3.2: Clear error messages for declined or invalid cards
      onError(error.message);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <PaymentElement options={{ layout: 'tabs' }} />
      <button type="submit" disabled={loading} className="btn btn-primary btn-full pay-btn">
        {loading
          ? t("validating", { defaultValue: "Validating..." })
          : t("payNow", { defaultValue: "Pay now" })}
      </button>
    </form>
  );
}
