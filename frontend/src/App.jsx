import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { motion } from "framer-motion";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { DistributionPanel } from "./components/DistributionPanel.jsx";
import { getContrastColor } from "./utils/color.js";
import ActivityFeed from "./components/ActivityFeed.jsx";
import AchForm from "./components/AchForm.jsx";
import CardWalletForm from "./components/CardWalletForm.jsx";
import { LanguageProvider, LANGUAGE_OPTIONS, useI18n } from "./i18n.js";
import { localizeSeededText } from "./utils/localizeSeededText.js";
import { supabase } from "./lib/supabaseClient.js";
import HomePage from "./HomePage.jsx";
import googleLogo from "./assets/google-logo.png";
import qppPlainLogo from "./assets/qpp-plain.png";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = STRIPE_KEY ? loadStripe(STRIPE_KEY) : null;
const PAGE_FORM_DEFAULTS = {
  slug: "",
  title: "",
  subtitle: "Secure, self-service payment experience",
  description: "",
  logoUrl: "",
  amountMode: "fixed",
  fixedAmount: 25,
  minAmount: 0,
  maxAmount: 0,
  glCodes: "GL-100",
  brandColor: "#0f63ff",
  headerMessage: "Thank you for choosing our organization",
  footerMessage: "Need help? Reach our billing support team.",
  emailTemplate:
    "Hi {{payer_name}},\n\nWe received your payment of ${{amount}}.\nTransaction ID: {{transaction_id}}\nDate: {{date}}\nCustom fields: {{custom_fields}}\n\nThank you.",
};

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
    let msg = payload.error || payload.message || "Request failed";
    if (payload.error === "Validation failed" && payload.details?.fieldErrors) {
      const firstFieldError = Object.values(payload.details.fieldErrors)
        .flat()
        .find(Boolean);
      if (firstFieldError) msg = firstFieldError;
    }
    const err = new Error(msg);
    if (payload.code) err.code = payload.code;
    throw err;
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
  const safeValues = Array.isArray(values) && values.length > 0 ? values : [0];
  const max = Math.max(...safeValues, 1);
  const points = safeValues
    .map((v, i) => {
      const x = (i / (safeValues.length - 1 || 1)) * 100;
      const y = 100 - (v / max) * 88;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      className="mini-area-chart"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
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
              <span>
                {t(`paymentMethod_${String(item.method || "").toLowerCase()}`, {
                  defaultValue: item.method,
                })}
              </span>
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
    <section className="panel skeleton-grid" aria-label={t("loadingContent", { defaultValue: "Loading content" })}>
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
      <div className="result-icon" aria-hidden="true">
        {success ? "✓" : "!"}
      </div>
      <h2 ref={headingRef} tabIndex={-1}>
        {success
          ? t("paymentSuccessful", { defaultValue: "Payment successful" })
          : t("paymentNotCompleted", { defaultValue: "Payment not completed" })}
      </h2>
      <p>{result.message}</p>
      {result.transactionId && (
        <small>
          {t("transactionId", {
            id: result.transactionId,
            defaultValue: `Transaction ID: ${result.transactionId}`,
          })}
        </small>
      )}
      {!success && (
        <button type="button" onClick={onRetry}>
          {t("tryAgain", { defaultValue: "Try again" })}
        </button>
      )}
    </section>
  );
}

function CheckoutInfoForm({ slug, config, onIntentCreated }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(config.fixedAmount || 0);
  const [payerEmail, setPayerEmail] = useState("");
  const [payerName, setPayerName] = useState("");
  const [customResponses, setCustomResponses] = useState({});
  const [paymentMethodType, setPaymentMethodType] = useState("card_wallet");
  const [fieldErrors, setFieldErrors] = useState({});
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const errors = {};
    if (!payerName.trim()) errors.payerName = t("fieldRequired", { field: t("fullName", { defaultValue: "Full name" }), defaultValue: "Full name is required." });
    if (!payerEmail.trim()) errors.payerEmail = t("fieldRequired", { field: t("email", { defaultValue: "Email" }), defaultValue: "Email is required." });
    if (config.amountMode === "range") {
      const amt = Number(amount);
      if (!amount || amt < Number(config.minAmount || 0)) {
        errors.amount = t("amountMin", { min: Number(config.minAmount || 0).toFixed(2), defaultValue: `Amount must be at least $${Number(config.minAmount || 0).toFixed(2)}.` });
      } else if (config.maxAmount && amt > Number(config.maxAmount)) {
        errors.amount = t("amountMax", { max: Number(config.maxAmount || 0).toFixed(2), defaultValue: `Amount must be at most $${Number(config.maxAmount || 0).toFixed(2)}.` });
      }
    }
    if (
      config.amountMode === "user_entered" &&
      (!amount || Number(amount) <= 0)
    ) {
      errors.amount = t("validAmountRequired", { defaultValue: "Please enter a valid amount." });
    }
    config.customFields?.forEach((field) => {
      if (field.required && !customResponses[field.id]) {
        errors[field.id] = t("fieldRequired", { field: field.label, defaultValue: `${field.label} is required.` });
      }
    });
    return errors;
  };

  const handleContinue = async (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstKey = Object.keys(errors)[0];
      setTimeout(
        () => document.getElementById(`field-${firstKey}`)?.focus(),
        50,
      );
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    setErrorMessage("");
    try {
      const payload = await apiRequest(
        `/public/pay/${slug}/create-payment-intent`,
        {
          method: "POST",
          body: {
            amount: Number(amount),
            payerEmail,
            payerName,
            payment_method_type: paymentMethodType,
            paymentMethod:
              paymentMethodType === "us_bank_account" ? "ach" : "card",
            fieldResponses: customResponses,
          },
        },
      );
      onIntentCreated({
        clientSecret: payload.clientSecret,
        paymentIntentId: payload.paymentIntentId,
        transactionId: payload.transactionId,
        paymentMethodType,
        amountInCents: Math.round(Number(amount) * 100),
      });
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="public-form"
      onSubmit={handleContinue}
      noValidate
      aria-label="Payment form"
    >
      <p className="required-note">{t("requiredFieldsNote", { defaultValue: "* Required fields" })}</p>
      <fieldset className="form-fieldset">
        <legend>{t("yourInformation", { defaultValue: "Your Information" })}</legend>
        <div className="field-group">
          <label htmlFor="field-payerName">{t("fullName", { defaultValue: "Full name" })} *</label>
          <input
            id="field-payerName"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            aria-required="true"
            aria-invalid={!!fieldErrors.payerName}
            aria-describedby={
              fieldErrors.payerName ? "err-payerName" : undefined
            }
          />
          {fieldErrors.payerName && (
            <p id="err-payerName" className="field-error" tabIndex={-1}>
              {fieldErrors.payerName}
            </p>
          )}
        </div>
        <div className="field-group">
          <label htmlFor="field-payerEmail">{t("email", { defaultValue: "Email" })} *</label>
          <input
            id="field-payerEmail"
            type="email"
            value={payerEmail}
            onChange={(e) => setPayerEmail(e.target.value)}
            aria-required="true"
            aria-invalid={!!fieldErrors.payerEmail}
            aria-describedby={
              fieldErrors.payerEmail ? "err-payerEmail" : undefined
            }
          />
          {fieldErrors.payerEmail && (
            <p id="err-payerEmail" className="field-error" tabIndex={-1}>
              {fieldErrors.payerEmail}
            </p>
          )}
        </div>
      </fieldset>

      {config.amountMode === "fixed" && (
        <div className="amount-display">
          <span className="amount-label">{t("amount", { defaultValue: "Amount" })}</span>
          <span className="amount-value">
            ${Number(config.fixedAmount || 0).toFixed(2)}
          </span>
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
            <p id="err-amount" className="field-error" tabIndex={-1}>
              {fieldErrors.amount}
            </p>
          )}
        </div>
      )}
      {config.amountMode === "user_entered" && (
        <div className="field-group">
          <label htmlFor="field-amount">{t("amount", { defaultValue: "Amount" })} *</label>
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
            <p id="err-amount" className="field-error" tabIndex={-1}>
              {fieldErrors.amount}
            </p>
          )}
        </div>
      )}

      {config.customFields?.length > 0 && (
        <fieldset className="form-fieldset">
          <legend>{t("additionalDetails", { defaultValue: "Additional Details" })}</legend>
          {config.customFields.map((field) => (
            <div
              key={field.id}
              className={
                field.type === "checkbox" ? "checkbox-group" : "field-group"
              }
            >
              {field.type === "checkbox" ? (
                <>
                  <input
                    id={`field-${field.id}`}
                    type="checkbox"
                    checked={Boolean(customResponses[field.id])}
                    onChange={(e) =>
                      setCustomResponses((p) => ({
                        ...p,
                        [field.id]: e.target.checked,
                      }))
                    }
                    aria-required={field.required}
                    aria-invalid={!!fieldErrors[field.id]}
                    aria-describedby={
                      fieldErrors[field.id] ? `err-${field.id}` : undefined
                    }
                  />
                  <label htmlFor={`field-${field.id}`}>
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                </>
              ) : (
                <>
                  <label htmlFor={`field-${field.id}`}>
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  {field.type === "dropdown" ? (
                    <select
                      id={`field-${field.id}`}
                      value={customResponses[field.id] || ""}
                      onChange={(e) =>
                        setCustomResponses((p) => ({
                          ...p,
                          [field.id]: e.target.value,
                        }))
                      }
                      aria-required={field.required}
                      aria-invalid={!!fieldErrors[field.id]}
                      aria-describedby={
                        fieldErrors[field.id] ? `err-${field.id}` : undefined
                      }
                    >
                      <option value="">{t("selectAnOption", { defaultValue: "Select an option" })}</option>
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`field-${field.id}`}
                      type={
                        field.type === "date"
                          ? "date"
                          : field.type === "number"
                            ? "number"
                            : "text"
                      }
                      value={customResponses[field.id] || ""}
                      onChange={(e) =>
                        setCustomResponses((p) => ({
                          ...p,
                          [field.id]: e.target.value,
                        }))
                      }
                      aria-required={field.required}
                      aria-invalid={!!fieldErrors[field.id]}
                      aria-describedby={
                        fieldErrors[field.id] ? `err-${field.id}` : undefined
                      }
                    />
                  )}
                </>
              )}
              {fieldErrors[field.id] && (
                <p id={`err-${field.id}`} className="field-error" tabIndex={-1}>
                  {fieldErrors[field.id]}
                </p>
              )}
            </div>
          ))}
        </fieldset>
      )}

      <fieldset className="form-fieldset">
        <legend>{t("paymentMethod", { defaultValue: "Payment method" })}</legend>
        <div className="payment-method-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={paymentMethodType === "card_wallet"}
            className={paymentMethodType === "card_wallet" ? "active" : ""}
            onClick={() => setPaymentMethodType("card_wallet")}
          >
            {t("cardAndDigitalWallet", { defaultValue: "Card & Digital Wallet" })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={paymentMethodType === "us_bank_account"}
            className={paymentMethodType === "us_bank_account" ? "active" : ""}
            onClick={() => setPaymentMethodType("us_bank_account")}
          >
            {t("bankTransferAch", { defaultValue: "Bank Transfer (ACH)" })}
          </button>
        </div>
      </fieldset>

      {errorMessage && (
        <div className="error-banner" role="alert">
          {errorMessage}
        </div>
      )}

      <button type="submit" className="pay-btn" disabled={submitting}>
        {submitting
          ? t("processing", { defaultValue: "Processing..." })
          : t("continueToPayment", { defaultValue: "Continue to Payment" })}
      </button>
    </form>
  );
}

function PaymentStepForm({ slug, intentData, onResult }) {
  const { t } = useI18n();
  const [errorMessage, setErrorMessage] = useState(null);

  const handleSuccess = async () => {
    try {
      const sync = await apiRequest(`/public/pay/${slug}/confirm`, {
        method: "POST",
        body: { paymentIntentId: intentData.paymentIntentId },
      });
      if (sync.status === "success") {
        onResult({
          type: "success",
          message: t("paymentSuccessConfirmation", { defaultValue: "Payment successful. Confirmation has been sent." }),
          transactionId: sync.transactionId,
        });
      } else {
        onResult({
          type: "failure",
          message: t("paymentStatusMessage", {
            status: sync.status,
            defaultValue: `Payment status: ${sync.status}. Please check transaction details.`,
          }),
          transactionId: sync.transactionId,
        });
      }
    } catch (err) {
      onResult({ type: "failure", message: err.message });
    }
  };

  return (
    <div className="payment-container">
      {errorMessage && (
        <div className="error-banner" role="alert">
          {errorMessage}
        </div>
      )}
      <div role="tabpanel">
        {intentData.paymentMethodType === "card_wallet" ? (
          <CardWalletForm onSuccess={handleSuccess} onError={setErrorMessage} />
        ) : (
          <AchForm
            amount={intentData.amountInCents}
            onSuccess={handleSuccess}
            onError={setErrorMessage}
          />
        )}
      </div>
    </div>
  );
}

function PublicPaymentPage() {
  const { t } = useI18n();
  const { slug } = useParams();
  const [config, setConfig] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [intentData, setIntentData] = useState(null);

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
        <EmptyState
          title={t("payUnavailable", { defaultValue: "Payment page unavailable" })}
          message={error || t("verifyUrlTryAgain", { defaultValue: "Please verify this URL and try again." })}
        />
      </main>
    );
  }

  const headerTextColor = getContrastColor(config.brandColor);
  const localizedTitle = localizeSeededText(config.title, t);
  const localizedSubtitle = localizeSeededText(config.subtitle, t);
  const localizedHeaderMessage = localizeSeededText(config.headerMessage, t);
  const localizedFooterMessage = localizeSeededText(config.footerMessage, t);

  const handleRetry = () => {
    setResult(null);
    setIntentData(null);
  };

  return (
    <main className="public-shell">
      <section className="public-card">
        <header
          className="public-header"
          style={{
            background: config.brandColor || "#0f63ff",
            color: headerTextColor,
          }}
        >
          {config.logoUrl && (
            <img
              src={config.logoUrl}
              alt={`${localizedTitle} logo`}
              className="public-logo"
              onError={(e) => {
                e.target.style.display = "none";
              }}
            />
          )}
          <h1>{localizedTitle}</h1>
          {localizedSubtitle && (
            <p className="public-subtitle">{localizedSubtitle}</p>
          )}
        </header>
        <div className="public-body">
          {config.description && <p className="subtle">{config.description}</p>}
          <div className="preview-banner">
            {localizedHeaderMessage || t("completeSecurePaymentBelow", { defaultValue: "Complete secure payment below." })}
          </div>
          {result ? (
            <PaymentResultView result={result} onRetry={handleRetry} />
          ) : !STRIPE_KEY || !stripePromise ? (
            <p className="error">
              Missing Stripe publishable key. Set `VITE_STRIPE_PUBLISHABLE_KEY`
              in your frontend environment.
            </p>
          ) : !intentData ? (
            <CheckoutInfoForm
              slug={slug}
              config={config}
              onIntentCreated={setIntentData}
            />
          ) : (
            <Elements
              stripe={stripePromise}
              options={{ clientSecret: intentData.clientSecret }}
            >
              <PaymentStepForm
                slug={slug}
                intentData={intentData}
                onResult={setResult}
              />
            </Elements>
          )}
          {localizedFooterMessage && (
            <footer className="public-footer">{localizedFooterMessage}</footer>
          )}
        </div>
      </section>
    </main>
  );
}

function AuthPage({ mode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const existingToken = localStorage.getItem("qpp_token");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyLogoDataUrl, setCompanyLogoDataUrl] = useState("");
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const isSignup = mode === "signup";

  if (existingToken) {
    return <Navigate to="/dashboard" replace />;
  }

  const exchangeSupabaseSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const exchange = await apiRequest("/auth/supabase/exchange", {
      method: "POST",
      body: {
        accessToken: session.access_token,
      },
    });
    localStorage.setItem("qpp_token", exchange.token);
    navigate("/dashboard", { replace: true });
    return true;
  };

  const createCompanyAccount = async () => {
    if (!companyName.trim()) throw new Error("Company name is required.");
    if (!companyLogoDataUrl) throw new Error("Company logo is required.");
    if (!loginForm.email.trim()) throw new Error("Email address is required.");
    if (!loginForm.password.trim()) throw new Error("Password is required.");

    const signupResponse = await apiRequest("/auth/signup", {
      method: "POST",
      body: {
        companyName: companyName.trim(),
        companyLogoUrl: companyLogoDataUrl,
        email: loginForm.email.trim().toLowerCase(),
        password: loginForm.password,
      },
    });
    setCompanyName("");
    setCompanyLogoDataUrl("");
    setLoginForm({ email: "", password: "" });
    return signupResponse;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setAuthNotice("");
    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: { email: loginForm.email.trim(), password: loginForm.password },
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
      const signupResponse = await createCompanyAccount();
      if (signupResponse?.token) {
        localStorage.setItem("qpp_token", signupResponse.token);
        navigate("/dashboard", { replace: true });
        return;
      }
      setAuthNotice(
        signupResponse?.message ||
          "Account created successfully. You can now sign in.",
      );
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
      if (isSignup) {
        const signupResponse = await createCompanyAccount();
        if (signupResponse?.token) {
          localStorage.setItem("qpp_token", signupResponse.token);
          navigate("/dashboard", { replace: true });
          return;
        }
        setAuthNotice(
          signupResponse?.message ||
            "Account created successfully. You can now sign in.",
        );
        return;
      }
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

  useEffect(() => {
    if (isSignup) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function tryExchange() {
      try {
        if (cancelled) return;
        const exchanged = await exchangeSupabaseSession();
        if (exchanged) return;
      } catch (err) {
        if (cancelled) return;
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
        <img src={qppPlainLogo} alt="QPP" className="auth-brand-logo" />
        <p className="eyebrow">{t("waystarInspiredExperience", { defaultValue: "Waystar Inspired Experience" })}</p>
        <h1>{isSignup ? t("createCompanyAccount", { defaultValue: "Create Company Account" }) : t("signIn", { defaultValue: "Sign In" })}</h1>
        <p className="auth-subtitle">
          {isSignup
            ? "Create your company account to manage branded payment pages."
            : "Sign in to manage branded payment pages and reporting."}
        </p>
        <form
          className="form-grid"
          onSubmit={isSignup ? handleSignup : handleLogin}
          aria-label={isSignup ? "Company sign up" : "Sign in"}
        >
          {isSignup && (
            <>
              <div className="field-group">
                <label htmlFor="company-name">{t("companyName", { defaultValue: "Company name" })}</label>
                <input
                  id="company-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  aria-required="true"
                />
              </div>
              <div className="field-group">
                <label htmlFor="company-logo">{t("companyLogo", { defaultValue: "Company logo" })}</label>
                <input
                  id="company-logo"
                  type="file"
                  accept="image/*"
                  required
                  aria-required="true"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) {
                      setCompanyLogoDataUrl("");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      setCompanyLogoDataUrl(String(reader.result || ""));
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </div>
            </>
          )}
          <div className="field-group">
            <label htmlFor="login-email">{t("emailAddress", { defaultValue: "Email address" })}</label>
            <input
              id="login-email"
              type={isSignup ? "email" : "text"}
              value={loginForm.email}
              onChange={(e) =>
                setLoginForm((p) => ({ ...p, email: e.target.value }))
              }
              required
              aria-required="true"
            />
          </div>
          <div className="field-group">
            <label htmlFor="login-password">{t("password", { defaultValue: "Password" })}</label>
            <input
              id="login-password"
              type="password"
              value={loginForm.password}
              onChange={(e) =>
                setLoginForm((p) => ({ ...p, password: e.target.value }))
              }
              required
              aria-required="true"
            />
          </div>
          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading
              ? isSignup
                ? "Creating account..."
                : "Signing in..."
              : isSignup
                ? t("createAccount", { defaultValue: "Create account" })
                : t("signIn", { defaultValue: "Sign in" })}
          </button>
        </form>
        <button
          type="button"
          className="auth-google-btn"
          onClick={handleGoogleAuth}
          disabled={loading}
        >
          <img
            src={googleLogo}
            alt=""
            className="google-icon"
            aria-hidden="true"
          />
          {isSignup
            ? t("createWithGoogle", { defaultValue: "Create with Google" })
            : t("continueWithGoogle", { defaultValue: "Continue with Google" })}
        </button>
        <p className="auth-switch-row">
          {isSignup ? "Already have an account?" : "Need an account?"}{" "}
          <Link
            className="auth-switch-link"
            to={isSignup ? "/login" : "/signup"}
          >
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
  const [user, setUser] = useState(null);
  const [pages, setPages] = useState([]);
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [insights, setInsights] = useState(null);
  const [pageVersions, setPageVersions] = useState({});
  const [selectedPage, setSelectedPage] = useState(null);
  const [view, setView] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("qpp_theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });

  const [pageForm, setPageForm] = useState(PAGE_FORM_DEFAULTS);
  const [editingPageId, setEditingPageId] = useState(null);
  const [reportFilters, setReportFilters] = useState({
    from: "",
    to: "",
    pageId: "",
    status: "",
    paymentMethod: "",
  });

  const [customFieldsBuilder, setCustomFieldsBuilder] = useState([]);
  const addBuilderField = () => {
    if (customFieldsBuilder.length >= 10) {
      setError("Maximum 10 custom fields allowed.");
      return;
    }
    setCustomFieldsBuilder((prev) => [
      ...prev,
      {
        id: `f${Date.now()}`,
        label: "",
        type: "text",
        required: false,
        options: "",
        order: prev.length,
      },
    ]);
  };
  const removeBuilderField = (idx) =>
    setCustomFieldsBuilder((prev) => prev.filter((_, i) => i !== idx));
  const updateBuilderField = (idx, key, val) =>
    setCustomFieldsBuilder((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, [key]: val } : f)),
    );
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

  const buildQueryString = (filters) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        params.set(key, value);
      }
    });
    return params.toString();
  };

  const fetchDashboard = async (activeToken, filters = reportFilters) => {
    const authToken = activeToken || token;
    if (!authToken) return;
    setLoading(true);
    setError("");
    try {
      const me = await apiRequest("/auth/me", { token: authToken });
      setUser(me);
      const txnQuery = buildQueryString(filters);
      const [pageList, reportSummary, txns] = await Promise.all([
        apiRequest("/admin/pages", { token: authToken }),
        apiRequest("/admin/reports/summary", { token: authToken }),
        apiRequest(
          `/admin/reports/transactions${txnQuery ? `?${txnQuery}` : ""}`,
          { token: authToken },
        ),
      ]);
      const insightData = await apiRequest("/admin/reports/insights", {
        token: authToken,
      });
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

  useEffect(() => {
    document.body.classList.remove("light-mode", "dark-mode");
    document.body.classList.add(theme === "light" ? "light-mode" : "dark-mode");
    localStorage.setItem("qpp_theme", theme);
    return () => {
      document.body.classList.remove("light-mode", "dark-mode");
    };
  }, [theme]);

  const resetPageBuilder = () => {
    setPageForm(PAGE_FORM_DEFAULTS);
    setCustomFieldsBuilder([]);
    setEditingPageId(null);
  };

  const preparePagePayload = () => ({
    slug: pageForm.slug,
    title: pageForm.title,
    subtitle: pageForm.subtitle,
    description: pageForm.description,
    logoUrl: pageForm.logoUrl,
    amountMode: pageForm.amountMode,
    fixedAmount:
      pageForm.amountMode === "fixed"
        ? Number(pageForm.fixedAmount)
        : undefined,
    minAmount:
      pageForm.amountMode === "range" ? Number(pageForm.minAmount) : undefined,
    maxAmount:
      pageForm.amountMode === "range" ? Number(pageForm.maxAmount) : undefined,
    glCodes: pageForm.glCodes
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean),
    brandColor: pageForm.brandColor,
    headerMessage: pageForm.headerMessage,
    footerMessage: pageForm.footerMessage,
    emailTemplate: pageForm.emailTemplate,
    customFields: customFieldsBuilder.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      options:
        f.type === "dropdown"
          ? f.options
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : [],
      order: f.order,
      placeholder: f.placeholder || "",
      helperText: f.helperText || "",
    })),
  });

  const handleCreatePage = async (e) => {
    e.preventDefault();
    if (!canEditPages) return;
    setLoading(true);
    setError("");
    try {
      const payload = preparePagePayload();
      if (editingPageId) {
        await apiRequest(`/admin/pages/${editingPageId}`, {
          method: "PUT",
          token,
          body: payload,
        });
      } else {
        await apiRequest("/admin/pages", {
          method: "POST",
          token,
          body: payload,
        });
      }
      resetPageBuilder();
      await fetchDashboard(token, reportFilters);
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
    } catch (err) {
      setError(`Copy failed: ${err.message}`);
    }
  };

  const handleToggleStatus = async (pageId, currentActive) => {
    try {
      await apiRequest(`/admin/pages/${pageId}/status`, {
        method: "PATCH",
        token,
        body: { isActive: !currentActive },
      });
      await fetchDashboard(token, reportFilters);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchVersions = async (pageId) => {
    const versions = await apiRequest(`/admin/pages/${pageId}/versions`, {
      token,
    });
    setPageVersions((prev) => ({ ...prev, [pageId]: versions }));
  };

  const publishDraft = async (pageId) => {
    try {
      await apiRequest(`/admin/pages/${pageId}/publish`, {
        method: "POST",
        token,
      });
      await fetchDashboard(token, reportFilters);
      await fetchVersions(pageId);
    } catch (err) {
      setError(err.message);
    }
  };

  const rollbackLatest = async (pageId) => {
    try {
      const versions =
        pageVersions[pageId] ||
        (await apiRequest(`/admin/pages/${pageId}/versions`, { token }));
      const target = versions[1];
      if (!target) {
        setError("No prior version available to rollback.");
        return;
      }
      await apiRequest(`/admin/pages/${pageId}/rollback`, {
        method: "POST",
        token,
        body: { versionNumber: target.versionNumber },
      });
      await fetchDashboard(token, reportFilters);
      await fetchVersions(pageId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("qpp_token");
    supabase.auth.signOut().catch(() => {});
    setToken("");
    setUser(null);
    setPages([]);
    setSummary(null);
    setTransactions([]);
  };

  const startEditingPage = (page) => {
    setEditingPageId(page.id);
    setPageForm({
      slug: page.slug || "",
      title: page.title || "",
      subtitle: page.subtitle || "",
      description: page.description || "",
      logoUrl: page.logoUrl || "",
      amountMode: page.amountMode || "fixed",
      fixedAmount: page.fixedAmount ?? 0,
      minAmount: page.minAmount ?? 0,
      maxAmount: page.maxAmount ?? 0,
      glCodes: (page.glCodes || []).join(", "),
      brandColor: page.brandColor || "#0f63ff",
      headerMessage: page.headerMessage || "",
      footerMessage: page.footerMessage || "",
      emailTemplate: page.emailTemplate || PAGE_FORM_DEFAULTS.emailTemplate,
    });
    setCustomFieldsBuilder(
      (page.customFields || []).map((field, idx) => ({
        id: field.id || `f${Date.now()}-${idx}`,
        label: field.label || "",
        type: field.type || "text",
        required: Boolean(field.required),
        options: (field.options || []).join(", "),
        order: field.order ?? idx,
        placeholder: field.placeholder || "",
        helperText: field.helperText || "",
      })),
    );
    setView("create");
  };

  const applyReportFilters = async (e) => {
    e.preventDefault();
    await fetchDashboard(token, reportFilters);
  };

  const exportTransactionsCsv = async () => {
    try {
      const query = buildQueryString(reportFilters);
      const response = await fetch(
        `${API_BASE}/admin/reports/transactions.csv${query ? `?${query}` : ""}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        throw new Error("Failed to export CSV");
      }
      const csvText = await response.text();
      const blob = new Blob([csvText], { type: "text/csv" });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "transactions.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!token) return <Navigate to="/login" replace />;

  const isOwner = user?.role === "owner";
  const ownerCompanyName = isOwner ? user?.companyName?.trim() : "";
  const ownerCompanyLogo = isOwner ? user?.companyLogoUrl?.trim() : "";
  const accountDisplayName = ownerCompanyName || "Waystar QPP";
  const accountSubtitle = isOwner
    ? t("ownerWorkspace", { defaultValue: "Owner workspace" })
    : `${t(`role_${user?.role || "viewer"}`, {
        defaultValue:
          `${(user?.role || "viewer").charAt(0).toUpperCase()}${(user?.role || "viewer").slice(1)}`,
      })} ${t("workspace", { defaultValue: "workspace" })}`;
  const collectionVelocityData = useMemo(() => {
    const trend = insights?.trend || [];
    const revenueValues = trend.map((entry) => Number(entry.revenue || 0));
    if (revenueValues.some((value) => value > 0)) return revenueValues;
    const transactionValues = trend.map((entry) =>
      Number(entry.transactionCount || 0),
    );
    if (transactionValues.some((value) => value > 0)) return transactionValues;
    return [0];
  }, [insights]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-main">
          <div className="sidebar-brand">
            <img src={qppPlainLogo} alt="QPP" className="sidebar-qpp-logo" />
            <div>
              <h2>{t("quickPaymentPages", { defaultValue: "Quick Payment Pages" })}</h2>
              <p className="sidebar-brand-subtext">{t("healthcarePaymentsControlCenter", { defaultValue: "Control Center" })}</p>
            </div>
          </div>
          <div className="workspace-profile">
            <div
              className="workspace-logo-wrap"
              aria-hidden={ownerCompanyLogo ? undefined : "true"}
            >
              {ownerCompanyLogo ? (
                <img
                  src={ownerCompanyLogo}
                  alt={`${accountDisplayName} logo`}
                  className="workspace-logo"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <span>{accountDisplayName.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="workspace-meta">
              <p className="workspace-name">{accountDisplayName}</p>
              <p className="workspace-subtitle">{accountSubtitle}</p>
            </div>
          </div>
          <div className="role-pill-wrap">
            <p className="role-pill">{user?.role || "viewer"}</p>
          </div>
          <nav aria-label="Admin navigation">
            {["overview", "insights", "pages", "create", "transactions"].map(
              (item) => (
                <button
                  key={item}
                  className={view === item ? "nav-btn active" : "nav-btn"}
                  onClick={() => setView(item)}
                  aria-current={view === item ? "page" : undefined}
                >
                  {t(item, { defaultValue: item[0].toUpperCase() + item.slice(1) })}
                </button>
              ),
            )}
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-lang-switcher">
            <label htmlFor="lang-select-sidebar">
              {t("language", { defaultValue: "Language" })}
            </label>
            <select
              id="lang-select-sidebar"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label={t("language", { defaultValue: "Language" })}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="theme-btn"
            type="button"
            onClick={() =>
              setTheme((prev) => (prev === "dark" ? "light" : "dark"))
            }
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            className="logout-btn"
            onClick={handleLogout}
            aria-label="Sign out"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="content-shell">
        <header className="dashboard-header">
          <p className="eyebrow">{t("healthcarePaymentsControlCenter", { defaultValue: "Control Center" })}</p>
          <h1>{accountDisplayName}</h1>
          <p className="subtle">
            Unified overview for payment pages, transactions, and distribution.
          </p>
        </header>
        {error && (
          <div role="alert" aria-live="assertive" className="error">
            {error}
          </div>
        )}

        {view === "overview" && (
          <>
            <section className="stats-grid">
              <StatCard
                label={t("totalPayments", { defaultValue: "Total Payments" })}
                value={summary ? summary.totalPayments.toLocaleString() : "--"}
              />
              <StatCard
                label={t("amountCollected", { defaultValue: "Amount Collected" })}
                value={
                  summary
                    ? `$${Number(summary.totalAmountCollected || 0).toLocaleString()}`
                    : "--"
                }
              />
              <StatCard
                label={t("averagePayment", { defaultValue: "Average Payment" })}
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
              <div className="view-stack">
                <section className="panel chart-panel">
                  <div>
                    <h3>{t("collectionVelocity", { defaultValue: "Collection velocity" })}</h3>
                    <p className="subtle">
                      {t("collectionVelocityDesc", { defaultValue: "Last 14-day trend based on recorded transactions." })}
                    </p>
                  </div>
                  <MiniAreaChart values={collectionVelocityData} />
                </section>
                <section className="panel">
                  <h3>{t("paymentMethodMix", { defaultValue: "Payment method mix" })}</h3>
                  {summary?.byPaymentMethod?.length ? (
                    <MethodBars items={summary.byPaymentMethod} />
                  ) : (
                    <p className="subtle">
                      No successful transactions yet. Run a test payment to
                      populate this view.
                    </p>
                  )}
                </section>
                <section className="panel">
                  <h3>{t("paymentPages", { defaultValue: "Payment pages" })}</h3>
                  <p>
                    {pages.length} configured pages across your payment
                    portfolio.
                  </p>
                </section>
                <section className="panel">
                  <ActivityFeed authToken={token} />
                </section>
              </div>
            )}
          </>
        )}

        {view === "insights" &&
          (loading ? (
            <LoadingSkeleton />
          ) : !insights ? (
            <EmptyState
              title="No insights yet"
              message="Perform some payment activity to populate analytics."
            />
          ) : (
            <div className="view-stack">
              <section className="stats-grid">
                <StatCard
                  label="Page Views"
                  value={insights.overview.totalViews.toLocaleString()}
                />
                <StatCard
                  label="Checkout Starts"
                  value={insights.overview.totalTransactions.toLocaleString()}
                />
                <StatCard
                  label="Successful Payments"
                  value={insights.overview.successfulTransactions.toLocaleString()}
                />
              </section>
              <section className="panel">
                <h3>{t("conversionFunnel", { defaultValue: "Conversion funnel" })}</h3>
                <div className="method-bars">
                  <div className="method-row">
                    <div className="method-meta">
                      <span>{t("viewToCheckout", { defaultValue: "View to Checkout" })}</span>
                      <strong>
                        {(insights.funnel.viewToCheckoutRate * 100).toFixed(1)}%
                      </strong>
                    </div>
                    <div className="bar-track">
                      <span
                        className="bar-fill"
                        style={{
                          width: `${Math.max(4, insights.funnel.viewToCheckoutRate * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="method-row">
                    <div className="method-meta">
                      <span>{t("checkoutToSuccess", { defaultValue: "Checkout to Success" })}</span>
                      <strong>
                        {(insights.funnel.checkoutToSuccessRate * 100).toFixed(
                          1,
                        )}
                        %
                      </strong>
                    </div>
                    <div className="bar-track">
                      <span
                        className="bar-fill"
                        style={{
                          width: `${Math.max(4, insights.funnel.checkoutToSuccessRate * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>
              <section className="panel">
                <h3>{t("topPagePerformance", { defaultValue: "Top page performance" })}</h3>
                <div className="table-wrap">
                  <table aria-label="Top page performance">
                    <thead>
                      <tr>
                        <th scope="col">{t("page", { defaultValue: "Page" })}</th>
                        <th scope="col">{t("views", { defaultValue: "Views" })}</th>
                        <th scope="col">{t("transactions", { defaultValue: "Transactions" })}</th>
                        <th scope="col">{t("success", { defaultValue: "Success" })}</th>
                        <th scope="col">{t("revenue", { defaultValue: "Revenue" })}</th>
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
            </div>
          ))}

        {view === "pages" &&
          (loading ? (
            <LoadingSkeleton />
          ) : pages.length === 0 ? (
            <EmptyState
              title="No payment pages yet"
              message="Create your first page in the editor and start collecting payments in minutes."
            />
          ) : (
            <>
              <section className="panel">
                <h3>{t("configuredPages", { defaultValue: "Configured pages" })}</h3>
                <div className="table-wrap">
                  <table aria-label="Payment pages">
                    <thead>
                      <tr>
                        <th scope="col">{t("title", { defaultValue: "Title" })}</th>
                        <th scope="col">{t("slug", { defaultValue: "Slug" })}</th>
                        <th scope="col">{t("status", { defaultValue: "Status" })}</th>
                        <th scope="col">{t("amountMode", { defaultValue: "Amount mode" })}</th>
                        <th scope="col">{t("actions", { defaultValue: "Actions" })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pages.map((page) => (
                        <tr key={page.id}>
                          <td>{page.title}</td>
                          <td>/{page.slug}</td>
                          <td>
                            {page.isActive
                              ? t("active", { defaultValue: "Active" })
                              : t("disabled", { defaultValue: "Disabled" })}
                          </td>
                          <td>{page.amountMode}</td>
                          <td>
                            <button
                              className="tiny-btn"
                              onClick={() => handleCopy(page.id)}
                              aria-label={`Copy URL for ${page.title}`}
                            >
                              Copy URL
                            </button>
                            <button
                              className={`tiny-btn${selectedPage?.id === page.id ? " active" : ""}`}
                              onClick={() =>
                                setSelectedPage(
                                  selectedPage?.id === page.id ? null : page,
                                )
                              }
                              aria-label={
                                selectedPage?.id === page.id
                                  ? `Close distribution panel for ${page.title}`
                                  : `Distribute ${page.title}`
                              }
                              aria-expanded={selectedPage?.id === page.id}
                            >
                              {selectedPage?.id === page.id
                                ? "Close"
                                : "Distribute"}
                            </button>
                            {canEditPages && (
                              <>
                                <button
                                  className="tiny-btn"
                                  onClick={() =>
                                    handleToggleStatus(page.id, page.isActive)
                                  }
                                  aria-label={
                                    page.isActive
                                      ? `Disable ${page.title}`
                                      : `Enable ${page.title}`
                                  }
                                >
                                  {page.isActive ? "Disable" : "Enable"}
                                </button>
                                <button
                                  className="tiny-btn"
                                  onClick={() => fetchVersions(page.id)}
                                  aria-label={`View versions for ${page.title}`}
                                >
                                  Versions
                                </button>
                                <button
                                  className="tiny-btn"
                                  onClick={() => startEditingPage(page)}
                                  aria-label={`Edit ${page.title}`}
                                >
                                  Edit
                                </button>
                                {page.hasDraft && (
                                  <button
                                    className="tiny-btn"
                                    onClick={() => publishDraft(page.id)}
                                    aria-label={`Publish draft for ${page.title}`}
                                  >
                                    Publish Draft
                                  </button>
                                )}
                                <button
                                  className="tiny-btn"
                                  onClick={() => rollbackLatest(page.id)}
                                  aria-label={`Rollback ${page.title} to previous version`}
                                >
                                  Rollback
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {Object.entries(pageVersions).map(([pageId, versions]) => (
                  <div key={pageId} className="versions-block">
                      <h4>
                      {t("versionsForPage", { defaultValue: "Versions for page" })}{" "}
                      {pages.find((p) => p.id === pageId)?.title || pageId}
                    </h4>
                    <ul>
                      {versions.slice(0, 5).map((v) => (
                        <li key={`${pageId}-${v.versionNumber}`}>
                          v{v.versionNumber} -{" "}
                          {new Date(v.createdAt).toLocaleString()}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
              {selectedPage && (
                <section className="panel">
                  <h3>{t("distributePanelTitle", { title: selectedPage.title, defaultValue: `Distribute - ${selectedPage.title}` })}</h3>
                  <DistributionPanel
                    pageId={selectedPage.id}
                    pageSlug={selectedPage.slug}
                    pageTitle={selectedPage.title}
                    authToken={token}
                  />
                </section>
              )}
            </>
          ))}

        {view === "create" && (
          <div className="create-grid">
            <section className="panel">
              <h3>
                {editingPageId ? "Edit payment page" : "Create payment page"}
              </h3>
              {!canEditPages && (
                <p className="error">
                  Your role is read-only. Ask an owner to grant editor access.
                </p>
              )}
              <form
                className="form-grid"
                onSubmit={handleCreatePage}
                aria-label="Create payment page"
              >
                <div className="field-group">
                  <label htmlFor="cf-title">{t("pageTitle", { defaultValue: "Page title" })} *</label>
                  <input
                    id="cf-title"
                    value={pageForm.title}
                    onChange={(e) =>
                      setPageForm((p) => ({ ...p, title: e.target.value }))
                    }
                    required
                    aria-required="true"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-subtitle">{t("subtitle", { defaultValue: "Subtitle" })}</label>
                  <input
                    id="cf-subtitle"
                    value={pageForm.subtitle}
                    onChange={(e) =>
                      setPageForm((p) => ({ ...p, subtitle: e.target.value }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-description">{t("description", { defaultValue: "Description" })}</label>
                  <input
                    id="cf-description"
                    value={pageForm.description}
                    onChange={(e) =>
                      setPageForm((p) => ({
                        ...p,
                        description: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-logoUrl">{t("logoUrl", { defaultValue: "Logo URL" })}</label>
                  <input
                    id="cf-logoUrl"
                    type="url"
                    value={pageForm.logoUrl}
                    onChange={(e) =>
                      setPageForm((p) => ({ ...p, logoUrl: e.target.value }))
                    }
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-slug">{t("urlSlug", { defaultValue: "URL slug" })} *</label>
                  <input
                    id="cf-slug"
                    value={pageForm.slug}
                    onChange={(e) =>
                      setPageForm((p) => ({
                        ...p,
                        slug: e.target.value.toLowerCase(),
                      }))
                    }
                    required
                    aria-required="true"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-brandColor">{t("brandColorHex", { defaultValue: "Brand color (hex)" })}</label>
                  <input
                    id="cf-brandColor"
                    type="color"
                    value={pageForm.brandColor}
                    onChange={(e) =>
                      setPageForm((p) => ({ ...p, brandColor: e.target.value }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-headerMessage">{t("headerMessage", { defaultValue: "Header message" })}</label>
                  <input
                    id="cf-headerMessage"
                    value={pageForm.headerMessage}
                    onChange={(e) =>
                      setPageForm((p) => ({
                        ...p,
                        headerMessage: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-footerMessage">{t("footerMessage", { defaultValue: "Footer message" })}</label>
                  <input
                    id="cf-footerMessage"
                    value={pageForm.footerMessage}
                    onChange={(e) =>
                      setPageForm((p) => ({
                        ...p,
                        footerMessage: e.target.value,
                      }))
                    }
                  />
                </div>
                <fieldset className="form-fieldset">
                  <legend>{t("paymentAmountMode", { defaultValue: "Payment Amount Mode" })}</legend>
                  <div className="field-group">
                    <label htmlFor="cf-amountMode">{t("amountMode", { defaultValue: "Amount mode" })}</label>
                    <select
                      id="cf-amountMode"
                      value={pageForm.amountMode}
                      onChange={(e) =>
                        setPageForm((p) => ({
                          ...p,
                          amountMode: e.target.value,
                        }))
                      }
                    >
                      <option value="fixed">{t("fixed", { defaultValue: "Fixed" })}</option>
                      <option value="range">{t("range", { defaultValue: "Range" })}</option>
                      <option value="user_entered">{t("userEntered", { defaultValue: "User entered" })}</option>
                    </select>
                  </div>
                  {pageForm.amountMode === "fixed" && (
                    <div className="field-group">
                      <label htmlFor="cf-fixedAmount">{t("fixedAmount", { defaultValue: "Fixed amount" })}</label>
                      <input
                        id="cf-fixedAmount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={pageForm.fixedAmount}
                        onChange={(e) =>
                          setPageForm((p) => ({
                            ...p,
                            fixedAmount: e.target.value,
                          }))
                        }
                      />
                    </div>
                  )}
                  {pageForm.amountMode === "range" && (
                    <>
                      <div className="field-group">
                        <label htmlFor="cf-minAmount">{t("minimumAmount", { defaultValue: "Minimum amount" })}</label>
                        <input
                          id="cf-minAmount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={pageForm.minAmount}
                          onChange={(e) =>
                            setPageForm((p) => ({
                              ...p,
                              minAmount: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="field-group">
                        <label htmlFor="cf-maxAmount">{t("maximumAmount", { defaultValue: "Maximum amount" })}</label>
                        <input
                          id="cf-maxAmount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={pageForm.maxAmount}
                          onChange={(e) =>
                            setPageForm((p) => ({
                              ...p,
                              maxAmount: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </>
                  )}
                </fieldset>
                <div className="field-group">
                  <label htmlFor="cf-glCodes">{t("glCodesCommaSeparated", { defaultValue: "GL codes (comma separated)" })}</label>
                  <input
                    id="cf-glCodes"
                    value={pageForm.glCodes}
                    onChange={(e) =>
                      setPageForm((p) => ({ ...p, glCodes: e.target.value }))
                    }
                    placeholder="Example: GL-100, AR_200, REV.300"
                  />
                  <small className="subtle">
                    Allowed characters: letters, numbers, `_`, `.`, and `-`.
                  </small>
                </div>
                <div className="field-group">
                  <label htmlFor="cf-emailTemplate">
                    Confirmation email template
                  </label>
                  <textarea
                    id="cf-emailTemplate"
                    rows={5}
                    value={pageForm.emailTemplate}
                    onChange={(e) =>
                      setPageForm((p) => ({
                        ...p,
                        emailTemplate: e.target.value,
                      }))
                    }
                    placeholder="Use {{payer_name}}, {{amount}}, {{transaction_id}}, {{date}}, {{custom_fields}}"
                  />
                </div>
                <div className="field-builder-header">
                  <span>Custom fields ({customFieldsBuilder.length}/10)</span>
                  <button
                    type="button"
                    className="tiny-btn"
                    onClick={addBuilderField}
                    aria-label="Add custom field"
                  >
                    + Add field
                  </button>
                </div>
                {customFieldsBuilder.map((field, idx) => (
                  <div key={field.id} className="field-builder-row">
                    <input
                      aria-label={`Custom field ${idx + 1} label`}
                      placeholder="Field label"
                      value={field.label}
                      onChange={(e) =>
                        updateBuilderField(idx, "label", e.target.value)
                      }
                    />
                    <select
                      aria-label={`Custom field ${idx + 1} type`}
                      value={field.type}
                      onChange={(e) =>
                        updateBuilderField(idx, "type", e.target.value)
                      }
                    >
                      <option value="text">{t("text", { defaultValue: "Text" })}</option>
                      <option value="number">{t("number", { defaultValue: "Number" })}</option>
                      <option value="dropdown">{t("dropdown", { defaultValue: "Dropdown" })}</option>
                      <option value="date">{t("date", { defaultValue: "Date" })}</option>
                      <option value="checkbox">{t("checkbox", { defaultValue: "Checkbox" })}</option>
                    </select>
                    {field.type === "dropdown" && (
                      <input
                        aria-label={`Custom field ${idx + 1} dropdown options`}
                        placeholder="Options (comma separated)"
                        value={field.options}
                        onChange={(e) =>
                          updateBuilderField(idx, "options", e.target.value)
                        }
                      />
                    )}
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) =>
                          updateBuilderField(idx, "required", e.target.checked)
                        }
                        aria-label={`${field.label || `Field ${idx + 1}`} required`}
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => moveBuilderField(idx, "up")}
                      disabled={idx === 0}
                      aria-label={`Move ${field.label || `field ${idx + 1}`} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => moveBuilderField(idx, "down")}
                      disabled={idx === customFieldsBuilder.length - 1}
                      aria-label={`Move ${field.label || `field ${idx + 1}`} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => removeBuilderField(idx)}
                      aria-label={`Remove ${field.label || `field ${idx + 1}`}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button type="submit" disabled={loading || !canEditPages}>
                  {loading
                    ? "Saving..."
                    : editingPageId
                      ? "Save changes"
                      : "Create page"}
                </button>
                {editingPageId && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={resetPageBuilder}
                  >
                    {t("cancelEditing", { defaultValue: "Cancel editing" })}
                  </button>
                )}
                <button
                  type="button"
                  disabled={loading || !canEditPages}
                  onClick={async () => {
                    try {
                      const targetPage =
                        pages.find((p) => p.id === editingPageId) || pages[0];
                      if (!targetPage) {
                        setError(
                          "Create a page first, then use Save as Draft.",
                        );
                        return;
                      }
                      await apiRequest(
                        `/admin/pages/${targetPage.id}?mode=draft`,
                        {
                          method: "PUT",
                          token,
                          body: {
                            ...preparePagePayload(),
                            isActive: targetPage.isActive,
                          },
                        },
                      );
                      await fetchDashboard(token, reportFilters);
                      setView("pages");
                    } catch (err) {
                      setError(err.message);
                    }
                  }}
                >
                  {t("saveAsDraft", { defaultValue: "Save as Draft" })}
                </button>
              </form>
            </section>
            <section className="panel preview-panel">
              <h3>{t("livePaymentPagePreview", { defaultValue: "Live payment page preview" })}</h3>
              <article className="payment-preview">
                <header style={{ background: pageForm.brandColor }}>
                  <p>{pageForm.title || "Quick Payment Page"}</p>
                </header>
                <div className="preview-body">
                  {pageForm.subtitle && <p>{pageForm.subtitle}</p>}
                  <div className="preview-banner">
                    {pageForm.headerMessage || "Complete secure payment below."}
                  </div>

                  <fieldset className="form-fieldset preview-fieldset">
                    <legend>{t("yourInformation", { defaultValue: "Your Information" })}</legend>
                    <label>
                      Full name *
                      <input readOnly value="" placeholder="Full name" />
                    </label>
                    <label>
                      Email *
                      <input
                        readOnly
                        value=""
                        placeholder="payer@example.com"
                      />
                    </label>
                  </fieldset>

                  {pageForm.amountMode === "fixed" ? (
                    <div className="amount-display preview-amount-display">
                      <span className="amount-label">{t("amount", { defaultValue: "Amount" })}</span>
                      <span className="amount-value">
                        ${Number(pageForm.fixedAmount || 0).toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <label>
                      Amount{pageForm.amountMode === "user_entered" ? " *" : ""}
                      <input
                        readOnly
                        value=""
                        placeholder={
                          pageForm.amountMode === "range"
                            ? `$${Number(pageForm.minAmount || 0).toFixed(2)} - $${Number(pageForm.maxAmount || 0).toFixed(2)}`
                            : "Enter amount"
                        }
                      />
                    </label>
                  )}

                  {customFieldsBuilder.length > 0 && (
                    <fieldset className="form-fieldset preview-fieldset">
                      <legend>{t("additionalDetails", { defaultValue: "Additional Details" })}</legend>
                      {customFieldsBuilder.map((field) => (
                        <label key={field.id}>
                          {field.label || "Custom field"}
                          {field.required ? " *" : ""}
                          {field.type === "dropdown" ? (
                            <select disabled>
                              <option>{t("selectAnOption", { defaultValue: "Select an option" })}</option>
                            </select>
                          ) : (
                            <input
                              readOnly
                              type={field.type === "date" ? "text" : "text"}
                              value=""
                              placeholder={
                                field.type === "date" ? "mm/dd/yyyy" : "Value"
                              }
                            />
                          )}
                        </label>
                      ))}
                    </fieldset>
                  )}

                  <fieldset className="form-fieldset preview-fieldset">
                    <legend>{t("paymentMethod", { defaultValue: "Payment method" })}</legend>
                    <div className="preview-method-tabs">
                      <button type="button" className="active">
                        {t("cardAndDigitalWallet", { defaultValue: "Card & Digital Wallet" })}
                      </button>
                      <button type="button">{t("bankTransferAch", { defaultValue: "Bank Transfer (ACH)" })}</button>
                    </div>
                  </fieldset>

                  <button type="button">{t("continueToPayment", { defaultValue: "Continue to Payment" })}</button>
                  {pageForm.footerMessage && (
                    <small>{pageForm.footerMessage}</small>
                  )}
                </div>
              </article>
            </section>
          </div>
        )}

        {view === "transactions" &&
          (loading ? (
            <LoadingSkeleton />
          ) : transactions.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              message="Once payers complete checkout, transactions will appear here in real time."
            />
          ) : (
            <section className="panel">
              <h3>{t("transactionsAndReporting", { defaultValue: "Transactions and reporting" })}</h3>
              <form
                className="form-grid"
                onSubmit={applyReportFilters}
                aria-label="Report filters"
              >
                <div className="field-group">
                  <label htmlFor="rf-from">{t("fromDate", { defaultValue: "From date" })}</label>
                  <input
                    id="rf-from"
                    type="date"
                    value={reportFilters.from}
                    onChange={(e) =>
                      setReportFilters((prev) => ({
                        ...prev,
                        from: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="rf-to">{t("toDate", { defaultValue: "To date" })}</label>
                  <input
                    id="rf-to"
                    type="date"
                    value={reportFilters.to}
                    onChange={(e) =>
                      setReportFilters((prev) => ({
                        ...prev,
                        to: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="rf-page">{t("paymentPage", { defaultValue: "Payment page" })}</label>
                  <select
                    id="rf-page"
                    value={reportFilters.pageId}
                    onChange={(e) =>
                      setReportFilters((prev) => ({
                        ...prev,
                        pageId: e.target.value,
                      }))
                    }
                  >
                    <option value="">{t("allPages", { defaultValue: "All pages" })}</option>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="rf-status">{t("status", { defaultValue: "Status" })}</label>
                  <select
                    id="rf-status"
                    value={reportFilters.status}
                    onChange={(e) =>
                      setReportFilters((prev) => ({
                        ...prev,
                        status: e.target.value,
                      }))
                    }
                  >
                    <option value="">{t("allStatuses", { defaultValue: "All statuses" })}</option>
                    <option value="success">{t("statusValue_success", { defaultValue: "Success" })}</option>
                    <option value="failed">{t("statusValue_failed", { defaultValue: "Failed" })}</option>
                    <option value="pending">{t("statusValue_pending", { defaultValue: "Pending" })}</option>
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="rf-method">{t("paymentMethod", { defaultValue: "Payment method" })}</label>
                  <select
                    id="rf-method"
                    value={reportFilters.paymentMethod}
                    onChange={(e) =>
                      setReportFilters((prev) => ({
                        ...prev,
                        paymentMethod: e.target.value,
                      }))
                    }
                  >
                    <option value="">{t("allMethods", { defaultValue: "All methods" })}</option>
                    <option value="card">{t("paymentMethod_card", { defaultValue: "Card" })}</option>
                    <option value="wallet">{t("paymentMethod_wallet", { defaultValue: "Wallet" })}</option>
                    <option value="ach">{t("paymentMethod_ach", { defaultValue: "ACH" })}</option>
                  </select>
                </div>
                <button type="submit">{t("applyFilters", { defaultValue: "Apply filters" })}</button>
                <button
                  type="button"
                  onClick={async () => {
                    const cleared = {
                      from: "",
                      to: "",
                      pageId: "",
                      status: "",
                      paymentMethod: "",
                    };
                    setReportFilters(cleared);
                    await fetchDashboard(token, cleared);
                  }}
                >
                  {t("clearFilters", { defaultValue: "Clear filters" })}
                </button>
                <button type="button" onClick={exportTransactionsCsv}>
                  {t("exportCsv", { defaultValue: "Export CSV" })}
                </button>
              </form>
              <div className="table-wrap">
                <table aria-label="Recent transactions">
                  <thead>
                    <tr>
                      <th scope="col">{t("amount", { defaultValue: "Amount" })}</th>
                      <th scope="col">{t("status", { defaultValue: "Status" })}</th>
                      <th scope="col">{t("method", { defaultValue: "Method" })}</th>
                      <th scope="col">{t("payer", { defaultValue: "Payer" })}</th>
                      <th scope="col">{t("created", { defaultValue: "Created" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((txn) => (
                      <tr key={txn.id}>
                        <td>${Number(txn.amount).toFixed(2)}</td>
                        <td>{txn.status}</td>
                        <td>{txn.paymentMethod}</td>
                        <td>{txn.payerEmail || "N/A"}</td>
                        <td>{new Date(txn.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
      </main>
    </div>
  );
}

function AnimatedAppRoutes() {
  const location = useLocation();

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <Routes location={location}>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<AdminApp />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/pay/:slug" element={<PublicPaymentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </motion.div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <AnimatedAppRoutes />
      </BrowserRouter>
    </LanguageProvider>
  );
}

export default App;
