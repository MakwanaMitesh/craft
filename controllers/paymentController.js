const crypto = require('crypto');
const Razorpay = require('razorpay');
const PDFDocument = require('pdfkit');
const Card = require('../models/Card');
const Plan = require('../models/Plan');
const Order = require('../models/Order');
const User = require('../models/User');
const Setting = require('../models/Setting');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { sendMail } = require('../config/mailer');

// Admin can override the Razorpay keys from Settings; fall back to .env
// when the admin hasn't set them in the UI yet.
async function getRazorpayCredentials() {
  const settings = await Setting.getSingletonWithSecret();
  return {
    keyId: settings.razorpayKeyId || process.env.RAZORPAY_KEY_ID,
    keySecret: settings.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET,
  };
}

// Marks an order + its card as paid and emails the share link. Both the
// client-side verify call and the webhook call into this, and either one
// may arrive first (or the webhook may arrive twice) — the status check
// up front makes re-entry a no-op so the card is never double-charged
// forward in time and the email is never sent twice.
async function fulfillOrder(order, paymentId) {
  if (order.status === 'paid') return;

  order.status = 'paid';
  order.razorpayPaymentId = paymentId;
  await order.save();

  const plan = await Plan.findById(order.plan);
  const card = await Card.findById(order.card);
  card.status = 'paid';
  card.plan = plan._id;
  card.paidAt = new Date();
  card.expiresAt = new Date(Date.now() + (plan.validityDays || 365) * 24 * 60 * 60 * 1000);
  await card.save();

  const user = await User.findById(order.user);
  const shareUrl = `${process.env.BASE_URL}/c/${card.slug}`;
  const occasionLabel = card.occasion === 'proposal' ? 'proposal' : 'birthday';
  await sendMail({
    to: user.email,
    subject: 'Your card is live! 🎉',
    html: `<p>Hi ${user.name},</p><p>Your ${occasionLabel} card for ${card.recipientName || card.partnerName} is published. Share it using the link below:</p><p><a href="${shareUrl}">${shareUrl}</a></p>`,
  });
}

async function markOrderFailed(order) {
  if (order.status === 'paid') return; // a later success shouldn't be clobbered by a stale failure event
  order.status = 'failed';
  await order.save();
}

// Creates a Razorpay order for the chosen plan and renders the checkout
// page with the Razorpay JS checkout widget. The amount is always read
// from the Plan document — never trust a price sent by the client.
exports.createOrder = catchAsync(async (req, res) => {
  const { cardId, planId } = req.body;

  const card = await Card.findOne({ _id: cardId, user: req.session.userId });
  if (!card) throw new AppError('Card not found.', 404);

  // The checkout UI only ever lists plans matching the card's own occasion
  // (see cardController.getCheckout), but that's a UI nicety, not a security
  // boundary — without this check here, a tampered planId (e.g. a cheaper
  // birthday-tier plan submitted for a proposal card) would still be
  // accepted and charged at the wrong price.
  const plan = await Plan.findOne({ _id: planId, isActive: true, occasion: card.occasion });
  if (!plan) throw new AppError('Please choose a valid plan.', 400);

  const { keyId, keySecret } = await getRazorpayCredentials();
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

  const amountInPaise = Math.round(plan.price * 100);

  const razorpayOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: `card_${card._id}`,
  });

  const order = await Order.create({
    user: req.session.userId,
    card: card._id,
    plan: plan._id,
    amount: plan.price,
    razorpayOrderId: razorpayOrder.id,
    status: 'created',
  });

  res.render('user/payment', {
    title: 'Complete payment',
    order,
    card,
    plan,
    razorpayKeyId: keyId,
    razorpayOrderId: razorpayOrder.id,
  });
});

// Verifies the Razorpay payment signature (HMAC SHA256) before trusting the
// client's claim of success. This is an AJAX endpoint, so every path —
// success or failure — resolves with JSON, never a redirect, so the
// frontend's res.json() call never fails on an HTML error page.
exports.verifyPayment = catchAsync(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

  const order = await Order.findOne({ _id: orderId, user: req.session.userId });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  const { keySecret } = await getRazorpayCredentials();
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    await markOrderFailed(order);
    return res.json({ success: false, redirectUrl: `/dashboard/cards/${order.card}/payment-failed` });
  }

  order.razorpaySignature = razorpay_signature;
  await fulfillOrder(order, razorpay_payment_id);

  res.json({ success: true, redirectUrl: `/dashboard/cards/${order.card}/success` });
});

// Backup path: Razorpay calls this directly, independent of whether the
// customer's browser ever got to run verifyPayment (closed tab, lost
// connection, etc). Verified against the webhook secret, not the key
// secret — these are configured separately in the Razorpay dashboard.
exports.handleWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body) // raw Buffer — signing must happen over the exact bytes Razorpay sent
    .digest('hex');

  if (!signature || signature !== expectedSignature) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
  }

  const payload = JSON.parse(req.body.toString('utf8'));
  const payment = payload.payload?.payment?.entity;
  if (!payment) return res.status(200).json({ received: true });

  const order = await Order.findOne({ razorpayOrderId: payment.order_id });
  if (!order) return res.status(200).json({ received: true }); // not one of ours, or already deleted

  if (payload.event === 'payment.captured') {
    await fulfillOrder(order, payment.id);
  } else if (payload.event === 'payment.failed') {
    await markOrderFailed(order);
  }

  res.status(200).json({ received: true });
});

exports.getSuccess = catchAsync(async (req, res) => {
  const card = await Card.findOne({ _id: req.params.id, user: req.session.userId });
  if (!card) throw new AppError('Card not found.', 404);

  const shareUrl = `${process.env.BASE_URL}/c/${card.slug}`;
  res.render('user/success', { title: 'Card published', card, shareUrl });
});

exports.getFailure = catchAsync(async (req, res) => {
  const card = await Card.findOne({ _id: req.params.id, user: req.session.userId });
  if (!card) throw new AppError('Card not found.', 404);

  res.render('user/payment-failed', { title: 'Payment failed', card });
});

// --- My orders + invoices ---
exports.listOrders = catchAsync(async (req, res) => {
  const orders = await Order.find({ user: req.session.userId })
    .populate('plan', 'name price')
    .populate('card', 'recipientName partnerName slug')
    .sort({ createdAt: -1 });

  res.render('user/orders', { title: 'My orders', orders });
});

exports.downloadInvoice = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.session.userId, status: 'paid' })
    .populate('plan', 'name price')
    .populate('card', 'recipientName partnerName occasion');
  if (!order) throw new AppError('Invoice not found.', 404);

  const settings = await Setting.getSingleton();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${order._id}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).text(settings.siteName, { align: 'left' });
  doc.moveDown();
  doc.fontSize(14).text('Invoice', { align: 'left' });
  doc.moveDown();

  doc.fontSize(10);
  doc.text(`Invoice ID: ${order._id}`);
  doc.text(`Date: ${order.createdAt.toDateString()}`);
  doc.text(`Razorpay payment ID: ${order.razorpayPaymentId || '—'}`);
  doc.moveDown();

  const occasionLabel = order.card?.occasion ? order.card.occasion[0].toUpperCase() + order.card.occasion.slice(1) : '—';
  doc.text(`Occasion: ${occasionLabel}`);
  doc.text(`Card recipient: ${order.card?.recipientName || order.card?.partnerName || '—'}`);
  doc.text(`Plan: ${order.plan?.name || '—'}`);
  doc.moveDown();

  // The default PDF font (Helvetica) has no ₹ glyph, so it would render as
  // a mangled superscript — spell out the currency instead.
  doc.fontSize(12).text(`Amount paid: Rs. ${order.amount}`, { align: 'left' });
  doc.moveDown(2);

  doc.fontSize(9).fillColor('#78716c').text(`Support: ${settings.supportEmail}`, { align: 'left' });

  doc.end();
});
