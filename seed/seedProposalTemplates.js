require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Template = require('../models/Template');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'images', 'uploads');

// Small original SVG shapes, rasterized to PNG via sharp — kept in-repo as
// code rather than binary assets, and avoids sourcing any third-party
// sticker art. Each shape is parameterized by color so the same 3 shapes
// can be re-themed per template.
function heartSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <path d="M50 88 C20 65 5 45 5 28 C5 12 18 2 32 2 C40 2 47 7 50 14 C53 7 60 2 68 2 C82 2 95 12 95 28 C95 45 80 65 50 88 Z" fill="${color}" />
  </svg>`;
}
function sparkleSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <path d="M50 2 C52 32 54 48 50 50 C48 54 32 52 2 50 C32 48 48 46 50 50 C52 48 68 50 98 50 C68 52 52 54 50 50 C48 68 50 82 50 98 C48 68 46 52 50 50 Z" fill="${color}" />
  </svg>`;
}
function ringSvg(primary, secondary) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="60" r="32" fill="none" stroke="${primary}" stroke-width="10" />
    <path d="M50 10 L38 32 L62 32 Z" fill="${secondary}" />
  </svg>`;
}

async function renderSticker(svgString, filename) {
  const outputPath = path.join(UPLOAD_DIR, filename);
  await sharp(Buffer.from(svgString)).resize(200, 200).png().toFile(outputPath);
  return `/images/uploads/${filename}`;
}

async function buildStickers(slug, primary, secondary) {
  return [
    { name: 'Heart', url: await renderSticker(heartSvg(secondary), `${slug}-heart.png`) },
    { name: 'Sparkle', url: await renderSticker(sparkleSvg(primary), `${slug}-sparkle.png`) },
    { name: 'Ring', url: await renderSticker(ringSvg(primary, secondary), `${slug}-ring.png`) },
  ];
}

const STARTER_PROPOSAL_TEMPLATES = [
  {
    name: 'Rose Blush',
    slug: 'rose-blush',
    occasion: 'proposal',
    colorTheme: { primary: '#FDA4AF', secondary: '#E11D48', background: '#FFF1F2' },
    fontPairId: 'dancing-lato',
    sortOrder: 4,
  },
  {
    name: 'Starry Night',
    slug: 'starry-night',
    occasion: 'proposal',
    colorTheme: { primary: '#D4AF37', secondary: '#1E3A8A', background: '#0B1120' },
    fontPairId: 'playfair-inter',
    sortOrder: 5,
    isPremium: true,
  },
];

async function seedProposalTemplates() {
  await connectDB();
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  for (const data of STARTER_PROPOSAL_TEMPLATES) {
    const existing = await Template.findOne({ slug: data.slug });
    if (existing) {
      console.log(`Skipping "${data.name}" — already exists.`);
      continue;
    }

    const stickers = await buildStickers(data.slug, data.colorTheme.primary, data.colorTheme.secondary);
    await Template.create({ ...data, stickers });
    console.log(`Created template: ${data.name} (${stickers.length} stickers)`);
  }

  await mongoose.disconnect();
}

seedProposalTemplates().catch((err) => {
  console.error(err);
  process.exit(1);
});
