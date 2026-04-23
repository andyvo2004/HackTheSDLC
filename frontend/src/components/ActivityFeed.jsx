import { useState, useEffect, useRef } from "react";
import { useI18n } from "../i18n.js";
import { localizeSeededText } from "../utils/localizeSeededText.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function ActivityFeed({ authToken }) {
  const { lang, t } = useI18n();
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("connecting");
  const [now, setNow] = useState(() => Date.now());
  const esRef = useRef(null);

  useEffect(() => {
    let reconnectTimer = null;

    async function loadRecentActivity() {
      try {
        const res = await fetch(`${API_BASE}/admin/reports/transactions`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) return;
        const rows = await res.json();
        const mapped = rows
          .filter((r) => r.status === "success")
          .slice(0, 10)
          .map((r) => ({
            transaction_id: r.id,
            payer_name: r.payerName || t("payer"),
            amount: Number(r.amount || 0),
            currency: "usd",
            page_title: r.page?.title || t("paymentPage"),
            created_at: r.createdAt,
          }));
        setEvents(mapped);
      } catch {
        // Non-blocking fallback; SSE may still populate feed.
      }
    }

    function connect() {
      setStatus("connecting");
      const es = new EventSource(`${API_BASE}/api/feed?token=${authToken}`);
      esRef.current = es;

      es.onopen = () => setStatus("live");

      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          setEvents((prev) => [payload, ...prev].slice(0, 10));
        } catch {
          // Ignore malformed feed messages from interrupted streams.
        }
      };

      es.onerror = () => {
        setStatus("reconnecting");
        es.close();
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    loadRecentActivity();
    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (esRef.current) esRef.current.close();
    };
  }, [authToken, t]);

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(ticker);
  }, []);

  const formatAmount = (amount, currency = "usd") =>
    new Intl.NumberFormat(lang === "en" ? "en-US" : lang, { style: "currency", currency }).format(amount);

  const timeAgo = (isoString) => {
    const seconds = Math.floor((now - new Date(isoString)) / 1000);
    if (seconds < 60) return t("secondsAgo", { count: seconds });
    if (seconds < 3600) return t("minutesAgo", { count: Math.floor(seconds / 60) });
    return t("hoursAgo", { count: Math.floor(seconds / 3600) });
  };

  return (
    <section aria-label={t("liveActivity")} aria-live="polite" aria-atomic="false">
      <div className="feed-header">
        <h2 className="feed-title">{t("liveActivity")}</h2>
        <span
          className={`feed-status feed-status--${status}`}
          aria-label={
            status === "live"
              ? t("statusLive")
              : status === "reconnecting"
                ? t("statusReconnecting")
                : t("statusConnecting")
          }
        >
          {status === "live" && (
            <>
              <span className="feed-dot" aria-hidden="true">●</span> {t("live")}
            </>
          )}
          {status === "connecting" && t("connecting")}
          {status === "reconnecting" && t("reconnecting")}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="feed-empty">{t("waitingForPayments")}</p>
      ) : (
        <ul className="feed-list" role="list">
          {events.map((event, i) => (
            <li key={event.transaction_id + i} className="feed-item feed-item--enter">
              <span className="feed-icon" aria-hidden="true">
                <span className="feed-icon-chip" />
              </span>
              <div className="feed-content">
                <strong>{event.payer_name}</strong> {t("paid")}{" "}
                <strong>{formatAmount(event.amount, event.currency)}</strong>
                <span className="feed-page"> {t("paidOn", { page: localizeSeededText(event.page_title, t) })}</span>
              </div>
              <time className="feed-time" dateTime={event.created_at}>
                {timeAgo(event.created_at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
