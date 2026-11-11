// All editable landing-page copy lives here — change headlines, feature
// descriptions, FAQ answers, etc. without touching views/public/landing.ejs
// or any controller logic. This is the single source of truth for landing
// copy (site-wide settings like name/logo/support email still live in the
// Settings model/admin panel, unrelated to this file).

module.exports = {
  seo: {
    title: 'CelebraCraft — Animated Birthday Wishes & Love Proposal Websites',
    description:
      'Create an animated birthday wish or love proposal website in 5 minutes and share it with one link. Balloons, cake, a runaway NO button, confetti, and more — works on any phone.',
    keywords:
      'birthday wish website, animated birthday card, love proposal website, online proposal, propose online, birthday card maker, digital birthday surprise',
  },

  hero: {
    headline: 'Surprise them with a website made just for them',
    subline: 'Animated birthday wishes and love proposals. Ready in 5 minutes, shared with one link.',
  },

  occasions: {
    birthday: {
      label: 'Birthday Wish',
      emoji: '🎂',
      tagline: 'Tap to open → balloons → cake with candles → letter',
      description: 'A playful, animated surprise that unfolds step by step — perfect for a birthday they won\'t forget.',
      includes: ['Floating balloons', 'Cake with blowable candles', 'A letter that types itself', 'Photo gallery', 'Background music'],
    },
    proposal: {
      label: 'Love Proposal',
      emoji: '💌',
      tagline: 'Tap to open → question with YES/NO → celebration',
      description: 'Ask the big question with a playful runaway NO button, then celebrate the moment they say yes.',
      includes: ['Your own custom question', 'A NO button that runs away', 'Heart-confetti celebration', 'Photo slideshow', 'You get notified the moment they say YES'],
    },
  },

  howItWorks: [
    { icon: '🎯', title: 'Choose occasion and design', text: 'Pick Birthday or Proposal, then a template that matches the mood.' },
    { icon: '✍️', title: 'Add name, photos, and message', text: 'Personalize it with their name, your photos together, and your words.' },
    { icon: '📲', title: 'Pay and share the link', text: 'One link, shareable anywhere — WhatsApp, text, email, wherever.' },
  ],

  featureSpotlight: [
    {
      occasion: 'birthday',
      title: 'Blow out the candles 🕯️',
      text: "They tap each candle (or blow into their mic) to put them out one by one, then confetti bursts and the letter reveals itself — typed out line by line, like it's being written just for them.",
    },
    {
      occasion: 'proposal',
      title: "The NO button they can't catch 😅",
      text: "Every time they go to press NO, it jumps somewhere else on screen — getting smaller and harder to hit each time, while YES grows bigger. It's playful pressure that makes saying yes feel inevitable.",
    },
    {
      occasion: 'common',
      title: 'Get notified the moment they say YES 💖',
      text: "You'll get an email the instant they answer — with the exact time and how many times they tried to dodge the question. For birthdays, you're notified the moment they open your card too.",
    },
  ],

  commonFeatures: [
    { icon: '🎵', label: 'Background music' },
    { icon: '📸', label: 'Photo gallery' },
    { icon: '📱', label: 'QR code to share' },
    { icon: '👀', label: 'View count' },
    { icon: '✨', label: 'Works on any phone' },
  ],

  faq: [
    {
      q: 'How long does the link stay active?',
      a: 'Every plan includes a validity period (shown on the pricing section) — typically up to a year — after which the link stops opening. You can always renew.',
    },
    {
      q: 'Can I edit after paying?',
      a: 'The core content (names, photos, message) is set when you publish. If you need a change, reach out to support and we\'ll help.',
    },
    {
      q: 'Does it work on iPhone and Android?',
      a: 'Yes — every card is built mobile-first and tested on both. No app required, it just opens in the browser.',
    },
    {
      q: 'Will they know who sent the proposal?',
      a: 'Only if you want them to — your name appears on the celebration screen as "Made with love by [you]" once they say yes, not before.',
    },
    {
      q: 'Is payment safe?',
      a: 'Yes — all payments are processed securely through Razorpay. We never see or store your card details.',
    },
    {
      q: 'What is the refund policy?',
      a: 'See our Refund Policy page for full details. In short: reach out within a few days of a failed or accidental purchase and we\'ll sort it out.',
    },
  ],

  finalCta: {
    headline: 'Make someone\'s day today',
  },
};
