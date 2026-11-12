# CLAUDE.md

This file documents the CelebraCraft codebase as it actually exists today. Any new AI chat or developer should be able to read this one file, understand the whole project, and continue work without breaking existing cards, links, or payments. If something below turns out to be wrong after a change, **update this file in the same change** (see "Coding rules for future work").

Anything described as planned-but-not-built lives only in the "Not built yet" section — everything else in this file reflects code that exists right now.

---

## 1. Project overview

CelebraCraft is a paid SaaS web app. A customer (the **card owner**) builds an animated, personalized greeting website through a multi-step wizard, pays for it, and gets a short public link to share. The **recipient** opens that link — no account needed — and gets a full-screen animated experience.

Two occasions exist today, both driven by the same `occasion` field (see §15 for how a third would be added):

- **Birthday Wish** (`occasion: 'birthday'`): tap-to-open gift box → floating balloons → cake with blowable candles → a hand-written letter (optionally with photos) that types itself out line by line.
- **Love Proposal** (`occasion: 'proposal'`): tap-to-open heart → a question with YES/NO buttons, where NO dodges around the screen and gets harder to hit the more it's pressed → a celebration screen (heart confetti, photo slideshow, the owner's message) on YES. The owner is notified by email and in-app the moment YES is pressed.

**Roles:**

| Role | Account? | Can do |
|---|---|---|
| **Admin** | Yes (`role: 'admin'`) | Everything under `/admin` — manage templates, plans, users, orders, cards, reviews, settings, audit log, site-wide analytics. |
| **User** (card owner) | Yes (`role: 'user'`) | Everything under `/dashboard` — build/pay for/manage their own cards, see per-card analytics, manage their profile and notification preferences. |
| **Recipient** | No account | Opens a public card at `/c/:slug`, optionally responds to a proposal. Never sees a login screen. |

---

## 2. Tech stack (from `package.json`)

| Package | Version | Used for |
|---|---|---|
| express | ^4.19.2 | Web framework |
| mongoose | ^8.5.0 | MongoDB ODM |
| ejs | ^3.1.10 | Server-rendered views |
| express-session + connect-mongo | ^1.18.0 / ^5.1.0 | Session storage in MongoDB |
| bcrypt | ^5.1.1 | Password hashing |
| express-validator | ^7.1.0 | Input validation |
| express-rate-limit | ^7.4.0 | Rate limiting |
| helmet | ^7.1.0 | Security headers / CSP |
| compression | ^1.7.4 | Gzip responses |
| morgan | ^1.10.0 | Request logging |
| multer | ^2.5.0 | File upload handling |
| sharp | ^0.35.5 | Image resize/re-encode/validate |
| cloudinary | ^2.11.0 | Optional hosted image storage |
| sanitize-html | ^2.13.0 | Strips unsafe HTML from user content |
| razorpay | ^2.9.4 | Payment gateway SDK |
| nodemailer | ^10.4.0 | Sending email |
| node-cron | ^4.6.0 | Scheduled jobs (expiry reminders) |
| qrcode | ^1.5.4 | QR code generation for share links |
| pdfkit | ^0.20.2 | PDF invoice generation |
| nanoid | ^3.3.7 | Short IDs (card slugs, uploaded filenames) |
| geoip-lite | ^2.0.3 | IP → approximate city/country for view tracking |
| ua-parser-js | ^2.0.10 | User-agent → device/browser/OS |
| isbot | ^5.2.3 | Bot detection (excluded from tracking) |
| dotenv | ^16.4.5 | Loads `.env` |
| tailwindcss (dev) | ^3.4.9 | Utility-first CSS, compiled to `public/css/output.css` |
| nodemon (dev) | ^3.1.4 | Auto-restart in development |

Front-end libraries loaded via CDN (not in `package.json`): **GSAP** + **canvas-confetti** (public card animations), **Chart.js** (admin dashboard/analytics charts), **Quill** (rich-text editor for legal pages in Settings).

---

## 3. How to run

```bash
git clone <this-repo>
cd celebracraft
npm install

cp .env.example .env
# fill in .env — see §12 for what every variable does

npm run build:css          # one-time: generates public/css/output.css (gitignored)
npm run seed:admin         # creates the first admin account from ADMIN_* in .env
npm run seed:templates     # creates 3 starter birthday templates
npm run seed:proposal-templates   # creates 2 starter proposal templates (with stickers)

npm run dev                 # http://localhost:3000, auto-restarts on file change
```

You'll also want at least one `Plan` per occasion before a customer can check out — create one at `/admin/plans` (no seed script for plans; pricing is business-specific).

### Migrations

Run once, in order, whenever you pull a change that touches these fields (both are safe to re-run — they only touch documents missing the field):

```bash
npm run migrate:occasion    # backfills Template/Card/Plan.occasion on documents from before the occasion system existed
npm run migrate:tracking    # renames Card.views -> Card.totalViews, adds Card.uniqueViews
```

### Production

```bash
npm run build:css:prod      # minified Tailwind build — run this during deployment
npm start                   # plain `node app.js`, no auto-restart
```

### Razorpay test mode

- Default/.env keys should be Razorpay **test-mode** keys (`rzp_test_...`). The admin can also set keys from `/admin/settings?tab=payments`, including a **test/live mode switch** — whichever is set there always wins over `.env` (see `paymentController.getRazorpayCredentials` / `settingsController.updatePayments`).
- Webhook URL: `https://<your-domain>/payments/webhook`, subscribed to `payment.captured` and `payment.failed`. `RAZORPAY_WEBHOOK_SECRET` is `.env`-only, not admin-editable (test and live webhooks have different secrets).
- Going live: switch the key pair (and the Settings mode toggle) from test to live, flip the Razorpay dashboard to Live, and create a **new** live-mode webhook with its own secret. Run one real low-value transaction yourself before launch — this needs your own verified live account, so it can't be done on your behalf.

---

## 4. Folder structure

```
app.js                   Express app wiring: middleware order, route mounting, cron start
config/
  db.js                  mongoose.connect()
  session.js             express-session + connect-mongo config
  mailer.js              sendMail() — reads SMTP config from Settings (preferred) or .env (fallback)
  cloudinary.js           Cloudinary client + isConfigured flag
  landingContent.js       Static fallback copy for the landing page (hero/FAQ/etc — overridden by Settings when admin fills them in)
controllers/
  authController.js       Register, login, logout, forgot/reset password
  profileController.js    Customer profile + password + notification-preference updates
  cardController.js       The whole card builder wizard (both occasions), "My cards", card analytics, QR download
  paymentController.js    Razorpay order creation, signature verification, webhook, invoices, "My orders"
  publicController.js     Landing page, demo previews, legal pages, the public card experience, proposal response
  trackingController.js   POST /api/track — the public card pages' analytics beacon
  notificationController.js  Bell-icon notification list + mark-as-read
  adminController.js      Everything under /admin except Settings (dashboard, analytics, users, templates, plans, orders, cards, reviews, audit log)
  settingsController.js   All 9 admin Settings tabs + send-test-email
jobs/
  expiryCron.js           Daily cron: email owners ~2 days before a card expires, log expired-card count
middleware/
  auth.js                 isAuthenticated / isUser / isAdmin / redirectIfAuthenticated
  csrf.js                 Hand-rolled session-bound CSRF token (ensureToken, verifyToken, verifyTokenAfterUpload)
  rateLimiter.js           generalLimiter, authLimiter, paymentLimiter, openedLimiter, trackLimiter
  upload.js                Static multer instance for admin uploads (template thumbnails/stickers, site logos) — fixed 5MB/jpg,png,webp limits
  dynamicPhotoUpload.js    Per-request multer instance for the customer wizard's photo uploads, built fresh from live Settings → Uploads limits
  maintenance.js           Blocks non-admin traffic when Settings.maintenanceMode is on
  locals.js                Injects flash, oldInput, currentUser, impersonatorName, unreadNotificationCount, settings, currentPath into every view
  validate.js              express-validator error → flash + redirect back
  errorHandler.js          Central error handler + 404 handler; translates Mongoose/Multer errors into friendly messages
models/                   One Mongoose schema per file — see §5
routes/
  publicRoutes.js          Landing, demo, legal pages, public card experience, tracking beacon — mounted at '/'
  authRoutes.js            Register/login/logout/forgot-password — mounted at '/'
  userRoutes.js            Everything under /dashboard, plus /stop-impersonating — mounted at '/'
  adminRoutes.js           Everything under /admin — mounted at '/admin'
seed/
  seedAdmin.js             Creates the first admin account from ADMIN_* env vars
  seedTemplates.js         3 starter birthday templates
  seedProposalTemplates.js 2 starter proposal templates + generated sticker images
  generateOgImage.js       Generates the default Open Graph image for the landing page
migrations/
  migrateOccasion.js       Backfills `occasion` on pre-existing Template/Card/Plan documents
  migrateCardTracking.js   Renames Card.views -> totalViews, adds uniqueViews
utils/
  AppError.js              Operational-error class (statusCode + isOperational) used everywhere instead of throwing raw errors
  catchAsync.js             Wraps async route handlers so rejected promises reach the error handler
  tokens.js                 generateCardSlug, generateResetToken/hashToken
  safeRedirect.js           Validates a `?redirect=` query value is an internal path (open-redirect guard)
  mediaStorage.js           storeImage/storeImages — sharp resize/validate, then Cloudinary or local disk
  occasions.js              OCCASIONS, DEFAULT_OCCASION, getEnabledOccasions(settings)
  tracking.js               hashIp, parseDevice, detectReferrerSource, lookupLocation, isBotRequest — used by trackingController
  trackingEvents.js          EVENT_TYPES array shared by CardEvent model and the tracking client script
  dateSeries.js             startOfDay, fillDailySeries — turns sparse daily aggregates into full chart series
  timeAgo.js                 "2 hours ago"-style relative time formatting
  csv.js                     escapeCsv/toCsv/sendCsv — shared CSV export helper (guards against formula injection)
  auditLog.js                logAdminAction(req, action, meta) — fire-and-forget audit log writes
  crypto.js                  encrypt/decrypt (AES-256-GCM) for secrets stored in Settings
views/
  layouts/                  main-head/foot (plain pages), dashboard-head/foot (sidebar layout), landing-head/foot (full-bleed landing page)
  partials/                 navbar, footer, sidebar, topbar (with notification bell), flash, head, share-tools, wizard step indicators
  auth/, user/, admin/, public/, errors/   Page templates grouped by area
public/
  css/                      Tailwind input/output
  images/uploads/           Local-disk fallback for uploaded images when Cloudinary isn't configured
  js/tracking.js            Client-side analytics beacon loaded on public card pages
```

---

## 5. Database models

All models are singular PascalCase files under `models/`, one Mongoose model per file, loaded wherever `require('../models/X')` appears. All use `{ timestamps: true }` unless noted.

### User (`models/User.js`)

| Field | Type | Notes |
|---|---|---|
| name | String | required |
| email | String | required, unique, lowercased |
| phone | String | |
| password | String | required, `select: false`, bcrypt-hashed in a `pre('save')` hook |
| role | String enum `['user','admin']` | default `'user'` |
| isBlocked | Boolean | default `false` — blocked users can't log in |
| lastLoginAt | Date | set on every successful login |
| notifyOnCardOpened | Boolean | default `true` — gates the **email** for the card-opened notification only |
| notifyOnProposalYes | Boolean | default `true` — gates the **email** for the proposal-YES notification only |
| resetPasswordToken, resetPasswordExpires | String/Date, `select: false` | forgot-password flow |

Method: `comparePassword(candidate)`.

### Card (`models/Card.js`)

| Field | Type | Notes |
|---|---|---|
| user | ObjectId → User | required |
| template | ObjectId → Template | required |
| plan | ObjectId → Plan | set once paid |
| slug | String | required, unique, indexed — the public URL segment |
| occasion | String enum (from `utils/occasions`) | required |
| **birthday fields** | | |
| recipientName, nickname, senderName | String | |
| birthdayDate | Date | if in the future, the public page shows a countdown instead of the full experience |
| message | String, max 4000 | sanitized HTML (rich-text letter) |
| candleCount | Number 1–20 | default 1 |
| photos | [String] | `photos[0]` doubles as the cover photo |
| music | `{name, url}` | one track chosen from the template's `musicTracks` |
| **proposal fields** | | |
| partnerName, question (max 500), yesMessage (max 2000) | String | required only when `occasion === 'proposal'` (conditional `required` function, not schema-level `required: true`) |
| sticker | String | optional, from the template's `stickers` |
| respondedYes | Boolean | default `false` |
| respondedAt | Date | |
| noAttempts | Number | how many times NO was dodged before YES |
| **shared** | | |
| status | String enum `['draft','paid']` | default `'draft'` |
| paidAt, expiresAt | Date | `expiresAt` set from the Plan's `validityDays` at payment time |
| isDisabled | Boolean | default `false` — admin kill-switch; public link 404s while set, independent of expiry |
| totalViews, uniqueViews | Number | default 0 — fast counters mirrored from CardView rows by `trackingController` |
| lastOpenedAt | Date | last `card_opened` tracking event |
| firstOpenedAt | Date | set the moment the recipient actually taps the gift box/heart open (not just a page load) |
| expiryReminderSentAt | Date | de-dupe guard for the cron expiry-reminder email |

Index: unique on `slug`.

### Template (`models/Template.js`)

| Field | Type | Notes |
|---|---|---|
| name, slug | String | slug unique, lowercased |
| thumbnail | String | |
| occasion | String enum | required |
| colorTheme | `{primary, secondary, background}` | hex colors, each with a default |
| fontPairId | String enum (one of `Template.FONT_PAIRS` ids) | default `'fredoka-nunito'` |
| musicTracks | `[{name, url}]` | |
| stickers | `[{name, url}]` | proposal occasion only |
| sections | `{balloons, cake, letter, photoGallery}` Booleans | which parts of the birthday experience this template includes |
| isPremium, isActive | Boolean | |
| sortOrder | Number | |

Static: `Template.FONT_PAIRS` (6 curated heading/body font pairs). Method: `getFontPair()`.

### Plan (`models/Plan.js`)

| Field | Type | Notes |
|---|---|---|
| name | String | required |
| occasion | String enum | required |
| price | Number | in INR rupees |
| description | String | |
| features | [String] | |
| validityDays | Number | default 365 — how long the public link stays live after payment |
| maxPhotos | Number | default 1 |
| musicAllowed | Boolean | default `false` |
| isPopular | Boolean | default `false` — only one plan per occasion can be flagged (enforced in `adminController`) |
| analyticsLevel | String enum `['basic','full']` | default `'full'` — gates how much of `/dashboard/cards/:id/stats` a card on this plan can see |
| isActive | Boolean | |

### Order (`models/Order.js`)

| Field | Type | Notes |
|---|---|---|
| user, card, plan | ObjectId refs | all required |
| amount | Number | **always read server-side from the Plan**, never from the client |
| currency | String | default `'INR'` |
| razorpayOrderId | String | required |
| razorpayPaymentId, razorpaySignature | String | |
| status | String enum `['created','paid','failed','refunded']` | default `'created'` |

### CardView (`models/CardView.js`)

One row per browser session that opens a public card (created on the `card_opened` event — see §7.6).

| Field | Type | Notes |
|---|---|---|
| card, owner | ObjectId refs | required |
| occasion | String enum | |
| sessionId | String | required, client-generated |
| deviceType | enum `['mobile','tablet','desktop']` | |
| browser, os | String | from `ua-parser-js` |
| referrerSource | enum `['whatsapp','instagram','direct','other']` | |
| city, country | String | from `geoip-lite`, approximate |
| ipHash | String | SHA-256 of `ip + today's date` — **the raw IP is never stored** |
| isUnique | Boolean | true if this `ipHash` hasn't been seen for this card before |
| openedAt | Date | default now |
| durationSeconds | Number | updated by the closing `time_spent` beacon |
| furthestStep | String | last event type reached in this session |

Indexes: `{card, openedAt}`, `{owner, openedAt}`.

### CardEvent (`models/CardEvent.js`)

Granular event log behind CardView.

| Field | Type |
|---|---|
| card | ObjectId → Card, required |
| sessionId | String, required |
| type | String enum, one of `EVENT_TYPES` (`utils/trackingEvents.js`): `card_opened, tapped_open, balloons_done, candles_blown, letter_opened, replay, no_attempt, yes_clicked, time_spent` |
| durationSeconds | Number — only set on `time_spent` |
| createdAt | Date |

Indexes: `{card, createdAt}`, `{sessionId}`.

### Review (`models/Review.js`)

| Field | Type | Notes |
|---|---|---|
| name | String | required |
| occasion | String enum | required |
| rating | Number 1–5 | required |
| text | String, max 500 | required |
| isApproved | Boolean | default `false` — the landing page's reviews section stays hidden until ≥3 are approved (no seed data exists for this model on purpose) |

### Setting (`models/Setting.js`)

**Singleton** — one document for the whole site, nested by Settings tab. Full field list is in §10. Has an in-memory cache (invalidated on every save via a `post('save')` hook) and encrypts `razorpayKeySecret` / `smtp.password` at rest (`select: false`, AES-256-GCM via `utils/crypto.js`).

### AuditLog (`models/AuditLog.js`)

| Field | Type |
|---|---|
| admin | ObjectId → User, required |
| action | String, e.g. `'user.block'`, `'card.delete'`, `'order.refund'` |
| targetType | String, e.g. `'User'`, `'Card'`, `'Order'` |
| targetId | ObjectId |
| details | Mixed — shape varies per action |
| createdAt | Date |

Indexes: `{createdAt: -1}`, `{admin, createdAt: -1}`.

### Notification (`models/Notification.js`)

Backs the dashboard bell icon.

| Field | Type |
|---|---|
| user | ObjectId → User, required, indexed |
| type | enum `['card_opened', 'proposal_yes']` |
| card | ObjectId → Card, required |
| message | String, required |
| isRead | Boolean, default `false` |
| createdAt | Date |

Index: `{user, createdAt: -1}`.

### PageView (`models/PageView.js`)

Minimal — just enough for the admin analytics "visitor funnel" (landing visits → signups → cards created → paid). Not a general analytics table; `CardView` is the detailed one.

| Field | Type |
|---|---|
| path | String, required |
| createdAt | Date |

Index: `{path, createdAt}`.

---

## 6. Routes

Mount points (`app.js`): `publicRoutes` and `authRoutes` and `userRoutes` all mount at `/`; `adminRoutes` mounts at `/admin` (and applies `isAuthenticated, isAdmin` to the whole router via `router.use`). `publicRoutes`/`authRoutes`/`userRoutes` apply their guards **per-route**, not via `router.use`, because a path-less `router.use` on a router mounted at `/` would otherwise run on every request — including ones meant for `/admin/*` — before Express ever reaches `adminRoutes`.

### Public (`routes/publicRoutes.js`, no login)

| Method | Path | Middleware | Controller | Purpose |
|---|---|---|---|---|
| GET | `/` | maintenanceGate | publicController.getLanding | Landing page |
| GET | `/demo/:templateSlug` | maintenanceGate | publicController.getDemo | Renders the real card engine with dummy data, no save |
| GET | `/terms`, `/privacy`, `/refund-policy`, `/contact` | — | publicController.getLegalPage | Legal pages (rich text from Settings, or placeholder) |
| GET | `/c/:slug` | maintenanceGate | publicController.viewCard | The public card experience |
| POST | `/c/:slug/opened` | maintenanceGate, openedLimiter | publicController.markOpened | First-tap signal → owner notification |
| POST | `/api/cards/:slug/respond` | maintenanceGate, openedLimiter | publicController.respondToProposal | Saves the proposal's YES answer |
| POST | `/api/track` | maintenanceGate, trackLimiter | trackingController.track | Analytics beacon from the public card pages |

### Auth (`routes/authRoutes.js`, mounted at `/`)

| Method | Path | Middleware | Controller | Purpose |
|---|---|---|---|---|
| GET/POST | `/register` | redirectIfAuthenticated (GET), authLimiter (POST) | authController.get/postRegister | Sign up (blocked with a "closed" page if `registrationsOpen` is off) |
| GET/POST | `/login` | redirectIfAuthenticated (GET), authLimiter (POST) | authController.get/postLogin | Log in, redirects by role |
| POST | `/logout` | — | authController.logout | Destroys session |
| GET/POST | `/forgot-password` | authLimiter (POST) | authController.get/postForgotPassword | Sends a reset-token email |
| GET/POST | `/reset-password/:token` | authLimiter (POST) | authController.get/postResetPassword | Sets a new password from the emailed token |

### User dashboard (`routes/userRoutes.js`, mounted at `/`, guard = `[maintenanceGate, isAuthenticated, isUser]` unless noted)

| Method | Path | Purpose |
|---|---|---|
| POST | `/stop-impersonating` | Ends an admin's "log in as this user" session (only `isAuthenticated`, not `isUser`, since it must work while impersonating) |
| GET | `/dashboard` | "My cards" list |
| GET | `/dashboard/cards/new` | Occasion picker (or redirects straight to the template picker if `?occasion=` is set and enabled) |
| GET | `/dashboard/cards/new/template` | Template picker (step 1) |
| POST | `/dashboard/cards` | Creates the draft card |
| GET/POST | `/dashboard/cards/:id/build/template` | Change template mid-wizard |
| GET/POST | `/dashboard/cards/:id/build/details` | Birthday: recipient details |
| GET/POST | `/dashboard/cards/:id/build/photos` | Birthday: photo upload (dynamicPhotoUpload) |
| GET/POST | `/dashboard/cards/:id/build/message` | Birthday: the letter message |
| GET/POST | `/dashboard/cards/:id/build/proposal/names` | Proposal: partner/sender names |
| GET/POST | `/dashboard/cards/:id/build/proposal/question` | Proposal: the question text |
| GET/POST | `/dashboard/cards/:id/build/proposal/sticker` | Proposal: pick a sticker |
| GET/POST | `/dashboard/cards/:id/build/proposal/yes-message` | Proposal: celebration message + photos (dynamicPhotoUpload) |
| GET/POST | `/dashboard/cards/:id/build/music` | Shared: pick a music track |
| GET | `/dashboard/cards/:id/build/preview` | Shared: preview before paying |
| GET | `/dashboard/cards/:id/preview` | Renders the owner's own card for review |
| POST | `/dashboard/cards/:id/delete` | Deletes a card (ownership-checked) |
| GET | `/dashboard/cards/:id/checkout` | Plan picker + Razorpay checkout page |
| GET | `/dashboard/cards/:id/success` / `/payment-failed` | Post-payment result pages |
| GET | `/dashboard/cards/:id/qr.png` | QR code for the share link |
| GET | `/dashboard/cards/:id/stats` | Card analytics (ownership-checked, plan-gated — see §9) |
| GET | `/api/notifications` | Bell-icon dropdown data (JSON) |
| POST | `/api/notifications/read` | Marks all notifications read |
| POST | `/payments/create-order` (paymentLimiter) | Creates the Razorpay order |
| POST | `/payments/verify` (paymentLimiter) | Verifies the Razorpay signature, activates the card |
| GET | `/dashboard/orders` | "My orders" |
| GET | `/dashboard/orders/:id/invoice.pdf` | PDF invoice download |
| GET/POST | `/dashboard/profile` | Profile + notification-preference edit |
| POST | `/dashboard/profile/password` | Change password |

### Admin (`routes/adminRoutes.js`, mounted at `/admin`, `router.use(isAuthenticated, isAdmin)` applies to all of it)

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard` | Stat cards (with period-over-period % change), charts, latest/most-viewed cards, latest orders |
| GET | `/analytics` | Device/browser/location/source breakdowns, busiest-hours heatmap, funnels, top templates |
| GET | `/audit-log` | Paginated list of every logged admin action |
| GET | `/users`, `/users/export.csv`, `/users/:id` | List/export/detail |
| POST | `/users/:id/toggle-block`, `/delete`, `/reset-password`, `/login-as` | User actions |
| GET | `/templates`, `/templates/export.csv`, `/templates/new`, `/templates/:id/edit`, `/templates/:id/preview` | Template CRUD + live preview |
| POST | `/templates`, `/templates/:id/edit`, `/templates/:id/toggle`, `/templates/:id/delete` | Template writes |
| GET | `/plans`, `/plans/export.csv`, `/plans/:id/edit` | Plan list/export/edit form |
| POST | `/plans`, `/plans/:id/edit`, `/plans/:id/toggle`, `/plans/:id/delete` | Plan writes |
| GET | `/orders`, `/orders/export.csv` | Orders list/export |
| POST | `/orders/:id/refund` | Razorpay refund |
| GET | `/cards`, `/cards/export.csv`, `/cards/:id` | Site-wide card list/export/detail |
| POST | `/cards/:id/extend-expiry`, `/toggle-disable`, `/delete` | Card admin actions |
| GET | `/reviews`, `/reviews/export.csv` | Review list/export |
| POST | `/reviews/:id/approve`, `/unapprove`, `/delete` | Review moderation |
| GET | `/settings` (`?tab=...`) | The 9-tab settings page |
| POST | `/settings/general`, `/contact`, `/homepage`, `/seo`, `/features`, `/payments`, `/email`, `/email/test`, `/uploads`, `/legal` | One save endpoint per tab (see §10) |

---

## 7. Main flows

### 7.1 Register/login and role redirects

- `postRegister`/`postLogin` set `req.session.{userId, userName, role}`. `postLogin` also sets `lastLoginAt`.
- After login, `role === 'admin'` → `/admin/dashboard`, otherwise → `/dashboard`, unless a safe `?redirect=` was carried through register (`utils/safeRedirect.js` rejects anything that isn't an internal path, blocking open-redirect).
- `redirectIfAuthenticated` bounces an already-logged-in visitor away from `/login`/`/register` straight to their dashboard.
- Registration is blocked (with a dedicated "registrations closed" page) when Settings → Features → `registrationsOpen` is off.

### 7.2 Card builder, per occasion

1. `getChooseOccasion` → occasion picker (only shows enabled occasions — `getEnabledOccasions(settings)`).
2. `getNewCardTemplate`/`postNewCard` → draft `Card.create()` with `occasion` taken from the chosen **Template** (never trusted from client input), `status: 'draft'`. Blocked server-side too if the occasion is disabled (defense in depth beyond just hiding the UI).
3. Every step after that is `card.save()` with `{ validateBeforeSave: false }`, because a proposal card's `partnerName`/`question`/`yesMessage` are schema-required only once `occasion === 'proposal'`, but don't exist yet on a fresh draft — full-document validation would fail on every intermediate save. Each step validates its own input explicitly before saving instead.
4. Birthday: details → photos → message → music → preview. Proposal: names → question → sticker → yes-message+photos → music → preview (shared steps after names onward reuse the same controller functions where the logic is identical).
5. `getCheckout` lists only Plans matching the card's own occasion.

### 7.3 Payment

1. `createOrder`: loads the card (ownership-checked) and the chosen Plan, **re-checks `plan.occasion === card.occasion` server-side** (a tampered `planId` for the wrong occasion is rejected, since that's how a cheaper plan could otherwise be charged for a different occasion's card), reads `plan.price` — **never a client-submitted amount** — creates a Razorpay order, and an `Order` document with `status: 'created'`.
2. Razorpay's Checkout widget runs client-side; on success, `verifyPayment` recomputes the HMAC-SHA256 signature from `razorpay_order_id|razorpay_payment_id` using the key secret and compares it to what the client sent. Mismatch → `markOrderFailed`. Match → `fulfillOrder`.
3. `fulfillOrder` is idempotent (`if (order.status === 'paid') return`) because both `verifyPayment` and the webhook can call it, in either order, possibly twice. It sets `order.status = 'paid'`, sets `card.status = 'paid'`, `card.plan`, `card.paidAt`, and `card.expiresAt = now + plan.validityDays`, then emails the owner the share link.
4. `handleWebhook` is a backup path — Razorpay calls it independent of whether the browser ever got to run `verifyPayment` (closed tab, lost connection). Verified against `RAZORPAY_WEBHOOK_SECRET` (a *different* secret from the key pair) over the **raw request body** (mounted with `express.raw()` *before* `express.json()` in `app.js`, since signing requires the exact bytes Razorpay sent).
5. Refunds: `adminController.refundOrder` calls `razorpay.payments.refund()` for the full amount, then sets `order.status = 'refunded'`. Only possible from `status: 'paid'`.

### 7.4 Public card page, per occasion

`publicController.viewCard`: loads the card by slug with `status: 'paid'` and `isDisabled: { $ne: true }` (note: `$ne: true`, not `isDisabled: false` — a strict-equality filter would silently exclude every card created before the field existed, since Mongo's query matching treats "field missing" differently from "field equals false"). 404 if not found/disabled, 410 if `expiresAt` has passed.

- Birthday with a future `birthdayDate` → renders a **countdown page** instead of the full experience.
- Otherwise renders `public/card` (birthday) or `public/card-proposal` (proposal) — the real engine, same templates `adminController.previewTemplate` and `publicController.getDemo` reuse for admin/demo previews with dummy data and `isPreview: true` (which also suppresses the tracking script, the `/opened` beacon, and the response endpoint).
- View counting does **not** happen here — it happens client-side via the tracking beacon (§7.6), specifically so bot/owner/admin page loads never get counted.

### 7.5 Proposal response + notifications

- `respondToProposal`: idempotent (`if (card.respondedYes) return { alreadyResponded: true }` — only the first YES is ever saved). Saves `respondedYes`, `respondedAt`, and a client-reported `noAttempts` (clamped 0–9999, since it's a lighthearted stat, not a security value).
- On both this and `markOpened` (first tap), the flow is: **always** create a `Notification` document (bell icon, never gated), then **conditionally** send an email — only if the owner's `notifyOn*` preference is on **and** Settings → Features → `emailNotificationsEnabled` is on (the global kill switch ANDs with the per-user toggle).
- `markOpened` picks the right display name per occasion (`partnerName` for proposal, `recipientName` for birthday) since both `card.ejs` and `card-proposal.ejs` call the same endpoint.

### 7.6 View and event tracking

Client script: `public/js/tracking.js`, loaded on real public card pages only (never on `/demo/:slug` previews, and not at all if Settings → Features → `cardViewTrackingEnabled` is off). Generates a `sessionId`, fires `card_opened` on load, exposes `window.CelebraTrack.event(type)` wired into each occasion's key moments, and sends a `time_spent` beacon via `navigator.sendBeacon` on page hide.

Server: `POST /api/track` (`trackingController.track`). For every valid event it writes a `CardEvent` row. For `card_opened` specifically it also:
- Hashes the IP with today's date (`utils/tracking.hashIp`) and checks whether that hash has been seen for this card before → `isUnique`.
- Looks up device/browser/OS (`ua-parser-js`) and approximate city/country (`geoip-lite`).
- Creates a `CardView` row and increments `Card.totalViews` (always) and `Card.uniqueViews` (only if unique), and sets `lastOpenedAt`.

**What's excluded from tracking** (checked in `trackingController.track`): requests whose user-agent `isbot()` flags as a bot; the card's own owner viewing while logged in; any logged-in admin. These are silently no-op'd (still `204`), not visibly rejected.

### 7.7 Card expiry and cron

`jobs/expiryCron.js`, scheduled once a day at 09:00 server time (`node-cron`, started from `app.js` after the DB connects):
- Emails the owner once, ~2 days before `expiresAt`, de-duped by `expiryReminderSentAt`.
- Logs (doesn't act on) a count of already-expired paid cards — expiry itself is never a stored "expired" status; every place that displays card status computes `expired` on the fly from `status === 'paid' && expiresAt < now`, specifically so it can never drift out of sync with `expiresAt`.

---

## 8. Admin panel pages

| Page | What it does |
|---|---|
| **Dashboard** | Date-range filter (today/7d/30d/month/custom). 9 stat cards, each showing a real period-over-period % change. Charts: revenue, card views, new users (all last-30-days), cards-by-occasion. Tables: latest orders, latest cards, most-viewed cards. |
| **Analytics** | Same date-range filter. Views by device/browser/source (doughnut charts), top countries/cities, a day-of-week × hour-of-day busiest-times heatmap, a birthday funnel (opened→tapped→candles→letter), a proposal funnel (opened→question→YES) with average NO-attempts, a visitor funnel (landing visits→signups→cards created→paid, using `PageView`), and top templates by cards-created / by revenue. |
| **Cards** | Site-wide list with search (recipient/partner name, owner email, slug) and occasion/status/template/date filters, CSV export. Detail page: full card info, owner, payment, a 30-day views chart, a raw view log, and the full event timeline. Actions: extend expiry, enable/disable (public link 404s while disabled — paid cards aren't touched otherwise), delete. |
| **Users** | Search/filter/pagination, CSV export. Detail page: profile, all their cards, their paid orders, total spent, last login. Actions: block/unblock, delete, send a password-reset email, "log in as this user" (full session impersonation, always logged to the audit log, reversible via a "Return to admin" banner that posts to `/stop-impersonating`). |
| **Orders** | Filter by status/occasion/date, CSV export, Razorpay refund button (only on `status: 'paid'` orders). |
| **Templates** | CRUD (colors, font pair, music tracks, enabled sections, stickers for proposal templates, live preview using the real public card engine with dummy data), usage counts (cards created from each), CSV export. |
| **Plans** | CRUD (price, features, validity, max photos, music allowed, "most popular" flag — only one per occasion), `analyticsLevel` (basic/full), usage counts (orders per plan), CSV export. |
| **Reviews** | Moderation queue — approve/unapprove/delete, CSV export. The landing page's reviews section only ever shows once ≥3 are approved; no seed/fake reviews exist. |
| **Settings** | 9 tabs — see §10 in full. |
| **Audit log** | Every logged admin action: who, what, target, details, when. Linked from the bottom of the Settings page. |

---

## 9. User (customer) panel pages

| Page | What it does |
|---|---|
| **My cards** (`/dashboard`) | Every card the user owns, with total/unique views, a "last opened Xago"-style relative label, and occasion-specific status text (proposal: "Waiting for answer" / "Said YES 💖 on [date]"). Links to continue editing a draft, view the live link, open card analytics, or delete. |
| **Card builder** | The wizard described in §7.2. |
| **Checkout / My orders** | Pay for a card, see payment history, download PDF invoices. |
| **Card analytics** (`/dashboard/cards/:id/stats`) | Ownership-checked (a non-owner gets a 404). Stat cards: total views, unique visitors, first/last opened, average time spent. A 30-day views chart. Birthday: whether candles were blown, whether the letter was read, replay count. Proposal: YES time + NO-attempt count. **If the card's Plan has `analyticsLevel: 'basic'`**, device/city breakdown and the recent-activity list are hidden — only the stat cards and views chart show, with a "Basic analytics" badge. |
| **Profile** | Name/phone, password change, and the two email-notification toggles (card opened / proposal YES — these control email only, not the bell icon). |
| **Notification bell** (topbar, all dashboard pages) | Unread-count badge, dropdown fetched from `/api/notifications`, marked read via `/api/notifications/read`. |

---

## 10. Settings and feature toggles

Everything lives in the single `Setting` document (`models/Setting.js`), cached in memory (invalidated on every save), and loaded into **every** view as `res.locals.settings` via `middleware/locals.js` (`Setting.getSingleton()`, which never includes the encrypted secret fields). `settingsController.getSingletonWithSecret()` is the only path that decrypts secrets, used solely where the credential is actually needed (payment calls, SMTP transport, the Settings form's own masked display).

| Tab | Save route | Fields |
|---|---|---|
| **General** | `/admin/settings/general` | siteName, tagline, logoLight/logoDark/favicon/ogImage (uploaded images), primaryColor, accentColor, currencyCode, currencySymbol, timezone, dateFormat |
| **Contact** | `/admin/settings/contact` | supportEmail, contact.phone/whatsappNumber/address, social.instagramUrl/facebookUrl/twitterUrl/youtubeUrl |
| **Homepage** | `/admin/settings/homepage` | homepage.heroHeadline/heroSubline (overrides `config/landingContent.js` field-by-field), homepage.faq (add/edit/reorder array), homepage.announcementText/announcementLink |
| **SEO** | `/admin/settings/seo` | seo.metaTitle/metaDescription/metaKeywords/googleAnalyticsId/metaPixelId |
| **Features** | `/admin/settings/features` | the 10 toggles below, plus maintenanceMode |
| **Payments** | `/admin/settings/payments` | razorpayKeyId, razorpayKeySecret (encrypted, blank = keep existing), razorpayMode (test/live), gstPercentage, invoiceBusiness.name/address/gstNumber |
| **Email** | `/admin/settings/email` + `/email/test` | smtp.host/port/user/password (encrypted, blank = keep existing)/fromName/fromEmail, plus a "send test email" action |
| **Uploads** | `/admin/settings/uploads` | uploads.maxPhotoSizeMB, uploads.allowedFileTypes, uploads.maxPhotosPerCard — enforced live by `middleware/dynamicPhotoUpload.js` on the customer wizard's photo uploads (admin thumbnail/logo uploads stay on fixed limits in `middleware/upload.js`) |
| **Legal pages** | `/admin/settings/legal` | legal.termsHtml/privacyHtml/refundPolicyHtml, edited with a Quill rich-text editor, sanitized server-side (`sanitizeHtml` with a permissive-but-bounded tag list) before save |

Every save on every tab calls `logAdminAction` (audit log) and redirects back to the same tab (`?tab=...`).

### Feature toggles and what each one actually affects

| Toggle | Effect |
|---|---|
| `birthdayEnabled` / `proposalEnabled` | Hides that occasion from the landing page (hero buttons, occasion cards, demo tabs, pricing tabs, final CTA), the navbar links, and the builder's occasion picker. Enforced server-side too (`postNewCard` rejects creating a new card for a disabled occasion). **Already-paid cards of that occasion keep working** — this only blocks starting new ones. |
| `registrationsOpen` | Off → `/register` shows a "registrations closed" page instead of the form; `postRegister` also rejects directly. |
| `reviewsEnabled` | Off → the landing page's reviews section never renders, regardless of approved-review count. |
| `announcementBarEnabled` | Shows the top announcement bar (text + optional link from the Homepage tab) above the navbar. |
| `whatsappButtonEnabled` | Shows a floating WhatsApp button (`wa.me/<contact.whatsappNumber>`) on pages that include the navbar partial. |
| `cardViewTrackingEnabled` | Global kill switch for the whole tracking pipeline — `trackingController.track` no-ops, and the tracking `<script>` tag isn't even rendered on public card pages. |
| `emailNotificationsEnabled` | Global kill switch, ANDed with each user's own `notifyOnCardOpened`/`notifyOnProposalYes` — both must be on for that email to actually send. The bell notification is unaffected either way. |
| `demoPreviewsEnabled` | Off → `/demo/:templateSlug` 404s directly (not just hidden buttons), and the landing page's "Try demo"/"Preview" buttons and whole Live Demos section don't render. |
| `poweredByFooterEnabled` | Shows "Made with [siteName]" under the owner's message on the public card's ending screen (both occasions). |
| `maintenanceMode` | Non-admin traffic sees a 503 maintenance page (`middleware/maintenance.js`); admins are unaffected. |

---

## 11. Theme and design

- **Tailwind config** (`tailwind.config.js`): custom `cream` (#FFFBF4), `amber` (50/100/500/600/700 — the primary brand color) and `rose` (400/500/600 — the secondary/proposal accent) palettes; `display` font family (Fredoka, falls back to `ui-rounded`) for headings, `body` font family (Nunito Sans) for text; a custom `xl2` border-radius (1.25rem) used throughout as the standard "card" rounding.
- Tailwind scans `./views/**/*.ejs` and `./public/js/**/*.js` for class names (`content` config) — a class that only exists inside a JS template string won't be picked up unless it also appears literally somewhere Tailwind scans.
- **Layouts** (`views/layouts/`): `main-head/foot` (plain centered pages — auth, legal), `dashboard-head/foot` (sidebar + topbar, used by every `/dashboard` and `/admin` page, includes the impersonation banner), `landing-head/foot` (full-bleed, no centering wrapper, so landing-page sections can go edge-to-edge — deliberately separate from `main-head/foot`).
- **Partials** (`views/partials/`): `navbar` (also renders the announcement bar and floating WhatsApp button when enabled), `footer`, `sidebar` (switches its link list by role), `topbar` (notification bell), `flash`, `head` (shared `<head>` tags), `share-tools` (copy link / WhatsApp / QR), `wizard-steps` / `wizard-steps-proposal` (step indicators for each wizard).
- **Animation**: GSAP + canvas-confetti, loaded via CDN **only** on the public card pages (`views/public/card.ejs`, `card-proposal.ejs`) and the landing page (GSAP ScrollTrigger for scroll reveals) — never bundled into the main app CSS/JS pipeline.
- **How a Template applies its own look**: `Template.colorTheme` (primary/secondary/background) is injected as CSS custom properties (`--primary`, `--secondary`, `--background`) in the card page's inline `<style>` block; `Template.getFontPair()` picks heading/body Google Fonts loaded per-request; `Template.musicTracks`/`stickers` are the options a card owner picks from in the builder, stored on the `Card` once chosen (`card.music`, `card.sticker`).

---

## 12. Environment variables (`.env.example`)

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` — controls cookie `secure` flag and morgan's log format. |
| `PORT` | Port the server listens on. |
| `APP_NAME` | Fallback app name if Settings → siteName isn't set. |
| `BASE_URL` | Full public URL (no trailing slash) — used for share links, QR codes, OG tags, email links. |
| `MONGO_URI` | MongoDB connection string. |
| `TRUST_PROXY_HOPS` | How many reverse-proxy hops Express trusts for the real client IP (`app.set('trust proxy', ...)`). **Security-critical, not just a networking detail** — get it wrong and either IP-based rate limiting/report-abuse logic (§16) becomes spoofable (set too high with no real proxy in front) or becomes shared across all visitors behind one proxy IP (set too low with a real proxy in front). `0` = no reverse proxy at all; `1` = exactly one (a single Nginx box, or most single-layer hosting platforms); `2+` = a CDN in front of another proxy/LB. Defaults to `1` if unset, matching this app's previous hardcoded value — verify that's actually true for your deployment, don't assume it. |
| `SESSION_SECRET` | Signs the session cookie. |
| `ENCRYPTION_KEY` | Encrypts Razorpay/SMTP secrets at rest in Settings. Falls back to `SESSION_SECRET` if unset — set a dedicated value in production. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay API credentials — fallback only; the admin Settings → Payments value always wins when set. |
| `RAZORPAY_WEBHOOK_SECRET` | Separate webhook-only secret, not admin-overridable. |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Used only by `npm run seed:admin` to create the first admin account. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM_EMAIL` | SMTP credentials — fallback only; Settings → Email always wins when a host is set there. If no host is configured anywhere, outgoing mail is logged to the console instead of sent. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | If all three are set, uploads go to Cloudinary; otherwise they fall back to local disk at `public/images/uploads/` (fine for dev, not for most production hosts with an ephemeral filesystem). |

---

## 13. Security

- **Auth**: bcrypt-hashed passwords (cost 12), session-based (not JWT). `isAuthenticated`/`isUser`/`isAdmin` middleware guard every protected route; blocked users (`isBlocked`) are rejected at login.
- **Sessions**: `express-session` stored in MongoDB via `connect-mongo`, `httpOnly`, `sameSite: 'lax'`, `secure` in production, 7-day `maxAge`.
- **CSRF**: a hand-rolled session-bound synchronizer token (`middleware/csrf.js`) — not the `csurf` package, which is deprecated with open advisories. Every form carries a hidden `_csrf` field; AJAX calls (like the notification bell) send it as an `X-CSRF-Token` header instead. Exempt paths (no session to bind a token to): the Razorpay webhook, and the public card beacons (`/opened`, `/respond`, `/api/track`). Multipart/upload routes run the check again *after* multer parses the body (`verifyTokenAfterUpload`), since it's unparseable before that point.
- **Validation**: `express-validator` on every form-accepting route, with a shared `middleware/validate.js` that flashes the first error and redirects back to the referring page.
- **Rate limiting** (`middleware/rateLimiter.js`): a generous global limiter on everything, a tighter one on auth routes, one on payment endpoints, one on the public card-opened beacon, one on the tracking beacon.
- **Encrypted settings**: `razorpayKeySecret` and `smtp.password` are AES-256-GCM encrypted at rest (`utils/crypto.js`), `select: false` in the schema, masked in the admin UI (blank input = keep existing value).
- **Upload rules**: every image (card photos, template thumbnails, site logos) is re-encoded through `sharp` before storage — this both compresses it and validates the bytes are an actually-decodable image, independent of the claimed file extension/mimetype. Customer photo uploads enforce live admin-set size/type/count limits (`middleware/dynamicPhotoUpload.js`); Multer errors (too large, too many files) are translated into friendly messages by `middleware/errorHandler.js` instead of a generic 500.
- **Ownership checks**: every `/dashboard/cards/:id/*` route scopes its query to `{ _id: req.params.id, user: req.session.userId }` — a card ID alone is never enough to read or write it. Payment amount is always read server-side from the Plan, never trusted from the client, and the plan's occasion is cross-checked against the card's occasion at order-creation time.
- **Other**: Helmet CSP (see `app.js` for the exact directive list — `'unsafe-inline'` is a known, documented tradeoff for the inline `<script>`/`onclick` attributes used throughout the views), `sanitize-html` on the rich-text letter message and the admin-authored legal pages, CSV exports escape values that start with `=+-@` to prevent formula injection when opened in Excel/Sheets, IP addresses are hashed (never stored raw) for view-uniqueness tracking.

---

## 14. Coding rules for future work

- Follow the existing **MVC-ish split**: routes wire middleware + a controller function; controllers do the work and call `res.render`/`res.json`/`res.redirect`; views only display what they're given. Keep business logic out of `.ejs` files beyond simple conditionals/loops.
- Every controller function is `async` and wrapped in `catchAsync` (`utils/catchAsync.js`) so a rejected promise reaches the central error handler instead of crashing the process. Throw `new AppError(message, statusCode)` for operational errors (bad input, not found, etc) — `errorHandler` only shows the message to the user when `error.isOperational` is true.
- Validate every form-accepting route with `express-validator` + the shared `validate` middleware.
- **Never break existing cards, links, or payments.** A schema change needs a migration if anything queries the new/renamed field directly against MongoDB (not just through Mongoose hydration, which does apply defaults in-memory on read but never writes them back) — see `migrations/migrateOccasion.js` and `migrations/migrateCardTracking.js` for the pattern, and prefer `{ field: { $ne: true } }` over `{ field: false }` when a boolean might be entirely absent on older documents.
- **Never trust a price from the client.** Always read `plan.price` server-side at order-creation time, and cross-check `plan.occasion === card.occasion`.
- All designs, illustrations, and animations must be original or properly licensed — the existing SVG assets (balloons, cakes, stickers, the OG image) were all hand-authored or generated with `sharp`, nothing is stock art.
- **Add new occasions through the `occasion` field**, not a separate app/codebase — see §15.
- **Update this file (`CLAUDE.md`) in the same change** whenever you add a model, route, settings field, or feature toggle — it's the only reference a future session has.
- Watch for the **`router.use()` leak**: a path-less `router.use(middleware)` on a router mounted at `'/'` runs on every request that reaches it, including ones meant for a router registered later — this has bitten this codebase more than once. Apply guards per-route (as an array, e.g. `const guard = [maintenanceGate, isAuthenticated, isUser]`) on routers mounted at `/`, not via `router.use`.
- Watch for the **GSAP inline-style trap**: `gsap.to()`/`gsap.fromTo()` sets an inline style that outranks a CSS class rule of the same property — removing a class doesn't undo a GSAP-set style; use `gsap.set()` to explicitly reset it.

---

## 15. How to add a new occasion (e.g. "Anniversary")

1. **`utils/occasions.js`** — add `'anniversary'` to `OCCASIONS`. `DEFAULT_OCCASION` can stay `'birthday'` unless you want otherwise. `getEnabledOccasions()` needs a new entry in `FEATURE_FLAG_BY_OCCASION` (e.g. `anniversary: 'anniversaryEnabled'`).
2. **`models/Setting.js`** — add the corresponding `features.anniversaryEnabled` Boolean (default `true`), and wire a checkbox for it into the Features tab in `views/admin/settings.ejs` + `settingsController.updateFeatures`'s `FEATURE_KEYS` array.
3. **`models/Card.js`** — add whatever occasion-specific fields the new experience needs, following the existing pattern: not schema-`required: true`, but `required: function() { return this.occasion === 'anniversary' }` (see `requiredForProposal`), since cards are built progressively and the field won't exist on a fresh draft.
4. **Public card engine** — add `views/public/card-anniversary.ejs` (or branch inside `card.ejs` if it's similar enough to birthday), following the same structure as `card.ejs`/`card-proposal.ejs`: GSAP screen sequence, the `window.__CARD_SLUG__` + `tracking.js` include gated by `isPreview`/`cardViewTrackingEnabled`, the `/c/:slug/opened` beacon call, the "Made with [siteName]" footer gated by `poweredByFooterEnabled`. Branch `publicController.viewCard` to render it.
5. **Builder wizard** — add `getAnniversaryX`/`postAnniversaryX` steps to `cardController.js` and matching routes in `userRoutes.js`, plus `views/user/wizard-anniversary-*.ejs`, following the proposal wizard's steps as a template. Update `FIRST_STEP_BY_OCCASION` in `cardController.js`.
6. **Admin** — Templates/Plans already support any occasion in `OCCASIONS` with no further change (the `occasion` dropdown is generated from that array everywhere). Add starter templates via a new `seed/seedAnniversaryTemplates.js` if you want seed data, following `seedProposalTemplates.js`.
7. **Tracking** — if the new occasion needs its own funnel steps, add them to `EVENT_TYPES` in `utils/trackingEvents.js` and extend the funnel aggregation in `adminController.getAnalytics`.
8. **Landing page** — add an entry to `content.occasions` in `config/landingContent.js` (label/emoji/tagline/description/includes) so the occasion card, demo tab, and pricing tab render correctly; `views/public/landing.ejs` already iterates `enabledOccasions` generically, so no template change should be needed there.
9. **Migration** — if you're adding this to a live database with existing Cards, write a migration backfilling `occasion` the same way `migrations/migrateOccasion.js` does (not needed for a brand-new occasion with no prior data).
10. Run through the full checkout flow once (builder → payment → public page → tracking → admin dashboards) before shipping, since the dashboards' occasion-grouped charts/funnels assume every occasion in `OCCASIONS` is representable.

---

## 16. Interactive Surprise Cards (free, no-login)

A second, deliberately separate card system, parallel to everything above. No account, no payment, no Template/Plan/Order — anyone can build and send one. It shares only the lowest-level infrastructure with the paid system (Express/Mongoose/EJS, `middleware/csrf.js`, `middleware/maintenance.js`, `utils/mediaStorage.js`, `middleware/dynamicPhotoUpload.js`). Four card types exist today: **Apology**, **Anniversary**, **Puzzle** (a sliding/swap photo puzzle hiding a message), and **Friendship**.

### Model: `SurpriseCard` (`models/SurpriseCard.js`)

| Field | Type | Notes |
|---|---|---|
| slug | String | required, unique, indexed — `generateCardSlug()` |
| type | String enum (`utils/surpriseCardTypes.js` → `SURPRISE_CARD_TYPES`) | `'apology' \| 'anniversary' \| 'puzzle' \| 'friendship'` |
| senderName, recipientName | String | required, max 30 |
| fields | Mixed | everything type-specific — see below. Adding a new type never needs a schema migration, since it just starts writing new keys here |
| photos | [String] | sharp-validated/resized like every other upload in this app |
| openedAt | Date | set the first time the recipient opens `/c/:slug` (shared across all four types, in `viewSurpriseCard`) |
| recipientAnswer, answeredAt | String, Date | generic "final decision" slot — Apology/Anniversary use `'yes' \| 'not_yet'`, Puzzle sets `'solved'` once solved |
| resultsKey | String | required, random — gates the sender's private `/c/:slug/results` page; the recipient's own link never contains it |

`fields` shape per type:
- **apology**: `moodCharacter`, `sorryText`, `whyMatterText`, `finalQuestion`, `forgiveMessage`
- **anniversary**: `togetherDate`, `anniversaryNumber`, `illustrationStyle`, `letterText`, `loveLines[]`, `timeline[]` (`{dateOrLabel, caption, photo}`)
- **puzzle**: `difficulty`, `gridSize`, `hiddenMessage`, `questions[]` (`{text, type, options?}`), `answers` (object keyed by question index), `solveStats` (`{moves, timeSeconds, peeks}`), `liveProgress` (`{moves, timeSeconds, updatedAt}` — overwritten at most every ~5s while playing, read by the sender's live results polling)
- **friendship**: `youAvatar`, `friendAvatar`, `friendsSinceYear`, `message`, `insideJokes[]`, `quiz[]` (`{question, options[], correctIndex}`), `quizResult` (`{score, total, completedAt}`)

### Routes (`routes/publicRoutes.js`, mounted at `/`)

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/cards/style-guide` | — | Design-system demo page |
| GET/POST | `/cards/apology/create` | POST: `cardCreateLimiter`, `dynamicPhotoUpload` (flat `photos`, ≤3), `verifyTokenAfterUpload` | Apology creation form + submit |
| GET/POST | `/cards/anniversary/create` | POST: `cardCreateLimiter`, `dynamicPhotoUpload.any(8)` | Anniversary creation form + submit (one optional photo per timeline moment) |
| GET/POST | `/cards/puzzle/create` | POST: `cardCreateLimiter`, `dynamicPhotoUpload` (single required photo, client-cropped to a square) | Puzzle creation form + submit |
| GET/POST | `/cards/friendship/create` | POST: `cardCreateLimiter`, `dynamicPhotoUpload.any(8)` | Friendship creation form + submit (flat `photos`, ≤8 — `.any()` used here specifically because the default export's cap comes from Settings → Uploads → max photos per card, 6 by default, which is lower than the 8 this type promises) |
| GET | `/c/:slug` | — | `publicController.viewCard` runs first and calls `next()` when the slug isn't a paid Card, falling through to `surpriseCardsController.viewSurpriseCard` — one URL shape serves both systems |
| GET | `/c/:slug/results` | — | Sender-only status page, gated by `?key=` against `resultsKey` |
| GET | `/c/:slug/results/live` | — | JSON, polled every 5s by the Puzzle results page only — live moves/time/peeks + a "recipient active right now" flag |
| POST | `/c/:slug/answer` | `openedLimiter` | Apology/Anniversary's Yes/Not-yet answer |
| POST | `/c/:slug/solve` | `openedLimiter` | Puzzle: records final solve stats, once |
| POST | `/c/:slug/answer-question` | `openedLimiter` | Puzzle: saves one post-solve question's answer |
| POST | `/c/:slug/progress` | `trackLimiter` | Puzzle: live progress beacon, at most once every ~5s (4s floor enforced server-side too) |
| POST | `/c/:slug/quiz-score` | `openedLimiter` | Friendship: saves the final quiz score |

### Controller: `controllers/surpriseCardsController.js`

One file for the whole system. `viewSurpriseCard` is the shared dispatcher (looked up by `type`, records `openedAt` once, renders the right `*-recipient` view); every other exported function is either a `get*Create`/`post*Create` pair (one per type) or a small single-purpose save endpoint (`answerSurpriseCard`, `solvePuzzleCard`, `answerPuzzleQuestion`, `recordPuzzleProgress`, `getPuzzleLiveStatus`, `saveFriendshipQuizScore`, `getSurpriseCardResults`).

### Views

- `views/public/style-guide.ejs` — the shared design system's own demo page.
- `views/public/{apology,anniversary,puzzle,friendship}-create.ejs` — one creation form per type, each with its own live preview and a loading→share overlay.
- `views/public/{apology,anniversary,puzzle,friendship}-recipient.ejs` — the actual multi-screen recipient experience per type.
- `views/public/surprise-card-results.ejs` — generic sender-only status page, shared by all four types; branches on `card.type` for the puzzle's live-polling behavior (every other type gets a plain 30s auto-reload).
- `views/partials/mood-character-svg.ejs`, `couple-illustration-svg.ejs`, `friend-avatar-svg.ejs` — original, hand-authored SVG illustrations/avatars specific to Apology, Anniversary, and Friendship respectively.

### Shared design system

- `public/css/cards.css` — hand-authored stylesheet (not run through the Tailwind build), CSS custom properties for colors/durations, loaded directly via `<link>` on every surprise-card page. Includes a blanket `overflow-wrap`/`word-break` rule scoped to `.sc-screen-container *` so a single long unbroken word (any script) never overflows a narrow screen.
- `public/js/cardComponents.js` — `window.SurpriseCard`, exposing 10 small vanilla-JS components: `createScreenContainer`, `wireTapToContinue`, `startFloatingHearts`, `startFloatingBokeh`, `startFloatingEmojis`, `burstConfetti`, `createEnvelopeLetter` (now has a `reset()` method so a "watch again"-style replay can reopen it), `createPhotoPolaroids`, `createSoundToggle`, `wireShareScreen`. Every animated component no-ops (or drops to zero) under `prefers-reduced-motion`; `startFloatingEmojis` additionally enforces a hard `maxConcurrent` ceiling (default 15) independent of its spawn interval, so a throttled/backgrounded tab's timers can't burst-spawn past it once the tab is visible again.

### What's tracked (and what isn't)

This system does **not** use `CardView`/`CardEvent` (those are the paid system's analytics tables) and has no admin-visible analytics at all. Every signal lives directly on the `SurpriseCard` document itself: `openedAt`, `recipientAnswer`/`answeredAt`, and the type-specific `fields.solveStats` / `fields.liveProgress` / `fields.quizResult` / `fields.answers` described above. The only place any of this is ever displayed back is the sender's own `/c/:slug/results` page.

### Settings and admin

**No Settings tab, feature toggle, or admin page exists for this system at all.** It doesn't read `Setting.getSingleton()` for anything except indirectly through the shared `dynamicPhotoUpload` middleware (photo size/type limits only), and `maintenanceMode` still blocks it like every other public route. There is currently no way to disable a card type, no admin list/search/delete for `SurpriseCard` documents, and no site-wide view count or funnel for this system — the only way to inspect or remove one today is a direct database query.

### Homepage and navigation

`views/partials/navbar.ejs` has a "Cards" link to `/#surprise-cards`; `views/public/landing.ejs` has a horizontally-scrollable "Surprise Cards" teaser section with live mini-previews. That section currently only features **Birthday and Apology** — it predates Anniversary, Puzzle, and Friendship and hasn't been extended to include them (see §17).

---

## 17. Known issues, TODOs, and "Not built yet"

**Not built yet:**
- No automated test suite (unit or integration) exists anywhere in the repo.
- No CI/CD configuration.
- No public API for third-party integrations — everything is server-rendered EJS.
- No multi-currency support beyond the `currencyCode`/`currencySymbol` display fields in Settings — pricing math and Razorpay are INR-only.
- No way to edit a card's content after it's paid (by design — see the FAQ in `config/landingContent.js`: "reach out to support").
- No public API docs, SDK, or webhook-out system for customers.
- Legal pages (Terms/Privacy/Refund) ship with clearly-labeled **placeholder** text until an admin fills in real copy via Settings → Legal pages.
- **Interactive Surprise Cards (§16) has no admin surface at all** — no list/search/detail/delete for `SurpriseCard` documents, no way to disable a card type or the system as a whole, no analytics. Everything is reachable only directly in the database.
- The homepage's "Surprise Cards" teaser row (§16) still only shows Birthday and Apology — Anniversary, Puzzle, and Friendship aren't featured there yet.
- Puzzle's drag-and-drop tile swap is a desktop-mouse convenience only — native HTML5 drag-and-drop generally doesn't fire on touch-only mobile browsers. Tap-to-swap (the primary interaction) works fully on mobile and is sufficient on its own to solve the puzzle.
- Friendship's "Save badge" PNG download has never been verified on a real Android or iPhone device (no browser/device available in this development environment) — it degrades to `canvas.toDataURL()` when `toBlob` is unavailable and shows an inline error if the badge image fails to decode, but the real-device download UX itself (e.g. iOS Safari's handling of a programmatic `<a download>` click) is unconfirmed.

**Known rough edges:**
- `middleware/upload.js` (admin thumbnails/logos) still has fixed 5MB/jpg,png,webp limits, independent of the Settings → Uploads tab, which only governs the *customer* wizard's photo uploads.
- `Setting.getSingleton()`'s in-memory cache is per-process — running multiple app instances behind a load balancer without a shared cache invalidation mechanism means a settings change may take a moment to reach every instance (each instance's own cache still gets invalidated on *its own* writes, but not on a write made via a different instance). Not an issue for a single-process deployment.

---

## 18. Changelog

A short, dated history of major features as they were added (dates reflect when each feature was built in this project's development, not calendar reality for every reader):

- **Initial build**: Project foundation — MVC structure, MongoDB/session/security middleware, Tailwind theme, User model, auth, admin panel skeleton, Template system, customer card builder (birthday only), Razorpay payments, the public card page with GSAP/confetti animations, sharing tools (link/WhatsApp/QR), scheduled reveal countdown, card-opened email notification, admin analytics, expiry-reminder cron job, CSRF/rate-limiting/upload hardening.
- **Multi-occasion support**: Added the `occasion` field across Template/Card/Plan, the Love Proposal experience (question + runaway NO button + celebration + YES notification), occasion-aware admin panel and customer builder, `migrations/migrateOccasion.js`.
- **Landing page redesign**: Full rebuild of the public landing page (hero, dual-occasion sections, live demo previews, pricing tabs, FAQ, reviews gated at ≥3 approved) backed by `config/landingContent.js` and the new `Review` model.
- **View/event tracking system**: `CardView`/`CardEvent` models, the `/api/track` beacon and client script, device/geo/referrer detection, bot/owner/admin exclusion, `migrations/migrateCardTracking.js` (renamed `Card.views` → `totalViews`, added `uniqueViews`).
- **Admin panel upgrade**: Dashboard date-range filtering with period-over-period % change, a new Analytics page (funnels, heatmap, device/location breakdowns), full Cards admin section with detail pages and admin actions (extend expiry, disable, delete), expanded Users section (reset-password email, login-as impersonation), order refunds, CSV export everywhere, the `AuditLog` model and audit logging across every sensitive admin action.
- **Customer analytics**: Per-card analytics page (`/dashboard/cards/:id/stats`), the `Notification` model + dashboard bell icon, per-user email-notification preferences, plan-gated (`basic`/`full`) analytics detail.
- **Admin Settings overhaul**: The 9-tab Settings system described in §10 — Setting model restructure, in-memory caching, AES-256-GCM secret encryption, live feature toggles, admin-editable homepage content/SEO/legal pages, dynamic upload limits, SMTP-from-Settings, test-email button.
- **This file**: `CLAUDE.md` created to document the project as of all the above.
- **2026-11-12 — Interactive Surprise Cards**: a second, free, no-login card system added alongside the paid one described in §1–§15, covered in full in §16. `SurpriseCard` model, the shared design system (`public/css/cards.css` + `public/js/cardComponents.js`), and four complete card types end to end (creation form → multi-screen recipient experience → sender results page): **Apology** (mood character, final yes/no question with a runaway "not yet" cycle); **Anniversary** (countdown with leap-year handling, timeline, "things I love about you", a typed letter, a live years/months/days counter); **Puzzle** (an N×N tap-to-swap/drag-and-drop photo puzzle with a client-side crop tool, a move/timer HUD, post-solve questions, and live sender-side progress tracking over polling); **Friendship** (six original avatar illustrations, an optional quiz, a photo-and-inside-jokes scrapbook, a typed letter, and a downloadable PNG badge). Also added: the homepage's "Surprise Cards" teaser section and the navbar's "Cards" link (Birthday + Apology only so far — see §17).
