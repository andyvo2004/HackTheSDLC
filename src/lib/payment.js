function luhnCheck(cardNumber) {
  const digits = cardNumber.replace(/\D/g, "");
  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return digits.length >= 12 && sum % 10 === 0;
}

export function validateCardPayload(card) {
  if (!card) return { ok: false, message: "Card details are required" };
  if (!luhnCheck(card.number || "")) {
    return { ok: false, message: "Invalid card number" };
  }
  if (!/^\d{3,4}$/.test(String(card.cvv || ""))) {
    return { ok: false, message: "Invalid CVV" };
  }
  if (!/^\d{5}$/.test(String(card.zip || ""))) {
    return { ok: false, message: "Invalid billing zip code" };
  }
  return { ok: true };
}

export async function processMockPayment({ amount }) {
  if (Number(amount) <= 0) {
    return { status: "failed", error: "Amount must be greater than zero" };
  }
  return {
    status: "success",
    processorRef: `mock_${Date.now()}`,
  };
}
