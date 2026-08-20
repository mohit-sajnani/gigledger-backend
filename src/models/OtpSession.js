const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * One in-flight login-2FA attempt. codeHash is bcrypt, never the raw
 * code. The TTL index below does the cleanup — nothing else has to.
 */
const otpSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  { timestamps: true }
);

otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpSession', otpSessionSchema);
