// Manage AI provider keys. All routes are protected by the x-admin-key header.
const AIProvider = require('../models/AIProvider.model');
const { encrypt, decrypt } = require('../utils/crypto');
const { adapters, healthCheck } = require('../services/ai/aiRouter');
const { runDailyResearch, researchStatus } = require('../services/research.service');

const clean = (p) => {
  const o = p.toObject ? p.toObject() : { ...p };
  delete o.apiKeyEnc;
  return o;
};
const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

exports.list = async (req, res) => {
  const items = await AIProvider.find().sort({ priority: 1 });
  res.json({ success: true, data: items.map(clean) });
};

exports.create = async (req, res) => {
  const { name, type, model, embedModel = '', baseUrl = '', apiKey, priority = 10 } = req.body || {};
  if (!name || !['gemini', 'openai'].includes(type) || !model || !apiKey) {
    return bad(res, 'name, type (gemini | openai), model and apiKey are required.');
  }
  if (type === 'openai' && !baseUrl) return bad(res, 'baseUrl is required for type "openai".');
  const doc = await AIProvider.create({ name, type, model, embedModel, baseUrl, priority, apiKeyEnc: encrypt(apiKey) });
  res.status(201).json({ success: true, data: clean(doc) });
};

exports.update = async (req, res) => {
  const allowed = ['enabled', 'priority', 'model', 'embedModel', 'baseUrl'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (req.body.apiKey) patch.apiKeyEnc = encrypt(req.body.apiKey);
  patch.cooldownUntil = null;
  patch.failCount = 0;
  const doc = await AIProvider.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (!doc) return bad(res, 'Provider not found.', 404);
  res.json({ success: true, data: clean(doc) });
};

exports.remove = async (req, res) => {
  const doc = await AIProvider.findByIdAndDelete(req.params.id);
  if (!doc) return bad(res, 'Provider not found.', 404);
  res.json({ success: true, message: 'Provider removed.' });
};

exports.test = async (req, res) => {
  const p = await AIProvider.findById(req.params.id).select('+apiKeyEnc');
  if (!p) return bad(res, 'Provider not found.', 404);
  try {
    const started = Date.now();
    await adapters[p.type].generate({
      apiKey: decrypt(p.apiKeyEnc), model: p.model, baseUrl: p.baseUrl,
      system: 'Reply with the JSON object {"ok": true} and nothing else.', prompt: 'ping', timeoutMs: 12000,
    });
    res.json({ success: true, data: { ok: true, ms: Date.now() - started } });
  } catch (err) {
    res.json({ success: true, data: { ok: false, error: err.message } });
  }
};

exports.resetCooldowns = async (req, res) => {
  await AIProvider.updateMany({}, { cooldownUntil: null, failCount: 0, lastError: null });
  res.json({ success: true, message: 'All provider cooldowns cleared.' });
};

// GET /api/admin/ai/health[?search=1]  -> live test of every provider (and Gemini web search with ?search=1)
exports.health = async (req, res) => {
  const providers = await healthCheck({ search: req.query.search === '1' });
  const working = providers.filter((p) => p.generate?.ok).length;
  res.json({ success: true, data: { working, total: providers.length, providers } });
};

// GET /api/admin/research/status
exports.researchStatus = async (req, res) => res.json({ success: true, data: await researchStatus() });

// POST /api/admin/research/run  -> runs the daily web research now (can take up to a minute)
exports.researchRun = async (req, res) => {
  const result = await runDailyResearch({ force: true });
  res.json({ success: true, data: result });
};
