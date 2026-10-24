// NEWS FEED for live search: reads Google News RSS (free, no API key, works from any server).
// The AI never "browses": it only rewrites the headlines we hand it, and every link we show
// is one of these fetched items (the AI refers to them by number, so it cannot invent a link).
const { getText } = require('../utils/http');
const { live: L } = require('../config/ai.config');

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; };

// Pure: RSS xml -> [{ title, link, source, date }]
function parseRss(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const link = tag(b, 'link');
    let title = tag(b, 'title');
    let source = tag(b, 'source');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim(); // Google adds " - Publisher"
    const t = Date.parse(tag(b, 'pubDate'));
    if (!link || title.length < 8) continue;
    out.push({ title, link, source: source || 'News', date: Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10), ts: Number.isNaN(t) ? 0 : t });
  }
  return out;
}

const feedUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${L.recencyDays}d`)}&hl=en-PK&gl=PK&ceid=PK:en`;

// Fetches several news searches, merges, removes duplicates, newest first.
async function fetchNews(queries, { max = 12 } = {}) {
  queries = (Array.isArray(queries) ? queries : [queries]).map((q) => String(q || '').trim()).filter(Boolean);
  if (!queries.length) return [];
  const results = await Promise.allSettled(queries.map((q) => getText(feedUrl(q)).then(parseRss)));
  const seen = new Set();
  const items = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const it of r.value) {
      const k = it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60);
      if (seen.has(k)) continue;
      seen.add(k); items.push(it);
    }
  }
  if (!items.length && results.every((r) => r.status === 'rejected')) throw new Error(`News feed unavailable: ${results[0].reason?.message}`);
  const cutoff = Date.now() - L.recencyDays * 86400000;
  return items.filter((i) => !i.ts || i.ts >= cutoff).sort((a, b) => b.ts - a.ts).slice(0, max);
}

module.exports = { fetchNews, parseRss };
