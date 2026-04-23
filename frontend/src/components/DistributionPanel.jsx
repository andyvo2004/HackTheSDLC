import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useI18n } from "../i18n.js";

export function DistributionPanel({ pageSlug, pageTitle }) {
  const { t } = useI18n();
  const url = `${window.location.origin}/pay/${pageSlug}`;
  const iframeCode = `<iframe src="${url}" width="100%" height="650" frameborder="0" title="${pageTitle} ${t("paymentPage")}" allow="payment"></iframe>`;

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
