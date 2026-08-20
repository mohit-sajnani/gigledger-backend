const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * A gig worker's account. passwordHash is select: false so it never
 * leaks into a plain .find()/.findOne() unless explicitly requested.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    platformsLinked: { type: [String], default: [] },
    taxProfile: { type: Schema.Types.Mixed, default: {} },
    twoFactorEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
