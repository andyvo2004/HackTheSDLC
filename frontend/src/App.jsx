import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { CardElement, Elements, PaymentRequestButtonElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { DistributionPanel } from "./components/DistributionPanel.jsx";
import { getContrastColor } from "./utils/color.js";
import ActivityFeed from "./components/ActivityFeed.jsx";
import { LanguageProvider, LANGUAGE_OPTIONS, useI18n } from "./i18n.js";
import { localizeSeededText } from "./utils/localizeSeededText.js";
import { supabase } from "./lib/supabaseClient.js";
import HomePage from "./HomePage.jsx";
import googleLogo from "./assets/google-logo.png";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = STRIPE_KEY ? loadStripe(STRIPE_KEY) : null;

function dollarsToCents(amount) {
  return Math.round(Number(amount || 0) * 100);
}

async function apiRequest(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = payload.error || payload.message || "Request failed";
    throw new Error(msg);
  }
  return payload;
}

function StatCard({ label, value }) {
  return (
    <article className="stat-card">
      <p className="eyebrow">{label}</p>
      <h3>{value}</h3>
    </article>
  );
}

function MiniAreaChart({ values }) {
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * 100;
      const y = 100 - (v / max) * 88;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="mini-area-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="lineFade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(15,99,255,0.35)" />
          <stop offset="100%" stopColor="rgba(15,99,255,0)" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${points} 100,100`} fill="url(#lineFade)" />
      <polyline points={points} />
    </svg>
  );
}

function MethodBars({ items }) {
  const { t } = useI18n();
  const max = Math.max(...items.map((m) => Number(m.totalAmount || 0)), 1);
  return (
    <div className="method-bars">
      {items.map((item) => {
        const width = Math.max(10, (Number(item.totalAmount || 0) / max) * 100);
        return (
          <div key={item.method} className="method-row">
            <div className="method-meta">
              <span>{t(`paymentMethod_${String(item.method || "").toLowerCase()}`, { defaultValue: item.method })}</span>
              <strong>${Number(item.totalAmount || 0).toLocaleString()}</strong>
            </div>
            <div className="bar-track">
              <span className="bar-fill" style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingSkeleton() {
  const { t } = useI18n();
  return (
    <section className="panel skeleton-grid" aria-label={t("loadingContent")}>
      <div className="skeleton-line lg" />
      <div className="skeleton-line" />
      <div className="skeleton-line" />
      <div className="skeleton-line sm" />
    </section>
  );
}

function EmptyState({ title, message }) {
  return (
    <section className="panel empty-state">
      <div className="empty-illustration" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
    </section>
  );
}

function PaymentResultView({ result, onRetry }) {
  const { t } = useI18n();
  const success = result?.type === "success";
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <section
      className={`result-card ${success ? "success" : "failure"}`}
      role="alert"
      aria-atomic="true"
    >
      {success && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, i) => (
            <span key={`c-${i}`} />
          ))}
        </div>
      )}
      <div className={`result-icon result-icon--${success ? "success" : "failure"}`} aria-hidden="true">
        <span className="result-icon-mark" />
      </div>
      <h2 ref={headingRef} tabIndex={-1}>{success ? t("paymentSuccessful") : t("paymentNotCompleted")}</h2>
      <p>{result.message}</p>
      {result.transactionId && <small>{t("transactionId", { id: result.transactionId })}</small>}
      {!success && (
        <button type="button" onClick={onRetry}>
          {t("tryAgain")}
        </button>
      )}
    </section>
  );
}

function PublicCheckoutForm({ slug, config, onResult }) {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [amount, setAmount] = useState(config.fixedAmount || 0);
  const [payerEmail, setPayerEmail] = useState("");
  const [payerName, setPayerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [customResponses, setCustomResponses] = useState({});
  const [achAuthorizationAccepted, setAchAuthorizationAccepted] = useState(false);
  const [walletRequest, setWalletRequest] = useState(null);
  const [walletAvailable, setWalletAvailable] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [stripeError, setStripeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const stripeErrorRef = useRef(null);

  const validate = () => {
    const errors = {};
    if (!payerName.trim()) errors.payerName = t("fieldRequired", { field: t("fullName") });
    if (!payerEmail.trim()) errors.payerEmail = t("fieldRequired", { field: t("email") });
    if (config.amountMode === "range") {
      const amt = Number(amount);
      if (!amount || amt < Number(config.minAmount || 0)) {
        errors.amount = t("amountMin", { min: Number(config.minAmount || 0).toFixed(2) });
      } else if (config.maxAmount && amt > Number(config.maxAmount)) {
        errors.amount = t("amountMax", { max: Number(config.maxAmount || 0).toFixed(2) });
      }
    }
    if (config.amountMode === "user_entered" && (!amount || Number(amount) <= 0)) {
      errors.amount = t("validAmountRequired");
    }
    config.customFields?.forEach((field) => {
      if (field.required && !customResponses[field.id]) {
        errors[field.id] = t("fieldRequired", { field: field.label });
      }
    });
    return errors;
  };

  const submit = async (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstKey = Object.keys(errors)[0];
      setTimeout(() => document.getElementById(`field-${firstKey}`)?.focus(), 50);
      return;
    }
    setFieldErrors({});
    if (!stripe || (paymentMethod === "card" && !elements)) return;
    setSubmitting(true);
    setStripeError("");
    try {
      const payload = await apiRequest(`/public/pay/${slug}/create-payment-intent`, {
        method: "POST",
        body: {
          amount: Number(amount),
          payerEmail,
          payerName,
          paymentMethod,
          fieldResponses: customResponses,
          achAuthorizationAccepted,
        },
      });

      if (paymentMethod === "card") {
        const cardElement = elements.getElement(CardElement);
        const confirmResult = await stripe.confirmCardPayment(payload.clientSecret, {
          payment_method: {
            card: cardElement,
            billing_details: { email: payerEmail, name: payerName },
          },
        });
        if (confirmResult.error) {
          const msg = confirmResult.error.message || t("stripeConfirmationFailed");
          setStripeError(msg);
          setTimeout(() => stripeErrorRef.current?.focus(), 50);
          throw new Error(msg);
        }
      }

      if (paymentMethod === "ach") {
        const collectResult = await stripe.collectBankAccountForPayment({
          clientSecret: payload.clientSecret,
          params: {
            payment_method_type: "us_bank_account",
            payment_method_data: {
              billing_details: { email: payerEmail, name: payerName },
            },
          },
        });
        if (collectResult.error) {
          const msg = collectResult.error.message || t("stripeConfirmationFailed");
          setStripeError(msg);
          setTimeout(() => stripeErrorRef.current?.focus(), 50);
          throw new Error(msg);
        }

        const achIntentStatus = collectResult.paymentIntent?.status;
        if (achIntentStatus === "requires_confirmation") {
          const confirmAch = await stripe.confirmUsBankAccountPayment(payload.clientSecret);
          if (confirmAch.error) {
            const msg = confirmAch.error.message || t("stripeConfirmationFailed");
            setStripeError(msg);
            setTimeout(() => stripeErrorRef.current?.focus(), 50);
            throw new Error(msg);
          }
        }
      }

      const sync = await apiRequest(`/public/pay/${slug}/confirm`, {
        method: "POST",
        body: { paymentIntentId: payload.paymentIntentId },
      });

      if (sync.status === "success") {
        const msg = t("paymentSuccessConfirmation");
        onResult({ type: "success", message: msg, transactionId: sync.transactionId, payerEmail, amount });
      } else {
        const msg = t("paymentStatusMessage", { status: sync.status });
        onResult({ type: "failure", message: msg, transactionId: sync.transactionId });
      }
    } catch (err) {
      if (!stripeError) {
        const msg = t("paymentFailedMessage", { message: err.message });
        setStripeError(msg);
        setTimeout(() => stripeErrorRef.current?.focus(), 50);
        onResult({ type: "failure", message: msg });
      }
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!stripe) {
      setWalletRequest(null);
      setWalletAvailable(false);
      return;
    }

    const totalAmount = Number(amount || config.fixedAmount || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      setWalletRequest(null);
      setWalletAvailable(false);
      return;
    }

    const paymentRequest = stripe.paymentRequest({
      country: "US",
      currency: "usd",
      total: {
        label: config.title || t("quickPaymentPage"),
        amount: dollarsToCents(totalAmount),
      },
      requestPayerName: true,
      requestPayerEmail: true,
    });

    paymentRequest.canMakePayment().then((result) => {
      if (!result) {
        setWalletRequest(null);
        setWalletAvailable(false);
        return;
      }
      setWalletRequest(paymentRequest);
      setWalletAvailable(true);
    });

    paymentRequest.on("paymentmethod", async (event) => {
      try {
        const payload = await apiRequest(`/public/pay/${slug}/create-payment-intent`, {
          method: "POST",
          body: {
            amount: totalAmount,
            payerEmail: event.payerEmail || payerEmail,
            payerName: event.payerName || payerName,
            paymentMethod: "wallet",
            fieldResponses: customResponses,
            achAuthorizationAccepted: false,
          },
        });

        const confirmResult = await stripe.confirmCardPayment(
          payload.clientSecret,
          { payment_method: event.paymentMethod.id },
          { handleActions: false },
        );

        if (confirmResult.error) {
          event.complete("fail");
          throw new Error(confirmResult.error.message || t("stripeConfirmationFailed"));
        }

        if (confirmResult.paymentIntent?.status === "requires_action") {
          const actionResult = await stripe.confirmCardPayment(payload.clientSecret);
          if (actionResult.error) {
            event.complete("fail");
            throw new Error(actionResult.error.message || t("stripeConfirmationFailed"));
          }
        }

        const sync = await apiRequest(`/public/pay/${slug}/confirm`, {
          method: "POST",
          body: { paymentIntentId: payload.paymentIntentId },
        });

        const isSuccess = sync.status === "success";
        event.complete(isSuccess ? "success" : "fail");
        if (isSuccess) {
          onResult({
            type: "success",
            message: t("paymentSuccessConfirmation"),
            transactionId: sync.transactionId,
            payerEmail: event.payerEmail || payerEmail,
            amount: totalAmount,
          });
        } else {
          onResult({
            type: "failure",
            message: t("paymentStatusMessage", { status: sync.status }),
            transactionId: sync.transactionId,
          });
        }
      } catch (err) {
        event.complete("fail");
        const msg = t("paymentFailedMessage", { message: err.message });
        setStripeError(msg);
        setTimeout(() => stripeErrorRef.current?.focus(), 50);
      }
    });
  }, [stripe, slug, amount, config.fixedAmount, config.title, payerEmail, payerName, customResponses, t, onResult]);

  return (
    <form className="public-form" onSubmit={submit} noValidate aria-label={t("paymentForm")}>
      <p className="required-note">{t("requiredFieldsNote")}</p>
      <fieldset className="form-fieldset">
        <legend>{t("yourInformation")}</legend>
        <div className="field-group">
          <label htmlFor="field-payerName">{t("fullName")} *</label>
          <input
            id="field-payerName"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            aria-required="true"
            aria-invalid={!!fieldErrors.payerName}
            aria-describedby={fieldErrors.payerName ? "err-payerName" : undefined}
          />
          {fieldErrors.payerName && (
            <p id="err-payerName" className="field-error" tabIndex={-1}>{fieldErrors.payerName}</p>
          )}
        </div>
        <div className="field-group">
          <label htmlFor="field-payerEmail">{t("email")} *</label>
          <input
            id="field-payerEmail"
            type="email"
            value={payerEmail}
            onChange={(e) => setPayerEmail(e.target.value)}
            aria-required="true"
            aria-invalid={!!fieldErrors.payerEmail}
            aria-describedby={fieldErrors.payerEmail ? "err-payerEmail" : undefined}
          />
          {fieldErrors.payerEmail && (
            <p id="err-payerEmail" className="field-error" tabIndex={-1}>{fieldErrors.payerEmail}</p>
          )}
        </div>
      </fieldset>

      {config.amountMode === "fixed" && (
        <div className="amount-display">
          <span className="amount-label">{t("amount")}</span>
          <span className="amount-value">${Number(config.fixedAmount || 0).toFixed(2)}</span>
        </div>
      )}
      {config.amountMode === "range" && (
        <div className="field-group">
          <label htmlFor="field-amount">
            {`Amount ($${Number(config.minAmount || 0).toFixed(2)} – $${Number(config.maxAmount || 0).toFixed(2)}) *`}
          </label>
          <input
            id="field-amount"
            type="number"
            min={config.minAmount || 0}
            max={config.maxAmount || undefined}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-required="true"
            aria-invalid={!!fieldErrors.amount}
            aria-describedby={fieldErrors.amount ? "err-amount" : undefined}
          />
          {fieldErrors.amount && (
            <p id="err-amount" className="field-error" tabIndex={-1}>{fieldErrors.amount}</p>
          )}
        </div>
      )}
      {config.amountMode === "user_entered" && (
        <div className="field-group">
          <label htmlFor="field-amount">{t("amount")} *</label>
          <input
            id="field-amount"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-required="true"
            aria-invalid={!!fieldErrors.amount}
            aria-describedby={fieldErrors.amount ? "err-amount" : undefined}
          />
          {fieldErrors.amount && (
            <p id="err-amount" className="field-error" tabIndex={-1}>{fieldErrors.amount}</p>
          )}
        </div>
      )}

      {config.customFields?.length > 0 && (
        <fieldset className="form-fieldset">
          <legend>{t("additionalDetails")}</legend>
          {config.customFields.map((field) => (
            <div key={field.id} className={field.type === "checkbox" ? "checkbox-group" : "field-group"}>
              {field.type === "checkbox" ? (
                <>
                  <input
                    id={`field-${field.id}`}
                    type="checkbox"
                    checked={Boolean(customResponses[field.id])}
                    onChange={(e) => setCustomResponses((p) => ({ ...p, [field.id]: e.target.checked }))}
                    aria-required={field.required}
                    aria-invalid={!!fieldErrors[field.id]}
                    aria-describedby={fieldErrors[field.id] ? `err-${field.id}` : undefined}
                  />
                  <label htmlFor={`field-${field.id}`}>{field.label}{field.required ? " *" : ""}</label>
                </>
              ) : (
                <>
                  <label htmlFor={`field-${field.id}`}>{field.label}{field.required ? " *" : ""}</label>
                  {field.type === "dropdown" ? (
                    <select
                      id={`field-${field.id}`}
                      value={customResponses[field.id] || ""}
                      onChange={(e) => setCustomResponses((p) => ({ ...p, [field.id]: e.target.value }))}
                      aria-required={field.required}
                      aria-invalid={!!fieldErrors[field.id]}
                      aria-describedby={fieldErrors[field.id] ? `err-${field.id}` : undefined}
                    >
                      <option value="">{t("selectAnOption")}</option>
                      {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <input
                      id={`field-${field.id}`}
                      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                      value={customResponses[field.id] || ""}
                      onChange={(e) => setCustomResponses((p) => ({ ...p, [field.id]: e.target.value }))}
                      aria-required={field.required}
                      aria-invalid={!!fieldErrors[field.id]}
                      aria-describedby={fieldErrors[field.id] ? `err-${field.id}` : undefined}
                    />
                  )}
                </>
              )}
              {fieldErrors[field.id] && (
                <p id={`err-${field.id}`} className="field-error" tabIndex={-1}>{fieldErrors[field.id]}</p>
              )}
            </div>
          ))}
        </fieldset>
      )}

      <fieldset className="form-fieldset">
        <legend>{t("paymentDetails")}</legend>
        <div className="field-group">
          <label htmlFor="field-payment-method">{t("paymentMethod")}</label>
          <select
            id="field-payment-method"
            value={paymentMethod}
            onChange={(e) => {
              const nextMethod = e.target.value;
              setPaymentMethod(nextMethod);
              if (nextMethod !== "ach") setAchAuthorizationAccepted(false);
            }}
          >
            <option value="card">{t("paymentMethod_card")}</option>
            <option value="ach">{t("paymentMethod_ach")}</option>
          </select>
        </div>
        {paymentMethod === "ach" ? (
          <div className="checkbox-group">
            <input
              id="ach-auth"
              type="checkbox"
              checked={achAuthorizationAccepted}
              onChange={(e) => setAchAuthorizationAccepted(e.target.checked)}
            />
            <label htmlFor="ach-auth">{t("achAuthorization")}</label>
          </div>
        ) : (
          <>
            {walletAvailable && walletRequest && (
              <>
                <div className="wallet-bar" role="group" aria-label={t("expressCheckoutOptions")}>
                  <PaymentRequestButtonElement options={{ paymentRequest: walletRequest }} />
                </div>
                <div className="wallet-divider" aria-hidden="true"><span>{t("orPayWithCard")}</span></div>
              </>
            )}
            <p id="card-element-label" className="card-label">{t("cardDetails")}</p>
            <div className="stripe-box" aria-labelledby="card-element-label">
              <CardElement options={{ hidePostalCode: false }} />
            </div>
          </>
        )}
        {stripeError && (
          <p
            ref={stripeErrorRef}
            className="field-error"
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
          >
            {stripeError}
          </p>
        )}
      </fieldset>

      <button
        type="submit"
        className="pay-btn"
        disabled={submitting || !stripe || (paymentMethod === "card" && !elements)}
      >
        {submitting ? t("processing") : t("completePayment")}
      </button>
    </form>
  );
}

function PublicPaymentPage() {
  const { lang, setLang, t } = useI18n();
  const { slug } = useParams();
  const [config, setConfig] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const page = await apiRequest(`/public/pay/${slug}`);
        setConfig(page);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug]);

  if (loading) {
    return (
      <main className="public-shell">
        <LoadingSkeleton />
      </main>
    );
  }
  if (error || !config) {
    return (
      <main className="public-shell">
        <div className="lang-switcher">
          <label htmlFor="lang-select-public">{t("language")}</label>
          <select id="lang-select-public" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
          </select>
        </div>
        <EmptyState title={t("payUnavailable")} message={error || t("verifyUrlTryAgain")} />
      </main>
    );
  }

  const headerTextColor = getContrastColor(config.brandColor);
  const localizedTitle = localizeSeededText(config.title, t);
  const localizedSubtitle = localizeSeededText(config.subtitle, t);
  const localizedHeaderMessage = localizeSeededText(config.headerMessage, t);
  const localizedFooterMessage = localizeSeededText(config.footerMessage, t);

  return (
    <main className="public-shell">
      <section className="public-card">
        <header className="public-header" style={{ background: config.brandColor || "#0f63ff", color: headerTextColor }}>
          {config.logoUrl && (
            <img
              src={config.logoUrl}
              alt={`${localizedTitle} logo`}
              className="public-logo"
              onError={(e) => { e.target.style.display = "none"; }}
            />
          )}
          <h1>{localizedTitle}</h1>
          {localizedSubtitle && <p className="public-subtitle">{localizedSubtitle}</p>}
        </header>
        <div className="public-body">
          {config.description && <p className="subtle">{config.description}</p>}
          <div className="preview-banner">{localizedHeaderMessage || t("completeSecurePaymentBelow")}</div>
          {result ? (
            <PaymentResultView result={result} onRetry={() => setResult(null)} />
          ) : STRIPE_KEY && stripePromise ? (
            <Elements stripe={stripePromise}>
              <PublicCheckoutForm slug={slug} config={config} onResult={setResult} />
            </Elements>
          ) : (
            <p className="error">
              {t("missingStripeKey")}
            </p>
          )}
          {localizedFooterMessage && <footer className="public-footer">{localizedFooterMessage}</footer>}
        </div>
      </section>
    </main>
  );
}

function AuthPage({ mode }) {
  const navigate = useNavigate();
  const existingToken = localStorage.getItem("qpp_token");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [signupRole, setSignupRole] = useState("");
  const [needsGoogleRoleCompletion, setNeedsGoogleRoleCompletion] = useState(false);
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const isSignup = mode === "signup";

  if (existingToken) {
    return <Navigate to="/dashboard" replace />;
  }

  const exchangeSupabaseSession = async (selectedRole = "") => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const exchange = await apiRequest("/auth/supabase/exchange", {
      method: "POST",
      body: {
        accessToken: session.access_token,
        ...(selectedRole ? { role: selectedRole } : {}),
      },
    });
    localStorage.setItem("qpp_token", exchange.token);
    navigate("/dashboard", { replace: true });
    return true;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setAuthNotice("");
    try {
      const { error: supabaseError } = await supabase.auth.signInWithPassword({
        email: loginForm.email,
        password: loginForm.password,
      });
      if (supabaseError) {
        throw supabaseError;
      }
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: loginForm,
      });
      localStorage.setItem("qpp_token", data.token);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setAuthNotice("");
    try {
      if (!signupRole) {
        throw new Error("Please select an account type.");
      }
      await apiRequest("/auth/signup", {
        method: "POST",
        body: {
          email: loginForm.email,
          password: loginForm.password,
          role: signupRole,
        },
      });
      setAuthNotice("Account created. Check your email to confirm, then sign in.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError("");
    setAuthNotice("");
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/login`,
        },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleCompleteGoogleSignup = async () => {
    setLoading(true);
    setError("");
    setAuthNotice("");
    try {
      if (!signupRole) {
        throw new Error("Please select an account type before continuing.");
      }
      const exchanged = await exchangeSupabaseSession(signupRole);
      if (!exchanged) {
        throw new Error("Google session not found. Please click Continue with Google first.");
      }
      setNeedsGoogleRoleCompletion(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function tryExchange() {
      try {
        if (cancelled) return;
        const exchanged = await exchangeSupabaseSession();
        if (exchanged) return;
      } catch (err) {
        if (cancelled) return;
        if (err.code === "ROLE_REQUIRED") {
          setNeedsGoogleRoleCompletion(true);
          setAuthNotice("Google account found. Select account type to finish setup.");
          if (!isSignup) navigate("/signup", { replace: true });
          return;
        }
        setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    tryExchange();
    return () => {
      cancelled = true;
    };
  }, [isSignup, navigate]);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Waystar Inspired Experience</p>
        <h1>{isSignup ? "Create Admin Account" : "Admin Sign In"}</h1>
        <p className="auth-subtitle">
          {isSignup
            ? "Choose your account type, then confirm your email to continue."
            : "Sign in to manage branded payment pages and reporting."}
        </p>
        <form className="form-grid" onSubmit={isSignup ? handleSignup : handleLogin}>
          <div className="field-group">
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              value={loginForm.email}
              onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
              required
              aria-required="true"
            />
          </div>
          <div className="field-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
              required
              aria-required="true"
            />
          </div>
          {isSignup && (
            <div className="field-group">
              <label htmlFor="signup-role">Account type *</label>
              <select
                id="signup-role"
                value={signupRole}
                onChange={(e) => setSignupRole(e.target.value)}
                required
                aria-required="true"
              >
                <option value="">Select account type</option>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          )}
          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? (isSignup ? "Creating account..." : "Signing in...") : (isSignup ? "Create account" : "Sign in")}
          </button>
        </form>
        {needsGoogleRoleCompletion ? (
          <button type="button" className="auth-google-btn" onClick={handleCompleteGoogleSignup} disabled={loading}>
            Finish Google signup
          </button>
        ) : (
          <button type="button" className="auth-google-btn" onClick={handleGoogleAuth} disabled={loading}>
            <img src={googleLogo} alt="" className="google-icon" aria-hidden="true" />
            Continue with Google
          </button>
        )}
        <p className="auth-switch-row">
          {isSignup ? "Already have an account?" : "Need an account?"}{" "}
          <Link className="auth-switch-link" to={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Sign in" : "Sign up"}
          </Link>
        </p>
        {authNotice && <p className="subtle">{authNotice}</p>}
        {error && (
          <div role="alert" aria-live="assertive" className="error">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}

function AdminApp() {
  const { lang, setLang, t } = useI18n();
  const [token, setToken] = useState(localStorage.getItem("qpp_token") || "");
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem("qpp_theme");
    if (storedTheme) return storedTheme;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    return "light";
  });
  const [user, setUser] = useState(null);
  const [pages, setPages] = useState([]);
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [insights, setInsights] = useState(null);
  const [pageVersions, setPageVersions] = useState({});
  const [selectedPage, setSelectedPage] = useState(null);
  const [mobileActionsPageId, setMobileActionsPageId] = useState(null);
  const [view, setView] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const [txnFilters, setTxnFilters] = useState({
    status: "all",
    method: "all",
    search: "",
  });

  const [loginForm, setLoginForm] = useState({
    email: "admin@example.com",
    password: "admin12345",
  });

  const getLocalizedPageDefaults = () => ({
    subtitle: t("secureSelfServiceExperience"),
    headerMessage: t("thankYouChoosingOrg"),
    footerMessage: t("needHelpBillingSupport"),
  });

  const [pageForm, setPageForm] = useState({
    slug: "",
    title: "",
    subtitle: getLocalizedPageDefaults().subtitle,
    description: "",
    logoUrl: "",
    amountMode: "fixed",
    fixedAmount: 25,
    minAmount: 0,
    maxAmount: 0,
    glCodes: "GL-100",
    brandColor: "#0f63ff",
    headerMessage: getLocalizedPageDefaults().headerMessage,
    footerMessage: getLocalizedPageDefaults().footerMessage,
  });

  const [customFieldsBuilder, setCustomFieldsBuilder] = useState([]);
  const addBuilderField = () => {
    if (customFieldsBuilder.length >= 10) { setError(t("maxCustomFields")); return; }
    setCustomFieldsBuilder((prev) => [...prev, { id: `f${Date.now()}`, label: "", type: "text", required: false, options: "", order: prev.length }]);
  };
  const removeBuilderField = (idx) => setCustomFieldsBuilder((prev) => prev.filter((_, i) => i !== idx));
  const updateBuilderField = (idx, key, val) => setCustomFieldsBuilder((prev) => prev.map((f, i) => i === idx ? { ...f, [key]: val } : f));
  const moveBuilderField = (idx, direction) => {
    setCustomFieldsBuilder((prev) => {
      const arr = [...prev];
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= arr.length) return arr;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return arr.map((f, i) => ({ ...f, order: i }));
    });
  };

  const canEditPages = useMemo(
    () => user && ["owner", "editor"].includes(user.role),
    [user],
  );

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("qpp_theme", theme);
  }, [theme]);

  useEffect(() => {
    const localizedDefaults = getLocalizedPageDefaults();
    const englishDefaults = {
      subtitle: "Secure, self-service payment experience",
      headerMessage: "Thank you for choosing our organization",
      footerMessage: "Need help? Reach our billing support team.",
    };
    setPageForm((prev) => {
      const next = { ...prev };
      if (
        !prev.subtitle ||
        prev.subtitle === englishDefaults.subtitle ||
        prev.subtitle === t("secureSelfServiceExperience")
      ) {
        next.subtitle = localizedDefaults.subtitle;
      }
      if (
        !prev.headerMessage ||
        prev.headerMessage === englishDefaults.headerMessage ||
        prev.headerMessage === t("thankYouChoosingOrg")
      ) {
        next.headerMessage = localizedDefaults.headerMessage;
      }
      if (
        !prev.footerMessage ||
        prev.footerMessage === englishDefaults.footerMessage ||
        prev.footerMessage === t("needHelpBillingSupport")
      ) {
        next.footerMessage = localizedDefaults.footerMessage;
      }
      return next;
    });
  }, [lang, t]);

  useEffect(() => {
    return () => {
      window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const fetchDashboard = async (activeToken) => {
    const authToken = activeToken || token;
    if (!authToken) return;
    setLoading(true);
    setError("");
    try {
      const [me, pageList, reportSummary, txns] = await Promise.all([
        apiRequest("/auth/me", { token: authToken }),
        apiRequest("/admin/pages", { token: authToken }),
        apiRequest("/admin/reports/summary", { token: authToken }),
        apiRequest("/admin/reports/transactions", { token: authToken }),
      ]);
      const insightData = await apiRequest("/admin/reports/insights", { token: authToken });
      setUser(me);
      setPages(pageList);
      setSummary(reportSummary);
      setTransactions(txns);
      setInsights(insightData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchDashboard(token);
  }, [token]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: loginForm,
      });
      localStorage.setItem("qpp_token", data.token);
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePage = async (e) => {
    e.preventDefault();
    if (!canEditPages) return;
    setLoading(true);
    setError("");
    try {
      await apiRequest("/admin/pages", {
        method: "POST",
        token,
        body: {
          slug: pageForm.slug,
          title: pageForm.title,
          subtitle: pageForm.subtitle,
          description: pageForm.description,
          logoUrl: pageForm.logoUrl,
          amountMode: pageForm.amountMode,
          fixedAmount: pageForm.amountMode === "fixed" ? Number(pageForm.fixedAmount) : undefined,
          minAmount: pageForm.amountMode === "range" ? Number(pageForm.minAmount) : undefined,
          maxAmount: pageForm.amountMode === "range" ? Number(pageForm.maxAmount) : undefined,
          glCodes: pageForm.glCodes
            .split(",")
            .map((code) => code.trim())
            .filter(Boolean),
          brandColor: pageForm.brandColor,
          headerMessage: pageForm.headerMessage,
          footerMessage: pageForm.footerMessage,
          customFields: customFieldsBuilder.map((f) => ({
            id: f.id,
            label: f.label,
            type: f.type,
            required: f.required,
            options: f.type === "dropdown" ? f.options.split(",").map((o) => o.trim()).filter(Boolean) : [],
            order: f.order,
          })),
        },
      });
      setPageForm({
        slug: "",
        title: "",
        subtitle: t("secureSelfServiceExperience"),
        description: "",
        logoUrl: "",
        amountMode: "fixed",
        fixedAmount: 25,
        minAmount: 0,
        maxAmount: 0,
        glCodes: "GL-100",
        brandColor: "#0f63ff",
        headerMessage: t("thankYouChoosingOrg"),
        footerMessage: t("needHelpBillingSupport"),
      });
      setCustomFieldsBuilder([]);
      await fetchDashboard(token);
      setView("pages");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (pageId) => {
    try {
      const info = await apiRequest(`/admin/pages/${pageId}/share`, { token });
      await navigator.clipboard.writeText(info.publicUrl);
      showToast(t("publicUrlCopied"));
    } catch (err) {
      setError(t("copyFailed", { message: err.message }));
      showToast(t("copyUrlFailed"), "error");
    }
  };

  const handleToggleStatus = async (pageId, currentActive) => {
    try {
      await apiRequest(`/admin/pages/${pageId}/status`, { method: "PATCH", token, body: { isActive: !currentActive } });
      await fetchDashboard(token);
      showToast(currentActive ? t("pageDisabled") : t("pageEnabled"));
    } catch (err) {
      setError(err.message);
      showToast(t("statusUpdateFailed"), "error");
    }
  };

  const fetchVersions = async (pageId) => {
    const versions = await apiRequest(`/admin/pages/${pageId}/versions`, { token });
    setPageVersions((prev) => ({ ...prev, [pageId]: versions }));
  };

  const publishDraft = async (pageId) => {
    try {
      await apiRequest(`/admin/pages/${pageId}/publish`, { method: "POST", token });
      await fetchDashboard(token);
      await fetchVersions(pageId);
      showToast(t("draftPublished"));
    } catch (err) {
      setError(err.message);
      showToast(t("publishFailed"), "error");
    }
  };

  const rollbackLatest = async (pageId) => {
    try {
      const versions = pageVersions[pageId] || (await apiRequest(`/admin/pages/${pageId}/versions`, { token }));
      const target = versions[1];
      if (!target) {
        setError(t("noPriorVersionRollback"));
        return;
      }
      await apiRequest(`/admin/pages/${pageId}/rollback`, {
        method: "POST",
        token,
        body: { versionNumber: target.versionNumber },
      });
      await fetchDashboard(token);
      await fetchVersions(pageId);
      showToast(t("rolledBack"));
    } catch (err) {
      setError(err.message);
      showToast(t("rollbackFailed"), "error");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("qpp_token");
    setToken("");
    setUser(null);
    setPages([]);
    setSummary(null);
    setTransactions([]);
    showToast(t("signedOut"));
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((txn) => {
      const matchesStatus = txnFilters.status === "all" || txn.status === txnFilters.status;
      const matchesMethod = txnFilters.method === "all" || txn.paymentMethod === txnFilters.method;
      const haystack = `${txn.payerEmail || ""} ${txn.id || ""}`.toLowerCase();
      const matchesSearch = !txnFilters.search || haystack.includes(txnFilters.search.toLowerCase());
      return matchesStatus && matchesMethod && matchesSearch;
    });
  }, [transactions, txnFilters]);

  const transactionStatuses = useMemo(
    () => ["all", ...new Set(transactions.map((txn) => txn.status).filter(Boolean))],
    [transactions],
  );
  const transactionMethods = useMemo(
    () => ["all", ...new Set(transactions.map((txn) => txn.paymentMethod).filter(Boolean))],
    [transactions],
  );
  const collectionVelocityValues = useMemo(() => {
    const trend = insights?.trend || [];
    if (trend.length >= 2) {
      return trend.map((point) => Number(point.revenue || 0));
    }
    const avg = Number(summary?.averagePaymentAmount || 10);
    return [avg, avg * 1.2, avg * 0.85, avg * 1.45, avg * 1.18, avg * 1.7];
  }, [insights, summary]);
  const translateMethod = (method) => {
    const normalized = String(method || "").toLowerCase();
    return t(`paymentMethod_${normalized}`, { defaultValue: method });
  };
  const localeCode = lang === "en" ? "en-US" : lang;
  const formatCurrency = (value) =>
    new Intl.NumberFormat(localeCode, { style: "currency", currency: "USD" }).format(Number(value || 0));
  const formatDateTime = (value) => new Date(value).toLocaleString(localeCode);
  const translateStatus = (status) => {
    const normalized = String(status || "").toLowerCase();
    return t(`statusValue_${normalized}`, { defaultValue: status });
  };
  const translateAmountMode = (amountMode) => {
    if (amountMode === "user_entered") return t("userEntered");
    return t(amountMode, { defaultValue: amountMode });
  };
  const localizePageText = (text) => localizeSeededText(text, t);

  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>{t("waystarQpp")}</h2>
        <p className="role-pill">{t(`role_${user?.role || "viewer"}`, { defaultValue: user?.role || t("viewer") })}</p>
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <nav aria-label={t("navigationLabel")}>
          {["overview", "insights", "pages", "create", "transactions"].map((item) => (
            <button
              key={item}
              className={view === item ? "nav-btn active" : "nav-btn"}
              onClick={() => setView(item)}
              aria-current={view === item ? "page" : undefined}
            >
              {t(item)}
            </button>
          ))}
        </nav>
        <button className="logout-btn" onClick={handleLogout} aria-label={t("logOut")}>
          {t("logOut")}
        </button>
        <button
          className="theme-btn"
          onClick={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
          aria-label={t("toggleDarkMode")}
        >
          {theme === "light" ? t("darkMode") : t("lightMode")}
        </button>
        <div className="lang-switcher lang-switcher--sidebar">
          <label htmlFor="lang-select-sidebar">{t("language")}</label>
          <select id="lang-select-sidebar" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
          </select>
        </div>
      </aside>

      <main className="content-shell">
        <header>
          <p className="eyebrow">{t("healthcarePaymentsControlCenter")}</p>
          <h1>{t("dashboardTitle")}</h1>
        </header>
        {error && <div role="alert" aria-live="assertive" className="error">{error}</div>}
        {toast && (
          <div className={`toast toast--${toast.type}`} role="status" aria-live="polite">
            {toast.message}
          </div>
        )}

        {view === "overview" && (
          <>
            <section className="stats-grid">
              <StatCard
                label={t("totalPayments")}
                value={summary ? summary.totalPayments.toLocaleString() : "--"}
              />
              <StatCard
                label={t("amountCollected")}
                value={
                  summary
                    ? `$${Number(summary.totalAmountCollected || 0).toLocaleString()}`
                    : "--"
                }
              />
              <StatCard
                label={t("averagePayment")}
                value={
                  summary
                    ? `$${Number(summary.averagePaymentAmount || 0).toFixed(2)}`
                    : "--"
                }
              />
            </section>
            {loading ? (
              <LoadingSkeleton />
            ) : (
              <>
                <section className="panel chart-panel">
                  <div>
                    <h3>{t("collectionVelocity")}</h3>
                    <p className="subtle">{t("collectionVelocityDesc")}</p>
                  </div>
                  <MiniAreaChart values={collectionVelocityValues} />
                </section>
                <section className="panel">
                  <h3>{t("paymentMethodMix")}</h3>
                  {summary?.byPaymentMethod?.length ? (
                    <MethodBars items={summary.byPaymentMethod} />
                  ) : (
                    <p className="subtle">{t("noSuccessfulTransactionsYet")}</p>
                  )}
                </section>
                <section className="panel">
                  <h3>{t("paymentPages")}</h3>
                  <p>{t("configuredPagesCount", { count: pages.length })}</p>
                </section>
                <section className="panel">
                  <ActivityFeed authToken={token} />
                </section>
              </>
            )}
          </>
        )}

        {view === "insights" && (
          loading ? (
            <LoadingSkeleton />
          ) : !insights ? (
            <EmptyState title={t("noInsightsYet")} message={t("noInsightsMessage")} />
          ) : (
            <>
              <section className="stats-grid">
                <StatCard label={t("pageViews")} value={insights.overview.totalViews.toLocaleString()} />
                <StatCard
                  label={t("checkoutStarts")}
                  value={insights.overview.totalTransactions.toLocaleString()}
                />
                <StatCard
                  label={t("successfulPayments")}
                  value={insights.overview.successfulTransactions.toLocaleString()}
                />
              </section>
              <section className="panel">
                <h3>{t("conversionFunnel")}</h3>
                <div className="method-bars">
                  <div className="method-row">
                    <div className="method-meta">
                      <span>{t("viewToCheckout")}</span>
                      <strong>{(insights.funnel.viewToCheckoutRate * 100).toFixed(1)}%</strong>
                    </div>
                    <div className="bar-track">
                      <span
                        className="bar-fill"
                        style={{ width: `${Math.max(4, insights.funnel.viewToCheckoutRate * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="method-row">
                    <div className="method-meta">
                      <span>{t("checkoutToSuccess")}</span>
                      <strong>{(insights.funnel.checkoutToSuccessRate * 100).toFixed(1)}%</strong>
                    </div>
                    <div className="bar-track">
                      <span
                        className="bar-fill"
                        style={{ width: `${Math.max(4, insights.funnel.checkoutToSuccessRate * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </section>
              <section className="panel">
                <h3>{t("topPagePerformance")}</h3>
                <div className="table-wrap">
                  <table aria-label={t("topPagePerformance")}>
                    <thead>
                      <tr>
                        <th scope="col">{t("page")}</th>
                        <th scope="col">{t("views")}</th>
                        <th scope="col">{t("transactions")}</th>
                        <th scope="col">{t("success")}</th>
                        <th scope="col">{t("revenue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.pagePerformance.slice(0, 8).map((p) => (
                        <tr key={p.id}>
                          <td>{p.title}</td>
                          <td>{p.viewCount}</td>
                          <td>{p.transactionCount}</td>
                          <td>{p.successCount}</td>
                          <td>${p.revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )
        )}

        {view === "pages" && (
          loading ? (
            <LoadingSkeleton />
          ) : pages.length === 0 ? (
            <EmptyState
              title={t("noPaymentPagesYet")}
              message={t("noPaymentPagesMessage")}
            />
          ) : (
            <>
            <section className="panel">
              <h3>{t("configuredPages")}</h3>
              <div className="table-wrap">
                <table aria-label={t("paymentPages")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("title")}</th>
                      <th scope="col">{t("slug")}</th>
                      <th scope="col">{t("status")}</th>
                      <th scope="col">{t("amountMode")}</th>
                      <th scope="col">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((page) => {
                      const actionButtons = (
                        <>
                          <button
                            className="tiny-btn"
                            onClick={() => handleCopy(page.id)}
                            aria-label={t("ariaCopyUrlForTitle", { title: localizePageText(page.title) })}
                          >
                            {t("copyUrl")}
                          </button>
                          <button
                            className={`tiny-btn${selectedPage?.id === page.id ? " active" : ""}`}
                            onClick={() => setSelectedPage(selectedPage?.id === page.id ? null : page)}
                            aria-label={
                              selectedPage?.id === page.id
                                ? t("ariaCloseDistributionPanelForTitle", { title: localizePageText(page.title) })
                                : t("ariaDistributeTitle", { title: localizePageText(page.title) })
                            }
                            aria-expanded={selectedPage?.id === page.id}
                          >
                            {selectedPage?.id === page.id ? t("close") : t("distribute")}
                          </button>
                          {canEditPages && (
                            <>
                              <button
                                className="tiny-btn"
                                onClick={() => handleToggleStatus(page.id, page.isActive)}
                                aria-label={
                                  page.isActive
                                    ? t("ariaDisableTitle", { title: localizePageText(page.title) })
                                    : t("ariaEnableTitle", { title: localizePageText(page.title) })
                                }
                              >
                                {page.isActive ? t("disable") : t("enable")}
                              </button>
                              <button
                                className="tiny-btn"
                                onClick={() => fetchVersions(page.id)}
                                aria-label={t("ariaViewVersionsForTitle", { title: localizePageText(page.title) })}
                              >
                                {t("versions")}
                              </button>
                              {page.hasDraft && (
                                <button
                                  className="tiny-btn"
                                  onClick={() => publishDraft(page.id)}
                                  aria-label={t("ariaPublishDraftForTitle", { title: localizePageText(page.title) })}
                                >
                                  {t("publishDraft")}
                                </button>
                              )}
                              <button
                                className="tiny-btn"
                                onClick={() => rollbackLatest(page.id)}
                                aria-label={t("ariaRollbackPageToPreviousTitle", { title: localizePageText(page.title) })}
                              >
                                {t("rollback")}
                              </button>
                            </>
                          )}
                        </>
                      );

                      return (
                      <tr key={page.id}>
                        <td>{localizePageText(page.title)}</td>
                        <td>/{page.slug}</td>
                        <td>
                          <span className={`status-badge ${page.isActive ? "status-badge--active" : "status-badge--disabled"}`}>
                            {page.isActive ? t("active") : t("disabled")}
                          </span>
                        </td>
                        <td>{translateAmountMode(page.amountMode)}</td>
                        <td className="page-actions-cell">
                          <div className="page-actions-desktop">{actionButtons}</div>
                          <div className="page-actions-mobile">
                            <button
                              className="tiny-btn mobile-actions-trigger"
                              onClick={() => setMobileActionsPageId((prev) => (prev === page.id ? null : page.id))}
                              aria-expanded={mobileActionsPageId === page.id}
                              aria-label={t("ariaMoreActionsTitle", { title: localizePageText(page.title) })}
                            >
                              {mobileActionsPageId === page.id ? t("hideActions") : t("moreActions")}
                            </button>
                            {mobileActionsPageId === page.id && (
                              <div className="mobile-actions-panel">{actionButtons}</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
              {Object.entries(pageVersions).map(([pageId, versions]) => (
                <div key={pageId} className="versions-block">
                  <h4>{t("versionsForPage")} {pages.find((p) => p.id === pageId)?.title || pageId}</h4>
                  <ul>
                    {versions.slice(0, 5).map((v) => (
                      <li key={`${pageId}-${v.versionNumber}`}>
                        v{v.versionNumber} - {new Date(v.createdAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
            {selectedPage && (
              <section className="panel">
              <h3>{t("distributePanelTitle", { title: localizePageText(selectedPage.title) })}</h3>
                <DistributionPanel pageSlug={selectedPage.slug} pageTitle={localizePageText(selectedPage.title)} />
              </section>
            )}
            </>
          )
        )}

        {view === "create" && (
          <div className="create-grid">
            <section className="panel">
              <h3>{t("createPaymentPage")}</h3>
              {!canEditPages && (
                <p className="error">{t("roleReadOnly")}</p>
              )}
              <form className="form-grid" onSubmit={handleCreatePage} aria-label={t("createPaymentPage")}>
                <div className="field-group">
                  <label htmlFor="cf-title">{t("pageTitle")} *</label>
                  <input
                    id="cf-title"
                    value={pageForm.title}
                    onChange={(e) => setPageForm((p) => ({ ...p, title: e.target.value }))}
                    required
                    aria-required="true"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-subtitle">{t("subtitle")}</label>
                  <input
                    id="cf-subtitle"
                    value={pageForm.subtitle}
                    onChange={(e) => setPageForm((p) => ({ ...p, subtitle: e.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-description">{t("description")}</label>
                  <input
                    id="cf-description"
                    value={pageForm.description}
                    onChange={(e) => setPageForm((p) => ({ ...p, description: e.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-logoUrl">{t("logoUrl")}</label>
                  <input
                    id="cf-logoUrl"
                    type="url"
                    value={pageForm.logoUrl}
                    onChange={(e) => setPageForm((p) => ({ ...p, logoUrl: e.target.value }))}
                    placeholder={t("logoUrlPlaceholder")}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-slug">{t("urlSlug")} *</label>
                  <input
                    id="cf-slug"
                    value={pageForm.slug}
                    onChange={(e) => setPageForm((p) => ({ ...p, slug: e.target.value.toLowerCase() }))}
                    required
                    aria-required="true"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-brandColor">{t("brandColorHex")}</label>
                  <input
                    id="cf-brandColor"
                    type="color"
                    value={pageForm.brandColor}
                    onChange={(e) => setPageForm((p) => ({ ...p, brandColor: e.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-headerMessage">{t("headerMessage")}</label>
                  <input
                    id="cf-headerMessage"
                    value={pageForm.headerMessage}
                    onChange={(e) => setPageForm((p) => ({ ...p, headerMessage: e.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-footerMessage">{t("footerMessage")}</label>
                  <input
                    id="cf-footerMessage"
                    value={pageForm.footerMessage}
                    onChange={(e) => setPageForm((p) => ({ ...p, footerMessage: e.target.value }))}
                  />
                </div>
                <fieldset className="form-fieldset">
                  <legend>{t("paymentAmountMode")}</legend>
                  <div className="field-group">
                    <label htmlFor="cf-amountMode">{t("amountMode")}</label>
                    <select
                      id="cf-amountMode"
                      value={pageForm.amountMode}
                      onChange={(e) => setPageForm((p) => ({ ...p, amountMode: e.target.value }))}
                    >
                      <option value="fixed">{t("fixed")}</option>
                      <option value="range">{t("range")}</option>
                      <option value="user_entered">{t("userEntered")}</option>
                    </select>
                  </div>
                  {pageForm.amountMode === "fixed" && (
                    <div className="field-group">
                      <label htmlFor="cf-fixedAmount">{t("fixedAmount")}</label>
                      <input
                        id="cf-fixedAmount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={pageForm.fixedAmount}
                        onChange={(e) => setPageForm((p) => ({ ...p, fixedAmount: e.target.value }))}
                      />
                    </div>
                  )}
                  {pageForm.amountMode === "range" && (
                    <>
                      <div className="field-group">
                        <label htmlFor="cf-minAmount">{t("minimumAmount")}</label>
                        <input
                          id="cf-minAmount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={pageForm.minAmount}
                          onChange={(e) => setPageForm((p) => ({ ...p, minAmount: e.target.value }))}
                        />
                      </div>
                      <div className="field-group">
                        <label htmlFor="cf-maxAmount">{t("maximumAmount")}</label>
                        <input
                          id="cf-maxAmount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={pageForm.maxAmount}
                          onChange={(e) => setPageForm((p) => ({ ...p, maxAmount: e.target.value }))}
                        />
                      </div>
                    </>
                  )}
                </fieldset>
                <div className="field-group">
                  <label htmlFor="cf-glCodes">{t("glCodesCommaSeparated")}</label>
                  <input
                    id="cf-glCodes"
                    value={pageForm.glCodes}
                    onChange={(e) => setPageForm((p) => ({ ...p, glCodes: e.target.value }))}
                  />
                </div>
                <div className="field-builder-header">
                  <span>{t("customFields", { count: customFieldsBuilder.length })}</span>
                  <button type="button" className="tiny-btn" onClick={addBuilderField} aria-label={t("addCustomField")}>+ {t("addField")}</button>
                </div>
                {customFieldsBuilder.map((field, idx) => (
                  <div key={field.id} className="field-builder-row">
                    <input
                      aria-label={`${t("customField")} ${idx + 1} ${t("label")}`}
                      placeholder={t("fieldLabel")}
                      value={field.label}
                      onChange={(e) => updateBuilderField(idx, "label", e.target.value)}
                    />
                    <select
                      aria-label={`${t("customField")} ${idx + 1} ${t("type")}`}
                      value={field.type}
                      onChange={(e) => updateBuilderField(idx, "type", e.target.value)}
                    >
                      <option value="text">{t("text")}</option>
                      <option value="number">{t("number")}</option>
                      <option value="dropdown">{t("dropdown")}</option>
                      <option value="date">{t("date")}</option>
                      <option value="checkbox">{t("checkbox")}</option>
                    </select>
                    {field.type === "dropdown" && (
                      <input
                        aria-label={`${t("customField")} ${idx + 1} ${t("dropdownOptions")}`}
                        placeholder={t("optionsCommaSeparated")}
                        value={field.options}
                        onChange={(e) => updateBuilderField(idx, "options", e.target.value)}
                      />
                    )}
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateBuilderField(idx, "required", e.target.checked)}
                        aria-label={`${field.label || `${t("field")} ${idx + 1}`} ${t("required").toLowerCase()}`}
                      />
                      {t("required")}
                    </label>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => moveBuilderField(idx, "up")}
                      disabled={idx === 0}
                      aria-label={`${t("moveUp")} ${field.label || t("fieldN", { count: idx + 1 })}`}
                    >↑</button>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => moveBuilderField(idx, "down")}
                      disabled={idx === customFieldsBuilder.length - 1}
                      aria-label={`${t("moveDown")} ${field.label || t("fieldN", { count: idx + 1 })}`}
                    >↓</button>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => removeBuilderField(idx)}
                      aria-label={`${t("remove")} ${field.label || `${t("field")} ${idx + 1}`}`}
                    >{t("remove")}</button>
                  </div>
                ))}
                <button type="submit" disabled={loading || !canEditPages}>
                  {loading ? t("saving") : t("createPage")}
                </button>
                <button
                  type="button"
                  disabled={loading || !canEditPages}
                  onClick={async () => {
                    try {
                      const targetPage = pages[0];
                      if (!targetPage) {
                        setError(t("noPageForDraft"));
                        return;
                      }
                      await apiRequest(`/admin/pages/${targetPage.id}?mode=draft`, {
                        method: "PUT",
                        token,
                        body: {
                          slug: targetPage.slug,
                          title: pageForm.title || targetPage.title,
                          subtitle: pageForm.subtitle,
                          description: targetPage.description || "",
                          logoUrl: targetPage.logoUrl || "",
                          brandColor: pageForm.brandColor,
                          headerMessage: pageForm.headerMessage,
                          footerMessage: pageForm.footerMessage,
                          amountMode: pageForm.amountMode,
                          fixedAmount: Number(pageForm.fixedAmount),
                          minAmount: targetPage.minAmount,
                          maxAmount: targetPage.maxAmount,
                          glCodes: pageForm.glCodes
                            .split(",")
                            .map((code) => code.trim())
                            .filter(Boolean),
                          emailTemplate: targetPage.emailTemplate || "",
                          isActive: true,
                          customFields: targetPage.customFields || [],
                        },
                      });
                      await fetchDashboard(token);
                      setView("pages");
                    } catch (err) {
                      setError(err.message);
                    }
                  }}
                >
                  {t("saveAsDraftFirstPage")}
                </button>
              </form>
            </section>
            <section className="panel preview-panel">
              <h3>{t("livePaymentPagePreview")}</h3>
              <article className="payment-preview">
                <header style={{ background: pageForm.brandColor }}>
                  <p>{t("quickPaymentPage")}</p>
                </header>
                <div className="preview-body">
                  <h4>{pageForm.title || t("yourPageTitle")}</h4>
                  <p>{pageForm.subtitle || t("yourSubtitleHere")}</p>
                  <div className="preview-banner">{pageForm.headerMessage}</div>
                  <label>
                    {t("paymentAmount")}
                    <input readOnly value={`$${Number(pageForm.fixedAmount || 0).toFixed(2)}`} />
                  </label>
                  <label>
                    {t("email")}
                    <input readOnly value={t("payerEmailExample")} />
                  </label>
                  <button type="button">{t("payNow")}</button>
                  <small>{pageForm.footerMessage}</small>
                </div>
              </article>
            </section>
          </div>
        )}

        {view === "transactions" && (
          loading ? (
            <LoadingSkeleton />
          ) : transactions.length === 0 ? (
            <EmptyState
              title={t("noTransactionsYet")}
              message={t("noTransactionsMessage")}
            />
          ) : (
            <section className="panel">
              <h3>{t("recentTransactions")}</h3>
              <div className="txn-filters" role="group" aria-label={t("transactionFilters")}>
                <label>
                  {t("status")}
                  <select
                    value={txnFilters.status}
                    onChange={(e) => setTxnFilters((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    {transactionStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status === "all" ? t("allStatuses") : translateStatus(status)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("method")}
                  <select
                    value={txnFilters.method}
                    onChange={(e) => setTxnFilters((prev) => ({ ...prev, method: e.target.value }))}
                  >
                    {transactionMethods.map((method) => (
                      <option key={method} value={method}>
                        {method === "all" ? t("allMethods") : translateMethod(method)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("search")}
                  <input
                    type="search"
                    placeholder={t("emailOrTransactionId")}
                    value={txnFilters.search}
                    onChange={(e) => setTxnFilters((prev) => ({ ...prev, search: e.target.value }))}
                  />
                </label>
              </div>
              <div className="table-wrap">
                <table aria-label={t("recentTransactions")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("amount")}</th>
                      <th scope="col">{t("status")}</th>
                      <th scope="col">{t("method")}</th>
                      <th scope="col">{t("payer")}</th>
                      <th scope="col">{t("created")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((txn) => (
                      <tr key={txn.id}>
                        <td>{formatCurrency(txn.amount)}</td>
                        <td>
                          <span className={`status-badge status-badge--${txn.status || "pending"}`}>
                            {translateStatus(txn.status || "pending")}
                          </span>
                        </td>
                        <td>{translateMethod(txn.paymentMethod)}</td>
                        <td>{txn.payerEmail || t("notAvailable")}</td>
                        <td>{formatDateTime(txn.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredTransactions.length === 0 && (
                <p className="subtle">{t("noTransactionsMatch")}</p>
              )}
            </section>
          )
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<AdminApp />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/pay/:slug" element={<PublicPaymentPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LanguageProvider>
  );
}

export default App;
