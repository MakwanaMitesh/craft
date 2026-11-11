const sanitizeHtml = require('sanitize-html');
const QRCode = require('qrcode');
const Card = require('../models/Card');
const Template = require('../models/Template');
const Plan = require('../models/Plan');
const CardView = require('../models/CardView');
const CardEvent = require('../models/CardEvent');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { generateCardSlug } = require('../utils/tokens');
const { storeImages } = require('../utils/mediaStorage');
const { OCCASIONS, DEFAULT_OCCASION, getEnabledOccasions } = require('../utils/occasions');
const { timeAgo } = require('../utils/timeAgo');
const { startOfDay, fillDailySeries } = require('../utils/dateSeries');

const MESSAGE_CHAR_LIMIT = 600;
const DEFAULT_MAX_PHOTOS = 6;

async function getMaxPhotoCap() {
  const plans = await Plan.find({ isActive: true }).select('maxPhotos');
  if (!plans.length) return DEFAULT_MAX_PHOTOS;
  return Math.max(...plans.map((p) => p.maxPhotos ?? DEFAULT_MAX_PHOTOS));
}

function sanitizeMessage(raw) {
  return sanitizeHtml(raw || '', {
    allowedTags: ['b', 'strong', 'i', 'em', 'u', 'br', 'p'],
    allowedAttributes: {},
    // Chrome wraps each line in <div> on Enter inside contenteditable; Firefox/Safari
    // use <br> or <p>. Without this, <div> isn't in allowedTags, so sanitize-html
    // would drop the tag but keep its text, silently merging lines together.
    transformTags: { div: 'p' },
  });
}

function plainTextLength(html) {
  return sanitizeHtml(html || '', { allowedTags: [], allowedAttributes: {} }).length;
}

async function loadOwnCard(req) {
  const card = await Card.findOne({ _id: req.params.id, user: req.session.userId }).populate('template');
  if (!card) throw new AppError('Card not found.', 404);
  return card;
}

// Every card.save() below the first draft creation passes
// { validateBeforeSave: false }. Cards are built progressively — a draft
// starts with just a template and fills in one field per wizard step — so
// full-document validation would fail on every intermediate save for a
// proposal card (partnerName/question/yesMessage are only required once
// occasion is 'proposal', but that's set from step 1, long before those
// fields exist yet). Each step still validates its own input explicitly
// before saving (see the AppError throws below); only the blanket
// "required when proposal" schema-level check is what's bypassed here.

// --- Dashboard ---
exports.getDashboard = catchAsync(async (req, res) => {
  const cards = await Card.find({ user: req.session.userId })
    .populate('template')
    .sort({ createdAt: -1 });

  const now = new Date();
  const cardsWithDisplayStatus = cards.map((card) => {
    const displayStatus = card.status === 'paid' && card.expiresAt && card.expiresAt < now ? 'expired' : card.status;
    return {
      card,
      displayStatus,
      shareUrl: `${process.env.BASE_URL}/c/${card.slug}`,
      lastOpenedLabel: card.lastOpenedAt ? `last opened ${timeAgo(card.lastOpenedAt)}` : null,
    };
  });

  res.render('user/dashboard', { title: 'My cards', cardsWithDisplayStatus });
});

// --- Card analytics (/dashboard/cards/:id/stats) ---
exports.getCardStats = catchAsync(async (req, res) => {
  const card = await Card.findOne({ _id: req.params.id, user: req.session.userId }).populate('template', 'name').populate('plan', 'name analyticsLevel');
  if (!card) throw new AppError('Card not found.', 404);

  // Cheaper plans can be given a trimmed-down view — gated per plan by the
  // admin, defaulting to 'full' so a draft card with no plan yet (or an
  // older plan created before this field existed) isn't short-changed.
  const analyticsLevel = card.plan?.analyticsLevel || 'full';

  const thirtyDaysAgo = startOfDay(new Date());
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  const [
    avgDurationAgg,
    dailyViews,
    byDevice,
    byCity,
    candlesBlownCount,
    letterOpenedCount,
    replayCount,
    recentViews,
  ] = await Promise.all([
    CardView.aggregate([{ $match: { card: card._id } }, { $group: { _id: null, avg: { $avg: '$durationSeconds' } } }]),
    CardView.aggregate([
      { $match: { card: card._id, openedAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$openedAt' } }, total: { $sum: 1 } } },
    ]),
    analyticsLevel === 'full'
      ? CardView.aggregate([{ $match: { card: card._id } }, { $group: { _id: '$deviceType', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
      : [],
    analyticsLevel === 'full'
      ? CardView.aggregate([{ $match: { card: card._id, city: { $nin: [null, ''] } } }, { $group: { _id: '$city', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }])
      : [],
    card.occasion === 'birthday' ? CardEvent.countDocuments({ card: card._id, type: 'candles_blown' }) : 0,
    card.occasion === 'birthday' ? CardEvent.countDocuments({ card: card._id, type: 'letter_opened' }) : 0,
    card.occasion === 'birthday' ? CardEvent.countDocuments({ card: card._id, type: 'replay' }) : 0,
    analyticsLevel === 'full' ? CardView.find({ card: card._id }).sort({ openedAt: -1 }).limit(20) : [],
  ]);

  const viewsSeries = fillDailySeries(dailyViews, thirtyDaysAgo, 30);
  const avgTimeSpent = Math.round(avgDurationAgg[0]?.avg || 0);

  const recentActivity = recentViews.map((v) => {
    const place = v.city ? `from ${v.city}` : '';
    const when = v.openedAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
    return `Opened on ${v.deviceType} ${place}, ${when}`.replace(/\s+,/, ',');
  });

  res.render('user/card-stats', {
    title: 'Card analytics',
    card,
    analyticsLevel,
    stats: {
      totalViews: card.totalViews,
      uniqueVisitors: card.uniqueViews,
      firstOpenedAt: card.firstOpenedAt,
      lastOpenedAt: card.lastOpenedAt,
      avgTimeSpent,
    },
    viewsLabels: viewsSeries.labels,
    viewsValues: viewsSeries.values,
    byDevice,
    byCity,
    birthday: { candlesBlown: candlesBlownCount > 0, letterOpened: letterOpenedCount > 0, replays: replayCount },
    proposal: { respondedYes: card.respondedYes, respondedAt: card.respondedAt, noAttempts: card.noAttempts },
    recentActivity,
  });
});

// Where each occasion's wizard goes after a template is chosen (either on
// first creation or when changing template mid-wizard).
const FIRST_STEP_BY_OCCASION = {
  birthday: (cardId) => `/dashboard/cards/${cardId}/build/details`,
  proposal: (cardId) => `/dashboard/cards/${cardId}/build/proposal/names`,
};

// --- Step 1: choose an occasion (no card exists yet) ---
exports.getChooseOccasion = catchAsync(async (req, res) => {
  const enabledOccasions = getEnabledOccasions(res.locals.settings);

  // Lets a link like the landing page's "Create now" buttons preselect an
  // occasion (e.g. /dashboard/cards/new?occasion=proposal) and skip straight
  // to the template picker — the plain /dashboard/cards/new URl (no query)
  // still shows the occasion-choice screen exactly as before. A disabled
  // occasion in the query string just falls through to the picker, same as
  // an invalid one.
  if (enabledOccasions.includes(req.query.occasion)) {
    return res.redirect(`/dashboard/cards/new/template?occasion=${req.query.occasion}`);
  }
  res.render('user/wizard-occasion', { title: 'Create a card', enabledOccasions });
});

// --- Step 2: choose a template, scoped to the chosen occasion ---
exports.getNewCardTemplate = catchAsync(async (req, res) => {
  const enabledOccasions = getEnabledOccasions(res.locals.settings);
  const occasion = enabledOccasions.includes(req.query.occasion) ? req.query.occasion : enabledOccasions[0] || DEFAULT_OCCASION;
  const templates = await Template.find({ isActive: true, occasion }).sort({ sortOrder: 1 });
  res.render('user/wizard-template', { title: 'Choose a template', templates, step: 1, card: null, occasion });
});

exports.postNewCard = catchAsync(async (req, res) => {
  const { templateId } = req.body;
  const template = await Template.findOne({ _id: templateId, isActive: true });
  if (!template) throw new AppError('Please choose a valid template.', 400);

  // Defense in depth: the builder's own UI already hides a disabled
  // occasion's templates, but a direct POST shouldn't be able to start a
  // brand-new card for one anyway — existing paid cards are untouched,
  // this only blocks starting new ones.
  if (!getEnabledOccasions(res.locals.settings).includes(template.occasion)) {
    throw new AppError('This occasion is not currently available.', 400);
  }

  const [card] = await Card.create(
    [
      {
        user: req.session.userId,
        template: template._id,
        // Trust the server-side Template document's occasion, never a
        // client-submitted field — keeps a card's occasion always consistent
        // with the template it was actually built from.
        occasion: template.occasion,
        slug: generateCardSlug(),
        status: 'draft',
      },
    ],
    // See the note above loadOwnCard() — a brand-new draft has none of the
    // occasion-specific fields filled in yet, so this would otherwise fail
    // "required when proposal" validation immediately.
    { validateBeforeSave: false }
  );

  res.redirect(FIRST_STEP_BY_OCCASION[card.occasion](card._id));
});

exports.getChangeTemplate = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const templates = await Template.find({ isActive: true, occasion: card.occasion }).sort({ sortOrder: 1 });
  res.render('user/wizard-template', { title: 'Choose a template', templates, step: 1, card, occasion: card.occasion });
});

exports.postChangeTemplate = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  // Can only switch to another template of the same occasion — switching
  // occasion entirely would strand whichever occasion-specific fields
  // (question/sticker vs recipientName/candleCount) were already filled in.
  const template = await Template.findOne({ _id: req.body.templateId, isActive: true, occasion: card.occasion });
  if (!template) throw new AppError('Please choose a valid template.', 400);

  card.template = template._id;
  // The previously chosen track/sticker belongs to the old template — drop them.
  card.music = undefined;
  card.sticker = undefined;
  await card.save({ validateBeforeSave: false });

  res.redirect(FIRST_STEP_BY_OCCASION[card.occasion](card._id));
});

// --- Step 2: recipient details ---
exports.getDetails = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  res.render('user/wizard-details', { title: 'Recipient details', card, step: 2 });
});

exports.postDetails = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const { recipientName, nickname, birthdayDate, senderName, candleCount } = req.body;

  card.recipientName = recipientName;
  card.nickname = nickname;
  card.birthdayDate = birthdayDate || undefined;
  card.senderName = senderName;
  card.candleCount = Number(candleCount) || 1;
  await card.save({ validateBeforeSave: false });

  res.redirect(`/dashboard/cards/${card._id}/build/photos`);
});

// --- Step 3: photos ---
exports.getPhotos = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const maxPhotos = await getMaxPhotoCap();
  res.render('user/wizard-photos', { title: 'Add photos', card, step: 3, maxPhotos });
});

exports.postPhotos = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const maxPhotos = await getMaxPhotoCap();

  if (req.files && req.files.length) {
    const capped = req.files.slice(0, maxPhotos);
    card.photos = await storeImages(capped);
    await card.save({ validateBeforeSave: false });
  }

  res.redirect(`/dashboard/cards/${card._id}/build/message`);
});

// --- Step 4: the letter ---
exports.getMessage = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  res.render('user/wizard-message', { title: 'Write your message', card, step: 4, charLimit: MESSAGE_CHAR_LIMIT });
});

exports.postMessage = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const clean = sanitizeMessage(req.body.message);

  if (plainTextLength(clean) > MESSAGE_CHAR_LIMIT) {
    throw new AppError(`Your message is too long — keep it under ${MESSAGE_CHAR_LIMIT} characters.`, 400);
  }
  if (!plainTextLength(clean)) {
    throw new AppError('Please write a message.', 400);
  }

  card.message = clean;
  await card.save({ validateBeforeSave: false });

  res.redirect(`/dashboard/cards/${card._id}/build/music`);
});

// --- Music, picked from the template's own tracks — shared by both wizards ---
// (step 5 of 6 for birthday, step 6 of 7 for proposal; each view's own step
// indicator partial numbers it correctly for that occasion)
exports.getMusic = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  res.render('user/wizard-music', { title: 'Pick music', card, step: card.occasion === 'proposal' ? 6 : 5 });
});

exports.postMusic = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const { trackUrl } = req.body;

  if (!trackUrl) {
    card.music = undefined;
  } else {
    const track = (card.template.musicTracks || []).find((t) => t.url === trackUrl);
    if (!track) throw new AppError('Please choose a track from this template.', 400);
    card.music = { name: track.name, url: track.url };
  }
  await card.save({ validateBeforeSave: false });

  res.redirect(`/dashboard/cards/${card._id}/build/preview`);
});

// --- Preview the real card engine before paying — shared by both wizards ---
exports.getWizardPreview = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const plans = await Plan.find({ isActive: true, occasion: card.occasion }).sort({ price: 1 });
  res.render('user/wizard-preview', { title: 'Preview your card', card, step: card.occasion === 'proposal' ? 7 : 6, plans });
});

// Renders the actual public card engine for the owner, without requiring
// a paid status and without counting as a real view.
exports.renderOwnPreview = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  if (card.occasion === 'proposal') {
    return res.render('public/card-proposal', {
      title: `Preview for ${card.partnerName || 'your partner'}`,
      card,
      isPreview: true,
    });
  }
  res.render('public/card', { title: `Preview for ${card.recipientName || 'your recipient'}`, card, isPreview: true });
});

exports.deleteCard = catchAsync(async (req, res) => {
  const card = await Card.findOneAndDelete({ _id: req.params.id, user: req.session.userId });
  if (!card) throw new AppError('Card not found.', 404);

  req.session.flash = { type: 'success', message: 'Card deleted.' };
  res.redirect('/dashboard');
});

exports.getCheckout = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const plans = await Plan.find({ isActive: true, occasion: card.occasion }).sort({ price: 1 });
  res.render('user/checkout', { title: 'Choose a plan', card, plans });
});

// --- Proposal wizard: b) partner + sender names ---
exports.getProposalNames = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  res.render('user/wizard-proposal-names', { title: 'Who is this for?', card, step: 2 });
});

exports.postProposalNames = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const { partnerName, senderName } = req.body;

  card.partnerName = partnerName;
  card.senderName = senderName;
  await card.save({ validateBeforeSave: false });

  res.redirect(`/dashboard/cards/${card._id}/build/proposal/question`);
});

// --- Proposal wizard: c) the question — preset or custom ---
const QUESTION_PRESETS = ['Will you be my girlfriend?', 'Will you be my boyfriend?', 'Will you marry me?'];

exports.getProposalQuestion = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  res.render('user/wizard-proposal-question', { title: 'The question', card, step: 3, presets: QUESTION_PRESETS });
});

exports.postProposalQuestion = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const question = (req.body.question || '').trim();

  if (!question) throw new AppError('Please choose or write a question.', 400);
  if (question.length > 500) throw new AppError('Keep the question under 500 characters.', 400);

  card.question = question;
  await card.save({ validateBeforeSave: false });

  res.redirect(`/dashboard/cards/${card._id}/build/proposal/sticker`);
});

// --- Proposal wizard: d) pick a sticker from the template's own set ---
exports.getProposalSticker = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  res.render('user/wizard-proposal-sticker', { title: 'Pick a sticker', card, step: 4 });
});

exports.postProposalSticker = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const { stickerUrl } = req.body;

  const sticker = (card.template.stickers || []).find((s) => s.url === stickerUrl);
  if (!sticker) throw new AppError('Please choose a sticker from this template.', 400);
  card.sticker = sticker.url;
  await card.save({ validateBeforeSave: false });

  res.redirect(`/dashboard/cards/${card._id}/build/proposal/yes-message`);
});

// --- Proposal wizard: e) the "Yes" celebration message + optional photos ---
const YES_MESSAGE_CHAR_LIMIT = 600;

exports.getProposalYesMessage = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const maxPhotos = await getMaxPhotoCap();
  res.render('user/wizard-proposal-yes-message', {
    title: 'Your "Yes" message',
    card,
    step: 5,
    charLimit: YES_MESSAGE_CHAR_LIMIT,
    maxPhotos,
  });
});

exports.postProposalYesMessage = catchAsync(async (req, res) => {
  const card = await loadOwnCard(req);
  const clean = sanitizeMessage(req.body.yesMessage);

  if (plainTextLength(clean) > YES_MESSAGE_CHAR_LIMIT) {
    throw new AppError(`Keep your message under ${YES_MESSAGE_CHAR_LIMIT} characters.`, 400);
  }
  if (!plainTextLength(clean)) {
    throw new AppError('Please write a message for when they say yes.', 400);
  }

  card.yesMessage = clean;

  if (req.files && req.files.length) {
    const maxPhotos = await getMaxPhotoCap();
    card.photos = await storeImages(req.files.slice(0, maxPhotos));
  }

  await card.save({ validateBeforeSave: false });

  res.redirect(`/dashboard/cards/${card._id}/build/music`);
});

// Scannable, downloadable QR code pointing at the card's public share link.
exports.downloadQr = catchAsync(async (req, res) => {
  const card = await Card.findOne({ _id: req.params.id, user: req.session.userId, status: 'paid' });
  if (!card) throw new AppError('Card not found.', 404);

  const shareUrl = `${process.env.BASE_URL}/c/${card.slug}`;
  const png = await QRCode.toBuffer(shareUrl, { width: 400, margin: 2 });

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="card-qr-${card.slug}.png"`);
  res.send(png);
});
