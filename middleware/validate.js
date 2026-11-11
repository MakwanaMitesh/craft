const { validationResult } = require('express-validator');

// Run after express-validator rules; on failure, flash the first error and
// bounce back to the form the user submitted instead of throwing.
function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  req.session.flash = { type: 'error', message: errors.array()[0].msg };
  req.session.oldInput = req.body;
  return res.redirect(req.headers.referer || '/');
}

module.exports = validate;
