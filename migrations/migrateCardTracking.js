require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

// Card.views was renamed to Card.totalViews when the tracking system was
// added (uniqueViews/lastOpenedAt are new counters with no prior data to
// carry over). Renaming a Mongoose schema field doesn't touch documents
// already in MongoDB, so without this, every card's existing view count
// would silently reset to 0 the first time totalViews is read. Safe to
// re-run: only touches documents that still have the old field name.
async function migrateCardTracking() {
  await connectDB();

  const cards = mongoose.connection.collection('cards');

  const renamed = await cards.updateMany(
    { views: { $exists: true }, totalViews: { $exists: false } },
    [{ $set: { totalViews: '$views' } }, { $unset: 'views' }]
  );
  console.log(`Card: renamed views -> totalViews on ${renamed.modifiedCount} document(s).`);

  const backfilled = await cards.updateMany(
    { totalViews: { $exists: false } },
    { $set: { totalViews: 0, uniqueViews: 0 } }
  );
  console.log(`Card: backfilled totalViews/uniqueViews on ${backfilled.modifiedCount} document(s).`);

  await mongoose.disconnect();
  console.log('Migration complete.');
}

migrateCardTracking().catch((err) => {
  console.error(err);
  process.exit(1);
});
