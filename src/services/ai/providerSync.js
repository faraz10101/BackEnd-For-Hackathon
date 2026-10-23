// Reads AI providers from .env and stores them (keys encrypted) in MongoDB.
// Runs automatically every time the server starts, so there is no extra command to run.
//
//  Ready-made providers (see config/ai.config.js):
//     GEMINI_API_KEY, GEMINI_API_KEY_2, ...      GROQ_API_KEY ...      OPENROUTER_API_KEY ...
//  Your own provider (any OpenAI-compatible API), n = 1..9:
//     AI_PROVIDER_1_NAME=together   AI_PROVIDER_1_TYPE=openai   AI_PROVIDER_1_MODEL=...
//     AI_PROVIDER_1_BASE_URL=https://api.together.xyz/v1   AI_PROVIDER_1_KEY=...   AI_PROVIDER_1_PRIORITY=6
const AIProvider = require('../../models/AIProvider.model');
const { encrypt } = require('../../utils/crypto');
const cfg = require('../../config/ai.config');

const SUFFIXES = ['', '_2', '_3', '_4', '_5'];

// Removes spaces and accidental quotes around a key.
const cleanKey = (v) => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
const mask = (k) => (k.length > 8 ? `...${k.slice(-4)}` : '****');

// Pure function (easy to test): env -> list of providers that should exist.
function collectFromEnv(env = process.env) {
  const out = [];

  for (const p of cfg.presets) {
    SUFFIXES.forEach((suffix, i) => {
      const key = cleanKey(env[`${p.keyEnv}${suffix}`]);
      if (!key) return;
      out.push({
        name: `${p.id}_${i + 1}`, type: p.type, baseUrl: p.baseUrl || '', model: p.model,
        embedModel: p.embedModel || '', priority: p.priority + i * 0.1, apiKey: key,
      });
    });
  }

  for (let n = 1; n <= 9; n++) {
    const get = (f) => String(env[`AI_PROVIDER_${n}_${f}`] || '').trim();
    const key = cleanKey(env[`AI_PROVIDER_${n}_KEY`]);
    if (!key) continue;
    const type = get('TYPE') || 'openai';
    const problems = [];
    if (!get('NAME')) problems.push('NAME');
    if (!get('MODEL')) problems.push('MODEL');
    if (!['gemini', 'openai'].includes(type)) problems.push('TYPE (gemini | openai)');
    if (type === 'openai' && !get('BASE_URL')) problems.push('BASE_URL');
    if (problems.length) { console.warn(`[AI] AI_PROVIDER_${n}_* ignored, missing/invalid: ${problems.join(', ')}`); continue; }
    out.push({
      name: get('NAME'), type, baseUrl: get('BASE_URL'), model: get('MODEL'), embedModel: get('EMBED_MODEL'),
      priority: Number(get('PRIORITY')) || 10, apiKey: key,
    });
  }
  return out;
}

async function syncProviders({ quiet = false } = {}) {
  const wanted = collectFromEnv();

  for (const w of wanted) {
    const { apiKey, ...fields } = w;
    await AIProvider.updateOne(
      { name: w.name },
      {
        $set: { ...fields, apiKeyEnc: encrypt(apiKey), source: 'env', failCount: 0, cooldownUntil: null, lastError: null },
        $setOnInsert: { enabled: true },
      },
      { upsert: true }
    );
  }

  // Providers that came from .env earlier but whose key was removed: switch them off.
  const names = wanted.map((w) => w.name);
  const gone = await AIProvider.updateMany({ source: 'env', name: { $nin: names }, enabled: true }, { $set: { enabled: false } });

  if (!quiet) {
    if (!wanted.length) {
      console.warn('[AI] No AI keys found in .env. The app still works, but with rule-based answers only.');
    } else {
      console.log(`[AI] ${wanted.length} provider(s) loaded from .env:`);
      for (const w of wanted) console.log(`     - ${w.name.padEnd(13)} ${w.type.padEnd(7)} ${w.model}  (key ${mask(w.apiKey)}, priority ${w.priority})`);
    }
    if (gone.modifiedCount) console.log(`[AI] ${gone.modifiedCount} provider(s) disabled because their key is no longer in .env.`);
  }
  return wanted.map(({ apiKey, ...rest }) => rest);
}

module.exports = { syncProviders, collectFromEnv };
