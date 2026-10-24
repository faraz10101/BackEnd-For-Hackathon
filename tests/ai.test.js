// Offline test: automatic model choice, model fallback inside one provider, safe page peek.
const path = require('path');
const B = path.resolve(__dirname, '..');
process.env.ENCRYPTION_SECRET = 't'; process.env.SALT = 's';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const { rankModels, autoSelect } = require(`${B}/services/ai/modelPicker`);
const { isPrivateIp, hostIsPublic } = require(`${B}/services/pagePeek.service`);

(async () => {
  // River's real list from the admin screenshot
  const ids = ['Qwen3.8-27B-FP8', 'DeepSeek-V4.1-Flash', 'NVIDIA-Nemotron-3.5-Super-VL-120B-NVFP4', 'GLM-5.3-Flash', 'DeepSeek-V4.1-Flash-1017', 'text-embedding-3', 'whisper-1'];
  const ranked = rankModels(ids);
  ok(/flash/i.test(ranked[0]) && ranked.slice(0, 3).every((m) => /flash/i.test(m)) && !ranked.includes('NVIDIA-Nemotron-3.5-Super-VL-120B-NVFP4') && !ranked.includes('text-embedding-3') && !ranked.includes('whisper-1'), `ranking: ${ranked.join(' > ')}`);
  ok(rankModels(['gemini-3.8-flash-image', 'gemini-3.8-pro', 'gemini-3.8-flash', 'gemini-live-3.8'])[0] === 'gemini-3.8-flash', 'gemini ranking prefers flash, skips image/live');

  // first model is broken (404) -> the next one that answers is chosen
  const calls = [];
  const adapters = { openai: {
    listModels: async () => ids.map((id) => ({ id, generate: !/embed|whisper/.test(id), embed: /embed/.test(id) })),
    generate: async ({ model }) => { calls.push(model); if (model === ranked[0]) { const e = new Error('HTTP 404: Model not found'); e.status = 404; throw e; } return '{"ok":true}'; },
    embed: async () => { const e = new Error('no embeddings'); e.status = 404; throw e; },
  } };
  const r = await autoSelect({ type: 'openai', apiKey: 'k', baseUrl: 'u', adapters });
  ok(r.model !== ranked[0] && calls[0] === ranked[0] && r.fallbackModels.length >= 1 && r.embedModel === '', `auto-select skipped the broken model and chose "${r.model}", ${r.fallbackModels.length} backups`);

  // a rejected KEY stops the search at once (another model would not help)
  let n = 0;
  adapters.openai.generate = async () => { n++; const e = new Error('HTTP 401: bad key'); e.status = 401; throw e; };
  let msg = ''; try { await autoSelect({ type: 'openai', apiKey: 'k', baseUrl: 'u', adapters }); } catch (e) { msg = e.message; }
  ok(n === 1 && /No model answered/.test(msg), 'bad key: one try, clear error');

  // page peek must never touch private / internal addresses
  ok(['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0'].every(isPrivateIp), 'private / metadata addresses are blocked');
  ok(!isPrivateIp('8.8.8.8') && !isPrivateIp('142.250.1.1'), 'public addresses are allowed');
  ok(!(await hostIsPublic('localhost')) && !(await hostIsPublic('127.0.0.1')) && !(await hostIsPublic('intranet.local')), 'localhost / .local refused');
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
