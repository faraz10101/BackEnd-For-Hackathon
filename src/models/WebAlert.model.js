const mongoose = require('mongoose');
const { SCAM_TYPES } = require('../config/constants');
const { research } = require('../config/ai.config');

// A scam warning the AI found on the public web (NOT a user report). Always shown with its source.
const schema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    summary: { type: String, required: true },
    tip: { type: String, default: '' },
    scamType: { type: String, enum: SCAM_TYPES, default: 'other' },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    sourceName: { type: String, default: '' },
    sourceUrl: { type: String, required: true },
    publishedDate: { type: String, default: null }, // YYYY-MM-DD if the source gave one
    day: { type: String, index: true },            // Pakistan date of the research run
    provider: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ createdAt: -1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: research.keepDays * 86400 }); // auto delete old alerts

module.exports = mongoose.model('WebAlert', schema);
