// Shared tracking client for the public card pages (card.ejs, card-proposal.ejs).
// Not loaded on /demo/:templateSlug previews or by logged-in owners/admins —
// those exclusions are enforced again server-side in trackingController,
// this is just the first line of defense against wasted calls.
(function () {
  function makeSessionId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const sessionId = makeSessionId();
  const slug = window.__CARD_SLUG__;
  if (!slug) return;

  function send(type, extra) {
    const payload = JSON.stringify({ slug, sessionId, type, ...extra });

    // sendBeacon survives the page unloading (needed for the closing
    // time_spent event); for everything else a normal fetch is fine and
    // easier to reason about. Both are best-effort — a dropped analytics
    // call should never affect the recipient's experience.
    if (type === 'time_spent' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
      return;
    }
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }

  const openedAt = Date.now();
  function sendDuration() {
    send('time_spent', { durationSeconds: Math.round((Date.now() - openedAt) / 1000) });
  }

  send('card_opened');
  window.addEventListener('pagehide', sendDuration);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendDuration();
  });

  window.CelebraTrack = { event: (type) => send(type) };
})();
