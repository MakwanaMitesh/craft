const QRCode = require('qrcode');
const SurpriseCard = require('../models/SurpriseCard');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { generateCardSlug } = require('../utils/tokens');
const { storeImage, storeImages } = require('../utils/mediaStorage');
const { ordinalSuffix, calcAnniversaryNumber } = require('../utils/ordinal');

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

  if (card.type === 'anniversary') {
    // Passed as plain UTC month/day numbers, not the Date object itself —
    // the client reconstructs "next anniversary" with new Date(year, month,
    // day) in the recipient's own local time, with no UTC-to-local
    // conversion step to introduce an off-by-one-day error for anyone west
    // of UTC (an HTML <input type="date"> value has no time component, so
    // it's stored as UTC midnight; re-parsing that as a client-local
    // timestamp would otherwise shift the displayed date back a day).
    return res.render('public/anniversary-recipient', {
      title: `For ${card.recipientName}, with love 💍`,
      card,
      anniversaryLabel: `${ordinalSuffix(card.fields.anniversaryNumber)} anniversary`.toUpperCase(),
      togetherYear: card.fields.togetherDate.getUTCFullYear(),
      togetherMonth: card.fields.togetherDate.getUTCMonth(),
      togetherDay: card.fields.togetherDate.getUTCDate(),
    });
  }

  if (card.type === 'puzzle') {
    // Deliberately generic OG text, same reasoning as every other card type
    // here — WhatsApp/Instagram's link preview must never show the actual
    // photo (that's the whole surprise) or the hidden message.
    return res.render('public/puzzle-recipient', {
      title: `${card.recipientName}, a puzzle is waiting for you 🧩`,
      card,
      photoUrl: card.photos[0],
      gridSize: card.fields.gridSize,
    });
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

// --- Anniversary ---
const ILLUSTRATION_STYLES = ['handholding', 'umbrella', 'coffee'];
const MAX_TIMELINE_MOMENTS = 8;
const MAX_LOVE_LINES = 5;
const MAX_TIMELINE_CAPTION = 120;
const MAX_LOVE_LINE_LENGTH = 100;

exports.getAnniversaryCreate = (req, res) => {
  res.render('public/anniversary-create', {
    title: 'Celebrate your love story 💍',
    illustrationStyles: ILLUSTRATION_STYLES,
    maxTimelineMoments: MAX_TIMELINE_MOMENTS,
    maxLoveLines: MAX_LOVE_LINES,
  });
};

function validateAnniversaryInput(body) {
  const errors = {};
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');

  const yourName = clean(body.yourName);
  if (!yourName) errors.yourName = 'Your name is required.';
  else if (yourName.length > 30) errors.yourName = 'Keep your name under 30 characters.';

  const theirName = clean(body.theirName);
  if (!theirName) errors.theirName = 'Their name is required.';
  else if (theirName.length > 30) errors.theirName = 'Keep their name under 30 characters.';

  let togetherDate = null;
  const rawDate = clean(body.togetherDate);
  if (!rawDate) {
    errors.togetherDate = 'Pick the date you got together.';
  } else {
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) errors.togetherDate = 'Enter a valid date.';
    else if (parsed > new Date()) errors.togetherDate = "That date hasn't happened yet.";
    else togetherDate = parsed;
  }

  const illustrationStyle = clean(body.illustrationStyle);
  if (!ILLUSTRATION_STYLES.includes(illustrationStyle)) errors.illustrationStyle = 'Choose an illustration style.';

  const letterText = clean(body.letterText);
  if (!letterText) errors.letterText = 'Write your anniversary letter.';
  else if (letterText.length > 1200) errors.letterText = 'Keep this under 1200 characters.';

  // Love lines — up to 5, blanks dropped, each line quietly capped (not
  // spec'd as a hard validation error, just a sane ceiling against abuse).
  const rawLoveLines = Array.isArray(body.loveLines) ? body.loveLines : body.loveLines ? [body.loveLines] : [];
  const loveLines = rawLoveLines.map(clean).filter(Boolean).slice(0, MAX_LOVE_LINES).map((l) => l.slice(0, MAX_LOVE_LINE_LENGTH));

  // Timeline — up to 8 moments; a row with neither a date/label nor a
  // caption is just an unfilled "Add moment" row and is silently skipped.
  // `originalIndex` is kept (not persisted — stripped in postAnniversaryCreate)
  // so a photo uploaded as `timelinePhoto_<i>` can still be matched to the
  // right moment after blank rows shift everything else's array position.
  const rawDates = Array.isArray(body.timelineDate) ? body.timelineDate : body.timelineDate ? [body.timelineDate] : [];
  const rawCaptions = Array.isArray(body.timelineCaption) ? body.timelineCaption : body.timelineCaption ? [body.timelineCaption] : [];
  const timelineCount = Math.max(rawDates.length, rawCaptions.length);
  const timeline = [];
  for (let i = 0; i < Math.min(timelineCount, MAX_TIMELINE_MOMENTS); i++) {
    const dateOrLabel = clean(rawDates[i]);
    const caption = clean(rawCaptions[i]);
    if (!dateOrLabel && !caption) continue;
    if (caption.length > MAX_TIMELINE_CAPTION) {
      errors.timeline = `Moment ${timeline.length + 1}: keep the caption under ${MAX_TIMELINE_CAPTION} characters.`;
      break;
    }
    timeline.push({ originalIndex: i, dateOrLabel: dateOrLabel.slice(0, 40), caption, photo: null });
  }

  return {
    errors,
    values: { yourName, theirName, togetherDate, illustrationStyle, letterText, loveLines, timeline },
  };
}

exports.postAnniversaryCreate = catchAsync(async (req, res) => {
  const { errors, values } = validateAnniversaryInput(req.body);
  if (Object.keys(errors).length) {
    return res.status(422).json({ success: false, errors });
  }

  // req.files comes from multer's .any() (middleware/dynamicPhotoUpload.js's
  // "any" variant) — an array, each tagged with which named field it came
  // from (timelinePhoto_0, timelinePhoto_1, ...), since a moment's photo is
  // optional and sparse (not every moment has one).
  const files = req.files || [];
  const photoByIndex = new Map();
  files.forEach((file) => {
    const match = /^timelinePhoto_(\d+)$/.exec(file.fieldname);
    if (match) photoByIndex.set(Number(match[1]), file);
  });

  if (photoByIndex.size) {
    const indexes = [...photoByIndex.keys()];
    const storedUrls = await storeImages(indexes.map((i) => photoByIndex.get(i)));
    const byOriginalIndex = new Map(values.timeline.map((moment) => [moment.originalIndex, moment]));
    indexes.forEach((i, pos) => {
      const moment = byOriginalIndex.get(i);
      if (moment) moment.photo = storedUrls[pos];
    });
  }

  const anniversaryNumber = calcAnniversaryNumber(values.togetherDate);
  // originalIndex was only ever bookkeeping to match photos to the right
  // moment after blank rows were dropped — not part of the stored shape.
  const timeline = values.timeline.map(({ originalIndex, ...moment }) => moment);

  const card = await SurpriseCard.create({
    slug: generateCardSlug(),
    type: 'anniversary',
    senderName: values.yourName,
    recipientName: values.theirName,
    fields: {
      togetherDate: values.togetherDate,
      anniversaryNumber,
      illustrationStyle: values.illustrationStyle,
      letterText: values.letterText,
      loveLines: values.loveLines,
      timeline,
    },
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
    whatsappMessage: `Happy anniversary, my love 💍 Open this: ${shareUrl}`,
    whatsappPreviewTitle: `For ${card.recipientName}, with love 💍`,
  });
});

// --- Photo Puzzle ---
const PUZZLE_DIFFICULTIES = ['easy', 'medium', 'hard'];
const PUZZLE_GRID_SIZE = { easy: 3, medium: 4, hard: 5 };
const MAX_PUZZLE_QUESTIONS = 3;
const QUESTION_TYPES = ['yesno', 'multiple', 'short'];

exports.getPuzzleCreate = (req, res) => {
  res.render('public/puzzle-create', {
    title: 'Hide a surprise in a puzzle 🧩',
    difficulties: PUZZLE_DIFFICULTIES,
    gridSizes: PUZZLE_GRID_SIZE,
    maxQuestions: MAX_PUZZLE_QUESTIONS,
  });
};

// `questionsJson` travels as a single JSON string field (not parallel-array
// fields like Anniversary's timeline) since each question's shape varies by
// type — a multiple-choice question carries 2-4 options, the other two
// types carry none — and that's awkward to express as flat form fields
// without yet another originalIndex-style bookkeeping scheme.
function validatePuzzleQuestions(raw) {
  if (!raw) return { questions: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Questions could not be read.' };
  }
  if (!Array.isArray(parsed)) return { error: 'Questions could not be read.' };

  const questions = [];
  for (const item of parsed.slice(0, MAX_PUZZLE_QUESTIONS)) {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text) continue; // an unfilled question row is just skipped, same as Anniversary's blank timeline rows
    if (text.length > 150) return { error: 'Keep each question under 150 characters.' };

    const type = QUESTION_TYPES.includes(item?.type) ? item.type : 'short';
    const question = { text, type };

    if (type === 'multiple') {
      const options = Array.isArray(item?.options)
        ? item.options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean).slice(0, 4)
        : [];
      if (options.length < 2) return { error: 'Multiple choice questions need at least 2 options.' };
      if (options.some((o) => o.length > 50)) return { error: 'Keep each option under 50 characters.' };
      question.options = options;
    }

    questions.push(question);
  }
  return { questions };
}

function validatePuzzleInput(body) {
  const errors = {};
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');

  const theirName = clean(body.theirName);
  if (!theirName) errors.theirName = 'Their name is required.';
  else if (theirName.length > 30) errors.theirName = 'Keep their name under 30 characters.';

  const yourName = clean(body.yourName);
  if (!yourName) errors.yourName = 'Your name is required.';
  else if (yourName.length > 30) errors.yourName = 'Keep your name under 30 characters.';

  const difficulty = clean(body.difficulty) || 'easy';
  if (!PUZZLE_DIFFICULTIES.includes(difficulty)) errors.difficulty = 'Choose a difficulty.';

  const hiddenMessage = clean(body.hiddenMessage);
  if (!hiddenMessage) errors.hiddenMessage = "Write the message they'll unlock.";
  else if (hiddenMessage.length > 300) errors.hiddenMessage = 'Keep this under 300 characters.';

  const { questions, error: questionsError } = validatePuzzleQuestions(body.questionsJson);
  if (questionsError) errors.questions = questionsError;

  return { errors, values: { theirName, yourName, difficulty, hiddenMessage, questions: questions || [] } };
}

exports.postPuzzleCreate = catchAsync(async (req, res) => {
  const { errors, values } = validatePuzzleInput(req.body);

  const files = req.files || [];
  if (files.length !== 1) {
    errors.photo = 'Upload and crop one photo for the puzzle.';
  }

  if (Object.keys(errors).length) {
    return res.status(422).json({ success: false, errors });
  }

  const photoUrl = await storeImage(files[0]);

  const card = await SurpriseCard.create({
    slug: generateCardSlug(),
    type: 'puzzle',
    senderName: values.yourName,
    recipientName: values.theirName,
    fields: {
      difficulty: values.difficulty,
      gridSize: PUZZLE_GRID_SIZE[values.difficulty],
      hiddenMessage: values.hiddenMessage,
      questions: values.questions,
    },
    photos: [photoUrl],
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
    whatsappMessage: `Solve this to unlock your surprise 🧩🔒 ${shareUrl}`,
    whatsappPreviewTitle: `${card.recipientName}, a puzzle is waiting for you 🧩`,
  });
});

// Fired once, the moment the puzzle is solved (not gated behind the
// "Unlock my surprise" tap, so an abandoned card still records that it was
// actually solved). Same atomic "only the first write wins" guard as
// answerSurpriseCard, keyed off recipientAnswer so a stray double-fire (or
// someone reopening an already-solved card) can't clobber the real stats
// with, say, a second playthrough's numbers.
exports.solvePuzzleCard = catchAsync(async (req, res) => {
  const moves = Number(req.body?.moves);
  const timeSeconds = Number(req.body?.timeSeconds);
  const peeks = Number(req.body?.peeks);
  if (!Number.isFinite(moves) || !Number.isFinite(timeSeconds) || !Number.isFinite(peeks)) {
    return res.status(400).json({ success: false });
  }

  const updated = await SurpriseCard.findOneAndUpdate(
    { slug: req.params.slug, recipientAnswer: { $ne: 'solved' } },
    {
      $set: {
        recipientAnswer: 'solved',
        answeredAt: new Date(),
        'fields.solveStats': {
          moves: Math.max(0, Math.round(moves)),
          timeSeconds: Math.max(0, Math.round(timeSeconds)),
          peeks: Math.max(0, Math.round(peeks)),
        },
      },
    }
  );

  if (!updated) {
    const exists = await SurpriseCard.exists({ slug: req.params.slug });
    return res.status(exists ? 200 : 404).json({ success: Boolean(exists) });
  }

  res.json({ success: true });
});

// Saves one post-solve question's answer, the moment it's answered (not
// batched at the end) — stored keyed by its index so re-answering (e.g. a
// refresh mid-flow) overwrites that one answer instead of appending a
// duplicate. A read-then-validate step is needed here (unlike the simpler
// atomic updates elsewhere in this file) because what counts as a valid
// answer depends on that specific question's type/options, which only
// exist on this card's own `fields.questions`.
exports.answerPuzzleQuestion = catchAsync(async (req, res) => {
  const card = await SurpriseCard.findOne({ slug: req.params.slug, type: 'puzzle' });
  if (!card) return res.status(404).json({ success: false });

  const index = Number(req.body?.questionIndex);
  const question = Number.isInteger(index) ? card.fields.questions?.[index] : null;
  if (!question) return res.status(400).json({ success: false });

  const rawAnswer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
  if (question.type === 'yesno') {
    if (!['yes', 'no'].includes(rawAnswer)) return res.status(400).json({ success: false });
  } else if (question.type === 'multiple') {
    if (!question.options.includes(rawAnswer)) return res.status(400).json({ success: false });
  } else {
    if (!rawAnswer || rawAnswer.length > 200) return res.status(400).json({ success: false });
  }

  await SurpriseCard.updateOne(
    { slug: req.params.slug },
    { $set: { [`fields.answers.${index}`]: { text: question.text, answer: rawAnswer, answeredAt: new Date() } } }
  );

  res.json({ success: true });
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
