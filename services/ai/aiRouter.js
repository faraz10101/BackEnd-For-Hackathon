// AI ROUTER: the single place that decides WHICH provider answers.
//
//  - Providers (Gemini, Groq, OpenRouter, your own ...) live in MongoDB, loaded from .env at startup.
//  - They are tried by priority (lowest number first).
//  - If one fails (limit reached, timeout, bad key, bad JSON) it rests for a while (see config/ai.config.js)
//    and the NEXT provider answers the same request. The user never sees the switch.
//  - Repeated quota errors rest longer each time (1 min, 2, 4 ... up to 6 h).
//  - If every provider fails, generateJSON() throws AIUnavailableError and callers use rule-based fallbacks;
//    embed() falls back to an offline embedding.
const AIProvider = require('../../models/AIProvider.model');
const { decrypt } = require('../../utils/crypto');
const { localEmbed } = require('../../utils/similarity');
const cfg = require('../../config/ai.config');
const gemini = require('./providers/gemini');
const openai = require('./providers/openaiCompat');

const adapters = { gemini, openai };

// ---- several models per key --------------------------------------------------
// If a model stops working (renamed, removed, bad answers) the SAME key tries its backup models before the router
// moves on to the next provider. A backup that works becomes the main model, so the next call is fast again.
const isModelProblem = (e) =>
  [400, 404, 503].includes(e.status) || /model.*(not found|unavailable|unsupported|deprecated|does not exist)|valid JSON|unexpected shape|Empty response/i.test(e.message || '');

async function withModels(p, call) {
  const list = [p.model, ...(p.fallbackModels || []).filter((m) => m && m !== p.model)].slice(0, 4);
  let last;
  for (const [i, model] of list.entries()) {
    try {
      const out = await call(model);
      if (i > 0) {
        console.warn(`[AI] ${p.name}: model "${p.model}" failed, "${model}" works and is now the main model.`);
        AIProvider.updateOne({ _id: p._id }, { $set: { model, fallbackModels: list.filter((m) => m !== model) } }).catch(() => {});
      }
      return out;
    } catch (err) {
      last = err;
      if (!isModelProblem(err) || i === list.length - 1) throw err;
      console.warn(`[AI] ${p.name}: model "${model}" failed (${err.message}), trying the next model.`);
    }
  }
  throw last;
}
const taskCfg = (task) => ({ ...cfg.tasks.default, ...(cfg.tasks[task] || {}) });

class AIUnavailableError extends Error {
  constructor(details) {
    super('No AI provider is currently available');
    this.name = 'AIUnavailableError';
    this.details = details;
  }
}

// capability: 'generate' | 'embed' | 'search' (search = web browsing, Gemini only)
async function candidates(capability) {
  const base = { enabled: true };
  if (capability === 'embed') base.embedModel = { $nin: ['', null] };
  if (capability === 'search') base.type = 'gemini';
  const ready = await AIProvider.find({
    ...base,
    $or: [{ cooldownUntil: null }, { cooldownUntil: { $lte: new Date() } }],
  })
    .select('+apiKeyEnc')
    .sort({ priority: 1, failCount: 1 });
  if (ready.length) return ready;
  // Everything is cooling down: still try them, soonest-available first.
  return AIProvider.find(base).select('+apiKeyEnc').sort({ cooldownUntil: 1 }).limit(10);
}

function cooldownMs(err, failCount = 0) {
  const c = cfg.cooldown;
  const s = err.status;
  if (s === 401 || s === 403) return c.authMs;
  if (s === 429) return Math.min(c.quotaMaxMs, c.quotaBaseMs * 2 ** Math.min(failCount, 12));
  if (s === 400 || s === 404) return c.modelMs;
  return c.otherMs;
}

const markFail = (p, err) =>
  AIProvider.updateOne(
    { _id: p._id },
    {
      $inc: { failCount: 1 },
      $set: { cooldownUntil: new Date(Date.now() + cooldownMs(err, p.failCount)), lastError: String(err.message).slice(0, 200) },
    }
  ).catch(() => {});

const markOk = (p) =>
  AIProvider.updateOne(
    { _id: p._id },
    {
      $set: { failCount: 0, cooldownUntil: null, lastError: null, lastUsedAt: new Date() },
      $inc: { successCount: 1 },
    }
  ).catch(() => {});

function parseJSON(text) {
  const clean = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json|```/gi, '').trim(); // reasoning models (DeepSeek, GLM) may add <think> blocks
  try {
    return JSON.parse(clean);
  } catch {
    const a = clean.indexOf('{');
    const b = clean.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(clean.slice(a, b + 1));
    throw new Error('AI did not return valid JSON');
  }
}

const logFail = (task, p, err, hasNext) =>
  console.warn(`[AI] ${p.name} failed for "${task}": ${err.message}${hasNext ? '  -> switching to the next provider' : ''}`);

async function generateJSON({ system, prompt, validate, task = 'default' }) {
  const t = taskCfg(task);
  const list = await candidates('generate');
  const errors = [];
  for (const [i, p] of list.entries()) {
    try {
      const data = await withModels(p, async (model) => {
        const text = await adapters[p.type].generate({
          apiKey: decrypt(p.apiKeyEnc), model, baseUrl: p.baseUrl,
          system, prompt, timeoutMs: t.timeoutMs, temperature: t.temperature,
        });
        const d = parseJSON(text);
        if (validate && !validate(d)) throw new Error('AI response had an unexpected shape');
        return d;
      });
      await markOk(p);
      if (errors.length) console.warn(`[AI] "${task}" was answered by ${p.name} instead.`);
      return { data, provider: p.name };
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
      logFail(task, p, err, i < list.length - 1);
      await markFail(p, err);
    }
  }
  throw new AIUnavailableError(errors);
}

// Web research: Gemini + Google Search. Returns the parsed JSON plus the pages that were really used.
async function researchJSON({ system, prompt, validate, task = 'research' }) {
  const t = taskCfg(task);
  const list = await candidates('search');
  if (!list.length) throw new AIUnavailableError(['No Gemini provider found. Web research needs a Gemini key (GEMINI_API_KEY).']);
  const errors = [];
  for (const [i, p] of list.entries()) {
    try {
      const { r, data } = await withModels(p, async (model) => {
        const out = await gemini.generateWithSearch({
          apiKey: decrypt(p.apiKeyEnc), model, system, prompt, timeoutMs: t.timeoutMs, temperature: t.temperature,
        });
        const d = parseJSON(out.text);
        if (validate && !validate(d)) throw new Error('AI response had an unexpected shape');
        return { r: out, data: d };
      });
      await markOk(p);
      return { data, sources: r.sources, queries: r.queries, provider: p.name };
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
      logFail(task, p, err, i < list.length - 1);
      await markFail(p, err);
    }
  }
  throw new AIUnavailableError(errors);
}

async function embed(text) {
  const input = String(text || '').slice(0, 2000);
  const t = taskCfg('embed');
  try {
    const list = await candidates('embed');
    for (const p of list) {
      try {
        const vector = await adapters[p.type].embed({
          apiKey: decrypt(p.apiKeyEnc), model: p.embedModel, baseUrl: p.baseUrl,
          text: input, timeoutMs: t.timeoutMs,
        });
        await markOk(p);
        return { vector, tag: `${p.type}:${p.embedModel}` };
      } catch (err) {
        await markFail(p, err);
      }
    }
  } catch { /* DB or decrypt problem: use offline embedding */ }
  return { vector: localEmbed(input), tag: 'local' };
}

// ---- Health check: does every provider really answer right now? ----------
const timed = async (fn) => {
  const started = Date.now();
  try { await fn(); return { ok: true, ms: Date.now() - started }; }
  catch (e) { return { ok: false, ms: Date.now() - started, error: String(e.message).slice(0, 200) }; }
};

async function healthCheck({ search = false } = {}) {
  const all = await AIProvider.find().select('+apiKeyEnc').sort({ priority: 1 });
  return Promise.all(all.map(async (p) => {
    const row = { name: p.name, type: p.type, model: p.model, embedModel: p.embedModel || null, priority: p.priority, enabled: p.enabled, source: p.source };
    if (!p.enabled) return { ...row, skipped: 'disabled' };

    let apiKey;
    try { apiKey = decrypt(p.apiKeyEnc); }
    catch { return { ...row, generate: { ok: false, error: 'Cannot decrypt the key. Did ENCRYPTION_SECRET change? Restart the server to reload keys from .env.' } }; }

    row.generate = await timed(() => adapters[p.type].generate({
      apiKey, model: p.model, baseUrl: p.baseUrl, timeoutMs: 40000,
      system: 'Reply with the JSON object {"ok": true} and nothing else.', prompt: 'ping',
    }));
    if (row.generate.ok) await markOk(p); else await markFail(p, { status: undefined, message: row.generate.error });

    if (p.embedModel) {
      row.embed = await timed(() => adapters[p.type].embed({ apiKey, model: p.embedModel, baseUrl: p.baseUrl, text: 'ping', timeoutMs: 30000 }));
    }
    if (search && p.type === 'gemini') {
      row.search = await timed(async () => {
        const r = await gemini.generateWithSearch({ apiKey, model: p.model, timeoutMs: 40000, system: 'Answer briefly.', prompt: 'Search the web: what is the latest news headline from Dawn newspaper Pakistan?' });
        if (!r.sources.length) throw new Error('Answered, but did not use web search (no sources returned)');
      });
    }
    return row;
  }));
}

module.exports = { generateJSON, researchJSON, embed, healthCheck, AIUnavailableError, adapters };
