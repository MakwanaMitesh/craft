const passport = require('passport');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { generateResetToken, hashToken } = require('../utils/tokens');
const { sendMail } = require('../config/mailer');
const { safeRedirect } = require('../utils/safeRedirect');

// Lets a link like "Create now" on the landing page (not logged in) send the
// visitor to register, then land back on the exact builder step they wanted
// — e.g. ?redirect=/dashboard/cards/new/template%3Focccasion%3Dproposal —
// instead of the generic /dashboard every other registration lands on.
exports.getRegister = (req, res) => {
  if (res.locals.settings?.features?.registrationsOpen === false) {
    return res.render('auth/registrations-closed', { title: 'Registrations closed' });
  }
  res.render('auth/register', { title: 'Create your account', redirectTo: safeRedirect(req.query.redirect) });
};

exports.postRegister = catchAsync(async (req, res) => {
  if (res.locals.settings?.features?.registrationsOpen === false) {
    req.session.flash = { type: 'error', message: 'New registrations are currently closed.' };
    return res.redirect('/register');
  }

  const { name, email, phone, password } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    req.session.flash = { type: 'error', message: 'An account with that email already exists.' };
    return res.redirect('/register');
  }

  const user = await User.create({ name, email, phone, password });

  req.session.userId = user._id;
  req.session.userName = user.name;
  req.session.role = user.role;

  req.session.flash = { type: 'success', message: `Welcome to ${process.env.APP_NAME || 'CelebraCraft'}!` };
  res.redirect(safeRedirect(req.body.redirectTo) || '/dashboard');
});

exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Log in', redirectTo: safeRedirect(req.query.redirect) });
};

exports.postLogin = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    req.session.flash = { type: 'error', message: 'Incorrect email or password.' };
    return res.redirect('/login');
  }

  if (user.isBlocked) {
    req.session.flash = { type: 'error', message: 'Your account has been blocked. Contact support.' };
    return res.redirect('/login');
  }

  req.session.userId = user._id;
  req.session.userName = user.name;
  req.session.role = user.role;

  user.lastLoginAt = new Date();
  await user.save();

  const redirectTo = user.role !== 'admin' && safeRedirect(req.body.redirectTo);
  res.redirect(redirectTo || (user.role === 'admin' ? '/admin/dashboard' : '/dashboard'));
});

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
};

exports.getForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot password' });
};

exports.postForgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });

  // Always show the same message, whether or not the email exists, to avoid leaking account info.
  const genericMessage = 'If that email is registered, a reset link has been sent.';

  if (user) {
    const { rawToken, hashedToken } = generateResetToken();
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
    await user.save();

    const resetUrl = `${process.env.BASE_URL}/reset-password/${rawToken}`;
    await sendMail({
      to: user.email,
      subject: 'Reset your password',
      html: `<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  }

  req.session.flash = { type: 'success', message: genericMessage };
  res.redirect('/login');
});

exports.getResetPassword = catchAsync(async (req, res) => {
  const hashedToken = hashToken(req.params.token);
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    req.session.flash = { type: 'error', message: 'That reset link is invalid or has expired.' };
    return res.redirect('/forgot-password');
  }

  res.render('auth/reset-password', { title: 'Reset password', token: req.params.token });
});

exports.postResetPassword = catchAsync(async (req, res) => {
  const hashedToken = hashToken(req.params.token);
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  }).select('+password');

  if (!user) {
    req.session.flash = { type: 'error', message: 'That reset link is invalid or has expired.' };
    return res.redirect('/forgot-password');
  }

  const { password, confirmPassword } = req.body;
  if (password !== confirmPassword) {
    req.session.flash = { type: 'error', message: 'Passwords do not match.' };
    return res.redirect(`/reset-password/${req.params.token}`);
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  req.session.flash = { type: 'success', message: 'Password updated. Please log in.' };
  res.redirect('/login');
});

// --- Google OAuth ---
// Same "?redirect= carried through" purpose as the plain register/login
// forms' redirectTo field, just stashed in the session instead of a form
// field — a redirect to Google and back can't carry an arbitrary query
// param through as cleanly as a same-site form submission can.
exports.startGoogleAuth = (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    req.session.flash = { type: 'error', message: 'Google sign-in is not set up yet. Please use email instead.' };
    return res.redirect('/login');
  }
  req.session.oauthRedirect = safeRedirect(req.query.redirect);
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
};

exports.googleAuthCallback = (req, res, next) => {
  passport.authenticate('google', { session: false, failureRedirect: '/login' }, async (err, user) => {
    if (err || !user) {
      req.session.flash = { type: 'error', message: 'Google sign-in failed. Please try again or use email.' };
      return res.redirect('/login');
    }
    if (user.isBlocked) {
      req.session.flash = { type: 'error', message: 'Your account has been blocked. Contact support.' };
      return res.redirect('/login');
    }

    req.session.userId = user._id;
    req.session.userName = user.name;
    req.session.role = user.role;
    user.lastLoginAt = new Date();
    await user.save();

    const redirectTo = user.role !== 'admin' && req.session.oauthRedirect;
    delete req.session.oauthRedirect;
    res.redirect(redirectTo || (user.role === 'admin' ? '/admin/dashboard' : '/dashboard'));
  })(req, res, next);
};
