// Generates a single original branded Open Graph image (1200x630, the
// standard OG size) from an inline SVG — same approach as the proposal
// sticker assets (seedProposalTemplates.js): hand-authored, rasterized via
// sharp, not sourced from anywhere external. Run once; re-run any time the
// branding changes (safe to re-run, just overwrites the file).
const path = require('path');
const sharp = require('sharp');

const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'images', 'og-landing.png');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFBF4" />
      <stop offset="55%" stop-color="#FCE8C3" />
      <stop offset="100%" stop-color="#FBC9D3" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />

  <circle cx="110" cy="120" r="70" fill="#FDA4AF" opacity="0.5" />
  <circle cx="1080" cy="500" r="90" fill="#FCE8C3" opacity="0.6" />
  <circle cx="1020" cy="90" r="40" fill="#F43F5E" opacity="0.3" />

  <text x="600" y="270" font-family="Verdana, sans-serif" font-size="68" font-weight="700" fill="#92400E" text-anchor="middle">CelebraCraft</text>
  <text x="600" y="340" font-family="Verdana, sans-serif" font-size="32" fill="#57534E" text-anchor="middle">Animated Birthday Wishes &amp; Love Proposals</text>

  <!-- Simple original cake icon (no emoji — librsvg has no color-emoji font to rasterize them) -->
  <g transform="translate(390, 400)">
    <rect x="0" y="34" width="60" height="30" rx="4" fill="#B45309" />
    <rect x="0" y="18" width="60" height="18" rx="4" fill="#fff" stroke="#F43F5E" stroke-width="3" />
    <rect x="28" y="0" width="4" height="16" fill="#fff" />
    <ellipse cx="30" cy="-2" rx="4" ry="7" fill="#F59E0B" />
  </g>
  <text x="420" y="510" font-family="Verdana, sans-serif" font-size="24" fill="#B45309" font-weight="600" text-anchor="middle">Birthday Wish</text>

  <!-- Simple original heart icon -->
  <g transform="translate(750, 400)">
    <path d="M30 56 C12 42 2 28 2 17 C2 7 10 1 19 1 C24 1 28 4 30 9 C32 4 36 1 41 1 C50 1 58 7 58 17 C58 28 48 42 30 56 Z" fill="#F43F5E" />
  </g>
  <text x="780" y="510" font-family="Verdana, sans-serif" font-size="24" fill="#E11D48" font-weight="600" text-anchor="middle">Love Proposal</text>
</svg>
`;

sharp(Buffer.from(svg))
  .png()
  .toFile(OUTPUT_PATH)
  .then(() => console.log(`Open Graph image written to ${OUTPUT_PATH}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
