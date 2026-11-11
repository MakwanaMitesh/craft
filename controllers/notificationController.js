const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');

// Backs the bell icon's dropdown — small, so no pagination.
exports.listNotifications = catchAsync(async (req, res) => {
  const notifications = await Notification.find({ user: req.session.userId }).sort({ createdAt: -1 }).limit(20);
  res.json({ notifications });
});

exports.markAllRead = catchAsync(async (req, res) => {
  await Notification.updateMany({ user: req.session.userId, isRead: false }, { isRead: true });
  res.json({ success: true });
});
