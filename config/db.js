const mongoose = require('mongoose');
const dns = require('dns');

// Some networks cannot resolve MongoDB Atlas "mongodb+srv://" addresses. If you hit that,
// set DNS_SERVERS=8.8.8.8,8.8.4.4 in .env. Left empty, the system DNS is used.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Connected to DB');
  } catch (error) {
    // Without a database nothing works, so stop clearly instead of running half-broken.
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }
}

module.exports = connectDB;
