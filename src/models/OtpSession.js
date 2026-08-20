const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * One in-flight OTP attempt — either verifying a new registration or
 * authenticating a login. purpose keeps the two from being interchangeable:
 * a registration code must never verify as a login code or vice versa.
 * codeHash is bcrypt, never the raw code. The TTL index below does the
 * cleanup — nothing else has to.
 */
const otpSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['register', 'login'], required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpSession', otpSessionSchema);
