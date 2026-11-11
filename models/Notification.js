const mongoose = require('mongoose');

// Backs the bell icon on the customer dashboard — a short-lived in-app
// feed distinct from email (see User.notifyOn* for the email toggles,
// which this is never gated by).
const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['card_opened', 'proposal_yes'], required: true },
  card: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
