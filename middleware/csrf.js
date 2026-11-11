const crypto = require('crypto');

// Hand-rolled session-bound CSRF token, used instead of the `csurf` package
// (deprecated/archived upstream, with open security advisories against it).
// Classic synchronizer-token pattern: a token lives in the session, every
// form embeds it as a hidden field, and state-changing requests must echo
// it back — an attacker's cross-site form can't read the session to forge it.

function ensureToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

// Requests that legitimately can't carry a session-bound token:
// - the Razorpay webhook: a server-to-server call verified by its own HMAC signature, no session at all
// - the public card-interaction beacons (opened, respond, track): fired from an anonymous recipient's browser with no session/login
const EXEMPT_PATHS = [/^\/payments\/webhook$/, /^\/c\/[^/]+\/opened$/, /^\/api\/cards\/[^/]+\/respond$/, /^\/api\/track$/];

function tokenMatches(req) {
  const submitted = req.body?._csrf || req.headers['x-csrf-token'];
  return Boolean(submitted && req.session.csrfToken && submitted === req.session.csrfToken);
}

function rejectRequest(req, res) {
  if (req.originalUrl.startsWith('/payments/') || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ success: false, message: 'Your session expired. Please refresh and try again.' });
  }

  // res.status(403).redirect(url) silently sends 302, not 403 — redirect()
  // always sets its own status unless given one explicitly as the first
  // argument, like this.
  req.session.flash = { type: 'error', message: 'Your session expired. Please try again.' };
  return res.redirect(403, req.headers.referer || '/');
}

function verifyToken(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (EXEMPT_PATHS.some((re) => re.test(req.path))) return next();

  // express.json()/urlencoded() never parse multipart/form-data — only
  // multer does, further down each upload route's own middleware chain. At
  // this point (mounted globally, before routing) req.body would still be
  // empty for those routes, so they skip this check and instead apply
  // verifyTokenAfterUpload themselves, placed right after upload.* in
  // routes/userRoutes.js and routes/adminRoutes.js.
  if (req.is('multipart/form-data')) return next();

  if (tokenMatches(req)) return next();
  return rejectRequest(req, res);
}

// Same check, but without the multipart short-circuit — for routes where
// multer has already run and populated req.body._csrf from the parsed form.
function verifyTokenAfterUpload(req, res, next) {
  if (tokenMatches(req)) return next();
  return rejectRequest(req, res);
}

module.exports = { ensureToken, verifyToken, verifyTokenAfterUpload };
