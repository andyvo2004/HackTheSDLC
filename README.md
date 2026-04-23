# Quick Payment Pages (QPP)
> Waystar Hackathon Challenge — Full-Stack Payment Platform

## Live Demo
- **Application URL:** [YOUR_DEPLOYED_URL]
- **Admin Login:** Use credentials from your .env (`ADMIN_EMAIL` / `ADMIN_PASSWORD`)
- **Demo Payment Pages:**
  - `/pay/yoga-class` — Fixed amount, custom fields
  - `/pay/parking-fee` — Range amount, license plate field

## What is QPP?
Quick Payment Pages is a hosted, self-service payment platform that lets providers create branded, configurable online payment pages in minutes. Admins configure pages with custom branding, payment rules, and custom data fields — then share them via URL, iframe, or QR code.

## Architecture

```
[Browser/Payer]  ──→  [React + Vite Frontend :5173]
                              │
                        [Vite Proxy]
                              │
[Admin Browser]  ──→  [Express API :3001]  ──→  [SQLite Database]
                              │
                       [Stripe API (sandbox)]
                              │
                    [SMTP / Resend (email)]
```

## Tech Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Frontend  | React 18 + Vite, vanilla CSS            |
| Backend   | Node.js + Express                       |
| Database  | SQLite (via sqlite3)                    |
| Payments  | Stripe (sandbox/test mode only)         |
| Email     | Nodemailer / SMTP (stub mode in dev)    |
| Auth      | JWT (jsonwebtoken)                      |

## Database Schema

**Tables:** `admin_users`, `payment_pages`, `payment_page_versions`, `custom_fields`, `transactions`, `field_responses`, `page_views`

Key relationships:
- `payment_pages` → `custom_fields` (one-to-many)
- `payment_pages` → `transactions` (one-to-many)
- `transactions` → `field_responses` (one-to-many)
- `payment_pages` → `payment_page_versions` (versioning/history)

## Environment Variables

### Backend (.env)

| Variable               | Description                              | Required |
|------------------------|------------------------------------------|----------|
| `PORT`                 | Express server port (default 3001)       | No       |
| `JWT_SECRET`           | Secret for signing JWT tokens            | Yes      |
| `ADMIN_EMAIL`          | Seeded owner account email               | Yes      |
| `ADMIN_PASSWORD`       | Seeded owner account password            | Yes      |
| `DB_PATH`              | Path to SQLite database file             | No       |
| `STRIPE_SECRET_KEY`    | Must start with `sk_test_`              | Yes      |
| `STRIPE_WEBHOOK_SECRET`| Stripe webhook signing secret            | Yes      |
| `SMTP_HOST`            | SMTP server hostname                     | No       |
| `SMTP_PORT`            | SMTP server port                         | No       |
| `SMTP_USER`            | SMTP username                            | No       |
| `SMTP_PASS`            | SMTP password                            | No       |
| `FROM_EMAIL`           | Sender email address                     | No       |

### Frontend (.env)

| Variable                      | Description                                          | Required |
|-------------------------------|------------------------------------------------------|----------|
| `VITE_API_URL`                | Backend API URL (default http://localhost:3001)      | Yes      |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Must start with `pk_test_`                          | Yes      |

## Local Setup

```bash
# 1. Clone the repo
git clone [your-repo-url]
cd qpp

# 2. Backend setup
cp .env.example .env
# Fill in .env values (JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, STRIPE keys)
npm install
npm run dev   # Starts on http://localhost:3001

# 3. Frontend setup (new terminal)
cd frontend
cp .env.example .env
# Set VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
npm install
npm run dev   # Starts on http://localhost:5173

# 4. Access the app
# Admin portal: http://localhost:5173
# Public payment page: http://localhost:5173/pay/[slug]
```

## Stripe Test Cards

| Card Number          | Result                              |
|----------------------|-------------------------------------|
| 4242 4242 4242 4242  | Payment succeeds                    |
| 4000 0000 0000 0002  | Card declined                       |
| 4000 0025 0000 3155  | Requires 3D Secure authentication   |

Use any future expiry date, any 3-digit CVV, any billing zip.

## Roles

| Role   | Capabilities                                                    |
|--------|-----------------------------------------------------------------|
| Owner  | Full access — manage pages, users, reports, settings            |
| Editor | Create and edit payment pages, view reports                     |
| Viewer | View pages and reports only (read-only)                         |

## API Overview

Full API documentation is available in the codebase. Key endpoint groups:

- `POST /auth/login` — Admin login
- `GET /auth/me` — Authenticated user profile
- `GET/POST /admin/pages` — Payment page management
- `PATCH /admin/pages/:id/status` — Enable/disable page
- `GET /public/pay/:slug` — Public page config (no auth)
- `POST /public/pay/:slug/create-payment-intent` — Create Stripe PaymentIntent
- `POST /public/pay/:slug/confirm` — Confirm payment
- `GET /admin/reports/transactions` — Transaction list with filters
- `GET /admin/reports/transactions.csv` — CSV export
- `GET /api/feed` — SSE live activity feed (auth required)

## Stripe Webhooks (Local Dev)

```bash
# Install Stripe CLI
stripe listen --forward-to localhost:3001/webhooks/stripe
```

## Mobile App Wrapper (React Native)

A mobile wrapper is included at `mobile/` (Expo + React Native WebView) to run QPP on iOS/Android quickly.

```bash
cd mobile
npm install
cp .env.example .env
# Set EXPO_PUBLIC_WEB_URL to your frontend URL (or LAN IP URL for physical devices)
npm run start
```

## Product Differentiator: Live Activity Feed

The admin dashboard features a real-time payment activity feed powered by Server-Sent Events (SSE). Every successful payment broadcasts instantly to all connected admin sessions, giving providers immediate awareness without polling or refreshing. This creates a noticeably more professional admin experience than static dashboards.

## Lighthouse Accessibility Audit

Use the built-in Lighthouse script to validate key quality thresholds on the public payment page.

```bash
# Terminal 1 (backend)
./dev-env.sh npm run dev

# Terminal 2 (frontend)
cd frontend
../dev-env.sh npm run dev -- --host 127.0.0.1 --port 5173

# Terminal 3 (audit)
cd frontend
../dev-env.sh npm run test:lighthouse
```

Optional environment variables for the audit command:
- `LIGHTHOUSE_URL` (default `http://127.0.0.1:5173/pay/yoga-class`)
- `LIGHTHOUSE_MIN_ACCESSIBILITY` (default `0.9`)
- `LIGHTHOUSE_MIN_PERFORMANCE` (default `0.7`)
- `LIGHTHOUSE_MIN_BEST_PRACTICES` (default `0.85`)
- `LIGHTHOUSE_MIN_SEO` (default `0.8`)

## Stretch Goals Implemented

- ACH bank transfer checkout with authorization language and Stripe Financial Connections
- Dynamic wallet availability detection via Payment Request API (Apple Pay / Google Pay where supported)
- Multi-language localization (10 languages)
- Webhook hardening with idempotency and refund/dispute handling
- Dark mode with persisted preference and OS preference detection fallback
- Playwright end-to-end smoke tests
- Mobile wrapper app (Expo + React Native WebView)
