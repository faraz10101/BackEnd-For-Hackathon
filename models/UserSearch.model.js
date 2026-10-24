const mongoose = require('mongoose');

// A logged-in user's own fresh search. Saved in their account so a page reload does not lose it.
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    topic: { type: String, required: true },
    query: { type: String, default: '' },   // the words the user typed (if any)
    angle: { type: String, default: '' },   // which extra search was used (so the next search uses a different one)
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ user: 1, createdAt: -1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 });

module.exports = mongoose.model('UserSearch', schema);
