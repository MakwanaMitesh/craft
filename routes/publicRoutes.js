const express = require('express');
const publicController = require('../controllers/publicController');
const trackingController = require('../controllers/trackingController');
const surpriseCardsController = require('../controllers/surpriseCardsController');
const maintenanceGate = require('../middleware/maintenance');
const dynamicPhotoUpload = require('../middleware/dynamicPhotoUpload');
const { verifyTokenAfterUpload } = require('../middleware/csrf');
const { openedLimiter, trackLimiter, cardCreateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Interactive Surprise Cards — new, free, no-login feature area, separate
// from the paid Template/Plan/Card system under /dashboard. Not linked from
// the navbar/homepage yet, per instruction — reachable directly only.
router.get('/cards/style-guide', surpriseCardsController.getStyleGuide);
router.get('/cards/apology/create', surpriseCardsController.getApologyCreate);
router.post(
  '/cards/apology/create',
  cardCreateLimiter,
  dynamicPhotoUpload, // reuses the same Settings-driven size/type limits as the paid wizard's photo uploads
  verifyTokenAfterUpload, // multipart body isn't parsed until multer runs, same reason every other upload route re-checks here
  surpriseCardsController.postApologyCreate
);
router.get('/cards/anniversary/create', surpriseCardsController.getAnniversaryCreate);
router.post(
  '/cards/anniversary/create',
  cardCreateLimiter,
  dynamicPhotoUpload.any(8), // one optional photo per timeline moment, up to 8 moments
  verifyTokenAfterUpload,
  surpriseCardsController.postAnniversaryCreate
);
router.get('/cards/puzzle/create', surpriseCardsController.getPuzzleCreate);
router.post(
  '/cards/puzzle/create',
  cardCreateLimiter,
  dynamicPhotoUpload, // single required "photos" field — the client already cropped it to a square before upload
  verifyTokenAfterUpload,
  surpriseCardsController.postPuzzleCreate
);

router.get('/', maintenanceGate, publicController.getLanding);
router.get('/demo/:templateSlug', maintenanceGate, publicController.getDemo);
// A thin per-route middleware sets req.params.page so the one handler stays
// generic — simpler than four near-identical controller exports.
const legalPage = (page) => (req, res, next) => {
  req.params.page = page;
  next();
};
router.get('/terms', legalPage('terms'), publicController.getLegalPage);
router.get('/privacy', legalPage('privacy'), publicController.getLegalPage);
router.get('/refund-policy', legalPage('refund-policy'), publicController.getLegalPage);
router.get('/contact', legalPage('contact'), publicController.getLegalPage);
// publicController.viewCard calls next() when the slug isn't a paid Card,
// falling through to the free Interactive Surprise Cards lookup below —
// one URL shape serves both systems without either needing to know about
// the other's data.
router.get('/c/:slug', maintenanceGate, publicController.viewCard, surpriseCardsController.viewSurpriseCard);
router.get('/c/:slug/results', maintenanceGate, surpriseCardsController.getSurpriseCardResults);
router.post('/c/:slug/opened', maintenanceGate, openedLimiter, publicController.markOpened);
router.post('/c/:slug/answer', maintenanceGate, openedLimiter, surpriseCardsController.answerSurpriseCard);
router.post('/c/:slug/solve', maintenanceGate, openedLimiter, surpriseCardsController.solvePuzzleCard);
router.post('/c/:slug/answer-question', maintenanceGate, openedLimiter, surpriseCardsController.answerPuzzleQuestion);
router.post('/api/cards/:slug/respond', maintenanceGate, openedLimiter, publicController.respondToProposal);
router.post('/api/track', maintenanceGate, trackLimiter, trackingController.track);

module.exports = router;
