// Not needed any more: providers are loaded from .env automatically every time the server starts.
// You can still run it manually:  npm run providers
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { syncProviders } = require('../services/ai/providerSync');

(async () => {
  await connectDB();
  await syncProviders();
  await mongoose.disconnect();
})();
