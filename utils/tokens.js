const crypto = require('crypto');
const { nanoid } = require('nanoid');

// Short, URL-friendly id used for public card links, e.g. /c/x7qT9b2k
function generateCardSlug() {
  return nanoid(10);
}

// Random token for password reset links; only the hash is stored in the DB.
function generateResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, hashedToken };
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { generateCardSlug, generateResetToken, hashToken };
