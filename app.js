require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const connectDB = require('./config/db');
const buildSessionMiddleware = require('./config/session');
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
// Railway, etc — see DEPLOYMENT.md) so Express reads the real client IP and
// protocol from X-Forwarded-* headers instead of the proxy's own loopback
// connection. Without this, per-IP rate limiting is useless (every request
// appears to come from the proxy) and req.secure is wrong behind TLS-terminating
// proxies. Harmless with no proxy in front (e.g. local dev) — only applies to
// a request so close to the app that we can trust the header.
app.set('trust proxy', 1);

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

connectDB()
  .then(() => {
    scheduleExpiryCron();
    app.listen(PORT, () => {
      console.log(`${process.env.APP_NAME || 'CelebraCraft'} running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
