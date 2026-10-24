// Picks a WORKING model automatically, so nobody has to choose one by hand.
//  1. ask the provider which models this key has
//  2. rank them (fast chat models first; embedding / vision / audio / guard models are skipped)
//  3. test them one by one with a tiny request; the first that answers wins, the rest become backups
const SKIP = /embed|rerank|whisper|tts|speech|audio|image|imagen|vision|(^|[-_/ ])vl([-_/ ]|\d|$)|guard|moderation|dall|veo|live|transcribe|ocr/i;

function score(id) {
  const s = id.toLowerCase();
  let n = 0;
  if (/flash|mini|lite|fast|instant|turbo|haiku/.test(s)) n += 3;
  if (/instruct|chat/.test(s)) n += 1;
  if (/preview|exp|beta|thinking|reasoner|-r1/.test(s)) n -= 2;
  if (/(^|[-_/])pro([-_/]|$)|opus|large|405b|120b/.test(s)) n -= 1;
  return n;
}

function rankModels(ids) {
  return [...new Set(ids)]
    .filter((id) => id && !SKIP.test(id))
    .map((id) => ({ id, n: score(id) }))
    .sort((a, b) => b.n - a.n || a.id.length - b.id.length || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

const PING = { system: 'Reply with the JSON object {"ok": true} and nothing else.', prompt: 'ping' };

async function autoSelect({ type, apiKey, baseUrl, adapters, preferred = '', maxTries = 5 }) {
  const a = adapters[type];
  const all = await a.listModels({ apiKey, baseUrl });
  const ranked = rankModels(all.filter((m) => m.generate).map((m) => m.id));
  if (!ranked.length) throw new Error('This key has no usable chat models.');
  const order = preferred && ranked.includes(preferred) ? [preferred, ...ranked.filter((x) => x !== preferred)] : ranked;

  const tried = [];
  let model = null;
  for (const id of order.slice(0, maxTries)) {
    try {
      await a.generate({ apiKey, baseUrl, model: id, ...PING, timeoutMs: 25000 });
      model = id; break;
    } catch (err) {
      tried.push(`${id}: ${err.message}`);
      if ([401, 403, 429].includes(err.status)) break; // the KEY has the problem, another model will not help
    }
  }
  if (!model) throw new Error(`No model answered the test. ${tried.join(' | ')}`.slice(0, 400));

  let embedModel = '';
  const embeds = all.filter((m) => m.embed).map((m) => m.id).sort((x, y) => Number(/embedding/.test(y)) - Number(/embedding/.test(x)));
  for (const id of embeds.slice(0, 2)) {
    try { await a.embed({ apiKey, baseUrl, model: id, text: 'ping', timeoutMs: 20000 }); embedModel = id; break; } catch { /* try the next one */ }
  }
  return { model, fallbackModels: order.filter((x) => x !== model).slice(0, 8), embedModel, total: order.length };
}

// Best effort backup list for a model the admin typed by hand (no tests, never throws).
async function backupList({ type, apiKey, baseUrl, adapters, current }) {
  try {
    const all = await adapters[type].listModels({ apiKey, baseUrl });
    return rankModels(all.filter((m) => m.generate).map((m) => m.id)).filter((x) => x !== current).slice(0, 8);
  } catch { return []; }
}

module.exports = { rankModels, autoSelect, backupList };
