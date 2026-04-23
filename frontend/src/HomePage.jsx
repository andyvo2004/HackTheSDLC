import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3, Moon, Share2, SlidersHorizontal, Sun } from "lucide-react";
import qppDarkLogo from "./assets/qpp-dark.png";
import qppLightLogo from "./assets/qpp-light.png";
import qppPlainLogo from "./assets/qpp-plain.png";
import "./HomePage.css";

function SmartNavLink({ to, className, children }) {
  const inRouterContext = useInRouterContext();

  if (inRouterContext) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a href={to} className={className}>
      {children}
    </a>
  );
}

export default function HomePage() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [isLightMode, setIsLightMode] = useState(false);
  const heroMockupRef = useRef(null);
  const howItWorksBgRef = useRef(null);

  const featureCards = useMemo(
    () => [
      {
        icon: SlidersHorizontal,
        title: "Fully Configurable",
        description:
          "Match your brand, collect custom fields, and choose fixed, open, or tiered payment amounts.",
      },
      {
        icon: Share2,
        title: "Shareable Everywhere",
        description:
          "Publish in seconds with a hosted URL, downloadable QR code, or iframe embed for your site.",
      },
      {
        icon: BarChart3,
        title: "Built-in Reporting",
        description:
          "Track every transaction with live history, filterable activity, and one-click CSV exports.",
      },
    ],
    [],
  );
  const logoPlaceholders = useMemo(
    () => [
      "Acme Co",
      "Northstar",
      "Vertex Labs",
      "Summit",
      "Aperture",
      "Lumen",
      "Pioneer",
      "Atlas",
    ],
    [],
  );

  useEffect(() => {
    const onScroll = () => {
      const nextScrollY = window.scrollY;
      setScrollY(nextScrollY);
      setIsScrolled(nextScrollY > 50);

      if (heroMockupRef.current) {
        const heroShift = Math.max(-80, nextScrollY * -0.12);
        heroMockupRef.current.style.transform = `translate3d(0, ${heroShift}px, 0)`;
      }

      if (howItWorksBgRef.current) {
        const howShift = Math.min(120, nextScrollY * 0.08);
        howItWorksBgRef.current.style.transform = `translate3d(0, ${howShift}px, 0) scale(1.08)`;
      }
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSmoothScroll = (event, targetId) => {
    event.preventDefault();
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className={`homepage ${isLightMode ? "light-mode" : ""}`}>
      <header className={`navbar ${isScrolled ? "navbar-scrolled" : ""}`}>
        <a href="#top" className="wordmark">
          <img
            src={isLightMode ? qppLightLogo : qppDarkLogo}
            alt="QPP"
            className="brand-logo"
          />
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a
            href="#features"
            className="nav-link"
            onClick={(event) => handleSmoothScroll(event, "features")}
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="nav-link"
            onClick={(event) => handleSmoothScroll(event, "how-it-works")}
          >
            How It Works
          </a>
        </nav>
        <nav className="nav-actions">
          <SmartNavLink to="/login" className="btn btn-outline">
            Login
          </SmartNavLink>
          <SmartNavLink to="/signup" className="btn btn-filled">
            Get Started
          </SmartNavLink>
        </nav>
      </header>

      <main id="top">
        <motion.section
          className="hero"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        >
          <div className="hero-content">
            <p className="eyebrow">Quick Payment Pages for modern businesses</p>
            <h1>Payments, Configured Your Way</h1>
            <p className="hero-subheadline">
              QPP helps modern businesses launch branded, self-service payment
              pages in minutes so customers can pay faster and teams can
              reconcile without friction.
            </p>
            <div className="hero-ctas">
              <SmartNavLink
                to="/signup"
                className="btn btn-filled btn-large"
              >
                Get Started
              </SmartNavLink>
              <a
                href="#how-it-works"
                className="btn btn-outline btn-large"
                onClick={(event) => handleSmoothScroll(event, "how-it-works")}
              >
                See How It Works
              </a>
            </div>
            <div
              className="hero-logo-marquee"
              aria-label="Trusted by modern teams"
            >
              <p>Trusted by teams like</p>
              <div className="logo-track-mask">
                <div className="logo-track logo-track-animate">
                  {[...logoPlaceholders, ...logoPlaceholders].map(
                    (name, index) => (
                      <div key={`${name}-${index}`} className="logo-pill">
                        {name}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
          <motion.div
            ref={heroMockupRef}
            className="hero-mockup"
            aria-hidden="true"
            whileHover={{ y: -6, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
          >
            <div className="placeholder-tag">[ Insert app screenshot ]</div>
          </motion.div>
        </motion.section>

        <motion.section
          id="features"
          className="features"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <h2>Everything your payment flow needs</h2>
          <div className="feature-grid">
            {featureCards.map((card, index) => (
              <motion.article
                key={card.title}
                className="feature-card"
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.35 }}
                transition={{ duration: 0.45, delay: index * 0.1 }}
                whileHover={{ y: -8 }}
              >
                <div className="feature-icon" aria-hidden="true">
                  <card.icon size={20} strokeWidth={1.9} />
                </div>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
                <div className="feature-placeholder">
                  [ Insert screenshot here ]
                </div>
              </motion.article>
            ))}
          </div>
        </motion.section>

        <motion.section
          id="how-it-works"
          className="how-it-works"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <div ref={howItWorksBgRef} className="how-bg" aria-hidden="true" />
          <div className="how-overlay" aria-hidden="true" />
          <div className="how-content">
            <h2>How It Works</h2>
            <div className="steps-grid">
              <article className="step">
                <span>01</span>
                <h3>Configure</h3>
                <p>
                  Set brand styles, form fields, and payment options to match
                  your workflow.
                </p>
              </article>
              <article className="step">
                <span>02</span>
                <h3>Share</h3>
                <p>
                  Send your page link, post a QR code, or embed directly into
                  your current site.
                </p>
              </article>
              <article className="step">
                <span>03</span>
                <h3>Get Paid</h3>
                <p>
                  Collect payments in real time and keep records synchronized
                  for your team.
                </p>
              </article>
            </div>
          </div>
        </motion.section>

        <motion.section
          className="stats-strip"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        >
          <div>
            <strong>WCAG 2.1 AA</strong>
            <span>Accessibility Ready</span>
          </div>
          <div>
            <strong>3</strong>
            <span>Payment Modes</span>
          </div>
          <div>
            <strong>10</strong>
            <span>Custom Fields</span>
          </div>
          <div>
            <strong>Real-Time</strong>
            <span>Reporting</span>
          </div>
        </motion.section>

        <motion.section
          className="final-cta"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <h2>Launch payment pages your customers actually enjoy using</h2>
          <p>
            Go from setup to collection in minutes with a premium checkout
            experience built for modern business teams.
          </p>
          <SmartNavLink to="/signup" className="btn btn-filled btn-large">
            Get Started
          </SmartNavLink>
        </motion.section>
      </main>

      <footer className="footer">
        <img src={qppPlainLogo} alt="QPP" className="footer-logo" />
        <p>Built for the Waystar Hackathon</p>
        <small>© {new Date().getFullYear()} Quick Payment Pages</small>
      </footer>

      <div
        className="ambient-glow"
        style={{ opacity: Math.min(0.42, 0.16 + scrollY / 4000) }}
      />
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setIsLightMode((prev) => !prev)}
        aria-label={
          isLightMode ? "Switch to dark mode" : "Switch to light mode"
        }
        title={isLightMode ? "Switch to dark mode" : "Switch to light mode"}
      >
        {isLightMode ? <Moon size={18} /> : <Sun size={18} />}
        <span>{isLightMode ? "Dark" : "Light"}</span>
      </button>
    </div>
  );
}
