require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const connectDB = require('./config/db');
const buildSessionMiddleware = require('./config/session');
const passport = require('./config/passport');
const injectLocals = require('./middleware/locals');
const { ensureToken, verifyToken } = require('./middleware/csrf');
const { generalLimiter } = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentController = require('./controllers/paymentController');
const { scheduleExpiryCron } = require('./jobs/expiryCron');

const app = express();

// Required whenever this app sits behind a reverse proxy (Nginx, Render,
// Railway, etc) so Express reads the real client IP and protocol from
// X-Forwarded-* headers instead of the proxy's own loopback connection.
// Without this, per-IP rate limiting is useless (every request appears to
// come from the proxy) and req.secure is wrong behind TLS-terminating proxies.
//
// This is NOT harmless to get wrong, in either direction:
//   - Set too high (or left at the default below) with NO real proxy in
//     front: a client can set X-Forwarded-For to anything it likes and
//     Express will believe it, making req.ip spoofable — defeating every
//     IP-based rate limit and the Surprise Cards report/auto-hide logic
//     (controllers/surpriseCardsController.js). Confirmed directly: with
//     this set to 1 and no real proxy present, `curl -H "X-Forwarded-For:
//     1.2.3.4"` makes req.ip report 1.2.3.4.
//   - Set too low (e.g. 0/false) with a real proxy in front: every
//     visitor appears to share the proxy's own IP, so rate limits and
//     per-IP report counting apply collectively to all of them instead of
//     individually — unrelated users can trip each other's limits.
// TRUST_PROXY_HOPS must therefore match your actual deployment exactly —
// see CLAUDE.md's Environment variables table and .env.example for how to
// count hops (0 = no proxy at all, direct internet exposure; 1 = exactly
// one reverse proxy/load balancer directly in front of this process; 2+
// for a CDN-then-LB stack). Defaults to 1 only to preserve this app's
// previous hardcoded behavior — verify it against your real setup rather
// than trusting that default.
const trustProxyHops = process.env.TRUST_PROXY_HOPS !== undefined ? Number(process.env.TRUST_PROXY_HOPS) : 1;
app.set('trust proxy', trustProxyHops);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' is required because views use inline <script> blocks
        // and inline event-handler attributes (onclick, onsubmit) throughout —
        // without it, a real browser silently blocks all of that JS (curl-based
        // testing never catches this, since curl doesn't enforce CSP at all).
        // A stricter setup would move to nonces/hashes per script tag instead.
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com', 'https://cdn.jsdelivr.net'],
        frameSrc: ["'self'", 'https://api.razorpay.com'],
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'], // photos/thumbnails/logo may be served from Cloudinary instead of locally
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        mediaSrc: ["'self'", 'https:'], // template music tracks may point at any https host the admin configures
        connectSrc: ["'self'", 'https://api.razorpay.com'],
      },
    },
  })
);
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Must come before express.json(): webhook signature verification needs the
// exact raw bytes Razorpay signed, not a re-serialized parsed object. No
// session/auth here either — this is a server-to-server call from Razorpay.
app.post('/payments/webhook', express.raw({ type: 'application/json' }), paymentController.handleWebhook);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(buildSessionMiddleware());
// No app.use(passport.session()) — this app's own session fields
// (req.session.userId/userName/role) are the only session state used
// anywhere; passport here is just the Google OAuth handshake (see
// config/passport.js and routes/authRoutes.js), not a second session layer.
app.use(passport.initialize());
app.use(generalLimiter);
app.use(injectLocals);
app.use(ensureToken);
app.use(verifyToken);

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

let server;

connectDB()
  .then(() => {
    scheduleExpiryCron();
    server = app.listen(PORT, () => {
      console.log(`${process.env.APP_NAME || 'CelebraCraft'} running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

function shutdown() {
  if (server) {
    server.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
