function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) return next();
  req.session.flash = { type: 'error', message: 'Please log in to continue.' };
  return res.redirect('/login');
}

function isUser(req, res, next) {
  if (req.session.role === 'user') return next();
  req.session.flash = { type: 'error', message: 'This page is for customers only.' };
  return res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.session.role === 'admin') return next();
  req.session.flash = { type: 'error', message: 'Admin access required.' };
  return res.redirect('/login');
}

// If already logged in, skip auth pages and go straight to the right dashboard.
function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect(req.session.role === 'admin' ? '/admin/dashboard' : '/dashboard');
  }
  return next();
}

module.exports = { isAuthenticated, isUser, isAdmin, redirectIfAuthenticated };
