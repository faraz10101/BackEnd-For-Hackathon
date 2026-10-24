// Text helpers used by the whole pipeline: phone numbers, links, script skeleton, privacy masking.
// Pure functions (no I/O), so they are easy to test.

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
// Bare domains ("bit.ly/abc", "bisp-claim.top") are only recognised when the ending is a known one,
// so normal text like "ok.Please" or "Rs.500" is not mistaken for a link.
const TLDS = [
  'com', 'net', 'org', 'info', 'biz', 'edu', 'gov', 'pk', 'co', 'io', 'me', 'app', 'site', 'online', 'shop', 'store',
  'xyz', 'top', 'click', 'link', 'live', 'vip', 'tk', 'ml', 'ga', 'cf', 'gq', 'work', 'rest', 'icu', 'buzz', 'cyou', 'ws',
  'cc', 'in', 'uk', 'us', 'ly', 'gd', 'gy', 'gl', 'id', 'to', 'tv', 'cn', 'ru', 'ae', 'sa', 'my', 'sbs', 'cloud', 'support',
  'help', 'finance', 'money', 'bank', 'pw', 'su', 'one', 'page', 'win', 'fun', 'life', 'world', 'today', 'digital',
].sort((a, b) => b.length - a.length).join('|');

const urlRegex = () =>
  new RegExp(
    `https?:\\/\\/[^\\s<>"'\\u200b]+|(?<![@\\w./-])(?:www\\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![a-z0-9-])(?::\\d{2,5})?(?:[/?#][^\\s<>"']*)?`,
    'gi'
  );

const TRAILING = /[.,;:!?'")\]}>]+$/;

// "https://www.Example.com/a?b=1" -> { url, host: "example.com", insecure: false }   (or null)
function normalizeUrl(raw) {
  let s = String(raw || '').trim().replace(TRAILING, '');
  if (!s || s.length > 500) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (hasScheme && !/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(hasScheme ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!isIp && !host.includes('.')) return null;
  return { url: u.href, host, insecure: hasScheme && u.protocol === 'http:' };
}

// All links in a text (max 5, unique by host).
function extractUrls(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(urlRegex())) {
    const u = normalizeUrl(m[0]);
    if (!u || seen.has(u.host)) continue;
    seen.add(u.host);
    out.push(u);
    if (out.length >= 5) break;
  }
  return out;
}

const stripUrls = (text) => String(text || '').replace(urlRegex(), ' ');

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------
// Pakistani mobile in any common writing: 0300-1234567, 0300 123 4567, +92 300 1234567, 00923001234567, 923001234567
const MOBILE_SRC = '(?<!\\d)(?:(?:\\+|00)?92[\\s\\-.]?|0)\\(?3\\d{2}\\)?[\\s\\-.]?\\d{3}[\\s\\-.]?\\d{4}(?!\\d)';
// Anything else that clearly starts like a phone number (national 0..., or +/00 international).
const OTHER_SRC = '(?<![\\w.])(?:\\+|00|0)\\(?\\d[\\d\\s\\-().]{5,16}\\d(?!\\d)';
const mobileRegex = () => new RegExp(MOBILE_SRC, 'g');
const otherRegex = () => new RegExp(OTHER_SRC, 'g');

// Any text -> one stable form, or null if it is not a phone number.
//   Pakistani mobile  -> 03001234567
//   Pakistani landline-> 02112345678
//   International     -> +9715012345678
// minDigits: smallest accepted length when the user typed it themselves (the report form allows 7).
function normalizeNumber(raw, minDigits = 10) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!d || d.length > 15) return null;
  if (d.startsWith('0092')) d = d.slice(2);
  else if (d.startsWith('00') && d.length > 10) return `+${d.slice(2)}`;

  if (/^923\d{9}$/.test(d)) return `0${d.slice(2)}`;            // +92 300 1234567
  if (/^03\d{9}$/.test(d)) return d;                              // 0300 1234567
  if (/^3\d{9}$/.test(d)) return `0${d}`;                         // 300 1234567
  if (/^92[1-9]\d{8,9}$/.test(d)) return `0${d.slice(2)}`;        // landline written with country code
  if (plus) return d.length >= 8 ? `+${d}` : null;                // other countries
  if (/^\d{13}$/.test(d) && !d.startsWith('0')) return null;     // a CNIC, not a phone number
  if (/^0[1-9]\d+$/.test(d)) return d.length >= Math.max(minDigits, 9) && d.length <= 12 ? d : null; // landline
  if (minDigits < 10 && d.length >= minDigits) return d;          // typed by hand, short numbers allowed
  return null;
}

function extractNumbers(text) {
  const t = String(text || '').replace(urlRegex(), ' ');
  const found = new Set();
  const rest = t.replace(mobileRegex(), (m) => {
    const n = normalizeNumber(m);
    if (n) found.add(n);
    return ' ';
  });
  for (const m of rest.matchAll(otherRegex())) {
    const n = normalizeNumber(m[0]);
    if (n) found.add(n);
  }
  return [...found].slice(0, 5);
}

// ---------------------------------------------------------------------------
// Script skeleton: the wording of a scam with numbers/links removed.
// Scammers change the number but reuse the text, so this is what we compare.
// ---------------------------------------------------------------------------
function scriptSkeleton(text) {
  let t = String(text || '').toLowerCase();
  if (!t.trim()) return '';
  t = t
    .replace(urlRegex(), ' <url> ')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' <email> ')
    .replace(mobileRegex(), ' <num> ')
    .replace(otherRegex(), ' <num> ')
    .replace(/\d[\d,.]*/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return t.slice(0, 600);
}

// ---------------------------------------------------------------------------
// Privacy: what we store/show of a reported message (no personal details).
// ---------------------------------------------------------------------------
function sanitizeSnippet(text, max = 300) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\b\d{5}[\s-]?\d{7}[\s-]?\d\b/g, '[cnic]')
    .replace(/\b(otp|pin|code|mpin|password)(\W{0,12})\d{3,8}\b/gi, '$1$2[hidden]')
    .replace(mobileRegex(), '[number]')
    .replace(otherRegex(), '[number]')
    .replace(/(?<!\d)3\d{9}(?!\d)/g, '[number]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[card]');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

module.exports = { extractNumbers, extractUrls, normalizeNumber, normalizeUrl, stripUrls, scriptSkeleton, sanitizeSnippet };
