const QRCode = require('qrcode');
const SurpriseCard = require('../models/SurpriseCard');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { generateCardSlug } = require('../utils/tokens');
const { storeImages } = require('../utils/mediaStorage');

// This file is the home for the new "Interactive Surprise Cards" feature
// (kept separate from the existing publicController/cardController, which
// already run the paid Birthday/Proposal occasion system) — a free,
// no-login, single-page-per-card-type system. No account/payment is
// involved anywhere here.
exports.getStyleGuide = catchAsync(async (req, res) => {
  const demoShareUrl = `${process.env.BASE_URL}/c/demo-preview`;
  const qrDataUrl = await QRCode.toDataURL(demoShareUrl, { width: 320, margin: 2 });

  res.render('public/style-guide', { title: 'Surprise Cards — Style Guide', demoShareUrl, qrDataUrl });
});

// --- Apology ---
const MOOD_CHARACTERS = ['bunny', 'teddy', 'cat'];
const FINAL_QUESTION_PRESETS = ['Will you forgive me?', 'Can we talk?', 'Friends again?'];
const MAX_APOLOGY_PHOTOS = 3;

exports.getApologyCreate = (req, res) => {
  res.render('public/apology-create', {
    title: "Say sorry the right way 💛",
    moodCharacters: MOOD_CHARACTERS,
    finalQuestionPresets: FINAL_QUESTION_PRESETS,
  });
};

// Trims and enforces a max length, returning null for anything that fails
// a required check — kept this plain (no express-validator) since errors
// need to come back as JSON for the page's own fetch() call, not a
// flash-and-redirect like every other form in this app.
function validateApologyInput(body) {
  const errors = {};
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');

  const theirName = clean(body.theirName);
  if (!theirName) errors.theirName = 'Their name is required.';
  else if (theirName.length > 30) errors.theirName = 'Keep their name under 30 characters.';

  const yourName = clean(body.yourName);
  if (!yourName) errors.yourName = 'Your name is required.';
  else if (yourName.length > 30) errors.yourName = 'Keep your name under 30 characters.';

  const moodCharacter = clean(body.moodCharacter);
  if (!MOOD_CHARACTERS.includes(moodCharacter)) errors.moodCharacter = 'Choose a mood character.';

  const sorryText = clean(body.sorryText);
  if (!sorryText) errors.sorryText = "Let them know what you're sorry for.";
  else if (sorryText.length > 500) errors.sorryText = 'Keep this under 500 characters.';

  const whyMatterText = clean(body.whyMatterText);
  if (whyMatterText.length > 500) errors.whyMatterText = 'Keep this under 500 characters.';

  let finalQuestion = clean(body.finalQuestion);
  if (!finalQuestion) finalQuestion = FINAL_QUESTION_PRESETS[0];
  if (finalQuestion.length > 100) errors.finalQuestion = 'Keep the question under 100 characters.';

  const forgiveMessage = clean(body.forgiveMessage);
  if (forgiveMessage.length > 300) errors.forgiveMessage = 'Keep this under 300 characters.';

  return {
    errors,
    values: { theirName, yourName, moodCharacter, sorryText, whyMatterText, finalQuestion, forgiveMessage },
  };
}

// Reached only when publicController.viewCard already checked and found no
// matching paid Card for this slug (see routes/publicRoutes.js).
exports.viewSurpriseCard = catchAsync(async (req, res) => {
  const card = await SurpriseCard.findOne({ slug: req.params.slug });
  if (!card) {
    return res.status(404).render('public/card-unavailable', { title: 'Card not found' });
  }

  if (!card.openedAt) {
    card.openedAt = new Date();
    await card.save();
  }

  if (card.type === 'apology') {
    return res.render('public/apology-recipient', { title: `A message for ${card.recipientName} 💛`, card });
  }

  // No other type exists yet — unreachable with the current SURPRISE_CARD_TYPES enum.
  return res.status(404).render('public/card-unavailable', { title: 'Card not found' });
});

// Fired both synchronously (fetch, on a "Yes" tap) and via
// navigator.sendBeacon (on page-hide, if they leave Screen 3 without ever
// tapping Yes) — either way the body is small JSON, parsed by the normal
// express.json() middleware. A beacon can't set a custom header, so the
// CSRF token travels inside the JSON body instead (tokenMatches() already
// checks req.body._csrf, same as every regular form on this site).
exports.answerSurpriseCard = catchAsync(async (req, res) => {
  const { answer } = req.body || {};
  if (!['yes', 'not_yet'].includes(answer)) return res.status(400).json({ success: false });

  // A later "not_yet" beacon (e.g. a stray page-hide firing around the same
  // moment as the "yes" tap's own request) must never overwrite a real
  // "yes" — yes is final once recorded. Doing the check and the write as
  // one atomic findOneAndUpdate (instead of findOne, then save) closes a
  // real race: two near-simultaneous requests reading the same
  // not-yet-answered state would otherwise both pass the check, and
  // whichever save() lands last would win regardless of which answer it was.
  const updated = await SurpriseCard.findOneAndUpdate(
    { slug: req.params.slug, recipientAnswer: { $ne: 'yes' } },
    { $set: { recipientAnswer: answer, answeredAt: new Date() } }
  );

  if (!updated) {
    // Either no card with this slug exists, or it's already answered "yes"
    // — the latter is still a success from the caller's point of view (the
    // answer stands, just not the one this particular request tried to set).
    const exists = await SurpriseCard.exists({ slug: req.params.slug });
    return res.status(exists ? 200 : 404).json({ success: Boolean(exists) });
  }

  res.json({ success: true });
});

exports.postApologyCreate = catchAsync(async (req, res) => {
  const { errors, values } = validateApologyInput(req.body);

  const files = req.files || [];
  if (files.length > MAX_APOLOGY_PHOTOS) {
    errors.photos = `Up to ${MAX_APOLOGY_PHOTOS} photos only.`;
  }

  if (Object.keys(errors).length) {
    return res.status(422).json({ success: false, errors });
  }

  const photos = files.length ? await storeImages(files) : [];

  const card = await SurpriseCard.create({
    slug: generateCardSlug(),
    type: 'apology',
    senderName: values.yourName,
    recipientName: values.theirName,
    fields: {
      moodCharacter: values.moodCharacter,
      sorryText: values.sorryText,
      whyMatterText: values.whyMatterText,
      finalQuestion: values.finalQuestion,
      forgiveMessage: values.forgiveMessage,
    },
    photos,
  });

  const shareUrl = `${process.env.BASE_URL}/c/${card.slug}`;
  const resultsUrl = `${process.env.BASE_URL}/c/${card.slug}/results?key=${card.resultsKey}`;
  const qrDataUrl = await QRCode.toDataURL(shareUrl, { width: 320, margin: 2 });

  res.json({
    success: true,
    shareUrl,
    resultsUrl,
    qrDataUrl,
    recipientName: card.recipientName,
    whatsappMessage: `I owe you something... please open this 💛 ${shareUrl}`,
    whatsappPreviewTitle: `A message for ${card.recipientName} 💛`,
  });
});

// Private, sender-only status page — gated by a secret `key` query param
// (card.resultsKey), never the public slug alone. Wrong/missing key gets
// the exact same 404 as a nonexistent card, so a guess can't distinguish
// "wrong key" from "no such card".
exports.getSurpriseCardResults = catchAsync(async (req, res) => {
  const card = await SurpriseCard.findOne({ slug: req.params.slug });
  if (!card || !req.query.key || req.query.key !== card.resultsKey) {
    return res.status(404).render('public/card-unavailable', { title: 'Page not found' });
  }

  res.render('public/surprise-card-results', {
    title: 'Card status',
    card,
    shareUrl: `${process.env.BASE_URL}/c/${card.slug}`,
  });
});
