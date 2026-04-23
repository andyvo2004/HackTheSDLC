import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { DistributionPanel } from "./components/DistributionPanel.jsx";
import { getContrastColor } from "./utils/color.js";
import ActivityFeed from "./components/ActivityFeed.jsx";
import { supabase } from "./lib/supabaseClient.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = STRIPE_KEY ? loadStripe(STRIPE_KEY) : null;

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
  const max = Math.max(...items.map((m) => Number(m.totalAmount || 0)), 1);
  return (
    <div className="method-bars">
      {items.map((item) => {
        const width = Math.max(10, (Number(item.totalAmount || 0) / max) * 100);
        return (
          <div key={item.method} className="method-row">
            <div className="method-meta">
              <span>{item.method}</span>
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
  return (
    <section className="panel skeleton-grid" aria-label="Loading content">
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
      <h2 ref={headingRef} tabIndex={-1}>{success ? "Payment successful" : "Payment not completed"}</h2>
      <p>{result.message}</p>
      {result.transactionId && <small>Transaction ID: {result.transactionId}</small>}
      {!success && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

function PublicCheckoutForm({ slug, config, onResult }) {
  const stripe = useStripe();
  const elements = useElements();
  const [amount, setAmount] = useState(config.fixedAmount || 0);
  const [payerEmail, setPayerEmail] = useState("");
  const [payerName, setPayerName] = useState("");
  const [customResponses, setCustomResponses] = useState({});
  const [achAuthorizationAccepted, setAchAuthorizationAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [stripeError, setStripeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const stripeErrorRef = useRef(null);

  const validate = () => {
    const errors = {};
    if (!payerName.trim()) errors.payerName = "Full name is required.";
    if (!payerEmail.trim()) errors.payerEmail = "Email is required.";
    if (config.amountMode === "range") {
      const amt = Number(amount);
      if (!amount || amt < Number(config.minAmount || 0)) {
        errors.amount = `Amount must be at least $${Number(config.minAmount || 0).toFixed(2)}.`;
      } else if (config.maxAmount && amt > Number(config.maxAmount)) {
        errors.amount = `Amount must be at most $${Number(config.maxAmount || 0).toFixed(2)}.`;
      }
    }
    if (config.amountMode === "user_entered" && (!amount || Number(amount) <= 0)) {
      errors.amount = "Please enter a valid amount.";
    }
    config.customFields?.forEach((field) => {
      if (field.required && !customResponses[field.id]) {
        errors[field.id] = `${field.label} is required.`;
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
    if (!stripe || !elements) return;
    setSubmitting(true);
    setStripeError("");
    try {
      const payload = await apiRequest(`/public/pay/${slug}/create-payment-intent`, {
        method: "POST",
        body: {
          amount: Number(amount),
          payerEmail,
          payerName,
          paymentMethod: "card",
          fieldResponses: customResponses,
          achAuthorizationAccepted,
        },
      });

      const cardElement = elements.getElement(CardElement);
      const confirmResult = await stripe.confirmCardPayment(payload.clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: { email: payerEmail, name: payerName },
        },
      });
      if (confirmResult.error) {
        const msg = confirmResult.error.message || "Stripe confirmation failed";
        setStripeError(msg);
        setTimeout(() => stripeErrorRef.current?.focus(), 50);
        throw new Error(msg);
      }

      const sync = await apiRequest(`/public/pay/${slug}/confirm`, {
        method: "POST",
        body: { paymentIntentId: payload.paymentIntentId },
      });

      if (sync.status === "success") {
        const msg = "Payment successful. Confirmation has been sent.";
        onResult({ type: "success", message: msg, transactionId: sync.transactionId, payerEmail, amount });
      } else {
        const msg = `Payment status: ${sync.status}. Please check transaction details.`;
        onResult({ type: "failure", message: msg, transactionId: sync.transactionId });
      }
    } catch (err) {
      if (!stripeError) {
        const msg = `Payment failed: ${err.message}`;
        setStripeError(msg);
        setTimeout(() => stripeErrorRef.current?.focus(), 50);
        onResult({ type: "failure", message: msg });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="public-form" onSubmit={submit} noValidate aria-label="Payment form">
      <p className="required-note">* Required fields</p>
      <fieldset className="form-fieldset">
        <legend>Your Information</legend>
        <div className="field-group">
          <label htmlFor="field-payerName">Full name *</label>
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
          <label htmlFor="field-payerEmail">Email *</label>
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
          <span className="amount-label">Amount</span>
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
          <label htmlFor="field-amount">Amount *</label>
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
          <legend>Additional Details</legend>
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
                      <option value="">Select an option</option>
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
        <legend>Payment Details</legend>
        <div className="checkbox-group">
          <input
            id="ach-auth"
            type="checkbox"
            checked={achAuthorizationAccepted}
            onChange={(e) => setAchAuthorizationAccepted(e.target.checked)}
          />
          <label htmlFor="ach-auth">I authorize bank transfer payment processing if ACH is selected.</label>
        </div>
        <p id="card-element-label" className="card-label">Card Details *</p>
        <div className="stripe-box" aria-labelledby="card-element-label">
          <CardElement options={{ hidePostalCode: false }} />
        </div>
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

      <button type="submit" className="pay-btn" disabled={submitting || !stripe || !elements}>
        {submitting ? "Processing..." : "Complete payment"}
      </button>
    </form>
  );
}

function PublicPaymentPage() {
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
        <EmptyState title="Payment page unavailable" message={error || "Please verify this URL and try again."} />
      </main>
    );
  }

  const headerTextColor = getContrastColor(config.brandColor);

  return (
    <main className="public-shell">
      <section className="public-card">
        <header className="public-header" style={{ background: config.brandColor || "#0f63ff", color: headerTextColor }}>
          {config.logoUrl && (
            <img
              src={config.logoUrl}
              alt={`${config.title} logo`}
              className="public-logo"
              onError={(e) => { e.target.style.display = "none"; }}
            />
          )}
          <h1>{config.title}</h1>
          {config.subtitle && <p className="public-subtitle">{config.subtitle}</p>}
        </header>
        <div className="public-body">
          {config.description && <p className="subtle">{config.description}</p>}
          <div className="preview-banner">{config.headerMessage || "Complete secure payment below."}</div>
          {result ? (
            <PaymentResultView result={result} onRetry={() => setResult(null)} />
          ) : STRIPE_KEY && stripePromise ? (
            <>
              <div className="wallet-bar" role="group" aria-label="Express checkout options">
                <button type="button" className="wallet-btn" disabled title="Apple Pay not available in this environment">Apple Pay</button>
                <button type="button" className="wallet-btn" disabled title="Google Pay not available in this environment">G Pay</button>
              </div>
              <div className="wallet-divider" aria-hidden="true"><span>or pay with card</span></div>
              <Elements stripe={stripePromise}>
                <PublicCheckoutForm slug={slug} config={config} onResult={setResult} />
              </Elements>
            </>
          ) : (
            <p className="error">
              Missing Stripe publishable key. Set `VITE_STRIPE_PUBLISHABLE_KEY` in your frontend environment.
            </p>
          )}
          {config.footerMessage && <footer className="public-footer">{config.footerMessage}</footer>}
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
    return <Navigate to="/" replace />;
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
    navigate("/", { replace: true });
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
      navigate("/", { replace: true });
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
        <form className="form-grid" onSubmit={isSignup ? handleSignup : handleLogin} aria-label={isSignup ? "Admin sign up" : "Admin sign in"}>
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
            <span className="google-icon" aria-hidden="true">G</span>
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
        {error && <div role="alert" aria-live="assertive" className="error">{error}</div>}
      </section>
    </main>
  );
}

function AdminApp() {
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

  const [pageForm, setPageForm] = useState({
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
  });

  const [customFieldsBuilder, setCustomFieldsBuilder] = useState([]);
  const addBuilderField = () => {
    if (customFieldsBuilder.length >= 10) { setError("Maximum 10 custom fields allowed."); return; }
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
      setTransactions(txns.slice(0, 8));
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
    } catch (err) {
      setError(`Copy failed: ${err.message}`);
    }
  };

  const handleToggleStatus = async (pageId, currentActive) => {
    try {
      await apiRequest(`/admin/pages/${pageId}/status`, { method: "PATCH", token, body: { isActive: !currentActive } });
      await fetchDashboard(token);
    } catch (err) {
      setError(err.message);
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
    } catch (err) {
      setError(err.message);
    }
  };

  const rollbackLatest = async (pageId) => {
    try {
      const versions = pageVersions[pageId] || (await apiRequest(`/admin/pages/${pageId}/versions`, { token }));
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
      await fetchDashboard(token);
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

  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>Waystar QPP</h2>
        <p className="role-pill">{user?.role || "viewer"}</p>
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <nav aria-label="Admin navigation">
          {["overview", "insights", "pages", "create", "transactions"].map((item) => (
            <button
              key={item}
              className={view === item ? "nav-btn active" : "nav-btn"}
              onClick={() => setView(item)}
              aria-current={view === item ? "page" : undefined}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <button className="logout-btn" onClick={handleLogout} aria-label="Sign out">
          Log out
        </button>
      </aside>

      <main className="content-shell">
        <header>
          <p className="eyebrow">Healthcare Payments Control Center</p>
          <h1>Design-forward operations dashboard</h1>
        </header>
        {error && <div role="alert" aria-live="assertive" className="error">{error}</div>}

        {view === "overview" && (
          <>
            <section className="stats-grid">
              <StatCard
                label="Total Payments"
                value={summary ? summary.totalPayments.toLocaleString() : "--"}
              />
              <StatCard
                label="Amount Collected"
                value={
                  summary
                    ? `$${Number(summary.totalAmountCollected || 0).toLocaleString()}`
                    : "--"
                }
              />
              <StatCard
                label="Average Payment"
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
                    <h3>Collection velocity</h3>
                    <p className="subtle">A visual trend of payment movement in your current cycle.</p>
                  </div>
                  <MiniAreaChart
                    values={[
                      Number(summary?.averagePaymentAmount || 10),
                      Number(summary?.averagePaymentAmount || 10) * 1.2,
                      Number(summary?.averagePaymentAmount || 10) * 0.85,
                      Number(summary?.averagePaymentAmount || 10) * 1.45,
                      Number(summary?.averagePaymentAmount || 10) * 1.18,
                      Number(summary?.averagePaymentAmount || 10) * 1.7,
                    ]}
                  />
                </section>
                <section className="panel">
                  <h3>Payment method mix</h3>
                  {summary?.byPaymentMethod?.length ? (
                    <MethodBars items={summary.byPaymentMethod} />
                  ) : (
                    <p className="subtle">No successful transactions yet. Run a test payment to populate this view.</p>
                  )}
                </section>
                <section className="panel">
                  <h3>Payment pages</h3>
                  <p>{pages.length} configured pages across your payment portfolio.</p>
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
            <EmptyState title="No insights yet" message="Perform some payment activity to populate analytics." />
          ) : (
            <>
              <section className="stats-grid">
                <StatCard label="Page Views" value={insights.overview.totalViews.toLocaleString()} />
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
                <h3>Conversion funnel</h3>
                <div className="method-bars">
                  <div className="method-row">
                    <div className="method-meta">
                      <span>View to Checkout</span>
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
                      <span>Checkout to Success</span>
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
                <h3>Top page performance</h3>
                <div className="table-wrap">
                  <table aria-label="Top page performance">
                    <thead>
                      <tr>
                        <th scope="col">Page</th>
                        <th scope="col">Views</th>
                        <th scope="col">Transactions</th>
                        <th scope="col">Success</th>
                        <th scope="col">Revenue</th>
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
              title="No payment pages yet"
              message="Create your first page in the editor and start collecting payments in minutes."
            />
          ) : (
            <>
            <section className="panel">
              <h3>Configured pages</h3>
              <div className="table-wrap">
                <table aria-label="Payment pages">
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Slug</th>
                      <th scope="col">Status</th>
                      <th scope="col">Amount mode</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((page) => (
                      <tr key={page.id}>
                        <td>{page.title}</td>
                        <td>/{page.slug}</td>
                        <td>{page.isActive ? "Active" : "Disabled"}</td>
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
                            onClick={() => setSelectedPage(selectedPage?.id === page.id ? null : page)}
                            aria-label={selectedPage?.id === page.id ? `Close distribution panel for ${page.title}` : `Distribute ${page.title}`}
                            aria-expanded={selectedPage?.id === page.id}
                          >
                            {selectedPage?.id === page.id ? "Close" : "Distribute"}
                          </button>
                          {canEditPages && (
                            <>
                              <button
                                className="tiny-btn"
                                onClick={() => handleToggleStatus(page.id, page.isActive)}
                                aria-label={page.isActive ? `Disable ${page.title}` : `Enable ${page.title}`}
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
                  <h4>Versions for page {pages.find((p) => p.id === pageId)?.title || pageId}</h4>
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
                <h3>Distribute — {selectedPage.title}</h3>
                <DistributionPanel pageSlug={selectedPage.slug} pageTitle={selectedPage.title} />
              </section>
            )}
            </>
          )
        )}

        {view === "create" && (
          <div className="create-grid">
            <section className="panel">
              <h3>Create payment page</h3>
              {!canEditPages && (
                <p className="error">Your role is read-only. Ask an owner to grant editor access.</p>
              )}
              <form className="form-grid" onSubmit={handleCreatePage} aria-label="Create payment page">
                <div className="field-group">
                  <label htmlFor="cf-title">Page title *</label>
                  <input
                    id="cf-title"
                    value={pageForm.title}
                    onChange={(e) => setPageForm((p) => ({ ...p, title: e.target.value }))}
                    required
                    aria-required="true"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-subtitle">Subtitle</label>
                  <input
                    id="cf-subtitle"
                    value={pageForm.subtitle}
                    onChange={(e) => setPageForm((p) => ({ ...p, subtitle: e.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-description">Description</label>
                  <input
                    id="cf-description"
                    value={pageForm.description}
                    onChange={(e) => setPageForm((p) => ({ ...p, description: e.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-logoUrl">Logo URL</label>
                  <input
                    id="cf-logoUrl"
                    type="url"
                    value={pageForm.logoUrl}
                    onChange={(e) => setPageForm((p) => ({ ...p, logoUrl: e.target.value }))}
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-slug">URL slug *</label>
                  <input
                    id="cf-slug"
                    value={pageForm.slug}
                    onChange={(e) => setPageForm((p) => ({ ...p, slug: e.target.value.toLowerCase() }))}
                    required
                    aria-required="true"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-brandColor">Brand color (hex)</label>
                  <input
                    id="cf-brandColor"
                    type="color"
                    value={pageForm.brandColor}
                    onChange={(e) => setPageForm((p) => ({ ...p, brandColor: e.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-headerMessage">Header message</label>
                  <input
                    id="cf-headerMessage"
                    value={pageForm.headerMessage}
                    onChange={(e) => setPageForm((p) => ({ ...p, headerMessage: e.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="cf-footerMessage">Footer message</label>
                  <input
                    id="cf-footerMessage"
                    value={pageForm.footerMessage}
                    onChange={(e) => setPageForm((p) => ({ ...p, footerMessage: e.target.value }))}
                  />
                </div>
                <fieldset className="form-fieldset">
                  <legend>Payment Amount Mode</legend>
                  <div className="field-group">
                    <label htmlFor="cf-amountMode">Amount mode</label>
                    <select
                      id="cf-amountMode"
                      value={pageForm.amountMode}
                      onChange={(e) => setPageForm((p) => ({ ...p, amountMode: e.target.value }))}
                    >
                      <option value="fixed">Fixed</option>
                      <option value="range">Range</option>
                      <option value="user_entered">User entered</option>
                    </select>
                  </div>
                  {pageForm.amountMode === "fixed" && (
                    <div className="field-group">
                      <label htmlFor="cf-fixedAmount">Fixed amount</label>
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
                        <label htmlFor="cf-minAmount">Minimum amount</label>
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
                        <label htmlFor="cf-maxAmount">Maximum amount</label>
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
                  <label htmlFor="cf-glCodes">GL codes (comma separated)</label>
                  <input
                    id="cf-glCodes"
                    value={pageForm.glCodes}
                    onChange={(e) => setPageForm((p) => ({ ...p, glCodes: e.target.value }))}
                  />
                </div>
                <div className="field-builder-header">
                  <span>Custom fields ({customFieldsBuilder.length}/10)</span>
                  <button type="button" className="tiny-btn" onClick={addBuilderField} aria-label="Add custom field">+ Add field</button>
                </div>
                {customFieldsBuilder.map((field, idx) => (
                  <div key={field.id} className="field-builder-row">
                    <input
                      aria-label={`Custom field ${idx + 1} label`}
                      placeholder="Field label"
                      value={field.label}
                      onChange={(e) => updateBuilderField(idx, "label", e.target.value)}
                    />
                    <select
                      aria-label={`Custom field ${idx + 1} type`}
                      value={field.type}
                      onChange={(e) => updateBuilderField(idx, "type", e.target.value)}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="dropdown">Dropdown</option>
                      <option value="date">Date</option>
                      <option value="checkbox">Checkbox</option>
                    </select>
                    {field.type === "dropdown" && (
                      <input
                        aria-label={`Custom field ${idx + 1} dropdown options`}
                        placeholder="Options (comma separated)"
                        value={field.options}
                        onChange={(e) => updateBuilderField(idx, "options", e.target.value)}
                      />
                    )}
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateBuilderField(idx, "required", e.target.checked)}
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
                    >↑</button>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => moveBuilderField(idx, "down")}
                      disabled={idx === customFieldsBuilder.length - 1}
                      aria-label={`Move ${field.label || `field ${idx + 1}`} down`}
                    >↓</button>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => removeBuilderField(idx)}
                      aria-label={`Remove ${field.label || `field ${idx + 1}`}`}
                    >Remove</button>
                  </div>
                ))}
                <button type="submit" disabled={loading || !canEditPages}>
                  {loading ? "Saving..." : "Create page"}
                </button>
                <button
                  type="button"
                  disabled={loading || !canEditPages}
                  onClick={async () => {
                    try {
                      const targetPage = pages[0];
                      if (!targetPage) {
                        setError("Create a page first, then use Save as Draft.");
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
                  Save as Draft (first page)
                </button>
              </form>
            </section>
            <section className="panel preview-panel">
              <h3>Live payment page preview</h3>
              <article className="payment-preview">
                <header style={{ background: pageForm.brandColor }}>
                  <p>Quick Payment Page</p>
                </header>
                <div className="preview-body">
                  <h4>{pageForm.title || "Your page title"}</h4>
                  <p>{pageForm.subtitle || "Your subtitle appears here."}</p>
                  <div className="preview-banner">{pageForm.headerMessage}</div>
                  <label>
                    Payment amount
                    <input readOnly value={`$${Number(pageForm.fixedAmount || 0).toFixed(2)}`} />
                  </label>
                  <label>
                    Email
                    <input readOnly value="payer@example.com" />
                  </label>
                  <button type="button">Pay now</button>
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
              title="No transactions yet"
              message="Once payers complete checkout, transactions will appear here in real time."
            />
          ) : (
            <section className="panel">
              <h3>Recent transactions</h3>
              <div className="table-wrap">
                <table aria-label="Recent transactions">
                  <thead>
                    <tr>
                      <th scope="col">Amount</th>
                      <th scope="col">Status</th>
                      <th scope="col">Method</th>
                      <th scope="col">Payer</th>
                      <th scope="col">Created</th>
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
          )
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminApp />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/pay/:slug" element={<PublicPaymentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
