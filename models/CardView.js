const mongoose = require('mongoose');
const { OCCASIONS } = require('../utils/occasions');

// One row per public card visit (one per browser session, created on the
// card_opened event — see controllers/trackingController). Card.totalViews/
// uniqueViews are fast running counters for display; this log is what lets
// the admin dashboard chart views over time and gives per-card analytics a
// device/location/engagement breakdown a single counter can't reconstruct.
//
// Never stores the raw IP — only ipHash (SHA-256 of ip + today's date) via
// utils/tracking.hashIp, which is enough to detect a repeat visitor within
// the same day without persisting anything that identifies them.
const cardViewSchema = new mongoose.Schema({
  card: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  occasion: { type: String, enum: OCCASIONS },
  sessionId: { type: String, required: true },
  deviceType: { type: String, enum: ['mobile', 'tablet', 'desktop'], default: 'desktop' },
  browser: { type: String, trim: true },
  os: { type: String, trim: true },
  referrerSource: { type: String, enum: ['whatsapp', 'instagram', 'direct', 'other'], default: 'direct' },
  city: { type: String, trim: true },
  country: { type: String, trim: true },
  ipHash: { type: String },
  isUnique: { type: Boolean, default: false },
  openedAt: { type: Date, default: Date.now },
  durationSeconds: { type: Number, default: 0 },
  furthestStep: { type: String, default: 'card_opened' },
});

cardViewSchema.index({ card: 1, openedAt: 1 });
cardViewSchema.index({ owner: 1, openedAt: 1 });

module.exports = mongoose.model('CardView', cardViewSchema);
