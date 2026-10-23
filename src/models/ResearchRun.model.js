const mongoose = require('mongoose');

// One row per research attempt, so we know whether today's run already happened.
const schema = new mongoose.Schema(
  {
    day: { type: String, index: true },
    status: { type: String, enum: ['ok', 'empty', 'failed'], required: true },
    saved: { type: Number, default: 0 },
    found: { type: Number, default: 0 },
    provider: { type: String, default: '' },
    queries: { type: [String], default: [] },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 86400 });
module.exports = mongoose.model('ResearchRun', schema);
