const mongoose = require('mongoose');
const { OCCASIONS, DEFAULT_OCCASION } = require('../utils/occasions');

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    occasion: { type: String, enum: OCCASIONS, default: DEFAULT_OCCASION, required: true },
    price: { type: Number, required: true, min: 0 }, // in INR rupees
    description: { type: String, trim: true },
    features: [{ type: String, trim: true }],
    validityDays: { type: Number, default: 365 }, // how long the public link stays live
    maxPhotos: { type: Number, default: 1, min: 0 },
    musicAllowed: { type: Boolean, default: false },
    isPopular: { type: Boolean, default: false }, // admin-set "Most popular" highlight on the pricing section
    analyticsLevel: { type: String, enum: ['basic', 'full'], default: 'full' }, // how much of /dashboard/cards/:id/stats a card on this plan can see
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Plan', planSchema);
