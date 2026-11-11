require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { DEFAULT_OCCASION } = require('../utils/occasions');

// Backfills `occasion` on every existing Template, Card, and Plan document.
// Mongoose's schema `default` only applies to documents created or read
// through Mongoose from this point forward — it does NOT retroactively
// write the field into documents already sitting in MongoDB, so anything
// that queries by `occasion` directly (e.g. { occasion: 'birthday' }) would
// silently miss pre-existing rows without this. Safe to re-run: only
// touches documents where the field doesn't exist yet.
async function migrateCollection(modelName, collectionName) {
  const result = await mongoose.connection.collection(collectionName).updateMany(
    { occasion: { $exists: false } },
    { $set: { occasion: DEFAULT_OCCASION } }
  );
  console.log(`${modelName}: backfilled ${result.modifiedCount} document(s).`);
}

async function migrateOccasion() {
  await connectDB();

  await migrateCollection('Template', 'templates');
  await migrateCollection('Card', 'cards');
  await migrateCollection('Plan', 'plans');

  await mongoose.disconnect();
  console.log('Migration complete.');
}

migrateOccasion().catch((err) => {
  console.error(err);
  process.exit(1);
});
