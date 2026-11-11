const mongoose = require('mongoose');
const { OCCASIONS, DEFAULT_OCCASION } = require('../utils/occasions');

const musicSchema = new mongoose.Schema({ name: String, url: String }, { _id: false });

// Fields only a proposal card needs. Required conditionally on `occasion`
// rather than unconditionally, because cards are created as a draft with
// just a template and filled in progressively by the wizard (see
// cardController.postNewCard) — the same reason none of the existing
// birthday-only fields below (recipientName, message, etc.) are
// unconditionally required either.
function requiredForProposal() {
  return this.occasion === 'proposal';
}

const cardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'Template', required: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
    slug: { type: String, required: true, unique: true, index: true },
    occasion: { type: String, enum: OCCASIONS, default: DEFAULT_OCCASION, required: true },

    // --- birthday fields ---
    recipientName: { type: String, trim: true },
    nickname: { type: String, trim: true },
    birthdayDate: { type: Date },
    senderName: { type: String, trim: true },
    message: { type: String, trim: true, maxlength: 4000 }, // sanitized HTML from the rich-text editor
    candleCount: { type: Number, min: 1, max: 20, default: 1 },
    photos: [{ type: String, trim: true }], // photos[0] doubles as the cover photo
    music: musicSchema, // one track chosen from the template's musicTracks, or unset for silence

    // --- proposal fields ---
    partnerName: { type: String, trim: true, required: requiredForProposal },
    question: { type: String, trim: true, maxlength: 500, required: requiredForProposal }, // e.g. "Will you be my girlfriend?"
    yesMessage: { type: String, trim: true, maxlength: 2000, required: requiredForProposal }, // shown on the celebration screen after YES
    sticker: { type: String, trim: true }, // optional emoji/sticker choice, decorative
    respondedYes: { type: Boolean, default: false },
    respondedAt: { type: Date },
    noAttempts: { type: Number, default: 0, min: 0 }, // how many times the NO button was dodged

    status: { type: String, enum: ['draft', 'paid'], default: 'draft' },
    paidAt: { type: Date },
    expiresAt: { type: Date },
    isDisabled: { type: Boolean, default: false }, // admin kill-switch — the public link 404s while set, independent of expiry
    // Fast running counters mirrored from CardView rows (see utils/tracking
    // and controllers/trackingController) so the owner/admin dashboards
    // never need to aggregate the raw view log just to show a number.
    totalViews: { type: Number, default: 0 },
    uniqueViews: { type: Number, default: 0 },
    lastOpenedAt: { type: Date },
    firstOpenedAt: { type: Date }, // set the moment the recipient actually taps the gift box open, not just a page load
    expiryReminderSentAt: { type: Date }, // de-dupe guard for the "expires in 2 days" cron email
  },
  { timestamps: true }
);

module.exports = mongoose.model('Card', cardSchema);
