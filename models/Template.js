const mongoose = require('mongoose');
const { OCCASIONS, DEFAULT_OCCASION } = require('../utils/occasions');

// Curated so the public card engine only ever needs to load fonts we trust
// and have pre-approved in the Content-Security-Policy.
const FONT_PAIRS = [
  { id: 'fredoka-nunito', heading: 'Fredoka', body: 'Nunito Sans' },
  { id: 'baloo-inter', heading: 'Baloo 2', body: 'Inter' },
  { id: 'quicksand-work', heading: 'Quicksand', body: 'Work Sans' },
  { id: 'comfortaa-karla', heading: 'Comfortaa', body: 'Karla' },
  { id: 'dancing-lato', heading: 'Dancing Script', body: 'Lato' }, // handwritten heading, for proposal-style romantic templates
  { id: 'playfair-inter', heading: 'Playfair Display', body: 'Inter' }, // elegant serif heading
];

const musicTrackSchema = new mongoose.Schema(
  { name: { type: String, trim: true, required: true }, url: { type: String, trim: true, required: true } },
  { _id: false }
);

// Proposal templates offer a set of stickers the card creator picks one
// from (Card.sticker stores the chosen one) — same shape/relationship as
// musicTracks -> Card.music. Images only for now (uploaded through the
// admin panel's sharp-validated pipeline, same as thumbnails); true Lottie
// animation support would need a client-side Lottie player added to the
// stack, which isn't part of this pass.
const stickerSchema = new mongoose.Schema(
  { name: { type: String, trim: true, required: true }, url: { type: String, trim: true, required: true } },
  { _id: false }
);

const templateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    thumbnail: { type: String, trim: true },
    occasion: { type: String, enum: OCCASIONS, default: DEFAULT_OCCASION, required: true },

    colorTheme: {
      primary: { type: String, default: '#B45309' },
      secondary: { type: String, default: '#F43F5E' },
      background: { type: String, default: '#FFFBF4' },
    },

    fontPairId: { type: String, enum: FONT_PAIRS.map((f) => f.id), default: 'fredoka-nunito' },

    musicTracks: [musicTrackSchema],
    stickers: [stickerSchema], // proposal occasion only; unused/ignored for birthday templates

    sections: {
      balloons: { type: Boolean, default: true },
      cake: { type: Boolean, default: true },
      letter: { type: Boolean, default: true },
      photoGallery: { type: Boolean, default: false },
    },

    isPremium: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

templateSchema.methods.getFontPair = function getFontPair() {
  return FONT_PAIRS.find((f) => f.id === this.fontPairId) || FONT_PAIRS[0];
};

templateSchema.statics.FONT_PAIRS = FONT_PAIRS;

module.exports = mongoose.model('Template', templateSchema);
