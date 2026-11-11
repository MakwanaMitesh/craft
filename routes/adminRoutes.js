const express = require('express');
const { body } = require('express-validator');
const adminController = require('../controllers/adminController');
const settingsController = require('../controllers/settingsController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { verifyTokenAfterUpload } = require('../middleware/csrf');

const router = express.Router();

router.use(isAuthenticated, isAdmin);

router.get('/dashboard', adminController.getDashboard);
router.get('/analytics', adminController.getAnalytics);
router.get('/audit-log', adminController.getAuditLog);

// Users
router.get('/users', adminController.listUsers);
router.get('/users/export.csv', adminController.exportUsersCsv);
router.get('/users/:id', adminController.getUserDetail);
router.post('/users/:id/toggle-block', adminController.toggleBlockUser);
router.post('/users/:id/delete', adminController.deleteUser);
router.post('/users/:id/reset-password', adminController.resetUserPassword);
router.post('/users/:id/login-as', adminController.loginAsUser);

// Templates
const templateRules = [
  body('name').trim().notEmpty().withMessage('Template name is required.'),
  body('slug').trim().notEmpty().withMessage('Template slug is required.'),
];

const templateUploads = upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'stickers', maxCount: 10 }, // proposal occasion only; harmless no-op field for birthday templates
]);

router.get('/templates', adminController.listTemplates);
router.get('/templates/export.csv', adminController.exportTemplatesCsv);
router.get('/templates/new', adminController.getNewTemplate);
router.post(
  '/templates',
  templateUploads,
  verifyTokenAfterUpload, // global check skips multipart bodies (unparsed until now) — re-run after multer parses req.body
  templateRules,
  validate,
  adminController.createTemplate
);
router.get('/templates/:id/edit', adminController.getEditTemplate);
router.post(
  '/templates/:id/edit',
  templateUploads,
  verifyTokenAfterUpload,
  templateRules,
  validate,
  adminController.updateTemplate
);
router.get('/templates/:id/preview', adminController.previewTemplate);
router.post('/templates/:id/toggle', adminController.toggleTemplate);
router.post('/templates/:id/delete', adminController.deleteTemplate);

// Plans
router.get('/plans', adminController.listPlans);
router.get('/plans/export.csv', adminController.exportPlansCsv);
router.post(
  '/plans',
  [
    body('name').trim().notEmpty().withMessage('Plan name is required.'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number.'),
  ],
  validate,
  adminController.createPlan
);
router.get('/plans/:id/edit', adminController.getEditPlan);
router.post(
  '/plans/:id/edit',
  [
    body('name').trim().notEmpty().withMessage('Plan name is required.'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number.'),
  ],
  validate,
  adminController.updatePlan
);
router.post('/plans/:id/toggle', adminController.togglePlan);
router.post('/plans/:id/delete', adminController.deletePlan);

// Orders
router.get('/orders', adminController.listOrders);
router.get('/orders/export.csv', adminController.exportOrdersCsv);
router.post('/orders/:id/refund', adminController.refundOrder);

// Cards
router.get('/cards', adminController.listCards);
router.get('/cards/export.csv', adminController.exportCardsCsv);
router.get('/cards/:id', adminController.getCardDetail);
router.post('/cards/:id/extend-expiry', adminController.extendCardExpiry);
router.post('/cards/:id/toggle-disable', adminController.toggleCardDisabled);
router.post('/cards/:id/delete', adminController.deleteCard);

// Reviews
router.get('/reviews', adminController.listReviews);
router.get('/reviews/export.csv', adminController.exportReviewsCsv);
router.post('/reviews/:id/approve', adminController.approveReview);
router.post('/reviews/:id/unapprove', adminController.unapproveReview);
router.post('/reviews/:id/delete', adminController.deleteReview);

// Settings
router.get('/settings', settingsController.getSettings);

const generalUploads = upload.fields([
  { name: 'logoLight', maxCount: 1 },
  { name: 'logoDark', maxCount: 1 },
  { name: 'favicon', maxCount: 1 },
  { name: 'ogImage', maxCount: 1 },
]);
router.post('/settings/general', generalUploads, verifyTokenAfterUpload, settingsController.updateGeneral);

router.post(
  '/settings/contact',
  [body('supportEmail').isEmail().withMessage('Enter a valid support email.')],
  validate,
  settingsController.updateContact
);
router.post('/settings/homepage', settingsController.updateHomepage);
router.post('/settings/seo', settingsController.updateSeo);
router.post('/settings/features', settingsController.updateFeatures);
router.post(
  '/settings/payments',
  [body('gstPercentage').optional({ checkFalsy: true }).isFloat({ min: 0, max: 100 }).withMessage('GST must be between 0 and 100.')],
  validate,
  settingsController.updatePayments
);
router.post(
  '/settings/email',
  [body('smtpPort').optional({ checkFalsy: true }).isInt({ min: 1, max: 65535 }).withMessage('Enter a valid port number.')],
  validate,
  settingsController.updateEmail
);
router.post('/settings/email/test', settingsController.sendTestEmail);
router.post(
  '/settings/uploads',
  [
    body('maxPhotoSizeMB').isFloat({ min: 1, max: 25 }).withMessage('Max photo size must be between 1 and 25 MB.'),
    body('maxPhotosPerCard').isInt({ min: 1, max: 30 }).withMessage('Max photos per card must be between 1 and 30.'),
  ],
  validate,
  settingsController.updateUploads
);
router.post('/settings/legal', settingsController.updateLegal);

module.exports = router;
