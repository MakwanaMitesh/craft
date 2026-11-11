// Single source of truth for occasion types, shared by Template, Card, and
// Plan. Adding a new occasion later (e.g. 'anniversary') means updating this
// one array — every model's enum and the migration script read from it.
const OCCASIONS = ['birthday', 'proposal'];
const DEFAULT_OCCASION = 'birthday';

const FEATURE_FLAG_BY_OCCASION = {
  birthday: 'birthdayEnabled',
  proposal: 'proposalEnabled',
};

// Customer-facing surfaces (homepage, builder, pricing) only ever offer
// occasions the admin has switched on in Settings → Feature toggles.
// Already-paid cards of a disabled occasion are untouched — this only
// filters what a *new* visitor is offered, never what an existing public
// card link does.
function getEnabledOccasions(settings) {
  return OCCASIONS.filter((o) => settings?.features?.[FEATURE_FLAG_BY_OCCASION[o]] !== false);
}

module.exports = { OCCASIONS, DEFAULT_OCCASION, getEnabledOccasions };
