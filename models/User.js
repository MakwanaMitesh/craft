const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    // Required unless this account was created via Google OAuth (no
    // password ever set/known) — same conditional-required pattern used
    // throughout this codebase (e.g. Card's proposal-only fields).
    password: { type: String, required: function requiresPassword() { return !this.googleId; }, select: false },
    googleId: { type: String, select: false, unique: true, sparse: true }, // sparse: only Google-signed-up accounts have one, and it must still be unique among those that do
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBlocked: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    // Controls the EMAIL side of the two owner notifications only — the bell
    // icon (see Notification model) always records both events regardless,
    // same reasoning as most apps separating "email me" from "notify me".
    notifyOnCardOpened: { type: Boolean, default: true },
    notifyOnProposalYes: { type: Boolean, default: true },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  // A Google-only account (no password ever set) can never match — without
  // this check bcrypt.compare would throw on an undefined hash instead of
  // just failing the login attempt.
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
