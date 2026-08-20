const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * One in-flight OTP attempt — either verifying a new registration or
 * authenticating a login. purpose keeps the two from being interchangeable:
 * a registration code must never verify as a login code or vice versa.
 * codeHash is bcrypt, never the raw code. The TTL index below does the
 * cleanup — nothing else has to.
 *
 * For purpose 'register' there's no User yet — email/firstName/lastName
 * hold the pending signup so the account is only ever created once the
 * code is actually verified. An abandoned registration this way just
 * expires with the session; it never squats the email permanently.
 */
const otpSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    purpose: { type: String, enum: ['register', 'login'], required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpSession', otpSessionSchema);
