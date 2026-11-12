const rateLimit = require('express-rate-limit');

// Baseline defense-in-depth for every request — generous enough that no
// real visitor should ever hit it, just here to blunt basic flooding.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

// Throttles login/register/password-reset attempts to slow down brute force
// and credential-stuffing attempts without affecting normal browsing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again in a few minutes.',
  handler(req, res) {
    // res.status(429).redirect(url) silently sends 302, not 429 — redirect()
    // always sets its own status unless given one explicitly as the first
    // argument, like this.
    req.session.flash = { type: 'error', message: 'Too many attempts. Please try again in a few minutes.' };
    res.redirect(429, req.headers.referer || '/login');
  },
});

// Payment endpoints: generous enough for a customer retrying a declined
// card a few times, tight enough to blunt scripted abuse of order creation
// or signature-verification guessing.
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({ success: false, message: 'Too many payment attempts. Please try again shortly.' });
  },
});

// The public "card opened" beacon has no session/auth, so without this an
// attacker could script repeated hits to spam the owner's inbox.
const openedLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({ success: false });
  },
});

// One card view fires several events (card_opened, tapped_open, a handful
// of step events, plus a closing time_spent beacon) — generous enough for
// genuine engagement, still tight enough to blunt scripted event flooding.
const trackLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({ success: false });
  },
});

// Interactive Surprise Cards are created with no login at all — without
// this, a script could flood the DB/upload storage with free cards.
const cardCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({ success: false, message: 'Too many cards created from this network. Please try again later.' });
  },
});

// "Report this card" — separate from openedLimiter (which every other free
// card action uses) since a report is a moderation signal, not a gameplay
// beacon, and deserves its own tighter ceiling independent of how much
// someone has already interacted with the card itself.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({ success: false, message: 'Too many reports from this network. Please try again later.' });
  },
});

module.exports = { generalLimiter, authLimiter, paymentLimiter, openedLimiter, trackLimiter, cardCreateLimiter, reportLimiter };
