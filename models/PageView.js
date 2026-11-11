const mongoose = require('mongoose');

// Minimal site-wide pageview log — currently only the landing page — just
// enough to answer "how many visitors did we get" for the admin analytics
// visitor funnel (landing visits -> signups -> cards created -> paid).
// Not a general analytics system: no device/geo detail like CardView has,
// since nothing downstream needs it yet.
const pageViewSchema = new mongoose.Schema({
  path: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

pageViewSchema.index({ path: 1, createdAt: 1 });

module.exports = mongoose.model('PageView', pageViewSchema);
