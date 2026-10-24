const mongoose = require('mongoose');

// The PUBLIC live feed: one row per topic per refresh (server does this every few hours). Everyone reads the newest rows.
const schema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    foundAt: { type: Date, default: Date.now },
    data: { type: mongoose.Schema.Types.Mixed, required: true }, // headline, level, summary, dangers, protect, incidents ...
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ topic: 1, foundAt: -1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 4 * 86400 }); // old snapshots clean themselves up

module.exports = mongoose.model('LiveSnapshot', schema);
