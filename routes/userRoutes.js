const express = require('express');
const { body } = require('express-validator');
const cardController = require('../controllers/cardController');
const paymentController = require('../controllers/paymentController');
const profileController = require('../controllers/profileController');
const notificationController = require('../controllers/notificationController');
const { isAuthenticated, isUser } = require('../middleware/auth');
const validate = require('../middleware/validate');
const dynamicPhotoUpload = require('../middleware/dynamicPhotoUpload');
const maintenanceGate = require('../middleware/maintenance');
const { paymentLimiter } = require('../middleware/rateLimiter');
const { verifyTokenAfterUpload } = require('../middleware/csrf');

const router = express.Router();

// Applied per-route (not via router.use) because this router is mounted at
// '/' alongside adminRoutes — a path-less router.use would run on every
// request, including /admin/*, before Express ever reaches adminRoutes.
// maintenanceGate comes first so a logged-out visitor sees the maintenance
// page instead of being bounced to /login.
const guard = [maintenanceGate, isAuthenticated, isUser];

const detailsRules = [
  body('recipientName').trim().notEmpty().withMessage('Recipient name is required.'),
  body('senderName').trim().notEmpty().withMessage('Your name is required.'),
  body('candleCount').optional().isInt({ min: 1, max: 20 }).withMessage('Candle count must be between 1 and 20.'),
];

// Reachable while an admin is impersonating a customer (session role is
// temporarily 'user'), so only isAuthenticated is required here, not isUser.
router.post('/stop-impersonating', maintenanceGate, isAuthenticated, require('../controllers/adminController').stopImpersonating);

router.get('/dashboard', guard, cardController.getDashboard);

// Wizard step 1 — choose occasion (new card only; no card exists yet)
router.get('/dashboard/cards/new', guard, cardController.getChooseOccasion);
router.get('/dashboard/cards/new/template', guard, cardController.getNewCardTemplate);
router.post(
  '/dashboard/cards',
  guard,
  body('templateId').notEmpty().withMessage('Please choose a template.'),
  validate,
  cardController.postNewCard
);
router.get('/dashboard/cards/:id/build/template', guard, cardController.getChangeTemplate);
router.post(
  '/dashboard/cards/:id/build/template',
  guard,
  body('templateId').notEmpty().withMessage('Please choose a template.'),
  validate,
  cardController.postChangeTemplate
);

// Wizard step 2 — recipient details
router.get('/dashboard/cards/:id/build/details', guard, cardController.getDetails);
router.post('/dashboard/cards/:id/build/details', guard, detailsRules, validate, cardController.postDetails);

// Wizard step 3 — photos
router.get('/dashboard/cards/:id/build/photos', guard, cardController.getPhotos);
router.post(
  '/dashboard/cards/:id/build/photos',
  guard,
  dynamicPhotoUpload,
  verifyTokenAfterUpload, // global check skips multipart bodies (unparsed until now) — re-run after multer parses req.body
  cardController.postPhotos
);

// Wizard step 4 — message
router.get('/dashboard/cards/:id/build/message', guard, cardController.getMessage);
router.post('/dashboard/cards/:id/build/message', guard, cardController.postMessage);

// Proposal wizard — b) names, c) question, d) sticker, e) yes-message + photos
router.get('/dashboard/cards/:id/build/proposal/names', guard, cardController.getProposalNames);
router.post(
  '/dashboard/cards/:id/build/proposal/names',
  guard,
  [
    body('partnerName').trim().notEmpty().withMessage("Partner's name is required."),
    body('senderName').trim().notEmpty().withMessage('Your name is required.'),
  ],
  validate,
  cardController.postProposalNames
);

router.get('/dashboard/cards/:id/build/proposal/question', guard, cardController.getProposalQuestion);
router.post('/dashboard/cards/:id/build/proposal/question', guard, cardController.postProposalQuestion);

router.get('/dashboard/cards/:id/build/proposal/sticker', guard, cardController.getProposalSticker);
router.post('/dashboard/cards/:id/build/proposal/sticker', guard, cardController.postProposalSticker);

router.get('/dashboard/cards/:id/build/proposal/yes-message', guard, cardController.getProposalYesMessage);
router.post(
  '/dashboard/cards/:id/build/proposal/yes-message',
  guard,
  dynamicPhotoUpload,
  verifyTokenAfterUpload,
  cardController.postProposalYesMessage
);

// Wizard step 5 — music (shared by both occasions)
router.get('/dashboard/cards/:id/build/music', guard, cardController.getMusic);
router.post('/dashboard/cards/:id/build/music', guard, cardController.postMusic);

// Wizard step 6 — preview before paying
router.get('/dashboard/cards/:id/build/preview', guard, cardController.getWizardPreview);
router.get('/dashboard/cards/:id/preview', guard, cardController.renderOwnPreview);

router.post('/dashboard/cards/:id/delete', guard, cardController.deleteCard);

router.get('/dashboard/cards/:id/checkout', guard, cardController.getCheckout);
router.get('/dashboard/cards/:id/success', guard, paymentController.getSuccess);
router.get('/dashboard/cards/:id/payment-failed', guard, paymentController.getFailure);
router.get('/dashboard/cards/:id/qr.png', guard, cardController.downloadQr);
router.get('/dashboard/cards/:id/stats', guard, cardController.getCardStats);

router.get('/api/notifications', guard, notificationController.listNotifications);
router.post('/api/notifications/read', guard, notificationController.markAllRead);

router.post('/payments/create-order', guard, paymentLimiter, paymentController.createOrder);
router.post('/payments/verify', guard, paymentLimiter, paymentController.verifyPayment);

// My orders + invoices
router.get('/dashboard/orders', guard, paymentController.listOrders);
router.get('/dashboard/orders/:id/invoice.pdf', guard, paymentController.downloadInvoice);

// Profile
router.get('/dashboard/profile', guard, profileController.getProfile);
router.post(
  '/dashboard/profile',
  guard,
  body('name').trim().notEmpty().withMessage('Name is required.'),
  validate,
  profileController.updateProfile
);
router.post(
  '/dashboard/profile/password',
  guard,
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.'),
  validate,
  profileController.changePassword
);

module.exports = router;
