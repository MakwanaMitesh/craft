require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Template = require('../models/Template');

const STARTER_TEMPLATES = [
  {
    name: 'Warm Sunset',
    slug: 'warm-sunset',
    colorTheme: { primary: '#B45309', secondary: '#F97316', background: '#FFF7ED' },
    fontPairId: 'fredoka-nunito',
    sections: { balloons: true, cake: true, letter: true, photoGallery: false },
    isPremium: false,
    sortOrder: 1,
  },
  {
    name: 'Pastel Party',
    slug: 'pastel-party',
    colorTheme: { primary: '#EC4899', secondary: '#818CF8', background: '#FDF4FF' },
    fontPairId: 'quicksand-work',
    sections: { balloons: true, cake: true, letter: true, photoGallery: true },
    isPremium: false,
    sortOrder: 2,
  },
  {
    name: 'Midnight Gold',
    slug: 'midnight-gold',
    colorTheme: { primary: '#CA8A04', secondary: '#1E293B', background: '#0F172A' },
    fontPairId: 'comfortaa-karla',
    sections: { balloons: false, cake: true, letter: true, photoGallery: true },
    isPremium: true,
    sortOrder: 3,
  },
];

async function seedTemplates() {
  await connectDB();

  for (const data of STARTER_TEMPLATES) {
    const existing = await Template.findOne({ slug: data.slug });
    if (existing) {
      console.log(`Skipping "${data.name}" — already exists.`);
      continue;
    }
    await Template.create(data);
    console.log(`Created template: ${data.name}`);
  }

  await mongoose.disconnect();
}

seedTemplates().catch((err) => {
  console.error(err);
  process.exit(1);
});
