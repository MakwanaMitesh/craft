// Single source of truth for Interactive Surprise Card types — the new,
// free, no-login card system (separate from the paid Template/Plan/Card
// system under /dashboard). Same "one array" extensibility pattern as
// utils/occasions.js: add a new type here, nowhere else needs to know the
// full list.
const SURPRISE_CARD_TYPES = ['apology'];

module.exports = { SURPRISE_CARD_TYPES };
