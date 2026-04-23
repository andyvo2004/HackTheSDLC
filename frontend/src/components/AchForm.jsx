import { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';

export default function AchForm({ amount, onSuccess, onError }) {
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
      <div className="ach-mandate" role="region" aria-label="ACH Authorization">
        <h3 className="ach-mandate__title">Bank Transfer Authorization</h3>
        <p className="ach-mandate__text">
          By clicking "Initiate Transfer", you authorize this organization to
          initiate an ACH debit entry to your bank account for{' '}
          <strong>${(amount / 100).toFixed(2)}</strong>.
        </p>
        <p className="ach-mandate__processing-time">
          ⏱ ACH transfers take <strong>2–3 business days</strong> to process.
        </p>
        <label className="ach-mandate__checkbox-row">
          <input
            type="checkbox"
            checked={mandateAccepted}
            onChange={(e) => setMandateAccepted(e.target.checked)}
            required
          />
          <span>I authorize this bank transfer and accept the terms above. *</span>
        </label>
      </div>

      <PaymentElement options={{ layout: 'tabs' }} />

      <button
        type="submit"
        disabled={loading || !mandateAccepted}
        className="btn btn-primary btn-full pay-btn"
      >
        {loading ? 'Processing...' : 'Initiate Bank Transfer'}
      </button>
    </form>
  );
}
