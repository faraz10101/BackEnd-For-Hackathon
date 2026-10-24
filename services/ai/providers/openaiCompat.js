// Works with any OpenAI-compatible API: Groq, OpenRouter, OpenAI, Together, etc.
const { postJSON, getJSON } = require('../../../utils/http');

const base = (u) => String(u || '').replace(/\/+$/, '');

async function generate({ apiKey, model, baseUrl, system, prompt, timeoutMs, temperature = 0.2 }) {
  const body = { model, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] };
  const call = (b) => postJSON(`${base(baseUrl)}/chat/completions`, { headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs, body: b });
  let data;
  try {
    data = await call({ ...body, response_format: { type: 'json_object' } });
  } catch (err) {
    // Some proxy providers do not know JSON mode and answer 400 (but not for a wrong model name): retry once without it.
    if (err.status === 400 && !/model/i.test(err.message)) data = await call(body);
    else throw err;
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from provider');
  return text;
}

async function embed({ apiKey, model, baseUrl, text, timeoutMs }) {
  const data = await postJSON(`${base(baseUrl)}/embeddings`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs,
    body: { model, input: text },
  });
  const values = data?.data?.[0]?.embedding;
  if (!Array.isArray(values) || !values.length) throw new Error('Empty embedding from provider');
  return values;
}

async function listModels({ apiKey, baseUrl, timeoutMs = 15000 }) {
  const data = await getJSON(`${base(baseUrl)}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs });
  return (data?.data || []).map((m) => ({ id: m.id, generate: !/embed/i.test(m.id), embed: /embed/i.test(m.id) }));
}

module.exports = { generate, embed, listModels };
