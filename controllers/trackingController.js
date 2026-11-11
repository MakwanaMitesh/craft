const Card = require('../models/Card');
const CardView = require('../models/CardView');
const CardEvent = require('../models/CardEvent');
const catchAsync = require('../utils/catchAsync');
const { EVENT_TYPES } = require('../utils/trackingEvents');
const { hashIp, parseDevice, detectReferrerSource, lookupLocation, isBotRequest } = require('../utils/tracking');

// Fire-and-forget analytics endpoint hit from the public card pages'
// tracking script. Always responds 200/204 on anything short of a malformed
// request — a dropped analytics beacon should never surface as an error to
// the recipient, and telling a bot/scanner which checks failed isn't useful.
exports.track = catchAsync(async (req, res) => {
  const { slug, sessionId, type, durationSeconds } = req.body || {};

  if (res.locals.settings?.features?.cardViewTrackingEnabled === false) {
    return res.status(204).end();
  }

  if (!slug || !sessionId || !EVENT_TYPES.includes(type)) {
    return res.status(204).end();
  }

  if (isBotRequest(req.get('user-agent'))) {
    return res.status(204).end();
  }

  const card = await Card.findOne({ slug, status: 'paid', isDisabled: { $ne: true } }).select('user occasion');
  if (!card) return res.status(204).end();

  // Exclude the card owner viewing their own link, and any admin, while
  // logged in — their visits aren't real recipient engagement.
  if (req.session?.userId && (String(req.session.userId) === String(card.user) || req.session.role === 'admin')) {
    return res.status(204).end();
  }

  const clampedDuration = Number.isFinite(Number(durationSeconds))
    ? Math.min(Math.max(Number(durationSeconds), 0), 24 * 60 * 60)
    : undefined;

  await CardEvent.create({
    card: card._id,
    sessionId,
    type,
    ...(type === 'time_spent' ? { durationSeconds: clampedDuration } : {}),
  });

  if (type === 'card_opened') {
    const ip = req.ip;
    const ipHash = hashIp(ip);
    const alreadySeenToday = await CardView.exists({ card: card._id, ipHash });

    const { deviceType, browser, os } = parseDevice(req.get('user-agent'));
    const { city, country } = lookupLocation(ip);

    await CardView.create({
      card: card._id,
      owner: card.user,
      occasion: card.occasion,
      sessionId,
      deviceType,
      browser,
      os,
      referrerSource: detectReferrerSource(req.get('referer')),
      city,
      country,
      ipHash,
      isUnique: !alreadySeenToday,
      furthestStep: 'card_opened',
    });

    await Card.updateOne(
      { _id: card._id },
      {
        $inc: { totalViews: 1, ...(alreadySeenToday ? {} : { uniqueViews: 1 }) },
        $set: { lastOpenedAt: new Date() },
      }
    );
  } else {
    const update = { furthestStep: type };
    if (type === 'time_spent' && clampedDuration !== undefined) update.durationSeconds = clampedDuration;
    // Best-effort — if the card_opened beacon never arrived (blocked
    // tracker, fast navigation away) there's no session row to attach this
    // to yet, and creating one without device/geo data would just pollute
    // the analytics with incomplete rows.
    await CardView.updateOne({ card: card._id, sessionId }, { $set: update });
  }

  res.status(204).end();
});
