# HealthyHackers - QPP Backend

Backend API for the Quick Payment Pages hackathon challenge.

## Tech stack

- Node.js + Express
- SQLite (`sqlite3`)
- JWT auth
- Role-based authorization (`owner`, `editor`, `viewer`)

## Quick start

1. Install dependencies:
   - `./dev-env.sh npm install`
2. Configure environment:
   - `cp .env.example .env`
3. Start server:
   - `./dev-env.sh npm run dev`

Server runs at `http://localhost:4000` by default.

## Frontend (React + Vite)

1. Install frontend dependencies:
   - `cd frontend`
   - `../dev-env.sh npm install`
2. Start frontend:
   - `cp .env.example .env`
   - `../dev-env.sh npm run dev`
3. Optional API URL override:
   - `VITE_API_URL=http://localhost:4000`
   - `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`

Frontend routes:
- `/` admin dashboard
- `/pay/:slug` public payment checkout (Stripe Elements)

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
- `EMAIL_FROM`: sender address for confirmations
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`: SMTP email config

## API overview

### Health

- `GET /health`

### Auth

- `POST /auth/login`
  - Body: `{ "email": "...", "password": "..." }`
  - Returns JWT token + role
- `GET /auth/me` (Bearer token required)
  - Returns current authenticated admin profile

### Admin - Payment pages (Bearer token required)

- `GET /admin/pages`
- `GET /admin/pages/:id`
- `POST /admin/pages` (editor/owner)
- `PUT /admin/pages/:id` (editor/owner)
- `PATCH /admin/pages/:id/status` (editor/owner)
- `GET /admin/pages/:id/share` (public URL + iframe snippet + QR code data URL)

### Public payment endpoints

- `GET /public/pay/:slug` (retrieve active page config)
- `POST /public/pay/:slug/create-payment-intent` (creates Stripe PaymentIntent + pending transaction)
  - Supports `paymentMethod` (`card`, `wallet`, `ach`)
  - For `ach`, include `achAuthorizationAccepted: true`
- `POST /public/pay/:slug/confirm` (syncs transaction status from Stripe intent)

### Webhooks

- `POST /webhooks/stripe` (Stripe event receiver for payment status updates)

### Admin reporting (Bearer token required)

- `GET /admin/reports/transactions?from=&to=&pageId=&status=&paymentMethod=`
- `GET /admin/reports/summary`
- `GET /admin/reports/transactions.csv?from=&to=&pageId=&status=&paymentMethod=`

### Admin user management (owner only)

- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/:id/role`
- `PATCH /admin/users/:id/password`

## Role permission matrix

- `viewer`
  - Can: read page configs, read reports/exports
  - Cannot: create/update/toggle pages, manage admin users
- `editor`
  - Can: everything `viewer` can, plus create/update/toggle pages
  - Cannot: manage admin users
- `owner`
  - Full access, including admin user management and role assignment

## Current implementation status

- Implemented:
  - Admin login with JWT
  - Role-based permissions (owner/editor/viewer)
  - Payment page CRUD + active toggle
  - Branding/amount/custom fields/GL codes/email template persistence
  - Public payment page retrieval
  - Stripe test-mode PaymentIntent flow
  - Stripe webhook transaction status updates
  - Transaction storage + field responses
  - SMTP confirmation email support (with local stub fallback)
  - Reporting summary + CSV export with active filters
- Not yet implemented:
  - Full wallet/ACH client-side checkout UX and capability detection
  - Fine-grained per-page/team permissions