// Looks at the website behind a link so the AI can judge the REAL page (login form? asks for OTP? brand it pretends to be?)
// instead of only guessing from the address. Safe by design: only public http(s) sites, never private/internal addresses,
// small size, short time, nothing is executed, and the text goes to the AI as untrusted data.
const dns = require('dns').promises;
const net = require('net');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
  }
  return true; // not an IP at all: refuse
}

async function hostIsPublic(host) {
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch { return false; }
}

const strip = (html) => html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const meta = (html, re) => (html.match(re)?.[1] || '').replace(/\s+/g, ' ').trim();

async function readLimited(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = []; let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8').slice(0, maxBytes);
}

// Follows at most 3 redirects and checks EVERY hop again.
async function peek(rawUrl, { timeoutMs = 5000 } = {}) {
  let url;
  try { url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`); } catch { return { url: rawUrl, reachable: false, reason: 'invalid link' }; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop < 4; hop++) {
      if (!['http:', 'https:'].includes(url.protocol) || (url.port && !['80', '443'].includes(url.port))) return { url: rawUrl, reachable: false, reason: 'blocked address' };
      if (!(await hostIsPublic(url.hostname.toLowerCase()))) return { url: rawUrl, reachable: false, reason: 'not a public website' };
      const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (ScamShield link check)', Accept: 'text/html' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url);
        continue;
      }
      const type = res.headers.get('content-type') || '';
      if (!/text\/html|text\/plain|xml/i.test(type)) return { url: rawUrl, finalUrl: url.href, reachable: true, status: res.status, note: `not a web page (${type.slice(0, 40) || 'unknown type'})` };
      const html = await readLimited(res, 150000);
      return {
        url: rawUrl, finalUrl: url.href, reachable: true, status: res.status,
        title: meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i).slice(0, 120),
        description: meta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i).slice(0, 200),
        asksPassword: /type\s*=\s*["']?password/i.test(html),
        hasForm: /<form[\s>]/i.test(html),
        redirectedTo: url.hostname !== new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).hostname ? url.hostname : null,
        text: strip(html).slice(0, 500),
      };
    }
    return { url: rawUrl, reachable: false, reason: 'too many redirects' };
  } catch (err) {
    return { url: rawUrl, reachable: false, reason: err.name === 'AbortError' ? 'site too slow' : 'site did not open' };
  } finally { clearTimeout(timer); }
}

// First two links of the message, at most ~6 seconds in total. Never throws.
async function peekPages(urls = []) {
  const list = [...new Set(urls.map((u) => u.href || u.url || u.host).filter(Boolean))].slice(0, 2);
  if (!list.length) return [];
  const all = Promise.all(list.map((u) => peek(u)));
  const cap = new Promise((r) => setTimeout(() => r(list.map((u) => ({ url: u, reachable: false, reason: 'site too slow' }))), 6000).unref());
  return Promise.race([all, cap]).catch(() => []);
}

module.exports = { peekPages, peek, isPrivateIp, hostIsPublic };
