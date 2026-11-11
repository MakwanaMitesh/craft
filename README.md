# CelebraCraft

A paid SaaS web app where customers build animated, template-driven birthday greeting websites and share them via a short link, QR code, or WhatsApp. Recipients open an unlisted public page — no login required — with a gift-box intro, floating balloons, a candle-blowing cake, and a hand-written letter with photos.

## Tech stack

- **Runtime:** Node.js + Express
- **Database:** MongoDB + Mongoose
- **Views:** EJS (server-rendered) + Tailwind CSS
- **Sessions:** express-session, stored in MongoDB via connect-mongo
- **Payments:** Razorpay (Checkout + webhook)
- **Uploads:** Multer → sharp (resize/re-encode) → Cloudinary or local disk
- **Email:** Nodemailer (falls back to console logging if no SMTP is configured)
- **Front-end animation:** GSAP + canvas-confetti (public card page only)
- **Other:** node-cron (expiry reminders), qrcode, pdfkit (invoices), sanitize-html

## Features at a glance

- **Customer:** multi-step card builder (template → details → photos → rich-text message → music → preview), Razorpay checkout, "My orders" with downloadable PDF invoices, share tools (copy link / WhatsApp / QR code), profile + password management.
- **Recipient (no account):** animated public card at `/c/:slug`, scheduled reveal (countdown until a chosen birthday date/time), Open Graph previews for WhatsApp/Instagram.
- **Admin:** dashboard with revenue/views charts and most-used templates, full template CRUD (colors, fonts, music tracks, enabled sections, live preview), plan CRUD, user management, order log with CSV export, site settings (logo, Razorpay keys, maintenance mode).

## Prerequisites

- Node.js 18+
- A MongoDB instance (local `mongod`, or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster)
- A [Razorpay](https://razorpay.com) account (test-mode keys are enough for development)

## Setup

```bash
git clone <this-repo>
cd celebracraft
npm install

cp .env.example .env
# edit .env — see the full variable reference below

npm run build:css          # generates public/css/output.css (gitignored)
npm run seed:admin         # creates the first admin account from ADMIN_* in .env
npm run seed:templates     # creates 3 starter templates (Warm Sunset, Pastel Party, Midnight Gold)

npm run dev                # http://localhost:3000, auto-restarts on file changes
```

You'll also want at least one pricing plan before a customer can publish a card — log in as admin and create one at `/admin/plans` (there's no seed script for plans, since pricing is business-specific).

## Environment variables

All variables live in `.env` (never commit this file — only `.env.example` is tracked).

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `development` or `production`. Controls cookie `secure` flag, error verbosity, and morgan's log format. |
| `PORT` | yes | Port the server listens on. |
| `APP_NAME` | yes | Used in page titles and a few emails as a fallback if Settings → Site name isn't set. |
| `BASE_URL` | yes | Full public URL of the site (e.g. `https://celebracraft.com`), used to build share links, QR codes, Open Graph tags, and email links. Must have no trailing slash. |
| `MONGO_URI` | yes | MongoDB connection string. |
| `SESSION_SECRET` | yes | Long random string used to sign the session cookie. Generate one with `openssl rand -hex 32`. |
| `RAZORPAY_KEY_ID` | yes | Razorpay API key ID. Can be overridden per-deployment from `/admin/settings` without touching `.env`. |
| `RAZORPAY_KEY_SECRET` | yes | Razorpay API key secret. Same override note as above — the admin-set value, if present, always wins. |
| `RAZORPAY_WEBHOOK_SECRET` | yes, if using the webhook | Separate secret from the key pair above — set when you create the webhook in the Razorpay dashboard. Not admin-overridable (see Payments section below). |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | yes (for `npm run seed:admin`) | Credentials for the first admin account. Change the password after first login. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | no | If `SMTP_HOST` is unset, outgoing email (password reset, payment confirmation, card-opened notification, expiry reminders) is logged to the console instead of sent — fine for local development. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | no | If all three are set, uploaded photos/thumbnails/logos are stored on Cloudinary. If any are missing, uploads fall back to local disk at `public/images/uploads/` — fine for local dev, but most hosting platforms have an ephemeral filesystem, so set these for production. |

## NPM scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the app with nodemon (auto-restart on change). |
| `npm start` | Start the app with plain `node` — use this in production. |
| `npm run build:css` | Watch-build Tailwind CSS for local development. |
| `npm run build:css:prod` | One-shot minified Tailwind build — run this during deployment. |
| `npm run seed:admin` | Create the first admin account from `ADMIN_*` env vars (safe to re-run; skips if that email already exists). |
| `npm run seed:templates` | Create the 3 starter templates (safe to re-run; skips any that already exist by slug). |

## Project structure

```
app.js                  Express app wiring: middleware order, routes, cron
config/                 DB, session, mailer, Cloudinary connection setup
controllers/            Route handlers, one file per concern
models/                 Mongoose schemas (User, Card, Template, Plan, Order, Setting, CardView)
middleware/             Auth guards, CSRF, rate limiting, upload, error handling
routes/                 Express routers — public, auth, user (/dashboard), admin (/admin)
views/                  EJS templates (layouts/, partials/, auth/, user/, admin/, public/)
public/                 Static assets — Tailwind output, client images, uploaded media (local fallback)
utils/                  Small shared helpers (tokens, media storage, sanitization)
jobs/                   node-cron jobs (card expiry reminders)
seed/                   One-off database seed scripts
```

## Security notes

- **CSRF:** a hand-rolled session-bound token (not the `csurf` package, which is deprecated/archived with open advisories) — every form carries a hidden `_csrf` field, verified against the session on every state-changing request. The Razorpay webhook and the public "card opened" beacon are the only exemptions, since neither has a session to bind a token to.
- **Rate limiting:** a generous global limiter on every request, a tighter one on auth routes (login/register/password reset), one on payment endpoints, and one on the public "card opened" beacon (which has no auth, so it needs its own abuse guard).
- **Uploads:** every image — card photos, template thumbnails, the site logo — is re-encoded through `sharp` before being stored, regardless of destination (Cloudinary or local disk). This both resizes/compresses and validates the bytes are an actual decodable image, rather than trusting the file extension alone.
- **Letter content:** the rich-text message is sanitized server-side with `sanitize-html` (a small allowlist of formatting tags) before it's ever stored or rendered back out.
- **Sessions:** `httpOnly`, `sameSite: lax`, and `secure` in production.

## Payments

- Razorpay keys can be set two ways: in `.env` (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`), or from `/admin/settings` in the UI (the secret is stored hashed-from-view — masked in the UI, never redisplayed in full). **The admin-set value always wins when both are present.**
- `RAZORPAY_WEBHOOK_SECRET` is `.env`-only, not admin-editable — it's a separate secret you set once when creating the webhook in the Razorpay dashboard, and isn't something you'd rotate as often as the API keys.
- Set the webhook URL to `https://<your-domain>/payments/webhook`, subscribed to `payment.captured` and `payment.failed`.
- **Going live:** switch `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (or the admin settings fields) from test-mode to live-mode values, toggle your Razorpay dashboard from Test to Live, and create a **new** live-mode webhook (test and live webhooks have different secrets — update `RAZORPAY_WEBHOOK_SECRET` accordingly). Run one real low-value transaction end-to-end yourself before announcing launch — this requires your own verified, live Razorpay account, so it's not something that can be done or verified on your behalf ahead of time.

## License

Private/proprietary — add a license here if you intend to open-source this.
