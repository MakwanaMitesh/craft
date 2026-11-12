const crypto = require('crypto');
const Razorpay = require('razorpay');
const User = require('../models/User');
const Template = require('../models/Template');
const Plan = require('../models/Plan');
const Order = require('../models/Order');
const Card = require('../models/Card');
const CardView = require('../models/CardView');
const CardEvent = require('../models/CardEvent');
const PageView = require('../models/PageView');
const AuditLog = require('../models/AuditLog');
const Setting = require('../models/Setting');
const Review = require('../models/Review');
const SurpriseCard = require('../models/SurpriseCard');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { storeImage } = require('../utils/mediaStorage');
const { OCCASIONS } = require('../utils/occasions');
const { SURPRISE_CARD_TYPES } = require('../utils/surpriseCardTypes');
const { logAdminAction } = require('../utils/auditLog');
const { sendCsv } = require('../utils/csv');
const { generateResetToken, hashToken } = require('../utils/tokens');
const { sendMail } = require('../config/mailer');
const { startOfDay, fillDailySeries } = require('../utils/dateSeries');

// Thumbnails/logos go through the same sharp-validated storeImage() pipeline
// as wizard photo uploads — see utils/mediaStorage.js.
async function processUploadedImage(file) {
  if (!file) return undefined;
  return storeImage(file);
}

const PAGE_SIZE = 10;

// --- Dashboard ---

// Resolves the admin's chosen date-range filter into a current window plus
// an equal-length "previous period" immediately before it, so every stat
// card can show a real like-for-like % change rather than comparing against
// an arbitrary fixed window.
function resolveDateRange(query) {
  const now = new Date();
  const today = startOfDay(now);
  const range = ['today', '7d', '30d', 'month', 'custom'].includes(query.range) ? query.range : 'today';

  let from;
  let to = now;
  if (range === '7d') {
    from = new Date(today);
    from.setDate(from.getDate() - 6);
  } else if (range === '30d') {
    from = new Date(today);
    from.setDate(from.getDate() - 29);
  } else if (range === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (range === 'custom' && query.from) {
    from = startOfDay(new Date(query.from));
    to = query.to ? new Date(new Date(query.to).setHours(23, 59, 59, 999)) : now;
  } else {
    from = today;
  }

  const durationMs = Math.max(to - from, 1);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);

  return { range, from, to, prevFrom, prevTo };
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

exports.getDashboard = catchAsync(async (req, res) => {
  const { range, from, to, prevFrom, prevTo } = resolveDateRange(req.query);
  const thirtyDaysAgo = startOfDay(new Date());
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  const [
    totalUsers,
    totalCards,
    paidCards,
    totalRevenueAgg,
    totalViewsAgg,
    totalProposalsYes,
    newUsersCurrent,
    newUsersPrevious,
    newCardsCurrent,
    newCardsPrevious,
    paidCardsCurrent,
    paidCardsPrevious,
    revenueCurrentAgg,
    revenuePreviousAgg,
    viewsCurrent,
    viewsPrevious,
    proposalsYesCurrent,
    proposalsYesPrevious,
    dailyRevenue,
    dailyViews,
    dailyNewUsers,
    cardsByOccasion,
    latestOrders,
    latestCards,
    mostViewedCards,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    Card.countDocuments(),
    Card.countDocuments({ status: 'paid' }),
    Order.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Card.aggregate([{ $group: { _id: null, total: { $sum: '$totalViews' } } }]),
    Card.countDocuments({ occasion: 'proposal', respondedYes: true }),
    User.countDocuments({ role: 'user', createdAt: { $gte: from, $lte: to } }),
    User.countDocuments({ role: 'user', createdAt: { $gte: prevFrom, $lte: prevTo } }),
    Card.countDocuments({ createdAt: { $gte: from, $lte: to } }),
    Card.countDocuments({ createdAt: { $gte: prevFrom, $lte: prevTo } }),
    Card.countDocuments({ status: 'paid', paidAt: { $gte: from, $lte: to } }),
    Card.countDocuments({ status: 'paid', paidAt: { $gte: prevFrom, $lte: prevTo } }),
    Order.aggregate([
      { $match: { status: 'paid', createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Order.aggregate([
      { $match: { status: 'paid', createdAt: { $gte: prevFrom, $lte: prevTo } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    CardView.countDocuments({ openedAt: { $gte: from, $lte: to } }),
    CardView.countDocuments({ openedAt: { $gte: prevFrom, $lte: prevTo } }),
    Card.countDocuments({ occasion: 'proposal', respondedYes: true, respondedAt: { $gte: from, $lte: to } }),
    Card.countDocuments({ occasion: 'proposal', respondedYes: true, respondedAt: { $gte: prevFrom, $lte: prevTo } }),
    Order.aggregate([
      { $match: { status: 'paid', createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$amount' } } },
    ]),
    CardView.aggregate([
      { $match: { openedAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$openedAt' } }, total: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $match: { role: 'user', createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: 1 } } },
    ]),
    Card.aggregate([{ $group: { _id: '$occasion', count: { $sum: 1 } } }]),
    Order.find()
      .populate('user', 'name email')
      .populate('plan', 'name')
      .populate('card', 'recipientName partnerName occasion')
      .sort({ createdAt: -1 })
      .limit(10),
    Card.find().populate('user', 'name email').populate('template', 'name').sort({ createdAt: -1 }).limit(8),
    Card.find({ status: 'paid' }).populate('user', 'name email').populate('template', 'name').sort({ totalViews: -1 }).limit(8),
  ]);

  const revenueSeries = fillDailySeries(dailyRevenue, thirtyDaysAgo, 30);
  const viewsSeries = fillDailySeries(dailyViews, thirtyDaysAgo, 30);
  const newUsersSeries = fillDailySeries(dailyNewUsers, thirtyDaysAgo, 30);

  const occasionCounts = new Map(cardsByOccasion.map((o) => [o._id, o.count]));
  const occasionLabels = OCCASIONS.map((o) => o[0].toUpperCase() + o.slice(1));
  const occasionValues = OCCASIONS.map((o) => occasionCounts.get(o) || 0);

  const revenueCurrent = revenueCurrentAgg[0]?.total || 0;
  const revenuePrevious = revenuePreviousAgg[0]?.total || 0;

  // "Total X" cards show the all-time headline number, but still carry a
  // real % change — comparing how much accrued in this period vs. the
  // previous one (period-over-period growth), not a snapshot-vs-snapshot
  // diff that a cumulative total can't meaningfully produce.
  const stats = [
    { key: 'totalUsers', label: 'Total users', value: totalUsers, change: pctChange(newUsersCurrent, newUsersPrevious) },
    { key: 'newUsers', label: 'New users (period)', value: newUsersCurrent, change: pctChange(newUsersCurrent, newUsersPrevious) },
    { key: 'totalCards', label: 'Total cards', value: totalCards, change: pctChange(newCardsCurrent, newCardsPrevious) },
    { key: 'paidCards', label: 'Paid cards', value: paidCards, change: pctChange(paidCardsCurrent, paidCardsPrevious) },
    { key: 'totalRevenue', label: 'Total revenue', value: totalRevenueAgg[0]?.total || 0, change: pctChange(revenueCurrent, revenuePrevious), prefix: '₹' },
    { key: 'periodRevenue', label: "Period's revenue", value: revenueCurrent, change: pctChange(revenueCurrent, revenuePrevious), prefix: '₹' },
    { key: 'totalViews', label: 'Total card views', value: totalViewsAgg[0]?.total || 0, change: pctChange(viewsCurrent, viewsPrevious) },
    { key: 'periodViews', label: 'Views (period)', value: viewsCurrent, change: pctChange(viewsCurrent, viewsPrevious) },
    { key: 'proposalsYes', label: 'Proposals answered YES', value: totalProposalsYes, change: pctChange(proposalsYesCurrent, proposalsYesPrevious), emoji: '💍' },
  ];

  res.render('admin/dashboard', {
    title: 'Admin dashboard',
    stats,
    range,
    rangeFrom: from.toISOString().slice(0, 10),
    rangeTo: to.toISOString().slice(0, 10),
    chartLabels: revenueSeries.labels,
    chartValues: revenueSeries.values,
    viewsLabels: viewsSeries.labels,
    viewsValues: viewsSeries.values,
    newUsersLabels: newUsersSeries.labels,
    newUsersValues: newUsersSeries.values,
    occasionLabels,
    occasionValues,
    latestOrders,
    latestCards,
    mostViewedCards,
  });
});

// --- Analytics ---
exports.getAnalytics = catchAsync(async (req, res) => {
  const { range, from, to } = resolveDateRange(req.query);

  const [
    byDevice,
    byBrowser,
    byCountry,
    byCity,
    bySource,
    hourDayRaw,
    birthdayFunnelRaw,
    proposalFunnelRaw,
    avgNoAttemptsAgg,
    landingVisits,
    signups,
    cardsCreated,
    cardsPaid,
    topTemplatesByCards,
    topTemplatesByRevenue,
  ] = await Promise.all([
    CardView.aggregate([
      { $match: { openedAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$deviceType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CardView.aggregate([
      { $match: { openedAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$browser', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    CardView.aggregate([
      { $match: { openedAt: { $gte: from, $lte: to }, country: { $nin: [null, ''] } } },
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    CardView.aggregate([
      { $match: { openedAt: { $gte: from, $lte: to }, city: { $nin: [null, ''] } } },
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    CardView.aggregate([
      { $match: { openedAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$referrerSource', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CardView.aggregate([
      { $match: { openedAt: { $gte: from, $lte: to } } },
      { $project: { hour: { $hour: '$openedAt' }, dow: { $dayOfWeek: '$openedAt' } } }, // dow: 1=Sunday..7=Saturday
      { $group: { _id: { hour: '$hour', dow: '$dow' }, count: { $sum: 1 } } },
    ]),
    CardEvent.aggregate([
      { $match: { type: { $in: ['card_opened', 'tapped_open', 'candles_blown', 'letter_opened'] }, createdAt: { $gte: from, $lte: to } } },
      { $lookup: { from: 'cards', localField: 'card', foreignField: '_id', as: 'card' } },
      { $unwind: '$card' },
      { $match: { 'card.occasion': 'birthday' } },
      { $group: { _id: '$type', sessions: { $addToSet: '$sessionId' } } },
    ]),
    CardEvent.aggregate([
      { $match: { type: { $in: ['card_opened', 'tapped_open', 'yes_clicked'] }, createdAt: { $gte: from, $lte: to } } },
      { $lookup: { from: 'cards', localField: 'card', foreignField: '_id', as: 'card' } },
      { $unwind: '$card' },
      { $match: { 'card.occasion': 'proposal' } },
      { $group: { _id: '$type', sessions: { $addToSet: '$sessionId' } } },
    ]),
    Card.aggregate([
      { $match: { occasion: 'proposal', respondedYes: true, respondedAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, avg: { $avg: '$noAttempts' } } },
    ]),
    PageView.countDocuments({ path: '/', createdAt: { $gte: from, $lte: to } }),
    User.countDocuments({ role: 'user', createdAt: { $gte: from, $lte: to } }),
    Card.countDocuments({ createdAt: { $gte: from, $lte: to } }),
    Card.countDocuments({ status: 'paid', paidAt: { $gte: from, $lte: to } }),
    Card.aggregate([
      { $match: { createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$template', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'templates', localField: '_id', foreignField: '_id', as: 'template' } },
      { $unwind: '$template' },
    ]),
    Order.aggregate([
      { $match: { status: 'paid', createdAt: { $gte: from, $lte: to } } },
      { $lookup: { from: 'cards', localField: 'card', foreignField: '_id', as: 'card' } },
      { $unwind: '$card' },
      { $group: { _id: '$card.template', revenue: { $sum: '$amount' } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'templates', localField: '_id', foreignField: '_id', as: 'template' } },
      { $unwind: '$template' },
    ]),
  ]);

  const toStepMap = (rows) => new Map(rows.map((r) => [r._id, r.sessions.length]));
  const birthdayMap = toStepMap(birthdayFunnelRaw);
  const proposalMap = toStepMap(proposalFunnelRaw);

  const birthdayFunnel = [
    { step: 'Opened', value: birthdayMap.get('card_opened') || 0 },
    { step: 'Tapped open', value: birthdayMap.get('tapped_open') || 0 },
    { step: 'Candles blown', value: birthdayMap.get('candles_blown') || 0 },
    { step: 'Letter read', value: birthdayMap.get('letter_opened') || 0 },
  ];
  const proposalFunnel = [
    { step: 'Opened', value: proposalMap.get('card_opened') || 0 },
    { step: 'Question seen', value: proposalMap.get('tapped_open') || 0 },
    { step: 'YES clicked', value: proposalMap.get('yes_clicked') || 0 },
  ];
  const visitorFunnel = [
    { step: 'Landing page visits', value: landingVisits },
    { step: 'Signups', value: signups },
    { step: 'Cards created', value: cardsCreated },
    { step: 'Paid', value: cardsPaid },
  ];

  // 7 (days, Sun..Sat) x 24 (hours) matrix for the busiest-hours heatmap.
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  hourDayRaw.forEach((r) => {
    heatmap[r._id.dow - 1][r._id.hour] = r.count;
  });

  res.render('admin/analytics', {
    title: 'Analytics',
    range,
    rangeFrom: from.toISOString().slice(0, 10),
    rangeTo: to.toISOString().slice(0, 10),
    byDevice,
    byBrowser,
    byCountry,
    byCity,
    bySource,
    heatmap,
    birthdayFunnel,
    proposalFunnel,
    visitorFunnel,
    avgNoAttempts: avgNoAttemptsAgg[0]?.avg ? Math.round(avgNoAttemptsAgg[0].avg * 10) / 10 : 0,
    topTemplatesByCards,
    topTemplatesByRevenue,
  });
});

// --- Users ---
exports.listUsers = catchAsync(async (req, res) => {
  const search = (req.query.search || '').trim();
  const status = req.query.status || 'all';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const filter = { role: 'user' };
  if (search) {
    filter.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }];
  }
  if (status === 'active') filter.isBlocked = false;
  if (status === 'blocked') filter.isBlocked = true;

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
    User.countDocuments(filter),
  ]);

  res.render('admin/users', {
    title: 'Manage users',
    users,
    search,
    status,
    page,
    totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
    total,
  });
});

exports.getUserDetail = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'user' });
  if (!user) throw new AppError('User not found.', 404);

  const [cards, orders] = await Promise.all([
    Card.find({ user: user._id }).populate('template').sort({ createdAt: -1 }),
    Order.find({ user: user._id, status: 'paid' }).populate('plan', 'name').sort({ createdAt: -1 }),
  ]);
  const totalSpent = orders.reduce((sum, o) => sum + o.amount, 0);

  res.render('admin/user-detail', { title: user.name, user, cards, orders, totalSpent });
});

exports.exportUsersCsv = catchAsync(async (req, res) => {
  const search = (req.query.search || '').trim();
  const status = req.query.status || 'all';
  const filter = { role: 'user' };
  if (search) filter.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }];
  if (status === 'active') filter.isBlocked = false;
  if (status === 'blocked') filter.isBlocked = true;

  const users = await User.find(filter).sort({ createdAt: -1 });
  sendCsv(
    res,
    `users-${Date.now()}.csv`,
    ['Name', 'Email', 'Phone', 'Status', 'Joined', 'Last login'],
    users.map((u) => [u.name, u.email, u.phone, u.isBlocked ? 'Blocked' : 'Active', u.createdAt.toISOString(), u.lastLoginAt ? u.lastLoginAt.toISOString() : ''])
  );
});

exports.toggleBlockUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found.', 404);

  user.isBlocked = !user.isBlocked;
  await user.save();

  logAdminAction(req, user.isBlocked ? 'user.block' : 'user.unblock', { targetType: 'User', targetId: user._id, details: { email: user.email } });

  req.session.flash = { type: 'success', message: `User ${user.isBlocked ? 'blocked' : 'unblocked'}.` };
  res.redirect(req.headers.referer || '/admin/users');
});

exports.deleteUser = catchAsync(async (req, res) => {
  const user = await User.findOneAndDelete({ _id: req.params.id, role: 'user' });
  if (!user) throw new AppError('User not found.', 404);

  logAdminAction(req, 'user.delete', { targetType: 'User', targetId: user._id, details: { email: user.email } });

  req.session.flash = { type: 'success', message: 'User deleted.' };
  res.redirect('/admin/users');
});

// Sends the exact same reset-password email the user's own "forgot
// password" flow sends — just triggered by support instead of the user.
exports.resetUserPassword = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'user' });
  if (!user) throw new AppError('User not found.', 404);

  const { rawToken, hashedToken } = generateResetToken();
  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = Date.now() + 30 * 60 * 1000;
  await user.save();

  const resetUrl = `${process.env.BASE_URL}/reset-password/${rawToken}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your password',
    html: `<p>Hi ${user.name},</p><p>Our support team triggered a password reset for your account. Click the link below to set a new password. This link expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  });

  logAdminAction(req, 'user.reset_password_email', { targetType: 'User', targetId: user._id, details: { email: user.email } });

  req.session.flash = { type: 'success', message: `Password reset email sent to ${user.email}.` };
  res.redirect(`/admin/users/${user._id}`);
});

// Support impersonation: logs the admin in as the customer (to reproduce a
// bug, check their view, etc), always recorded in the audit log, and always
// reversible via /stop-impersonating without needing the admin password again.
exports.loginAsUser = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'user' });
  if (!user) throw new AppError('User not found.', 404);

  logAdminAction(req, 'user.login_as', { targetType: 'User', targetId: user._id, details: { email: user.email } });

  req.session.impersonatorId = req.session.userId;
  req.session.impersonatorName = req.session.userName;
  req.session.userId = user._id;
  req.session.userName = user.name;
  req.session.role = 'user';

  res.redirect('/dashboard');
});

exports.stopImpersonating = catchAsync(async (req, res) => {
  if (!req.session.impersonatorId) return res.redirect('/dashboard');

  const admin = await User.findById(req.session.impersonatorId);
  req.session.userId = admin._id;
  req.session.userName = admin.name;
  req.session.role = admin.role;
  delete req.session.impersonatorId;
  delete req.session.impersonatorName;

  res.redirect('/admin/users');
});

// --- Templates ---
function parseSections(body) {
  return {
    balloons: body.sectionBalloons === 'on',
    cake: body.sectionCake === 'on',
    letter: body.sectionLetter === 'on',
    photoGallery: body.sectionPhotoGallery === 'on',
  };
}

// Textarea input, one track per line as "Track Name | https://url-to-file.mp3".
function parseMusicTracks(raw) {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, url] = line.split('|').map((part) => part.trim());
      return { name, url };
    })
    .filter((track) => track.name && track.url);
}

function musicTracksToTextarea(tracks) {
  return (tracks || []).map((t) => `${t.name} | ${t.url}`).join('\n');
}

// Each uploaded sticker file is named after its own filename (minus
// extension) — simplest way to let an admin give stickers meaningful names
// without a second parallel text input to keep in sync with file order.
async function processUploadedStickers(files) {
  if (!files || !files.length) return undefined;
  const urls = await Promise.all(files.map((f) => storeImage(f)));
  return files.map((f, i) => ({
    name: f.originalname.replace(/\.[^.]+$/, '') || `Sticker ${i + 1}`,
    url: urls[i],
  }));
}

exports.listTemplates = catchAsync(async (req, res) => {
  const occasion = req.query.occasion || 'all';
  const filter = {};
  if (occasion !== 'all') filter.occasion = occasion;

  const [templates, usageCounts] = await Promise.all([
    Template.find(filter).sort({ sortOrder: 1, createdAt: -1 }),
    Card.aggregate([{ $group: { _id: '$template', count: { $sum: 1 } } }]),
  ]);
  const usageByTemplate = new Map(usageCounts.map((u) => [String(u._id), u.count]));

  res.render('admin/templates', { title: 'Manage templates', templates, occasion, OCCASIONS, usageByTemplate });
});

exports.exportTemplatesCsv = catchAsync(async (req, res) => {
  const occasion = req.query.occasion || 'all';
  const filter = {};
  if (occasion !== 'all') filter.occasion = occasion;

  const [templates, usageCounts] = await Promise.all([
    Template.find(filter).sort({ sortOrder: 1, createdAt: -1 }),
    Card.aggregate([{ $group: { _id: '$template', count: { $sum: 1 } } }]),
  ]);
  const usageByTemplate = new Map(usageCounts.map((u) => [String(u._id), u.count]));

  sendCsv(
    res,
    `templates-${Date.now()}.csv`,
    ['Name', 'Slug', 'Occasion', 'Active', 'Premium', 'Cards created', 'Created'],
    templates.map((t) => [t.name, t.slug, t.occasion, t.isActive ? 'Yes' : 'No', t.isPremium ? 'Yes' : 'No', usageByTemplate.get(String(t._id)) || 0, t.createdAt.toISOString()])
  );
});

exports.getNewTemplate = catchAsync(async (req, res) => {
  res.render('admin/template-edit', {
    title: 'Add template',
    template: null,
    fontPairs: Template.FONT_PAIRS,
    OCCASIONS,
  });
});

exports.createTemplate = catchAsync(async (req, res) => {
  const { name, slug, occasion, fontPairId, isPremium, sortOrder, musicTracks } = req.body;
  const thumbnail = await processUploadedImage(req.files?.thumbnail?.[0]);
  const stickers = await processUploadedStickers(req.files?.stickers);

  const template = await Template.create({
    name,
    slug,
    occasion,
    fontPairId,
    isPremium: isPremium === 'on',
    sortOrder: sortOrder || 0,
    colorTheme: {
      primary: req.body.primaryColor,
      secondary: req.body.secondaryColor,
      background: req.body.backgroundColor,
    },
    sections: parseSections(req.body),
    musicTracks: parseMusicTracks(musicTracks),
    stickers,
    thumbnail,
  });

  logAdminAction(req, 'template.create', { targetType: 'Template', targetId: template._id, details: { name: template.name } });
  req.session.flash = { type: 'success', message: 'Template created.' };
  res.redirect('/admin/templates');
});

exports.getEditTemplate = catchAsync(async (req, res) => {
  const template = await Template.findById(req.params.id);
  if (!template) throw new AppError('Template not found.', 404);

  res.render('admin/template-edit', {
    title: 'Edit template',
    template,
    fontPairs: Template.FONT_PAIRS,
    musicTracksText: musicTracksToTextarea(template.musicTracks),
    OCCASIONS,
  });
});

exports.updateTemplate = catchAsync(async (req, res) => {
  const template = await Template.findById(req.params.id);
  if (!template) throw new AppError('Template not found.', 404);

  const { name, slug, occasion, fontPairId, isPremium, sortOrder, musicTracks } = req.body;

  template.name = name;
  template.slug = slug;
  template.occasion = occasion;
  template.fontPairId = fontPairId;
  template.isPremium = isPremium === 'on';
  template.sortOrder = sortOrder || 0;
  template.colorTheme = {
    primary: req.body.primaryColor,
    secondary: req.body.secondaryColor,
    background: req.body.backgroundColor,
  };
  template.sections = parseSections(req.body);
  template.musicTracks = parseMusicTracks(musicTracks);
  const thumbnail = await processUploadedImage(req.files?.thumbnail?.[0]);
  if (thumbnail) template.thumbnail = thumbnail;
  // Uploading new stickers replaces the full set, same as thumbnail/logo —
  // avoids needing per-sticker delete UI for this pass.
  const stickers = await processUploadedStickers(req.files?.stickers);
  if (stickers) template.stickers = stickers;

  await template.save();

  logAdminAction(req, 'template.update', { targetType: 'Template', targetId: template._id, details: { name: template.name } });
  req.session.flash = { type: 'success', message: 'Template updated.' };
  res.redirect('/admin/templates');
});

exports.toggleTemplate = catchAsync(async (req, res) => {
  const template = await Template.findById(req.params.id);
  if (!template) throw new AppError('Template not found.', 404);

  template.isActive = !template.isActive;
  await template.save();

  logAdminAction(req, template.isActive ? 'template.activate' : 'template.deactivate', { targetType: 'Template', targetId: template._id });
  req.session.flash = { type: 'success', message: `Template ${template.isActive ? 'activated' : 'deactivated'}.` };
  res.redirect('/admin/templates');
});

exports.deleteTemplate = catchAsync(async (req, res) => {
  const template = await Template.findByIdAndDelete(req.params.id);
  if (!template) throw new AppError('Template not found.', 404);

  logAdminAction(req, 'template.delete', { targetType: 'Template', targetId: template._id, details: { name: template.name } });
  req.session.flash = { type: 'success', message: 'Template deleted.' };
  res.redirect('/admin/templates');
});

// Renders the real public card engine with dummy content so an admin can
// see exactly what a recipient would see, without creating a real card.
exports.previewTemplate = catchAsync(async (req, res) => {
  const template = await Template.findById(req.params.id);
  if (!template) throw new AppError('Template not found.', 404);

  if (template.occasion === 'proposal') {
    const dummyCard = {
      partnerName: 'Priya',
      senderName: 'Rahul',
      question: 'Will you marry me?',
      yesMessage: "You've just made me the happiest person alive. I love you!",
      sticker: template.stickers?.[0]?.url,
      photos: [],
      template,
    };
    return res.render('public/card-proposal', { title: `Preview: ${template.name}`, card: dummyCard, isPreview: true });
  }

  const dummyCard = {
    recipientName: 'Priya',
    senderName: 'Rahul',
    message:
      '<p>Happy Birthday! 🎉</p><p>Wishing you a year filled with joy, laughter, and all the things that make you smile.</p><p>You deserve all the happiness in the world today and always.</p>',
    candleCount: 5,
    photos: [],
    template,
  };

  res.render('public/card', { title: `Preview: ${template.name}`, card: dummyCard, isPreview: true });
});

// --- Plans ---
function parseFeatures(raw) {
  return raw ? raw.split(',').map((f) => f.trim()).filter(Boolean) : [];
}

exports.listPlans = catchAsync(async (req, res) => {
  const occasion = req.query.occasion || 'all';
  const filter = {};
  if (occasion !== 'all') filter.occasion = occasion;

  const [plans, usageCounts] = await Promise.all([
    Plan.find(filter).sort({ price: 1 }),
    Order.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: '$plan', count: { $sum: 1 } } }]),
  ]);
  const usageByPlan = new Map(usageCounts.map((u) => [String(u._id), u.count]));

  res.render('admin/plans', { title: 'Manage plans', plans, occasion, OCCASIONS, usageByPlan });
});

exports.exportPlansCsv = catchAsync(async (req, res) => {
  const occasion = req.query.occasion || 'all';
  const filter = {};
  if (occasion !== 'all') filter.occasion = occasion;

  const [plans, usageCounts] = await Promise.all([
    Plan.find(filter).sort({ price: 1 }),
    Order.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: '$plan', count: { $sum: 1 } } }]),
  ]);
  const usageByPlan = new Map(usageCounts.map((u) => [String(u._id), u.count]));

  sendCsv(
    res,
    `plans-${Date.now()}.csv`,
    ['Name', 'Occasion', 'Price', 'Validity days', 'Active', 'Most popular', 'Orders'],
    plans.map((p) => [p.name, p.occasion, p.price, p.validityDays, p.isActive ? 'Yes' : 'No', p.isPopular ? 'Yes' : 'No', usageByPlan.get(String(p._id)) || 0])
  );
});

// Only one plan per occasion should carry the "Most popular" highlight on
// the pricing section — setting it on one clears it from the rest of that
// occasion's plans, rather than letting multiple badges show at once.
async function clearOtherPopularPlans(occasion, exceptPlanId) {
  await Plan.updateMany({ occasion, _id: { $ne: exceptPlanId } }, { isPopular: false });
}

exports.createPlan = catchAsync(async (req, res) => {
  const { name, occasion, price, description, features, validityDays, maxPhotos, musicAllowed, isPopular, analyticsLevel } = req.body;

  const plan = await Plan.create({
    name,
    occasion,
    price,
    description,
    validityDays,
    maxPhotos,
    musicAllowed: musicAllowed === 'on' || musicAllowed === 'true',
    isPopular: isPopular === 'on' || isPopular === 'true',
    analyticsLevel: analyticsLevel === 'basic' ? 'basic' : 'full',
    features: parseFeatures(features),
  });
  if (plan.isPopular) await clearOtherPopularPlans(plan.occasion, plan._id);

  logAdminAction(req, 'plan.create', { targetType: 'Plan', targetId: plan._id, details: { name: plan.name } });
  req.session.flash = { type: 'success', message: 'Plan created.' };
  res.redirect('/admin/plans');
});

exports.getEditPlan = catchAsync(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) throw new AppError('Plan not found.', 404);

  res.render('admin/plan-edit', { title: 'Edit plan', plan, OCCASIONS });
});

exports.updatePlan = catchAsync(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) throw new AppError('Plan not found.', 404);

  const { name, occasion, price, description, features, validityDays, maxPhotos, musicAllowed, isPopular, analyticsLevel } = req.body;

  plan.name = name;
  plan.occasion = occasion;
  plan.price = price;
  plan.description = description;
  plan.validityDays = validityDays;
  plan.maxPhotos = maxPhotos;
  plan.musicAllowed = musicAllowed === 'on' || musicAllowed === 'true';
  plan.isPopular = isPopular === 'on' || isPopular === 'true';
  plan.analyticsLevel = analyticsLevel === 'basic' ? 'basic' : 'full';
  plan.features = parseFeatures(features);
  await plan.save();
  if (plan.isPopular) await clearOtherPopularPlans(plan.occasion, plan._id);

  logAdminAction(req, 'plan.update', { targetType: 'Plan', targetId: plan._id, details: { name: plan.name } });
  req.session.flash = { type: 'success', message: 'Plan updated.' };
  res.redirect('/admin/plans');
});

exports.togglePlan = catchAsync(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) throw new AppError('Plan not found.', 404);

  plan.isActive = !plan.isActive;
  await plan.save();

  logAdminAction(req, plan.isActive ? 'plan.activate' : 'plan.deactivate', { targetType: 'Plan', targetId: plan._id });
  req.session.flash = { type: 'success', message: `Plan ${plan.isActive ? 'activated' : 'deactivated'}.` };
  res.redirect('/admin/plans');
});

exports.deletePlan = catchAsync(async (req, res) => {
  const plan = await Plan.findByIdAndDelete(req.params.id);
  if (!plan) throw new AppError('Plan not found.', 404);

  logAdminAction(req, 'plan.delete', { targetType: 'Plan', targetId: plan._id, details: { name: plan.name } });
  req.session.flash = { type: 'success', message: 'Plan deleted.' };
  res.redirect('/admin/plans');
});

// --- Orders ---
function buildOrderFilter(query) {
  const filter = {};
  if (query.status && query.status !== 'all') filter.status = query.status;

  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }
  return filter;
}

// Order doesn't store occasion directly — it's a property of the card it's
// for — so filtering/joining by occasion goes through an aggregation
// instead of a plain populate+filter.
async function findOrdersWithOccasion(filter, occasion) {
  const pipeline = [
    { $match: filter },
    { $lookup: { from: 'cards', localField: 'card', foreignField: '_id', as: 'card' } },
    { $unwind: '$card' },
    ...(occasion && occasion !== 'all' ? [{ $match: { 'card.occasion': occasion } }] : []),
    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $lookup: { from: 'plans', localField: 'plan', foreignField: '_id', as: 'plan' } },
    { $unwind: '$plan' },
    { $sort: { createdAt: -1 } },
  ];
  return Order.aggregate(pipeline);
}

exports.listOrders = catchAsync(async (req, res) => {
  const filter = buildOrderFilter(req.query);
  const occasion = req.query.occasion || 'all';
  const orders = await findOrdersWithOccasion(filter, occasion);

  res.render('admin/orders', {
    title: 'Orders',
    orders,
    filters: {
      status: req.query.status || 'all',
      dateFrom: req.query.dateFrom || '',
      dateTo: req.query.dateTo || '',
      occasion,
    },
    OCCASIONS,
  });
});

exports.refundOrder = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found.', 404);
  if (order.status !== 'paid') throw new AppError('Only paid orders can be refunded.', 400);

  const settings = await Setting.getSingletonWithSecret();
  const keyId = settings.razorpayKeyId || process.env.RAZORPAY_KEY_ID;
  const keySecret = settings.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET;
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

  await razorpay.payments.refund(order.razorpayPaymentId, {
    amount: Math.round(order.amount * 100), // full refund, in paise
  });

  order.status = 'refunded';
  await order.save();

  logAdminAction(req, 'order.refund', { targetType: 'Order', targetId: order._id, details: { amount: order.amount, razorpayPaymentId: order.razorpayPaymentId } });

  req.session.flash = { type: 'success', message: 'Order refunded.' };
  res.redirect(req.headers.referer || '/admin/orders');
});

exports.exportOrdersCsv = catchAsync(async (req, res) => {
  const filter = buildOrderFilter(req.query);
  const occasion = req.query.occasion || 'all';
  const orders = await findOrdersWithOccasion(filter, occasion);

  // Guards against CSV/formula injection: several of these columns (customer
  // name, card recipient/partner name) are user-controlled. Without the
  // leading-apostrophe neutralization, a name like '=HYPERLINK("http://evil.com")'
  // would execute as a live formula the moment an admin opens this file in
  // Excel or Google Sheets — quoting alone (for commas/quotes) doesn't stop that.
  const escapeCsv = (value) => {
    let str = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  };

  const header = ['Date', 'Customer', 'Email', 'Occasion', 'Card recipient', 'Plan', 'Amount', 'Status', 'Razorpay order ID'];
  const rows = orders.map((o) =>
    [
      new Date(o.createdAt).toISOString(),
      o.user?.name,
      o.user?.email,
      o.card?.occasion,
      o.card?.recipientName || o.card?.partnerName,
      o.plan?.name,
      o.amount,
      o.status,
      o.razorpayOrderId,
    ]
      .map(escapeCsv)
      .join(',')
  );

  const csv = [header.map(escapeCsv).join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
  res.send(csv);
});

// --- Cards (site-wide list, for admin oversight) ---

// Search by recipient/partner name or slug goes straight on the Card
// filter; search by owner email needs the owner's _id resolved first since
// Card doesn't denormalize the owner's email onto itself.
async function buildCardFilter(query) {
  const filter = {};
  if (query.occasion && query.occasion !== 'all') filter.occasion = query.occasion;
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.template) filter.template = query.template;
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  const search = (query.search || '').trim();
  if (search) {
    const matchingUsers = await User.find({ email: new RegExp(search, 'i') }, '_id');
    filter.$or = [
      { recipientName: new RegExp(search, 'i') },
      { partnerName: new RegExp(search, 'i') },
      { slug: new RegExp(search, 'i') },
      { user: { $in: matchingUsers.map((u) => u._id) } },
    ];
  }

  return filter;
}

exports.listCards = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const filter = await buildCardFilter(req.query);

  const [cards, total, templates] = await Promise.all([
    Card.find(filter)
      .populate('user', 'name email')
      .populate('template', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
    Card.countDocuments(filter),
    Template.find({}, 'name slug').sort({ name: 1 }),
  ]);

  res.render('admin/cards', {
    title: 'All cards',
    cards,
    templates,
    filters: {
      occasion: req.query.occasion || 'all',
      status: req.query.status || 'all',
      template: req.query.template || '',
      search: req.query.search || '',
      dateFrom: req.query.dateFrom || '',
      dateTo: req.query.dateTo || '',
    },
    page,
    totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
    total,
    OCCASIONS,
  });
});

exports.exportCardsCsv = catchAsync(async (req, res) => {
  const filter = await buildCardFilter(req.query);
  const cards = await Card.find(filter).populate('user', 'name email').populate('template', 'name').sort({ createdAt: -1 });

  sendCsv(
    res,
    `cards-${Date.now()}.csv`,
    ['Slug', 'Occasion', 'Owner', 'Owner email', 'Recipient', 'Template', 'Status', 'Total views', 'Unique views', 'Created'],
    cards.map((c) => [
      c.slug,
      c.occasion,
      c.user?.name,
      c.user?.email,
      c.recipientName || c.partnerName,
      c.template?.name,
      c.isDisabled ? 'disabled' : c.status,
      c.totalViews,
      c.uniqueViews,
      c.createdAt.toISOString(),
    ])
  );
});

exports.getCardDetail = catchAsync(async (req, res) => {
  const card = await Card.findById(req.params.id).populate('user', 'name email').populate('template').populate('plan', 'name price');
  if (!card) throw new AppError('Card not found.', 404);

  const thirtyDaysAgo = startOfDay(new Date());
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  const [order, dailyViews, viewLog, eventTimeline] = await Promise.all([
    Order.findOne({ card: card._id, status: 'paid' }),
    CardView.aggregate([
      { $match: { card: card._id, openedAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$openedAt' } }, total: { $sum: 1 } } },
    ]),
    CardView.find({ card: card._id }).sort({ openedAt: -1 }).limit(50),
    CardEvent.find({ card: card._id }).sort({ createdAt: -1 }).limit(100),
  ]);

  const viewsSeries = fillDailySeries(dailyViews, thirtyDaysAgo, 30);

  res.render('admin/card-detail', {
    title: card.recipientName || card.partnerName || card.slug,
    card,
    order,
    viewsLabels: viewsSeries.labels,
    viewsValues: viewsSeries.values,
    viewLog,
    eventTimeline,
  });
});

exports.extendCardExpiry = catchAsync(async (req, res) => {
  const card = await Card.findById(req.params.id);
  if (!card) throw new AppError('Card not found.', 404);

  const days = Math.max(parseInt(req.body.days, 10) || 0, 0);
  if (days > 0) {
    const base = card.expiresAt && card.expiresAt > new Date() ? card.expiresAt : new Date();
    card.expiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    await card.save();
    logAdminAction(req, 'card.extend_expiry', { targetType: 'Card', targetId: card._id, details: { days, newExpiresAt: card.expiresAt } });
    req.session.flash = { type: 'success', message: `Expiry extended by ${days} day${days === 1 ? '' : 's'}.` };
  }

  res.redirect(`/admin/cards/${card._id}`);
});

exports.toggleCardDisabled = catchAsync(async (req, res) => {
  const card = await Card.findById(req.params.id);
  if (!card) throw new AppError('Card not found.', 404);

  card.isDisabled = !card.isDisabled;
  await card.save();

  logAdminAction(req, card.isDisabled ? 'card.disable' : 'card.enable', { targetType: 'Card', targetId: card._id, details: { slug: card.slug } });

  req.session.flash = { type: 'success', message: `Card ${card.isDisabled ? 'disabled' : 'enabled'}.` };
  res.redirect(`/admin/cards/${card._id}`);
});

exports.deleteCard = catchAsync(async (req, res) => {
  const card = await Card.findByIdAndDelete(req.params.id);
  if (!card) throw new AppError('Card not found.', 404);

  logAdminAction(req, 'card.delete', { targetType: 'Card', targetId: card._id, details: { slug: card.slug } });

  req.session.flash = { type: 'success', message: 'Card deleted.' };
  res.redirect('/admin/cards');
});

// Interactive Surprise Cards — the free, no-login system (CLAUDE.md §16),
// kept in this same file rather than a separate controller, matching how
// every other admin domain already lives here. No occasion/status/plan to
// filter on (none of that exists for this system) — just type, a reported
// flag, a date range, and a name/slug search.
async function buildSurpriseCardFilter(query) {
  const filter = {};
  if (query.type && query.type !== 'all') filter.type = query.type;
  if (query.reported === 'true') filter.isReported = true;
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  const search = (query.search || '').trim();
  if (search) {
    filter.$or = [
      { recipientName: new RegExp(search, 'i') },
      { senderName: new RegExp(search, 'i') },
      { slug: new RegExp(search, 'i') },
    ];
  }

  return filter;
}

exports.listSurpriseCards = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const filter = await buildSurpriseCardFilter(req.query);

  const [cards, total] = await Promise.all([
    SurpriseCard.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    SurpriseCard.countDocuments(filter),
  ]);

  res.render('admin/surprise-cards', {
    title: 'Surprise cards',
    cards,
    filters: {
      type: req.query.type || 'all',
      search: req.query.search || '',
      dateFrom: req.query.dateFrom || '',
      dateTo: req.query.dateTo || '',
      reported: req.query.reported || '',
    },
    page,
    totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
    total,
    SURPRISE_CARD_TYPES,
  });
});

exports.exportSurpriseCardsCsv = catchAsync(async (req, res) => {
  const filter = await buildSurpriseCardFilter(req.query);
  const cards = await SurpriseCard.find(filter).sort({ createdAt: -1 });

  sendCsv(
    res,
    `surprise-cards-${Date.now()}.csv`,
    ['Slug', 'Type', 'Sender', 'Recipient', 'Opened', 'Reported', 'Disabled', 'Created'],
    cards.map((c) => [
      c.slug,
      c.type,
      c.senderName,
      c.recipientName,
      c.openedAt ? c.openedAt.toISOString() : '',
      c.isReported ? 'yes' : 'no',
      c.isDisabled ? 'yes' : 'no',
      c.createdAt.toISOString(),
    ])
  );
});

exports.getSurpriseCardDetail = catchAsync(async (req, res) => {
  const card = await SurpriseCard.findById(req.params.id);
  if (!card) throw new AppError('Surprise card not found.', 404);

  res.render('admin/surprise-card-detail', {
    title: card.recipientName || card.slug,
    card,
  });
});

exports.toggleSurpriseCardDisabled = catchAsync(async (req, res) => {
  const card = await SurpriseCard.findById(req.params.id);
  if (!card) throw new AppError('Surprise card not found.', 404);

  card.isDisabled = !card.isDisabled;
  await card.save();

  logAdminAction(req, card.isDisabled ? 'surprisecard.disable' : 'surprisecard.enable', {
    targetType: 'SurpriseCard',
    targetId: card._id,
    details: { slug: card.slug },
  });

  req.session.flash = { type: 'success', message: `Card ${card.isDisabled ? 'disabled' : 'enabled'}.` };
  res.redirect(`/admin/surprise-cards/${card._id}`);
});

exports.deleteSurpriseCard = catchAsync(async (req, res) => {
  const card = await SurpriseCard.findByIdAndDelete(req.params.id);
  if (!card) throw new AppError('Surprise card not found.', 404);

  logAdminAction(req, 'surprisecard.delete', { targetType: 'SurpriseCard', targetId: card._id, details: { slug: card.slug } });

  req.session.flash = { type: 'success', message: 'Card deleted.' };
  res.redirect('/admin/surprise-cards');
});

// Settings now lives in controllers/settingsController.js (9 tabs' worth of
// fields + encryption + a test-email button outgrew this file).

// Reviews
exports.listReviews = catchAsync(async (req, res) => {
  const [reviews, approvedCount] = await Promise.all([
    Review.find().sort({ createdAt: -1 }),
    Review.countDocuments({ isApproved: true }),
  ]);
  res.render('admin/reviews', { title: 'Reviews', reviews, approvedCount });
});

exports.exportReviewsCsv = catchAsync(async (req, res) => {
  const reviews = await Review.find().sort({ createdAt: -1 });
  sendCsv(
    res,
    `reviews-${Date.now()}.csv`,
    ['Name', 'Occasion', 'Rating', 'Text', 'Approved', 'Submitted'],
    reviews.map((r) => [r.name, r.occasion, r.rating, r.text, r.isApproved ? 'Yes' : 'No', r.createdAt.toISOString()])
  );
});

exports.approveReview = catchAsync(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new AppError('Review not found.', 404);
  review.isApproved = true;
  await review.save();
  logAdminAction(req, 'review.approve', { targetType: 'Review', targetId: review._id });
  req.session.flash = { type: 'success', message: 'Review approved.' };
  res.redirect('/admin/reviews');
});

exports.unapproveReview = catchAsync(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new AppError('Review not found.', 404);
  review.isApproved = false;
  await review.save();
  logAdminAction(req, 'review.unapprove', { targetType: 'Review', targetId: review._id });
  req.session.flash = { type: 'success', message: 'Review unapproved.' };
  res.redirect('/admin/reviews');
});

exports.deleteReview = catchAsync(async (req, res) => {
  const review = await Review.findByIdAndDelete(req.params.id);
  logAdminAction(req, 'review.delete', { targetType: 'Review', targetId: req.params.id });
  req.session.flash = { type: 'success', message: 'Review deleted.' };
  res.redirect('/admin/reviews');
});

// --- Audit log ---
exports.getAuditLog = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const [logs, total] = await Promise.all([
    AuditLog.find()
      .populate('admin', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
    AuditLog.countDocuments(),
  ]);

  res.render('admin/audit-log', { title: 'Audit log', logs, page, totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1) });
});
