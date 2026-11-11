const cron = require('node-cron');
const Card = require('../models/Card');
const User = require('../models/User');
const { sendMail } = require('../config/mailer');

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

// Emails the card owner once, ~2 days before their card's public link
// expires. expiryReminderSentAt is the de-dupe guard so a card already
// reminded doesn't get emailed again on every subsequent run.
async function sendExpiryReminders() {
  const now = new Date();
  const soon = new Date(now.getTime() + TWO_DAYS_MS);

  const cards = await Card.find({
    status: 'paid',
    expiresAt: { $gte: now, $lte: soon },
    expiryReminderSentAt: null,
  });

  for (const card of cards) {
    const user = await User.findById(card.user);
    if (!user) continue;

    await sendMail({
      to: user.email,
      subject: `Your card for ${card.recipientName} expires soon`,
      html: `<p>Hi ${user.name},</p><p>Your card for ${card.recipientName} stops being shareable on ${card.expiresAt.toDateString()}. Renew it soon if you'd like it to stay live.</p>`,
    });

    card.expiryReminderSentAt = now;
    await card.save();
  }

  return cards.length;
}

// Status itself stays computed (not stored) everywhere it's displayed, to
// avoid it drifting out of sync with expiresAt — see models/Card.js. This
// just surfaces a count for operational visibility; it writes nothing.
async function logExpiredCards() {
  const now = new Date();
  const count = await Card.countDocuments({ status: 'paid', expiresAt: { $lt: now } });
  if (count > 0) console.log(`[expiryCron] ${count} card(s) are past their expiry date.`);
  return count;
}

async function runDailyCheck() {
  const remindersSent = await sendExpiryReminders();
  const expiredCount = await logExpiredCards();
  console.log(`[expiryCron] Sent ${remindersSent} expiry reminder(s); ${expiredCount} card(s) currently expired.`);
  return { remindersSent, expiredCount };
}

function scheduleExpiryCron() {
  // Once a day at 09:00 server time.
  cron.schedule('0 9 * * *', () => {
    runDailyCheck().catch((err) => console.error('[expiryCron] run failed:', err));
  });
}

module.exports = { scheduleExpiryCron, runDailyCheck };
