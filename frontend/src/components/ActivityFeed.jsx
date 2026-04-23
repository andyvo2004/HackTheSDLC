import { useState, useEffect, useRef } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function ActivityFeed({ authToken }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("connecting");
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
            payer_name: r.payerName || "Payer",
            amount: Number(r.amount || 0),
            currency: "usd",
            page_title: r.page?.title || "Payment page",
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
        } catch {}
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
  }, [authToken]);

  const formatAmount = (amount, currency = "usd") =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);

  const timeAgo = (isoString) => {
    const seconds = Math.floor((Date.now() - new Date(isoString)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <section aria-label="Live payment activity feed" aria-live="polite" aria-atomic="false">
      <div className="feed-header">
        <h2 className="feed-title">Live Activity</h2>
        <span
          className={`feed-status feed-status--${status}`}
          aria-label={`Feed status: ${status}`}
        >
          {status === "live" && (
            <>
              <span className="feed-dot" aria-hidden="true">●</span> Live
            </>
          )}
          {status === "connecting" && "Connecting..."}
          {status === "reconnecting" && "Reconnecting..."}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="feed-empty">Waiting for payments...</p>
      ) : (
        <ul className="feed-list" role="list">
          {events.map((event, i) => (
            <li key={event.transaction_id + i} className="feed-item feed-item--enter">
              <span className="feed-icon" aria-hidden="true">💳</span>
              <div className="feed-content">
                <strong>{event.payer_name}</strong> paid{" "}
                <strong>{formatAmount(event.amount, event.currency)}</strong>
                <span className="feed-page"> on {event.page_title}</span>
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
