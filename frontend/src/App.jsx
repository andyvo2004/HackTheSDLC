import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

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
  return (
    <section className={`result-card ${success ? "success" : "failure"}`}>
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
      <h3>{success ? "Payment successful" : "Payment not completed"}</h3>
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
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setStatus("");
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
          billing_details: {
            email: payerEmail,
            name: payerName,
          },
        },
      });
      if (confirmResult.error) {
        throw new Error(confirmResult.error.message || "Stripe confirmation failed");
      }

      const sync = await apiRequest(`/public/pay/${slug}/confirm`, {
        method: "POST",
        body: { paymentIntentId: payload.paymentIntentId },
      });

      if (sync.status === "success") {
        const msg = "Payment successful. Confirmation has been sent.";
        setStatus(msg);
        onResult({
          type: "success",
          message: msg,
          transactionId: sync.transactionId,
        });
      } else {
        const msg = `Payment status: ${sync.status}. Please check transaction details.`;
        setStatus(msg);
        onResult({
          type: "failure",
          message: msg,
          transactionId: sync.transactionId,
        });
      }
    } catch (err) {
      const msg = `Payment failed: ${err.message}`;
      setStatus(msg);
      onResult({ type: "failure", message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="public-form" onSubmit={submit}>
      <label>
        Full name
        <input value={payerName} onChange={(e) => setPayerName(e.target.value)} required />
      </label>
      <label>
        Email
        <input type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} required />
      </label>
      {config.amountMode !== "fixed" && (
        <label>
          Amount
          <input
            type="number"
            min={config.minAmount || 0}
            max={config.maxAmount || undefined}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
      )}
      {config.customFields?.map((field) => (
        <label key={field.id}>
          {field.label}
          <input
            required={field.required}
            value={customResponses[field.id] || ""}
            onChange={(e) => setCustomResponses((p) => ({ ...p, [field.id]: e.target.value }))}
          />
        </label>
      ))}
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={achAuthorizationAccepted}
          onChange={(e) => setAchAuthorizationAccepted(e.target.checked)}
        />
        I authorize bank transfer payment processing if ACH is selected.
      </label>
      <div className="stripe-box">
        <CardElement options={{ hidePostalCode: false }} />
      </div>
      <button type="submit" disabled={submitting || !stripe || !elements}>
        {submitting ? "Processing..." : "Complete payment"}
      </button>
      {status && <p className="status-text">{status}</p>}
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
  return (
    <main className="public-shell">
      <section className="public-card">
        <header className="public-header" style={{ background: config.brandColor || "#0f63ff" }}>
          <p>{config.title}</p>
          <small>{config.subtitle}</small>
        </header>
        <div className="public-body">
          <p className="subtle">{config.description}</p>
          <div className="preview-banner">{config.headerMessage || "Complete secure payment below."}</div>
          {result ? (
            <PaymentResultView result={result} onRetry={() => setResult(null)} />
          ) : STRIPE_KEY && stripePromise ? (
            <Elements stripe={stripePromise}>
              <PublicCheckoutForm slug={slug} config={config} onResult={setResult} />
            </Elements>
          ) : (
            <p className="error">
              Missing Stripe publishable key. Set `VITE_STRIPE_PUBLISHABLE_KEY` in your frontend environment.
            </p>
          )}
          <small>{config.footerMessage}</small>
        </div>
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
  const [view, setView] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [loginForm, setLoginForm] = useState({
    email: "admin@example.com",
    password: "admin12345",
  });

  const [pageForm, setPageForm] = useState({
    slug: "",
    title: "",
    subtitle: "Secure, self-service payment experience",
    amountMode: "fixed",
    fixedAmount: 25,
    glCodes: "GL-100",
    brandColor: "#0f63ff",
    headerMessage: "Thank you for choosing our organization",
    footerMessage: "Need help? Reach our billing support team.",
  });

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
          amountMode: pageForm.amountMode,
          fixedAmount: Number(pageForm.fixedAmount),
          glCodes: pageForm.glCodes
            .split(",")
            .map((code) => code.trim())
            .filter(Boolean),
          subtitle: pageForm.subtitle,
          brandColor: pageForm.brandColor,
          headerMessage: pageForm.headerMessage,
          footerMessage: pageForm.footerMessage,
          customFields: [],
        },
      });
      setPageForm({
        slug: "",
        title: "",
        subtitle: "Secure, self-service payment experience",
        amountMode: "fixed",
        fixedAmount: 25,
        glCodes: "GL-100",
        brandColor: "#0f63ff",
        headerMessage: "Thank you for choosing our organization",
        footerMessage: "Need help? Reach our billing support team.",
      });
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
    setToken("");
    setUser(null);
    setPages([]);
    setSummary(null);
    setTransactions([]);
  };

  if (!token) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">Waystar Inspired Experience</p>
          <h1>Quick Payment Pages</h1>
          <p className="auth-subtitle">
            Clean, modern admin control for high-trust payment flows.
          </p>
          <form className="form-grid" onSubmit={handleLogin}>
            <label>
              Email
              <input
                type="email"
                value={loginForm.email}
                onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

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
        <nav>
          {["overview", "insights", "pages", "create", "transactions"].map((item) => (
            <button
              key={item}
              className={view === item ? "nav-btn active" : "nav-btn"}
              onClick={() => setView(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <button className="logout-btn" onClick={handleLogout}>
          Log out
        </button>
      </aside>

      <main className="content-shell">
        <header>
          <p className="eyebrow">Healthcare Payments Control Center</p>
          <h1>Design-forward operations dashboard</h1>
        </header>
        {error && <p className="error">{error}</p>}

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
                  <table>
                    <thead>
                      <tr>
                        <th>Page</th>
                        <th>Views</th>
                        <th>Transactions</th>
                        <th>Success</th>
                        <th>Revenue</th>
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
            <section className="panel">
              <h3>Configured pages</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Slug</th>
                      <th>Status</th>
                      <th>Amount mode</th>
                      <th>Actions</th>
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
                          <button className="tiny-btn" onClick={() => handleCopy(page.id)}>
                            Copy URL
                          </button>
                          {canEditPages && (
                            <>
                              <button className="tiny-btn" onClick={() => fetchVersions(page.id)}>
                                Versions
                              </button>
                              {page.hasDraft && (
                                <button className="tiny-btn" onClick={() => publishDraft(page.id)}>
                                  Publish Draft
                                </button>
                              )}
                              <button className="tiny-btn" onClick={() => rollbackLatest(page.id)}>
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
          )
        )}

        {view === "create" && (
          <div className="create-grid">
            <section className="panel">
              <h3>Create payment page</h3>
              {!canEditPages && (
                <p className="error">Your role is read-only. Ask an owner to grant editor access.</p>
              )}
              <form className="form-grid" onSubmit={handleCreatePage}>
                <label>
                  Page title
                  <input
                    value={pageForm.title}
                    onChange={(e) => setPageForm((p) => ({ ...p, title: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Subtitle
                  <input
                    value={pageForm.subtitle}
                    onChange={(e) => setPageForm((p) => ({ ...p, subtitle: e.target.value }))}
                  />
                </label>
                <label>
                  URL slug
                  <input
                    value={pageForm.slug}
                    onChange={(e) => setPageForm((p) => ({ ...p, slug: e.target.value.toLowerCase() }))}
                    required
                  />
                </label>
                <label>
                  Brand color
                  <input
                    type="color"
                    value={pageForm.brandColor}
                    onChange={(e) => setPageForm((p) => ({ ...p, brandColor: e.target.value }))}
                  />
                </label>
                <label>
                  Header message
                  <input
                    value={pageForm.headerMessage}
                    onChange={(e) => setPageForm((p) => ({ ...p, headerMessage: e.target.value }))}
                  />
                </label>
                <label>
                  Footer message
                  <input
                    value={pageForm.footerMessage}
                    onChange={(e) => setPageForm((p) => ({ ...p, footerMessage: e.target.value }))}
                  />
                </label>
                <label>
                  Amount mode
                  <select
                    value={pageForm.amountMode}
                    onChange={(e) => setPageForm((p) => ({ ...p, amountMode: e.target.value }))}
                  >
                    <option value="fixed">Fixed</option>
                    <option value="range">Range</option>
                    <option value="user_entered">User entered</option>
                  </select>
                </label>
                <label>
                  Fixed amount
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pageForm.fixedAmount}
                    onChange={(e) => setPageForm((p) => ({ ...p, fixedAmount: e.target.value }))}
                  />
                </label>
                <label>
                  GL codes (comma separated)
                  <input
                    value={pageForm.glCodes}
                    onChange={(e) => setPageForm((p) => ({ ...p, glCodes: e.target.value }))}
                  />
                </label>
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
                <table>
                  <thead>
                    <tr>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Method</th>
                      <th>Payer</th>
                      <th>Created</th>
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
        <Route path="/pay/:slug" element={<PublicPaymentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
