// Shared vanilla-JS component library for every Interactive Surprise Card
// recipient experience. Pairs with public/css/cards.css. No framework, no
// build step — loaded directly with a <script> tag, exposes everything
// under window.SurpriseCard.
//
// Data shape for a card — see models/SurpriseCard.js:
//   { slug, type, senderName, recipientName, fields, photos[], createdAt,
//     openedAt, recipientAnswer, answeredAt }

(function (global) {
  'use strict';

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- 1. ScreenContainer ---
  // Manages a stack of .sc-screen elements inside a .sc-screen-container,
  // showing exactly one at a time with a fade + upward-slide transition.
  function createScreenContainer(containerEl) {
    const screens = Array.from(containerEl.querySelectorAll('.sc-screen'));
    let current = -1;

    function show(index) {
      if (index < 0 || index >= screens.length) return;
      screens.forEach((s, i) => s.classList.toggle('sc-active', i === index));
      current = index;
    }

    function next() {
      show(current + 1);
    }

    function goTo(index) {
      show(index);
    }

    if (screens.length) show(0);

    return { next, goTo, get current() { return current; }, screens };
  }

  // --- 2. TapToContinue ---
  // Just a class + a click handler wire-up helper — the pulsing animation
  // itself is pure CSS (.sc-tap-continue), so it keeps running at 60fps
  // without any JS involved, and stops automatically under reduced motion.
  function wireTapToContinue(buttonEl, onTap) {
    buttonEl.classList.add('sc-tap-continue');
    buttonEl.addEventListener('click', onTap, { once: true });
  }

  // --- 3. FloatingHearts ---
  // Spawns a steady trickle of small heart shapes that rise and fade,
  // color configurable per call. No-ops under reduced motion rather than
  // spawning static, going-nowhere hearts.
  function startFloatingHearts(layerEl, { color = '#E07A8B', count = 10, intervalMs = 900, speedMultiplier = 1 } = {}) {
    if (prefersReducedMotion()) return { stop() {} };

    let stopped = false;
    const heartPath = 'M12 21s-7.5-4.6-10-9C.3 8.4 2 4 6 4c2 0 3.4 1 4 2.3C10.6 5 12 4 14 4c4 0 5.7 4.4 4 8-2.5 4.4-10 9-10 9z';

    function spawnOne() {
      if (stopped) return;
      const heart = document.createElement('div');
      heart.className = 'sc-heart';
      heart.style.left = `${4 + Math.random() * 92}%`;
      heart.style.width = heart.style.height = `${16 + Math.random() * 18}px`;
      heart.style.animationDuration = `${(5 + Math.random() * 3) * speedMultiplier}s`;
      heart.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="${heartPath}" fill="${color}"/></svg>`;
      layerEl.appendChild(heart);
      heart.addEventListener('animationend', () => heart.remove());
    }

    for (let i = 0; i < count; i++) setTimeout(spawnOne, i * (intervalMs / count));
    const timer = setInterval(spawnOne, intervalMs);

    return { stop: () => { stopped = true; clearInterval(timer); } };
  }

  // --- FloatingBokeh (ambient background, shared helper) ---
  // Very slow (18-26s), low-opacity soft circles drifting upward — a
  // calmer alternative to FloatingHearts for sincere/gentle card types.
  function startFloatingBokeh(layerEl, { colors = ['#E6DEF7', '#F8D7DA', '#FFF8F0'], count = 7, opacity = 0.18 } = {}) {
    if (prefersReducedMotion()) return { stop() {} };

    let stopped = false;
    function spawnOne() {
      if (stopped) return;
      const circle = document.createElement('div');
      const size = 60 + Math.random() * 90;
      circle.className = 'sc-bokeh';
      circle.style.left = `${Math.random() * 100}%`;
      circle.style.width = circle.style.height = `${size}px`;
      circle.style.background = colors[Math.floor(Math.random() * colors.length)];
      circle.style.setProperty('--bokeh-opacity', opacity);
      circle.style.animationDuration = `${18 + Math.random() * 8}s`;
      layerEl.appendChild(circle);
      circle.addEventListener('animationend', () => circle.remove());
    }

    for (let i = 0; i < count; i++) setTimeout(spawnOne, i * 1800);
    const timer = setInterval(spawnOne, 2600);
    return { stop: () => { stopped = true; clearInterval(timer); } };
  }

  // --- FloatingEmojis (ambient background, shared helper) ---
  // Like FloatingHearts but for an arbitrary mix of plain-text emoji at
  // varied sizes/speeds — Friendship's floating 🫂💛🎈✨🎉🧡, and any future
  // card that wants a similar effect without a dedicated SVG shape.
  function startFloatingEmojis(layerEl, { emojis = ['✨'], count = 12, intervalMs = 900, speedMultiplier = 1, maxConcurrent = 15 } = {}) {
    if (prefersReducedMotion()) return { stop() {} };

    let stopped = false;
    let alive = 0;
    function spawnOne() {
      // A hard ceiling on top of the timing-based implicit rate limit —
      // without it, a backgrounded tab's throttled/batched timers can let
      // several ticks' worth of spawns fire in a burst once it's visible
      // again, briefly spiking well past what the interval alone implies.
      if (stopped || alive >= maxConcurrent) return;
      alive += 1;
      const span = document.createElement('span');
      span.className = 'sc-emoji';
      span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      span.style.left = `${4 + Math.random() * 92}%`;
      span.style.fontSize = `${16 + Math.random() * 22}px`;
      span.style.animationDuration = `${(5 + Math.random() * 3) * speedMultiplier}s`;
      layerEl.appendChild(span);
      span.addEventListener('animationend', () => { alive -= 1; span.remove(); });
    }

    for (let i = 0; i < count; i++) setTimeout(spawnOne, i * (intervalMs / count));
    const timer = setInterval(spawnOne, intervalMs);
    return { stop: () => { stopped = true; clearInterval(timer); } };
  }

  // --- 4. Confetti ---
  // Thin wrapper around the canvas-confetti CDN library already used by
  // the rest of the site's card engine (views/public/card.ejs) — reused
  // here rather than reimplemented, so there's one confetti dependency,
  // not two.
  function burstConfetti(opts = {}) {
    if (typeof confetti !== 'function') return; // library not loaded on this page
    if (prefersReducedMotion()) return;
    confetti({
      particleCount: 60,
      spread: 90,
      startVelocity: 35,
      origin: { y: 0.5 },
      colors: ['#E07A8B', '#D4A373', '#F8D7DA'],
      ...opts,
    });
  }

  // --- 5. EnvelopeLetter ---
  // Tap the envelope -> flap opens -> letter fades in -> text types itself
  // out in the handwritten font. `text` may contain literal "\n" for line
  // breaks.
  function createEnvelopeLetter({ wrapEl, letterEl, textEl, text, onOpen, typeSpeedMs = 28, openDelayMs = 500 }) {
    let opened = false;

    function typeText() {
      const full = text || '';
      textEl.textContent = '';
      const caret = document.createElement('span');
      caret.className = 'sc-letter-caret';
      textEl.after(caret);

      if (prefersReducedMotion()) {
        textEl.textContent = full;
        caret.remove();
        return;
      }

      let i = 0;
      const speedMs = typeSpeedMs;
      const timer = setInterval(() => {
        i += 1;
        textEl.textContent = full.slice(0, i);
        if (i >= full.length) {
          clearInterval(timer);
          caret.remove();
        }
      }, speedMs);
    }

    wrapEl.addEventListener('click', () => {
      if (opened) return;
      opened = true;
      wrapEl.classList.add('sc-open');
      setTimeout(() => {
        letterEl.classList.add('sc-visible');
        typeText();
      }, prefersReducedMotion() ? 0 : openDelayMs);
      if (onOpen) onOpen();
    });

    // Lets a "watch again"-style replay reopen the same envelope — without
    // this, the click listener's own closed-over `opened` flag would
    // permanently refuse to reopen it a second time in the same page load.
    function reset() {
      opened = false;
      wrapEl.classList.remove('sc-open');
      letterEl.classList.remove('sc-visible');
      textEl.textContent = '';
    }

    return { isOpen: () => opened, reset };
  }

  // --- 6. PhotoPolaroids ---
  // A stack of tilted polaroids; swipe (or drag) the front one away to
  // reveal the next. Loops back to the first after the last.
  function createPhotoPolaroids(stackEl) {
    const cards = Array.from(stackEl.querySelectorAll('.sc-polaroid'));
    let order = cards.map((_, i) => i);

    function render() {
      order.forEach((cardIndex, position) => {
        const el = cards[cardIndex];
        const tilt = (cardIndex % 2 === 0 ? -1 : 1) * (3 + (cardIndex % 3) * 2);
        el.style.zIndex = String(cards.length - position);
        el.style.transform = position === 0
          ? `translate(0, 0) rotate(${tilt}deg) scale(1)`
          : `translate(${position * 6}px, ${position * 8}px) rotate(${tilt + position * 2}deg) scale(${1 - position * 0.04})`;
        el.style.opacity = position < 3 ? '1' : '0';
      });
    }

    function advance() {
      order.push(order.shift());
      render();
    }

    let startX = 0;
    function onStart(e) { startX = (e.touches ? e.touches[0] : e).clientX; }
    function onEnd(e) {
      const endX = (e.changedTouches ? e.changedTouches[0] : e).clientX;
      if (Math.abs(endX - startX) > 40) advance();
    }

    const front = () => cards[order[0]];
    stackEl.addEventListener('touchstart', onStart, { passive: true });
    stackEl.addEventListener('touchend', onEnd, { passive: true });
    stackEl.addEventListener('mousedown', onStart);
    stackEl.addEventListener('mouseup', onEnd);
    stackEl.addEventListener('click', () => advance());

    render();
    return { advance, get frontIndex() { return order[0]; } };
  }

  // --- 7. SoundToggle ---
  // Starts muted (autoplay-with-sound is blocked by every mobile browser
  // without a user gesture anyway) and only unmutes after the first tap.
  function createSoundToggle(buttonEl, audioEl) {
    let muted = true;
    if (audioEl) audioEl.muted = true;
    buttonEl.textContent = '🔇';

    buttonEl.addEventListener('click', () => {
      muted = !muted;
      if (audioEl) {
        audioEl.muted = muted;
        if (!muted) audioEl.play().catch(() => {});
      }
      buttonEl.textContent = muted ? '🔇' : '🔈';
    });

    return { get muted() { return muted; } };
  }

  // --- 8. ShareScreen ---
  // Wires up copy-link, WhatsApp share, and a "preview" link. The QR code
  // image itself is generated server-side (see controllers/surpriseCardsController.js)
  // and just passed in as a ready <img src>, so this page never needs a
  // client-side QR library.
  function wireShareScreen({ copyBtn, whatsappBtn, previewBtn, shareUrl, whatsappText }) {
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(shareUrl);
          const original = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = original; }, 1500);
        } catch {
          // Clipboard API unavailable (very old browser, or non-HTTPS) — the
          // link is still visible/selectable on the page itself.
        }
      });
    }
    if (whatsappBtn) {
      const text = encodeURIComponent(`${whatsappText || ''} ${shareUrl}`.trim());
      whatsappBtn.setAttribute('href', `https://wa.me/?text=${text}`);
      whatsappBtn.setAttribute('target', '_blank');
      whatsappBtn.setAttribute('rel', 'noopener');
    }
    if (previewBtn) {
      previewBtn.setAttribute('href', shareUrl);
      previewBtn.setAttribute('target', '_blank');
      previewBtn.setAttribute('rel', 'noopener');
    }
  }

  // --- 9. ReportLink ---
  // A small, unobtrusive "Report this card" link shown on every free card
  // type's recipient page. Confirms once, then disables itself — there's no
  // undo on the server side either, since this only raises a flag for an
  // admin to look at, it doesn't take the card down by itself.
  function wireReportLink(linkEl, { slug, csrfToken }) {
    linkEl.addEventListener('click', async (e) => {
      e.preventDefault();
      if (linkEl.dataset.reported) return;
      if (!window.confirm('Report this card to the site admins?')) return;

      try {
        await fetch(`/c/${slug}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ _csrf: csrfToken }),
        });
      } catch {
        // Best-effort — there's nothing more useful to do client-side if
        // this particular request fails than to just let them try again.
      }
      linkEl.dataset.reported = 'true';
      linkEl.textContent = 'Reported — thanks';
    });
  }

  global.SurpriseCard = {
    createScreenContainer,
    wireTapToContinue,
    startFloatingHearts,
    startFloatingBokeh,
    startFloatingEmojis,
    burstConfetti,
    createEnvelopeLetter,
    createPhotoPolaroids,
    createSoundToggle,
    wireShareScreen,
    wireReportLink,
  };
})(window);
