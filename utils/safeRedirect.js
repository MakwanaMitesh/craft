// Validates a user-supplied redirect target before ever passing it to
// res.redirect() — without this, a value like "//evil.com" or
// "https://evil.com" would be an open-redirect vector (looks like an
// internal link, actually sends the user off-site after login/register).
function safeRedirect(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) {
    return null;
  }
  return target;
}

module.exports = { safeRedirect };
