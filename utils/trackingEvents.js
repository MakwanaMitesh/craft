// Shared vocabulary of event types the public card pages report to
// POST /api/track (see public/js/tracking.js, controllers/trackingController).
const EVENT_TYPES = [
  'card_opened',
  'tapped_open',
  'balloons_done',
  'candles_blown',
  'letter_opened',
  'replay',
  'no_attempt',
  'yes_clicked',
  'time_spent',
];

module.exports = { EVENT_TYPES };
