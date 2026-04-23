import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useI18n } from "../i18n.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export function DistributionPanel({ pageId, pageSlug, pageTitle, authToken }) {
  const { t } = useI18n();
  const [shareInfo, setShareInfo] = useState({
    publicUrl: `${window.location.origin}/pay/${pageSlug}`,
    iframeSnippet: "",
  });
  const url = shareInfo.publicUrl;
  const iframeCode =
    shareInfo.iframeSnippet ||
    [
      "<iframe",
      `  src="${url}"`,
      `  title="${pageTitle} ${t("paymentPage")}"`,
      '  width="100%"',
      '  height="720"',
      '  style="border:0;max-width:100%;border-radius:12px;"',
      '  loading="lazy"',
      "></iframe>",
    ].join("\n");

  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const canvasRef = useRef(null);
  const liveRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: 200, margin: 2 }, (err) => {
        if (err) console.error("QR generation failed:", err);
      });
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    async function loadShareInfo() {
      if (!pageId || !authToken) return;
      try {
        const response = await fetch(`${API_BASE}/admin/pages/${pageId}/share`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        setShareInfo({
          publicUrl: payload.publicUrl || `${window.location.origin}/pay/${pageSlug}`,
          iframeSnippet: payload.iframeSnippet || "",
        });
      } catch {
        // Keep fallback local preview URL/snippet.
      }
    }
    loadShareInfo();
    return () => {
      cancelled = true;
    };
  }, [authToken, pageId, pageSlug]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    if (liveRef.current) liveRef.current.textContent = t("linkCopiedToClipboard");
    setTimeout(() => {
      setLinkCopied(false);
      if (liveRef.current) liveRef.current.textContent = "";
    }, 2000);
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(iframeCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const downloadPNG = () => {
    const dataUrl = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `qr-${pageSlug}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadSVG = () => {
    QRCode.toString(url, { type: "svg" }, (err, svgString) => {
      if (err) { console.error("SVG generation failed:", err); return; }
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `qr-${pageSlug}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    });
  };

  return (
    <div className="dist-panel">
      <span ref={liveRef} aria-live="polite" className="sr-only" />

      <div className="dist-card">
        <h4 className="dist-card-title">{t("directUrl")}</h4>
        <p className="dist-helper">{t("publicPaymentLink", { defaultValue: "Public payment link" })}</p>
        <input
          className="dist-url-input"
          readOnly
          value={url}
          aria-label={t("directUrl")}
          onClick={(e) => e.target.select()}
        />
        <button
          className="dist-btn"
          onClick={copyLink}
          aria-label={t("copyLink")}
        >
          {linkCopied ? t("copied") : t("copyLink")}
        </button>
      </div>

      <div className="dist-card">
        <h4 className="dist-card-title">{t("embedCode")}</h4>
        <p className="dist-helper">{t("copyPasteWebsite", { defaultValue: "Copy and paste into your website" })}</p>
        <textarea
          className="dist-embed-code"
          readOnly
          rows={4}
          value={iframeCode}
          aria-label={t("embedCode")}
          onClick={(e) => e.target.select()}
        />
        <button
          className="dist-btn"
          onClick={copyCode}
          aria-label={t("copyCode")}
        >
          {codeCopied ? t("copied") : t("copyCode")}
        </button>
        <p className="dist-helper">{t("pasteEmbedHint")}</p>
      </div>

      <div className="dist-card">
        <h4 className="dist-card-title">{t("qrCode")}</h4>
        <div
          role="img"
          aria-label={`QR code for ${pageTitle} payment page`}
          className="dist-qr-wrap"
        >
          <canvas ref={canvasRef} />
        </div>
        <div className="dist-qr-btns">
          <button className="dist-btn" onClick={downloadPNG}>{t("downloadPng")}</button>
          <button className="dist-btn" onClick={downloadSVG}>{t("downloadSvg")}</button>
        </div>
      </div>
    </div>
  );
}
