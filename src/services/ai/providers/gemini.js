const { postJSON } = require('../../../utils/http');

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const url = (model, method) => `${BASE}/${encodeURIComponent(model)}:${method}`;

async function generate({ apiKey, model, system, prompt, timeoutMs, temperature = 0.2 }) {
  const data = await postJSON(url(model, 'generateContent'), {
    headers: { 'x-goog-api-key': apiKey },
    timeoutMs,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature },
    },
  });
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

// Same as generate(), but Gemini may browse the web with the Google Search tool.
// (Gemini cannot force JSON mode together with tools, so the caller parses the JSON from the text.)
// Also returns the pages Gemini really used, so we can check every link we show.
async function generateWithSearch({ apiKey, model, system, prompt, timeoutMs, temperature = 0.2 }) {
  const data = await postJSON(url(model, 'generateContent'), {
    headers: { 'x-goog-api-key': apiKey },
    timeoutMs,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature },
    },
  });
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new Error('Empty response from Gemini');
  const meta = cand?.groundingMetadata || {};
  const sources = (meta.groundingChunks || []).map((c) => c.web).filter(Boolean).map((w) => ({ title: w.title || '', uri: w.uri || '' }));
  return { text, sources, queries: meta.webSearchQueries || [] };
}

async function embed({ apiKey, model, text, timeoutMs }) {
  const data = await postJSON(url(model, 'embedContent'), {
    headers: { 'x-goog-api-key': apiKey },
    timeoutMs,
    body: { content: { parts: [{ text }] } },
  });
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || !values.length) throw new Error('Empty embedding from Gemini');
  return values;
}

module.exports = { generate, generateWithSearch, embed };
