const Card = require('../models/Card');
const Template = require('../models/Template');
const Plan = require('../models/Plan');
const Review = require('../models/Review');
const User = require('../models/User');
const PageView = require('../models/PageView');
const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { sendMail } = require('../config/mailer');
const landingContent = require('../config/landingContent');
const { isBotRequest } = require('../utils/tracking');
const { getEnabledOccasions } = require('../utils/occasions');

const MIN_APPROVED_REVIEWS = 3;

exports.getLanding = catchAsync(async (req, res) => {
  // Fire-and-forget — feeds the admin analytics visitor funnel (landing
  // visits -> signups -> cards created -> paid). Excludes bots and admins
  // viewing their own site, same exclusion logic as card view tracking.
  if (!isBotRequest(req.get('user-agent')) && req.session?.role !== 'admin') {
    PageView.create({ path: '/' }).catch(() => {});
  }

  const settings = res.locals.settings;
  const enabledOccasions = getEnabledOccasions(settings);

  const [birthdayTemplates, proposalTemplates, birthdayPlans, proposalPlans, approvedReviews] = await Promise.all([
    enabledOccasions.includes('birthday') ? Template.find({ isActive: true, occasion: 'birthday' }).sort({ sortOrder: 1 }).limit(6) : [],
    enabledOccasions.includes('proposal') ? Template.find({ isActive: true, occasion: 'proposal' }).sort({ sortOrder: 1 }).limit(6) : [],
    enabledOccasions.includes('birthday') ? Plan.find({ isActive: true, occasion: 'birthday' }).sort({ price: 1 }) : [],
    enabledOccasions.includes('proposal') ? Plan.find({ isActive: true, occasion: 'proposal' }).sort({ price: 1 }) : [],
    settings.features?.reviewsEnabled !== false ? Review.find({ isApproved: true }).sort({ createdAt: -1 }).limit(12) : [],
  ]);

  // Settings → Homepage content tab overrides the config-file defaults
  // field by field, so an admin only needs to fill in what they want to
  // change — the rest still falls back to config/landingContent.js.
  const content = {
    ...landingContent,
    hero: {
      headline: settings.homepage?.heroHeadline || landingContent.hero.headline,
      subline: settings.homepage?.heroSubline || landingContent.hero.subline,
    },
    faq: settings.homepage?.faq?.length
      ? [...settings.homepage.faq].sort((a, b) => a.order - b.order).map((f) => ({ q: f.question, a: f.answer }))
      : landingContent.faq,
  };

  // Homepage teaser row for the Interactive Surprise Cards feature (the
  // free, no-login system under /cards/*) alongside the paid Birthday
  // occasion — a plain array so a future card type is just one more entry,
  // no template changes needed unless its mini-preview needs genuinely new
  // markup (see the `preview` switch in views/public/landing.ejs).
  const surpriseCardsSection = [
    {
      key: 'birthday',
      name: 'Birthday Wish',
      badge: 'Most Loved 🏆',
      badgeClass: 'bg-amber-100 text-amber-700',
      preview: 'giftbox',
      createUrl: '/dashboard/cards/new?occasion=birthday',
    },
    {
      key: 'apology',
      name: 'Apology Card',
      badge: 'Heartfelt 💛',
      badgeClass: 'bg-rose-100 text-rose-600',
      preview: 'apology',
      createUrl: '/cards/apology/create',
    },
  ].filter((c) => c.key !== 'birthday' || enabledOccasions.includes('birthday'));

  res.render('public/landing', {
    title: settings.seo?.metaTitle || landingContent.seo.title,
    metaDescription: settings.seo?.metaDescription || landingContent.seo.description,
    metaKeywords: settings.seo?.metaKeywords || landingContent.seo.keywords,
    canonicalUrl: process.env.BASE_URL,
    ogImage: settings.ogImage || `${process.env.BASE_URL}/images/og-landing.png`,
    content,
    enabledOccasions,
    surpriseCardsSection,
    templatesByOccasion: { birthday: birthdayTemplates, proposal: proposalTemplates },
    plansByOccasion: { birthday: birthdayPlans, proposal: proposalPlans },
    // The whole reviews section stays hidden below this count — see
    // views/public/landing.ejs — rather than ever showing fabricated ones.
    reviews: approvedReviews.length >= MIN_APPROVED_REVIEWS ? approvedReviews : [],
  });
});

// Renders the exact real card engine (same views/public/card.ejs and
// card-proposal.ejs a paying customer's recipient sees) with sample data —
// no card is created, nothing is saved, no payment involved. Mirrors
// adminController.previewTemplate, but public and keyed by slug. Only
// active templates are demoable, same as the builder's own template picker.
// Minimal placeholder legal pages, linked from the footer. The real policy
// text should replace these paragraphs before launch — flagged clearly so
// that's obvious rather than silently shipping as if it were final.
const LEGAL_PAGES = {
  terms: {
    pageTitle: 'Terms of Service',
    paragraphs: [
      'This is placeholder content — replace it with your actual Terms of Service before launch.',
      'By using this site, you agree to create cards with content you have the right to share, and to use the service for its intended purpose of sending birthday wishes and proposals.',
    ],
  },
  privacy: {
    pageTitle: 'Privacy Policy',
    paragraphs: [
      'This is placeholder content — replace it with your actual Privacy Policy before launch.',
      'We store the account and card information you provide in order to operate the service, and never sell your data to third parties.',
      'For card owners: when someone opens a card you created, we record anonymous view statistics — approximate device type, browser, and city/country (derived from IP address, which is never stored itself), referral source, how far they got through the card, and how long they spent — so you can see how your card is doing. We never record this for your own visits to your card, for admin visits, or for bots.',
    ],
  },
  'refund-policy': {
    pageTitle: 'Refund Policy',
    paragraphs: [
      'This is placeholder content — replace it with your actual Refund Policy before launch.',
      'If a payment fails or was made in error, contact support within a few days and we\'ll help sort it out.',
    ],
  },
  contact: {
    pageTitle: 'Contact us',
    paragraphs: ['Have a question, found a bug, or need help with an order? Reach out any time — we read every message.'],
  },
};

const LEGAL_SETTINGS_FIELD = { terms: 'termsHtml', privacy: 'privacyHtml', 'refund-policy': 'refundPolicyHtml' };

exports.getLegalPage = catchAsync(async (req, res) => {
  const page = LEGAL_PAGES[req.params.page];
  if (!page) throw new AppError('Page not found.', 404);

  // Settings → Legal pages tab overrides the placeholder paragraphs once
  // an admin has actually written something there (sanitized on save —
  // see settingsController.updateLegal).
  const settingsField = LEGAL_SETTINGS_FIELD[req.params.page];
  const html = settingsField ? res.locals.settings?.legal?.[settingsField] : null;

  res.render('public/legal', { title: page.pageTitle, ...page, html: html || null });
});

exports.getDemo = catchAsync(async (req, res) => {
  if (res.locals.settings?.features?.demoPreviewsEnabled === false) {
    throw new AppError('Demo previews are currently unavailable.', 404);
  }

  const template = await Template.findOne({ slug: req.params.templateSlug, isActive: true });
  if (!template) throw new AppError('Template not found.', 404);

  if (template.occasion === 'proposal') {
    const dummyCard = {
      partnerName: 'Priya',
      senderName: 'Rahul',
      question: 'Will you marry me?',
      yesMessage: "You've just made me the happiest person alive. I love you!",
      sticker: template.stickers?.[0]?.url,
      photos: [],
      template,
    };
    return res.render('public/card-proposal', { title: `Demo: ${template.name}`, card: dummyCard, isPreview: true });
  }

  const dummyCard = {
    recipientName: 'Priya',
    senderName: 'Rahul',
    message:
      '<p>Happy Birthday! 🎉</p><p>Wishing you a year filled with joy, laughter, and all the things that make you smile.</p><p>You deserve all the happiness in the world today and always.</p>',
    candleCount: 5,
    photos: [],
    template,
  };
  res.render('public/card', { title: `Demo: ${template.name}`, card: dummyCard, isPreview: true });
});

exports.viewCard = catchAsync(async (req, res, next) => {
  const card = await Card.findOne({ slug: req.params.slug, status: 'paid' }).populate('template');

  // Not a paid Card at all — might be a (free, no-login) Interactive
  // Surprise Card instead, which lives in a separate model/collection. Only
  // a genuine non-match falls through; a disabled paid Card still shows its
  // own "not found" response immediately, same as before.
  if (!card) return next();

  if (card.isDisabled) {
    return res.status(404).render('public/card-unavailable', { title: 'Card not found' });
  }

  if (card.expiresAt && card.expiresAt < new Date()) {
    return res.status(410).render('public/card-unavailable', { title: 'Card expired' });
  }

  // View counting (totalViews/uniqueViews/CardView rows) now happens
  // client-side via POST /api/track's card_opened event (see
  // trackingController) — not here — so that bot/owner/admin visits and
  // link-preview-bot page loads never get counted in the first place.
  const canonicalUrl = `${process.env.BASE_URL}/c/${card.slug}`;
  // No per-card generated image exists, so only advertise one when the
  // template actually has a thumbnail — a broken og:image is worse than none.
  // thumbnail is already an absolute URL when stored in Cloudinary, but just
  // a local relative path ("/images/uploads/...") when stored on disk.
  const ogImage = card.template.thumbnail
    ? card.template.thumbnail.startsWith('http')
      ? card.template.thumbnail
      : `${process.env.BASE_URL}${card.template.thumbnail}`
    : null;

  if (card.occasion === 'proposal') {
    // Deliberately generic — neither the question nor the answer are given
    // away in the link preview.
    const ogDescription = `💌 Someone has a question for ${card.partnerName}`;
    return res.render('public/card-proposal', {
      title: `A question for ${card.partnerName}`,
      card,
      canonicalUrl,
      ogImage,
      ogDescription,
    });
  }

  // Deliberately generic — the actual message is left out of the link
  // preview so WhatsApp/Instagram don't spoil the surprise before it's opened.
  const ogDescription = `Tap to open a personalized birthday surprise for ${card.recipientName} 🎉`;

  // Scheduled reveal: if a birthday date/time is set and hasn't arrived yet,
  // show a countdown instead of the full experience. The view above still
  // counts — someone did visit the link — but the gift box stays locked.
  if (card.birthdayDate && card.birthdayDate > new Date()) {
    return res.render('public/card-countdown', {
      title: `A surprise for ${card.recipientName}`,
      card,
      canonicalUrl,
      ogImage,
      ogDescription,
    });
  }

  res.render('public/card', {
    title: `A surprise for ${card.recipientName}`,
    card,
    canonicalUrl,
    ogImage,
    ogDescription,
  });
});

// Called by the gift-box tap on the public card — this is the real "opened"
// signal, not just a page load (which could be a link-preview bot, or the
// sender checking their own link). Idempotent: only the first tap emails.
exports.markOpened = catchAsync(async (req, res) => {
  const card = await Card.findOne({ slug: req.params.slug, status: 'paid', isDisabled: { $ne: true } });
  if (!card) return res.status(404).json({ success: false });

  if (!card.firstOpenedAt) {
    card.firstOpenedAt = new Date();
    await card.save();

    // card.ejs and card-proposal.ejs both call this endpoint — the
    // recipient's display name lives on a different field per occasion.
    const recipientLabel = card.occasion === 'proposal' ? card.partnerName : card.recipientName;

    const user = await User.findById(card.user);
    if (user) {
      await Notification.create({
        user: user._id,
        type: 'card_opened',
        card: card._id,
        message: `${recipientLabel} just opened their card! 🎉`,
      });

      // Bell notification above always fires; email is the part the
      // profile toggle (and the admin's site-wide kill switch) controls.
      if (user.notifyOnCardOpened && res.locals.settings?.features?.emailNotificationsEnabled !== false) {
        await sendMail({
          to: user.email,
          subject: `${recipientLabel} just opened their card! 🎉`,
          html: `<p>Hi ${user.name},</p><p>Good news — ${recipientLabel} just opened the ${card.occasion === 'proposal' ? 'proposal' : 'birthday'} card you made for them.</p>`,
        });
      }
    }
  }

  res.json({ success: true });
});

// Fires once, the moment YES is pressed. NO-attempt counting happens purely
// client-side during the dodge mini-game (see card-proposal.ejs) and is
// submitted here in the same call as the answer — one write instead of a
// network round-trip per dodge. Only the first response is ever saved;
// later calls (e.g. the page reloaded after answering) are a no-op that
// still reports success, since from the recipient's side nothing failed.
exports.respondToProposal = catchAsync(async (req, res) => {
  const card = await Card.findOne({ slug: req.params.slug, status: 'paid', occasion: 'proposal', isDisabled: { $ne: true } });
  if (!card) return res.status(404).json({ success: false });

  if (card.respondedYes) {
    return res.json({ success: true, alreadyResponded: true });
  }

  // Client-reported count for a lighthearted stat, not a security value —
  // clamp to a sane range rather than trusting it outright.
  const noAttempts = Math.min(Math.max(parseInt(req.body.noAttempts, 10) || 0, 0), 9999);

  card.respondedYes = true;
  card.respondedAt = new Date();
  card.noAttempts = noAttempts;
  await card.save({ validateBeforeSave: false });

  const user = await User.findById(card.user);
  if (user) {
    await Notification.create({
      user: user._id,
      type: 'proposal_yes',
      card: card._id,
      message: `💖 ${card.partnerName} said YES!`,
    });

    if (user.notifyOnProposalYes && res.locals.settings?.features?.emailNotificationsEnabled !== false) {
      await sendMail({
        to: user.email,
        subject: `💖 ${card.partnerName} said YES!`,
        html: `<p>Hi ${user.name},</p><p><strong>${card.partnerName}</strong> just said <strong>YES</strong> to your proposal! 🎉</p><p>They answered at ${card.respondedAt.toLocaleString()}, after trying to press NO ${noAttempts} time${noAttempts === 1 ? '' : 's'}.</p>`,
      });
    }
  }

  res.json({ success: true });
});
