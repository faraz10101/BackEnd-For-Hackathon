const mongoose = require('mongoose');

// How many live searches one verified user has used on one Pakistan day.
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, required: true }, // YYYY-MM-DD in Pakistan time
    count: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ user: 1, day: 1 }, { unique: true });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 86400 }); // old rows clean themselves up

module.exports = mongoose.model('SearchUsage', schema);
