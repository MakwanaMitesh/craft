const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

// Singleton document holding every site-wide setting, editable by admin
// across the Settings tabs. Kept as nested objects per tab purely for
// readability — there's still only one document in the collection.
const settingSchema = new mongoose.Schema(
  {
    // --- 1. General ---
    siteName: { type: String, default: 'CelebraCraft' },
    tagline: { type: String, default: '' },
    logoLight: { type: String, default: '' },
    logoDark: { type: String, default: '' },
    favicon: { type: String, default: '' },
    ogImage: { type: String, default: '' },
    primaryColor: { type: String, default: '#B45309' },
    accentColor: { type: String, default: '#E11D48' },
    currencyCode: { type: String, default: 'INR' },
    currencySymbol: { type: String, default: '₹' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    dateFormat: { type: String, default: 'DD MMM YYYY' },

    // --- 2. Contact ---
    supportEmail: { type: String, default: 'support@celebracraft.com' },
    contact: {
      phone: { type: String, default: '' },
      whatsappNumber: { type: String, default: '' }, // digits only, international format (no '+'), e.g. 919876543210
      address: { type: String, default: '' },
    },
    social: {
      instagramUrl: { type: String, default: '' },
      facebookUrl: { type: String, default: '' },
      twitterUrl: { type: String, default: '' },
      youtubeUrl: { type: String, default: '' },
    },

    // --- 3. Homepage content ---
    homepage: {
      heroHeadline: { type: String, default: '' },
      heroSubline: { type: String, default: '' },
      faq: [
        {
          question: { type: String, trim: true },
          answer: { type: String, trim: true },
          order: { type: Number, default: 0 },
        },
      ],
      announcementText: { type: String, default: '' },
      announcementLink: { type: String, default: '' },
    },

    // --- 4. SEO ---
    seo: {
      metaTitle: { type: String, default: '' },
      metaDescription: { type: String, default: '' },
      metaKeywords: { type: String, default: '' },
      googleAnalyticsId: { type: String, default: '' },
      metaPixelId: { type: String, default: '' },
    },

    // --- 5. Feature toggles ---
    features: {
      birthdayEnabled: { type: Boolean, default: true },
      proposalEnabled: { type: Boolean, default: true },
      registrationsOpen: { type: Boolean, default: true },
      reviewsEnabled: { type: Boolean, default: true },
      announcementBarEnabled: { type: Boolean, default: false },
      whatsappButtonEnabled: { type: Boolean, default: false },
      cardViewTrackingEnabled: { type: Boolean, default: true },
      emailNotificationsEnabled: { type: Boolean, default: true },
      demoPreviewsEnabled: { type: Boolean, default: true },
      poweredByFooterEnabled: { type: Boolean, default: true },
    },
    maintenanceMode: { type: Boolean, default: false },

    // --- 6. Payments ---
    razorpayKeyId: { type: String, default: '' },
    razorpayKeySecret: { type: String, default: '', select: false }, // encrypted at rest — see utils/crypto
    razorpayMode: { type: String, enum: ['test', 'live'], default: 'test' },
    gstPercentage: { type: Number, default: 0, min: 0, max: 100 },
    invoiceBusiness: {
      name: { type: String, default: '' },
      address: { type: String, default: '' },
      gstNumber: { type: String, default: '' },
    },

    // --- 7. Email (SMTP) ---
    smtp: {
      host: { type: String, default: '' },
      port: { type: Number, default: 587 },
      user: { type: String, default: '' },
      password: { type: String, default: '', select: false }, // encrypted at rest
      fromName: { type: String, default: '' },
      fromEmail: { type: String, default: '' },
    },

    // --- 8. Uploads ---
    uploads: {
      maxPhotoSizeMB: { type: Number, default: 5, min: 1, max: 25 },
      allowedFileTypes: { type: [String], default: ['jpg', 'jpeg', 'png', 'webp'] },
      maxPhotosPerCard: { type: Number, default: 6, min: 1, max: 30 },
    },

    // --- 9. Legal pages ---
    legal: {
      termsHtml: { type: String, default: '' },
      privacyHtml: { type: String, default: '' },
      refundPolicyHtml: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

// In-memory cache so every request's res.locals.settings (and the
// maintenance/feature-toggle checks on the hot path) doesn't hit MongoDB —
// invalidated on every save, from anywhere in the app, via the post-save
// hook below, so a settings change is visible on the very next request.
let cache = null;

settingSchema.statics.getSingleton = async function getSingleton() {
  if (cache) return cache;
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  cache = settings.toObject({ depopulate: true });
  return cache;
};

// Same as getSingleton but also includes the normally-hidden encrypted
// secrets, decrypted, for use only where the actual credential is needed
// (payment calls, SMTP transport, the settings form's own masked display).
// Deliberately not cached — rare call, and keeping decrypted secrets out of
// the long-lived shared cache object is a cheap bit of extra caution.
settingSchema.statics.getSingletonWithSecret = async function getSingletonWithSecret() {
  let settings = await this.findOne().select('+razorpayKeySecret +smtp.password');
  if (!settings) settings = await this.create({});
  settings.razorpayKeySecret = decrypt(settings.razorpayKeySecret);
  settings.smtp.password = decrypt(settings.smtp.password);
  return settings;
};

settingSchema.pre('save', function encryptSecrets(next) {
  if (this.isModified('razorpayKeySecret') && this.razorpayKeySecret && !this.razorpayKeySecret.startsWith('enc:')) {
    this.razorpayKeySecret = encrypt(this.razorpayKeySecret);
  }
  if (this.isModified('smtp.password') && this.smtp.password && !this.smtp.password.startsWith('enc:')) {
    this.smtp.password = encrypt(this.smtp.password);
  }
  next();
});

// Always strips the secret fields before caching — updateSettings() saves
// through getSingletonWithSecret(), whose document instance carries the
// decrypted razorpayKeySecret/smtp.password in memory, and those must never
// end up in the shared cache object that every request's res.locals.settings
// points at.
settingSchema.post('save', function refreshCache(doc) {
  const safe = doc.toObject({ depopulate: true });
  delete safe.razorpayKeySecret;
  if (safe.smtp) delete safe.smtp.password;
  cache = safe;
});

module.exports = mongoose.model('Setting', settingSchema);
