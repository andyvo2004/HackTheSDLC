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
| Database  | SQLite (via better-sqlite3)             |
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

- `POST /api/auth/login` — Admin login
- `GET/POST/PATCH/DELETE /api/pages` — Payment page management
- `GET /public/pay/:slug` — Public page config (no auth)
- `POST /public/pay/:slug/intent` — Create Stripe PaymentIntent
- `POST /public/pay/:slug/confirm` — Confirm payment
- `GET /api/reports/transactions` — Transaction list with filters
- `GET /api/reports/export` — CSV export
- `GET /api/feed` — SSE live activity feed (auth required)

## Stripe Webhooks (Local Dev)

```bash
# Install Stripe CLI
stripe listen --forward-to localhost:3001/webhooks/stripe
```

## Product Differentiator: Live Activity Feed

The admin dashboard features a real-time payment activity feed powered by Server-Sent Events (SSE). Every successful payment broadcasts instantly to all connected admin sessions, giving providers immediate awareness without polling or refreshing. This creates a noticeably more professional admin experience than static dashboards.
