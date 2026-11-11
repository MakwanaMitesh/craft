const crypto = require('crypto');
const geoip = require('geoip-lite');
const { UAParser } = require('ua-parser-js');
const { isbot } = require('isbot');

// SHA-256 of (ip + today's date) — enough to recognize the same visitor
// again within the same day for a unique-view count, without ever storing
// the raw IP address anywhere.
function hashIp(ip) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  return crypto.createHash('sha256').update(`${ip || 'unknown'}:${today}`).digest('hex');
}

function parseDevice(userAgent) {
  const result = new UAParser(userAgent || '').getResult();
  const deviceType = result.device.type === 'mobile' || result.device.type === 'tablet'
    ? result.device.type
    : 'desktop';
  return {
    deviceType,
    browser: result.browser.name || 'unknown',
    os: result.os.name || 'unknown',
  };
}

function detectReferrerSource(referrer) {
  if (!referrer) return 'direct';
  const r = referrer.toLowerCase();
  if (r.includes('whatsapp')) return 'whatsapp';
  if (r.includes('instagram')) return 'instagram';
  return 'other';
}

function lookupLocation(ip) {
  const geo = ip && geoip.lookup(ip);
  return { city: geo?.city || null, country: geo?.country || null };
}

module.exports = { hashIp, parseDevice, detectReferrerSource, lookupLocation, isBotRequest: isbot };
