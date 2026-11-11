const crypto = require('crypto');

// Encrypts secrets at rest (Razorpay key secret, SMTP password) with
// AES-256-GCM. The key comes from ENCRYPTION_KEY (a 32-byte value, hex or
// plain string — either is hashed down to 32 bytes with sha256) so it
// never has to be exactly 32 bytes in the .env file. Falls back to
// SESSION_SECRET if ENCRYPTION_KEY isn't set, purely so local/dev setups
// that haven't added it yet don't crash — production should set its own.
function getKey() {
  const source = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'celebracraft-dev-fallback-key';
  return crypto.createHash('sha256').update(source).digest();
}

// Encrypted values are prefixed "enc:" so decrypt() can tell them apart
// from plaintext already sitting in the database from before this existed
// — those pass through unchanged and get re-encrypted the next time they're saved.
function encrypt(plainText) {
  if (!plainText) return plainText;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(value) {
  if (!value || !value.startsWith('enc:')) return value;
  try {
    const [, ivHex, authTagHex, dataHex] = value.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return ''; // corrupted/unreadable under the current key — treat as unset rather than throwing
  }
}

module.exports = { encrypt, decrypt };
