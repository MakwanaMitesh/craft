const nodemailer = require('nodemailer');

// Admin-configured SMTP (Settings → Email tab) takes priority; .env values
// are the fallback for anything the admin hasn't set yet, same pattern as
// Razorpay credentials in paymentController.
async function resolveSmtpConfig() {
  const Setting = require('../models/Setting'); // required lazily to avoid a require-cycle at module load time
  const settings = await Setting.getSingletonWithSecret();

  return {
    host: settings.smtp?.host || process.env.SMTP_HOST,
    port: Number(settings.smtp?.port || process.env.SMTP_PORT) || 587,
    user: settings.smtp?.user || process.env.SMTP_USER,
    pass: settings.smtp?.password || process.env.SMTP_PASS,
    fromName: settings.smtp?.fromName || settings.siteName || 'CelebraCraft',
    fromEmail: settings.smtp?.fromEmail || process.env.SMTP_FROM_EMAIL || 'no-reply@celebracraft.com',
  };
}

async function sendMail({ to, subject, html }) {
  const config = await resolveSmtpConfig();
  const from = `${config.fromName} <${config.fromEmail}>`;

  if (!config.host) {
    // No SMTP configured (e.g. local dev) — log instead of sending.
    console.log(`\n[Mailer] SMTP not configured. Would send email:\nTo: ${to}\nSubject: ${subject}\n${html}\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  await transporter.sendMail({ from, to, subject, html });
}

module.exports = { sendMail, resolveSmtpConfig };
