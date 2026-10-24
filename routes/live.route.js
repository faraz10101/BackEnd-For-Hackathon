const router = require('express').Router();
const rateLimit = require('../middleware/rateLimit');
const { userAuth } = require('../middleware/auth');
const { feed, info, search } = require('../controllers/live.controller');

// Public: the saved live feed (no AI call happens here, it only reads the database).
router.get('/feed', rateLimit({ windowMs: 60 * 1000, max: 60 }), feed);
// Verified accounts only. Besides the daily limit (5 per day) there is a small burst limit per user.
router.get('/info', userAuth, info);
router.post('/search', userAuth, rateLimit({ windowMs: 60 * 1000, max: 4, key: (req) => req.user._id, message: 'Please wait a moment before searching again.' }), search);

module.exports = router;
