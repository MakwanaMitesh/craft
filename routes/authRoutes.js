const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const { redirectIfAuthenticated } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required.'),
  body('email').isEmail().withMessage('A valid email is required.'),
  body('phone').optional({ checkFalsy: true }).isMobilePhone('any').withMessage('Enter a valid phone number.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
];

const loginRules = [
  body('email').isEmail().withMessage('A valid email is required.'),
  body('password').notEmpty().withMessage('Password is required.'),
];

router.get('/register', redirectIfAuthenticated, authController.getRegister);
router.post('/register', authLimiter, registerRules, validate, authController.postRegister);

router.get('/login', redirectIfAuthenticated, authController.getLogin);
router.post('/login', authLimiter, loginRules, validate, authController.postLogin);

router.get('/auth/google', authLimiter, redirectIfAuthenticated, authController.startGoogleAuth);
router.get('/auth/google/callback', authLimiter, authController.googleAuthCallback);

router.post('/logout', authController.logout);

router.get('/forgot-password', authController.getForgotPassword);
router.post(
  '/forgot-password',
  authLimiter,
  [body('email').isEmail().withMessage('A valid email is required.')],
  validate,
  authController.postForgotPassword
);

router.get('/reset-password/:token', authController.getResetPassword);
router.post(
  '/reset-password/:token',
  authLimiter,
  [body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')],
  validate,
  authController.postResetPassword
);

module.exports = router;
