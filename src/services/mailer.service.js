const nodemailer = require('nodemailer');

/**
 * Sends the raw OTP by email. Without SMTP creds configured (local dev,
 * CI, tests) this just logs the code instead of failing — the login
 * flow stays fully testable with zero real infrastructure. In
 * production that fallback is refused outright: logging a live login
 * code to stdout would be a silent 2FA bypass for anyone with log access.
 */
const sendOtpEmail = async (toEmail, code) => {
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP_HOST is not configured — refusing to send OTP in production');
    }
    console.log(`[mailer] OTP for ${toEmail}: ${code}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Your GigLedger login code',
    text: `Your login code is ${code}. It expires in 5 minutes.`,
  });
};

module.exports = { sendOtpEmail };
