const live = require('../services/live.service');

// GET /api/live/feed  (PUBLIC, no login) -> the saved live feed everyone sees: per-topic answers + latest incidents
exports.feed = async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: await live.getGlobalFeed() });
};

// GET /api/live/info -> topics + searches left today + the user's last saved search (so a reload keeps it)
exports.info = async (req, res) => {
  const [quota, latest] = await Promise.all([live.getQuota(req.user._id), live.latestFor(req.user._id)]);
  res.json({ success: true, data: { topics: live.topicList(), quota, latest } });
};

// POST /api/live/search  { topic } or { query }  (login required) -> a fresh search saved in the user's account
exports.search = async (req, res) => {
  const custom = live.cleanQuery(req.body?.query);
  const topic = custom ? 'custom' : live.isTopic(req.body?.topic) ? req.body.topic : 'today';
  const uid = req.user._id;

  const taken = await live.consume(uid);
  if (!taken.ok) {
    const quota = await live.getQuota(uid);
    return res.status(429).json({
      success: false,
      message: `You have used all ${quota.limit} fresh searches for today. They reset at midnight (Pakistan time). The live feed above is still updated for you every few hours.`,
      data: { quota },
    });
  }

  let result;
  try {
    const seen = await live.recentSeen(uid).catch(() => ({ links: new Set(), lastAngle: {} }));
    result = await live.runSearch(topic, { custom, exclude: seen.links, angle: custom ? '' : live.pickAngle(topic, seen.lastAngle[topic]) });
    await live.saveUserResult(uid, result).catch((e) => console.warn('[Live] could not save the user search:', e.message));
  } catch (err) {
    console.warn('[Live] search failed:', err.details ? err.details.join(' | ') : err.message);
    result = (await live.fromSnapshot(topic).catch(() => null)) || (await live.fromStored(topic).catch(() => null));
    await live.refund(uid); // the user did not get a fresh result: do not charge
    if (!result) {
      return res.status(503).json({ success: false, message: 'Fresh search is not available right now. Please try again in a few minutes.', data: { quota: await live.getQuota(uid) } });
    }
    result.notice = 'A fresh search was not possible right now, so this is the latest saved result. Your search was not counted.';
  }
  res.json({ success: true, data: { result, quota: await live.getQuota(uid) } });
};
