# HealthyHackers - QPP Backend

Backend API for the Quick Payment Pages hackathon challenge.

## Tech stack

- Node.js + Express
- SQLite (`sqlite3`)
- JWT auth

## Quick start

1. Install dependencies:
   - `./dev-env.sh npm install`
2. Configure environment:
   - `cp .env.example .env`
3. Start server:
   - `./dev-env.sh npm run dev`

Server runs at `http://localhost:4000` by default.

## Local JS "venv" style setup

This repo includes `dev-env.sh` so you can run Node/npm locally without relying on system npm/Homebrew permissions.

- Use it for all Node commands:
  - `./dev-env.sh npm install`
  - `./dev-env.sh npm run dev`
  - `./dev-env.sh node -v`

## Environment variables

See `.env.example`.

- `PORT`: API port
- `JWT_SECRET`: token signing secret
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: auto-seeded admin login
- `BASE_PUBLIC_URL`: base URL used to generate share links
- `DB_PATH`: sqlite file path
- `STRIPE_SECRET_KEY`: Stripe test secret key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret

## API overview

### Health

- `GET /health`

### Auth

- `POST /auth/login`
  - Body: `{ "email": "...", "password": "..." }`
  - Returns JWT token

### Admin - Payment pages (Bearer token required)

- `GET /admin/pages`
- `GET /admin/pages/:id`
- `POST /admin/pages`
- `PUT /admin/pages/:id`
- `PATCH /admin/pages/:id/status`
- `GET /admin/pages/:id/share` (public URL + iframe snippet + QR code data URL)

### Public payment endpoints

- `GET /public/pay/:slug` (retrieve active page config)
- `POST /public/pay/:slug/create-payment-intent` (creates Stripe PaymentIntent + pending transaction)
- `POST /public/pay/:slug/confirm` (syncs transaction status from Stripe intent)

### Webhooks

- `POST /webhooks/stripe` (Stripe event receiver for payment status updates)

### Admin reporting (Bearer token required)

- `GET /admin/reports/transactions?from=&to=&pageId=&status=`
- `GET /admin/reports/summary`
- `GET /admin/reports/transactions.csv`

## Current implementation status

- Implemented:
  - Admin login with JWT
  - Payment page CRUD + active toggle
  - Branding/amount/custom fields/GL codes/email template persistence
  - Public payment page retrieval
  - Stripe test-mode PaymentIntent flow
  - Stripe webhook transaction status updates
  - Transaction storage + field responses
  - Confirmation email stub
  - Reporting summary + CSV export
- Not yet implemented:
  - Real email delivery provider
  - Wallet/ACH-specific flows
  - Role-based authorization beyond single admin role