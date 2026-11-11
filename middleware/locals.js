const Setting = require('../models/Setting');
const Notification = require('../models/Notification');

// Makes flash messages, old form input, the logged-in user, and site
// settings available to every EJS view without passing them explicitly.
async function injectLocals(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  res.locals.oldInput = req.session.oldInput || {};
  delete req.session.oldInput;

  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, name: req.session.userName, role: req.session.role }
    : null;
  res.locals.impersonatorName = req.session.impersonatorId ? req.session.impersonatorName : null;

  // Only customers have a bell icon — skip the extra query for logged-out
  // visitors and admins.
  res.locals.unreadNotificationCount = req.session.role === 'user'
    ? await Notification.countDocuments({ user: req.session.userId, isRead: false })
    : 0;

  res.locals.settings = await Setting.getSingleton();
  res.locals.currentPath = req.path;

  next();
}

module.exports = injectLocals;
