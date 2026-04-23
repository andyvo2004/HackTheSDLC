# QPP Frontend
React + Vite frontend for the Quick Payment Pages platform.

## Setup
See the root [README.md](../README.md) for full setup instructions.

## Routes
- `/` — Admin portal (requires login)
- `/pay/:slug` — Public payment page (no auth required)

## Key Files
- `src/App.jsx` — All page components and routing logic
- `src/index.css` — Global styles and component styles
- `src/components/DistributionPanel.jsx` — URL/iframe/QR code distribution
- `src/components/ActivityFeed.jsx` — Live payment activity feed
- `src/utils/color.js` — WCAG contrast color utility

## Environment Variables

| Variable                      | Value                    |
|-------------------------------|--------------------------|
| `VITE_API_URL`                | http://localhost:3001    |
| `VITE_STRIPE_PUBLISHABLE_KEY` | pk_test_...              |
