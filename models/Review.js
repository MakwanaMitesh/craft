const mongoose = require('mongoose');
const { OCCASIONS } = require('../utils/occasions');

// Real customer reviews only — admin-approved before ever appearing on the
// landing page (see publicController.getLanding, which hides the whole
// reviews section until at least 3 are approved). No seed data for this
// model, deliberately: fabricated testimonials aren't an option here.
const reviewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    occasion: { type: String, enum: OCCASIONS, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    isApproved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Review', reviewSchema);
