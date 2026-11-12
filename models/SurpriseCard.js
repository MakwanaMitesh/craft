const mongoose = require('mongoose');
const crypto = require('crypto');
const { SURPRISE_CARD_TYPES } = require('../utils/surpriseCardTypes');

// The new, free, no-login "Interactive Surprise Cards" system — intentionally
// separate from models/Card.js (the paid, account-bound Template/Plan/Order
// system under /dashboard). Anyone can create one of these with no sign-up;
// `fields` holds whatever is specific to a given `type` (e.g. Apology's mood
// character and final question), so adding a new type never needs a schema
// migration — it just starts writing new keys into `fields`.
const surpriseCardSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true }, // generateCardSlug() — random, 10+ chars
    type: { type: String, enum: SURPRISE_CARD_TYPES, required: true },
    senderName: { type: String, required: true, trim: true, maxlength: 30 },
    recipientName: { type: String, required: true, trim: true, maxlength: 30 },
    fields: { type: mongoose.Schema.Types.Mixed, default: {} }, // type-specific content
    photos: [{ type: String, trim: true }], // up to 3, sharp-validated/resized like every other upload in this app
    openedAt: { type: Date }, // set the first time the recipient opens /c/:slug
    recipientAnswer: { type: String }, // whichever final-question choice (or custom text) the recipient responded with
    answeredAt: { type: Date },
    // A second, separate secret for /c/:slug/results — the recipient has
    // the slug (it's in the link they were sent) but never this key, so
    // seeing the card itself gives no way to also see the sender's private
    // status page for it.
    resultsKey: { type: String, required: true, default: () => crypto.randomBytes(16).toString('hex') },

    // Admin moderation — mirrors Card.isDisabled's "kill-switch independent
    // of any other state" shape, since these cards have no status/expiresAt
    // of their own to piggyback on.
    isDisabled: { type: Boolean, default: false },
    // Set by the recipient-facing "Report this card" link (see
    // surpriseCardsController.reportSurpriseCard) — a lightweight flag for
    // the admin list, not a moderation queue of its own.
    isReported: { type: Boolean, default: false },
    reportedAt: { type: Date },
    reportCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('SurpriseCard', surpriseCardSchema);
