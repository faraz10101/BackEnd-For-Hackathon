// Manage AI provider keys. All routes are protected by the x-admin-key header.
const AIProvider = require('../models/AIProvider.model');
const { encrypt, decrypt } = require('../utils/crypto');
const { adapters, healthCheck } = require('../services/ai/aiRouter');
const { runDailyResearch, researchStatus } = require('../services/research.service');
const { autoSelect, backupList } = require('../services/ai/modelPicker');
const { refreshGlobal } = require('../services/live.service');

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

// POST /api/admin/providers  { name, type, apiKey, baseUrl?, model?, embedModel?, priority? }
// Leave `model` empty = AUTOMATIC: the server loads the model list, tests the best ones and keeps the first that answers.
exports.create = async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const type = b.type;
  const apiKey = String(b.apiKey || '').trim();
  const baseUrl = String(b.baseUrl || '').trim();
  let model = String(b.model || '').trim();
  let embedModel = String(b.embedModel || '').trim();
  const priority = Number(b.priority) || 10;
  if (!name || !['gemini', 'openai'].includes(type) || !apiKey) return bad(res, 'name, type (gemini | openai) and apiKey are required.');
  if (type === 'openai' && !baseUrl) return bad(res, 'baseUrl is required for type "openai".');
  if (await AIProvider.exists({ name })) return bad(res, `A provider named "${name}" already exists. Choose another name.`, 409);

  let fallbackModels = [];
  let note;
  if (!model) {
    try {
      const r = await autoSelect({ type, apiKey, baseUrl, adapters });
      model = r.model; fallbackModels = r.fallbackModels; if (!embedModel) embedModel = r.embedModel;
      note = `Automatic: "${model}" passed the test. ${fallbackModels.length} backup model(s) saved${embedModel ? `, embeddings: ${embedModel}` : ''}.`;
    } catch (err) {
      return bad(res, `Could not pick a model automatically: ${err.message}`, 502);
    }
  } else {
    fallbackModels = await backupList({ type, apiKey, baseUrl, adapters, current: model });
    note = `Saved with model "${model}". ${fallbackModels.length} backup model(s) found.`;
  }
  const doc = await AIProvider.create({ name, type, model, fallbackModels, embedModel, baseUrl, priority, apiKeyEnc: encrypt(apiKey) });
  res.status(201).json({ success: true, data: clean(doc), note });
};

// POST /api/admin/providers/:id/auto-model -> test again and pick the best working model
exports.autoModel = async (req, res) => {
  const p = await AIProvider.findById(req.params.id).select('+apiKeyEnc');
  if (!p) return bad(res, 'Provider not found.', 404);
  try {
    const r = await autoSelect({ type: p.type, apiKey: decrypt(p.apiKeyEnc), baseUrl: p.baseUrl, adapters, preferred: p.model });
    p.model = r.model; p.fallbackModels = r.fallbackModels; if (!p.embedModel && r.embedModel) p.embedModel = r.embedModel;
    p.cooldownUntil = null; p.failCount = 0; p.lastError = null;
    await p.save();
    res.json({ success: true, data: clean(p), note: `"${r.model}" passed the test. ${r.fallbackModels.length} backup model(s) saved.` });
  } catch (err) {
    bad(res, `Automatic model selection failed: ${err.message}`, 502);
  }
};

// POST /api/admin/live/refresh -> research the public live feed now (works with ANY provider)
exports.liveRefresh = async (req, res) => {
  const r = await refreshGlobal();
  res.json({ success: true, data: r });
};

exports.update = async (req, res) => {
  const allowed = ['enabled', 'priority', 'model', 'embedModel', 'baseUrl'];
  if (req.body.model !== undefined) req.body.model = String(req.body.model).trim();
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (patch.model === '') delete patch.model; // never blank out the model
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
      system: 'Reply with the JSON object {"ok": true} and nothing else.', prompt: 'ping', timeoutMs: 40000,
    });
    res.json({ success: true, data: { ok: true, ms: Date.now() - started } });
  } catch (err) {
    res.json({ success: true, data: { ok: false, error: err.message } });
  }
};

// GET /api/admin/providers/:id/models -> models this key can really use (to pick a working model name)
exports.models = async (req, res) => {
  const p = await AIProvider.findById(req.params.id).select('+apiKeyEnc');
  if (!p) return bad(res, 'Provider not found.', 404);
  try {
    const all = await adapters[p.type].listModels({ apiKey: decrypt(p.apiKeyEnc), baseUrl: p.baseUrl });
    res.json({ success: true, data: { generate: all.filter((m) => m.generate).map((m) => m.id), embed: all.filter((m) => m.embed).map((m) => m.id) } });
  } catch (err) {
    bad(res, `Could not load the model list: ${err.message}`, 502);
  }
};

// POST /api/admin/providers/preview-models { type, baseUrl, apiKey } -> models, BEFORE the provider is saved
exports.previewModels = async (req, res) => {
  const { type, baseUrl = '', apiKey } = req.body || {};
  if (!['gemini', 'openai'].includes(type) || !apiKey) return bad(res, 'type and apiKey are required.');
  if (type === 'openai' && !baseUrl) return bad(res, 'baseUrl is required for type "openai".');
  try {
    const all = await adapters[type].listModels({ apiKey: String(apiKey).trim(), baseUrl: String(baseUrl).trim() });
    res.json({ success: true, data: { generate: all.filter((m) => m.generate).map((m) => m.id), embed: all.filter((m) => m.embed).map((m) => m.id) } });
  } catch (err) {
    bad(res, `Could not connect: ${err.message}`, 502);
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
