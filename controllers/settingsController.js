const sanitizeHtml = require('sanitize-html');
const nodemailer = require('nodemailer');
const Setting = require('../models/Setting');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { storeImage } = require('../utils/mediaStorage');
const { logAdminAction } = require('../utils/auditLog');
const { resolveSmtpConfig } = require('../config/mailer');

async function processUploadedImage(file) {
  if (!file) return undefined;
  return storeImage(file);
}

const toBool = (v) => v === 'on' || v === 'true';

exports.getSettings = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();
  const tab = ['general', 'contact', 'homepage', 'seo', 'features', 'payments', 'email', 'uploads', 'legal'].includes(req.query.tab)
    ? req.query.tab
    : 'general';

  res.render('admin/settings', { title: 'Site settings', settings, tab });
});

// --- 1. General ---
exports.updateGeneral = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();
  const { siteName, tagline, primaryColor, accentColor, currencyCode, currencySymbol, timezone, dateFormat } = req.body;

  settings.siteName = siteName;
  settings.tagline = tagline;
  settings.primaryColor = primaryColor;
  settings.accentColor = accentColor;
  settings.currencyCode = currencyCode;
  settings.currencySymbol = currencySymbol;
  settings.timezone = timezone;
  settings.dateFormat = dateFormat;

  const [logoLight, logoDark, favicon, ogImage] = await Promise.all([
    processUploadedImage(req.files?.logoLight?.[0]),
    processUploadedImage(req.files?.logoDark?.[0]),
    processUploadedImage(req.files?.favicon?.[0]),
    processUploadedImage(req.files?.ogImage?.[0]),
  ]);
  if (logoLight) settings.logoLight = logoLight;
  if (logoDark) settings.logoDark = logoDark;
  if (favicon) settings.favicon = favicon;
  if (ogImage) settings.ogImage = ogImage;

  await settings.save();
  logAdminAction(req, 'settings.update_general', { targetType: 'Setting', targetId: settings._id });
  req.session.flash = { type: 'success', message: 'General settings saved.' };
  res.redirect('/admin/settings?tab=general');
});

// --- 2. Contact ---
exports.updateContact = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();
  const { supportEmail, phone, whatsappNumber, address, instagramUrl, facebookUrl, twitterUrl, youtubeUrl } = req.body;

  settings.supportEmail = supportEmail;
  settings.contact = { phone, whatsappNumber: whatsappNumber?.replace(/\D/g, ''), address };
  settings.social = { instagramUrl, facebookUrl, twitterUrl, youtubeUrl };

  await settings.save();
  logAdminAction(req, 'settings.update_contact', { targetType: 'Setting', targetId: settings._id });
  req.session.flash = { type: 'success', message: 'Contact settings saved.' };
  res.redirect('/admin/settings?tab=contact');
});

// --- 3. Homepage content ---
exports.updateHomepage = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();
  const { heroHeadline, heroSubline, announcementText, announcementLink } = req.body;

  // faq[i][question]/[answer]/[order] — express's urlencoded(extended:true)
  // parses the bracket notation into req.body.faq as an array already.
  const faq = Array.isArray(req.body.faq)
    ? req.body.faq
        .filter((f) => f && f.question && f.answer)
        .map((f, i) => ({ question: f.question.trim(), answer: f.answer.trim(), order: Number(f.order ?? i) }))
    : [];

  settings.homepage = { heroHeadline, heroSubline, announcementText, announcementLink, faq };

  await settings.save();
  logAdminAction(req, 'settings.update_homepage', { targetType: 'Setting', targetId: settings._id, details: { faqCount: faq.length } });
  req.session.flash = { type: 'success', message: 'Homepage content saved.' };
  res.redirect('/admin/settings?tab=homepage');
});

// --- 4. SEO ---
exports.updateSeo = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();
  const { metaTitle, metaDescription, metaKeywords, googleAnalyticsId, metaPixelId } = req.body;

  settings.seo = { metaTitle, metaDescription, metaKeywords, googleAnalyticsId, metaPixelId };

  await settings.save();
  logAdminAction(req, 'settings.update_seo', { targetType: 'Setting', targetId: settings._id });
  req.session.flash = { type: 'success', message: 'SEO settings saved.' };
  res.redirect('/admin/settings?tab=seo');
});

// --- 5. Feature toggles ---
const FEATURE_KEYS = [
  'birthdayEnabled', 'proposalEnabled', 'registrationsOpen', 'reviewsEnabled',
  'announcementBarEnabled', 'whatsappButtonEnabled', 'cardViewTrackingEnabled',
  'emailNotificationsEnabled', 'demoPreviewsEnabled', 'poweredByFooterEnabled',
];

exports.updateFeatures = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();

  settings.features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, toBool(req.body[key])]));
  settings.maintenanceMode = toBool(req.body.maintenanceMode);

  await settings.save();
  logAdminAction(req, 'settings.update_features', { targetType: 'Setting', targetId: settings._id, details: settings.features });
  req.session.flash = { type: 'success', message: 'Feature toggles saved.' };
  res.redirect('/admin/settings?tab=features');
});

// --- 6. Payments ---
exports.updatePayments = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();
  const { razorpayKeyId, razorpayKeySecret, razorpayMode, gstPercentage, invoiceBusinessName, invoiceBusinessAddress, invoiceBusinessGstNumber } = req.body;

  settings.razorpayKeyId = razorpayKeyId;
  // A blank secret field means "leave the existing secret untouched" — the
  // UI only ever shows a masked placeholder, never the real value.
  if (razorpayKeySecret) settings.razorpayKeySecret = razorpayKeySecret;
  settings.razorpayMode = razorpayMode === 'live' ? 'live' : 'test';
  settings.gstPercentage = Math.min(Math.max(Number(gstPercentage) || 0, 0), 100);
  settings.invoiceBusiness = { name: invoiceBusinessName, address: invoiceBusinessAddress, gstNumber: invoiceBusinessGstNumber };

  await settings.save();
  logAdminAction(req, 'settings.update_payments', { targetType: 'Setting', targetId: settings._id, details: { razorpayMode: settings.razorpayMode } });
  req.session.flash = { type: 'success', message: 'Payment settings saved.' };
  res.redirect('/admin/settings?tab=payments');
});

// --- 7. Email (SMTP) ---
exports.updateEmail = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();
  const { smtpHost, smtpPort, smtpUser, smtpPassword, fromName, fromEmail } = req.body;

  settings.smtp.host = smtpHost;
  settings.smtp.port = Number(smtpPort) || 587;
  settings.smtp.user = smtpUser;
  if (smtpPassword) settings.smtp.password = smtpPassword; // blank = keep existing, same pattern as Razorpay secret
  settings.smtp.fromName = fromName;
  settings.smtp.fromEmail = fromEmail;

  await settings.save();
  logAdminAction(req, 'settings.update_email', { targetType: 'Setting', targetId: settings._id, details: { smtpHost } });
  req.session.flash = { type: 'success', message: 'Email settings saved.' };
  res.redirect('/admin/settings?tab=email');
});

exports.sendTestEmail = catchAsync(async (req, res) => {
  const config = await resolveSmtpConfig();
  if (!config.host) {
    req.session.flash = { type: 'error', message: 'Set an SMTP host first.' };
    return res.redirect('/admin/settings?tab=email');
  }

  const to = req.body.testEmailTo;
  if (!to) throw new AppError('Enter an email address to send the test to.', 400);

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  try {
    await transporter.sendMail({
      from: `${config.fromName} <${config.fromEmail}>`,
      to,
      subject: 'Test email from your admin settings',
      html: '<p>If you got this, your SMTP settings are working correctly. 🎉</p>',
    });
    req.session.flash = { type: 'success', message: `Test email sent to ${to}.` };
  } catch (err) {
    req.session.flash = { type: 'error', message: `Couldn't send test email: ${err.message}` };
  }

  logAdminAction(req, 'settings.send_test_email', { targetType: 'Setting', details: { to } });
  res.redirect('/admin/settings?tab=email');
});

// --- 8. Uploads ---
exports.updateUploads = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();
  const { maxPhotoSizeMB, maxPhotosPerCard } = req.body;
  const allowedFileTypes = Array.isArray(req.body.allowedFileTypes)
    ? req.body.allowedFileTypes
    : req.body.allowedFileTypes
      ? [req.body.allowedFileTypes]
      : [];

  settings.uploads = {
    maxPhotoSizeMB: Math.min(Math.max(Number(maxPhotoSizeMB) || 5, 1), 25),
    maxPhotosPerCard: Math.min(Math.max(Number(maxPhotosPerCard) || 6, 1), 30),
    allowedFileTypes: allowedFileTypes.length ? allowedFileTypes : ['jpg', 'jpeg', 'png', 'webp'],
  };

  await settings.save();
  logAdminAction(req, 'settings.update_uploads', { targetType: 'Setting', targetId: settings._id, details: settings.uploads });
  req.session.flash = { type: 'success', message: 'Upload settings saved.' };
  res.redirect('/admin/settings?tab=uploads');
});

// --- 9. Legal pages ---
// Deliberately more permissive than cardController's message sanitizer —
// this is admin-authored content, not user-submitted, and needs headings/
// lists/links for a real Terms/Privacy/Refund page.
const LEGAL_ALLOWED_TAGS = ['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'a', 'br', 'blockquote'];

function sanitizeLegalHtml(raw) {
  return sanitizeHtml(raw || '', {
    allowedTags: LEGAL_ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'target', 'rel'] },
  });
}

exports.updateLegal = catchAsync(async (req, res) => {
  const settings = await Setting.getSingletonWithSecret();

  settings.legal = {
    termsHtml: sanitizeLegalHtml(req.body.termsHtml),
    privacyHtml: sanitizeLegalHtml(req.body.privacyHtml),
    refundPolicyHtml: sanitizeLegalHtml(req.body.refundPolicyHtml),
  };

  await settings.save();
  logAdminAction(req, 'settings.update_legal', { targetType: 'Setting', targetId: settings._id });
  req.session.flash = { type: 'success', message: 'Legal pages saved.' };
  res.redirect('/admin/settings?tab=legal');
});
