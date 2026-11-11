const AppError = require('../utils/AppError');

// Error/404 pages extend the main layout, which needs `settings` and
// `currentUser` — normally set by injectLocals earlier in the chain. If the
// error happened *inside* injectLocals itself (e.g. the Settings lookup
// throws), those locals would be missing and rendering the error page would
// itself crash. Fall back to safe defaults rather than risk that cascade.
function ensureLayoutLocals(res) {
  if (res.locals.settings === undefined) res.locals.settings = { siteName: 'CelebraCraft', supportEmail: '' };
  if (res.locals.currentUser === undefined) res.locals.currentUser = null;
  if (res.locals.flash === undefined) res.locals.flash = null;
}

// 404 handler — placed after all routes.
function notFound(req, res) {
  ensureLayoutLocals(res);
  res.status(404).render('errors/404', { title: 'Page not found' });
}

function wantsJson(req) {
  return (
    req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.originalUrl.startsWith('/payments/') ||
    /^\/c\/[^/]+\/opened$/.test(req.path)
  );
}

// Central error handler — catches everything thrown or passed to next(err).
function errorHandler(err, req, res, next) {
  let error = err;

  if (err.name === 'ValidationError') {
    error = new AppError(Object.values(err.errors).map((e) => e.message).join(', '), 400);
  }
  if (err.code === 11000) {
    error = new AppError('That value is already in use.', 400);
  }
  if (err.name === 'CastError') {
    error = new AppError('Resource not found.', 404);
  }
  if (err.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE: 'That file is too large.',
      LIMIT_FILE_COUNT: 'Too many files.',
      LIMIT_UNEXPECTED_FILE: 'Too many files.',
    };
    error = new AppError(messages[err.code] || 'Upload failed. Please try again.', 400);
  }

  const statusCode = error.statusCode || 500;
  const message = error.isOperational ? error.message : 'Something went wrong. Please try again.';

  // Unexpected (non-operational) errors are exactly what ops needs visibility
  // into in production — logging only outside production had it backwards.
  if (!error.isOperational) console.error(err);

  if (wantsJson(req)) {
    return res.status(statusCode).json({ success: false, message });
  }

  // A GET request failing usually means there's no sensible form to flash a
  // message back to (and no guarantee the referer is safe to redirect into
  // either) — show a proper error page instead. POST/PUT/DELETE failures
  // are typically validation errors, where redirecting back with a flash is
  // the better UX for continuing to fill out the same form.
  if (req.method === 'GET' || statusCode >= 500) {
    ensureLayoutLocals(res);
    return res.status(statusCode).render('errors/500', { title: 'Something went wrong', message });
  }

  // res.status(code).redirect(url) silently sends 302, not `code` — redirect()
  // always sets its own status unless given one explicitly as the first
  // argument, like this.
  req.session.flash = { type: 'error', message };
  return res.redirect(statusCode, req.headers.referer || '/');
}

module.exports = { notFound, errorHandler };
