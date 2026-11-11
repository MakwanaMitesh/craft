const mongoose = require('mongoose');
const { EVENT_TYPES } = require('../utils/trackingEvents');

// Granular event stream behind the CardView summary row — lets a future
// funnel report answer "how many people who opened got to candles_blown"
// without the CardView row itself growing a column per possible event.
const cardEventSchema = new mongoose.Schema({
  card: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
  sessionId: { type: String, required: true },
  type: { type: String, enum: EVENT_TYPES, required: true },
  durationSeconds: { type: Number }, // only set on the 'time_spent' beacon
  createdAt: { type: Date, default: Date.now },
});

cardEventSchema.index({ card: 1, createdAt: 1 });
cardEventSchema.index({ sessionId: 1 });

module.exports = mongoose.model('CardEvent', cardEventSchema);
