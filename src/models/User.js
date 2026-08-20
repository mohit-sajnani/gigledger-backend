const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * A gig worker's account. No password anywhere — auth is entirely
 * email-OTP, so there's nothing here to hash or leak.
 */
const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    emailVerified: { type: Boolean, default: false },
    platformsLinked: { type: [String], default: [] },
    taxProfile: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
