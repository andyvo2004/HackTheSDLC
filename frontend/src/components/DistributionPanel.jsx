import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export function DistributionPanel({ pageSlug, pageTitle }) {
  const url = `${window.location.origin}/pay/${pageSlug}`;
  const iframeCode = `<iframe src="${url}" width="100%" height="650" frameborder="0" title="${pageTitle} Payment Page" allow="payment"></iframe>`;

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
    if (liveRef.current) liveRef.current.textContent = "Link copied to clipboard";
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
        <h4 className="dist-card-title">Direct URL</h4>
        <input
          className="dist-url-input"
          readOnly
          value={url}
          aria-label="Payment page direct URL"
          onClick={(e) => e.target.select()}
        />
        <button
          className="dist-btn"
          onClick={copyLink}
          aria-label="Copy payment page link"
        >
          {linkCopied ? "Copied! ✓" : "Copy Link"}
        </button>
      </div>

      <div className="dist-card">
        <h4 className="dist-card-title">Embed Code</h4>
        <textarea
          className="dist-embed-code"
          readOnly
          rows={4}
          value={iframeCode}
          aria-label="Payment page embed code"
          onClick={(e) => e.target.select()}
        />
        <button
          className="dist-btn"
          onClick={copyCode}
          aria-label="Copy embed code"
        >
          {codeCopied ? "Copied! ✓" : "Copy Code"}
        </button>
        <p className="dist-helper">Paste into any webpage to embed the payment form.</p>
      </div>

      <div className="dist-card">
        <h4 className="dist-card-title">QR Code</h4>
        <div
          role="img"
          aria-label={`QR code for ${pageTitle} payment page`}
          className="dist-qr-wrap"
        >
          <canvas ref={canvasRef} />
        </div>
        <div className="dist-qr-btns">
          <button className="dist-btn" onClick={downloadPNG}>Download PNG</button>
          <button className="dist-btn" onClick={downloadSVG}>Download SVG</button>
        </div>
      </div>
    </div>
  );
}
