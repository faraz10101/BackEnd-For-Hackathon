// DAILY WEB RESEARCH
// Once a day the AI (Gemini + Google Search) looks for fresh scam warnings in Pakistan and we store
// a few of them as "web alerts". Every alert keeps its source link. These are NOT user reports and the
// homepage labels them separately.
//
// Safety checks: an alert is only saved if its link points to a website that Gemini really used in its
// search results (so made-up links are dropped), the date is not too old, and the total is capped.
const WebAlert = require('../models/WebAlert.model');
const ResearchRun = require('../models/ResearchRun.model');
const ai = require('./ai/aiRouter');
const { clearFeedCache } = require('./feed.service');
const { SCAM_TYPES } = require('../config/constants');
const { research: R } = require('../config/ai.config');

const PKT = 5 * 3600000; // Pakistan time, UTC+5
const pktNow = () => new Date(Date.now() + PKT);
const pktDay = () => pktNow().toISOString().slice(0, 10);
const pktHour = () => pktNow().getUTCHours();

const SYSTEM = `You are the research desk of ScamShield, a scam-awareness service for ordinary people in ${R.country}.
Use Google Search to find REAL, RECENT public information about scams and official scam warnings.
Rules:
1. Report only things you actually found in search results from the last ${R.recencyDays} days. Never invent a scam, a date or a link.
2. Every item must cite the real page you found (sourceUrl). If you cannot cite a page, leave that item out.
3. Never include private people's phone numbers, names or any personal data.
4. Return at most {MAX} items, the most useful for ordinary people first. If nothing reliable is found, return {"alerts": []}.
5. Write in plain ${R.outputLanguage}. "summary" is max 2 short sentences. "tip" is one practical action, max 12 words.
Respond with ONE JSON object and nothing else:
{"alerts":[{"title":"max 12 words","summary":"...","tip":"...","scamType":"one of: ${SCAM_TYPES.join(', ')}","severity":"low|medium|high","sourceName":"publisher name","sourceUrl":"https://...","publishedDate":"YYYY-MM-DD or null"}]}`;

// ---- pure helpers (kept separate so they are easy to test) ----------------
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

function groundedDomains(sources = []) {
  const set = new Set();
  for (const s of sources) {
    const t = bare(s.title);
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t)) set.add(t);
    try {
      const h = bare(new URL(s.uri).hostname);
      if (h && !h.endsWith('google.com')) set.add(h);
    } catch { /* ignore bad url */ }
  }
  return set;
}

const isGrounded = (host, set) => [...set].some((d) => host === d || host.endsWith(`.${d}`) || d.endsWith(`.${host}`));
const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const normTitle = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function cleanAlerts(raw, sources, { now = Date.now(), max = R.maxAlertsPerDay } = {}) {
  const domains = groundedDomains(sources);
  const out = [];
  const seenUrl = new Set();
  const seenTitle = new Set();
  for (const a of Array.isArray(raw) ? raw : []) {
    if (out.length >= max) break;
    let u;
    try { u = new URL(String(a?.sourceUrl || '')); } catch { continue; }
    if (!['http:', 'https:'].includes(u.protocol)) continue;
    if (!isGrounded(bare(u.hostname), domains)) continue;      // link was not part of the real search results

    const title = clip(a.title, 140);
    const summary = clip(a.summary, 320);
    if (title.length < 8 || summary.length < 20) continue;
    if (seenUrl.has(u.href) || seenTitle.has(normTitle(title))) continue;

    let published = null;
    if (a.publishedDate && /^\d{4}-\d{2}-\d{2}$/.test(a.publishedDate)) {
      const t = Date.parse(a.publishedDate);
      if (!Number.isNaN(t)) {
        if (t > now + 86400000) continue;                              // dated in the future: not trustworthy
        if (t < now - R.recencyDays * 86400000) continue;              // too old
        published = a.publishedDate;
      }
    }
    seenUrl.add(u.href); seenTitle.add(normTitle(title));
    out.push({
      title, summary, tip: clip(a.tip, 100),
      scamType: SCAM_TYPES.includes(a.scamType) ? a.scamType : 'other',
      severity: ['low', 'medium', 'high'].includes(a.severity) ? a.severity : 'medium',
      sourceName: clip(a.sourceName || bare(u.hostname), 60),
      sourceUrl: u.href, publishedDate: published,
    });
  }
  return out;
}

// ---- the job ----------------------------------------------------------------
let running = false;

async function runDailyResearch({ force = false } = {}) {
  if (!R.enabled) return { status: 'disabled', saved: 0 };
  if (running) return { status: 'busy', saved: 0 };
  running = true;
  const day = pktDay();
  try {
    if (!force) {
      const done = await ResearchRun.exists({ day, status: { $in: ['ok', 'empty'] } });
      if (done) return { status: 'already-done', saved: 0 };
      const lastFail = await ResearchRun.findOne({ status: 'failed' }).sort({ createdAt: -1 });
      if (lastFail && Date.now() - lastFail.createdAt.getTime() < R.retryAfterFailureMs) return { status: 'waiting-after-failure', saved: 0 };
    }

    const prompt = JSON.stringify({
      today: day, country: R.country, lookBackDays: R.recencyDays,
      topics: R.topics, preferredSources: R.preferredSources, maxItems: R.maxAlertsPerDay,
    });
    const system = SYSTEM.replace('{MAX}', String(R.maxAlertsPerDay));

    let r;
    try {
      r = await ai.researchJSON({ system, prompt, validate: (o) => o && Array.isArray(o.alerts) });
    } catch (err) {
      const msg = err.details ? err.details.join(' | ') : err.message;
      await ResearchRun.create({ day, status: 'failed', error: String(msg).slice(0, 400) });
      console.warn(`[Research] failed: ${msg}`);
      return { status: 'failed', saved: 0, error: msg };
    }

    const found = r.data.alerts.length;
    let alerts = cleanAlerts(r.data.alerts, r.sources);

    // Skip anything we already stored recently (same link or same title).
    if (alerts.length) {
      const recent = await WebAlert.find({ createdAt: { $gte: new Date(Date.now() - 14 * 86400000) } }).select('sourceUrl title');
      const urls = new Set(recent.map((x) => x.sourceUrl));
      const titles = new Set(recent.map((x) => normTitle(x.title)));
      alerts = alerts.filter((a) => !urls.has(a.sourceUrl) && !titles.has(normTitle(a.title)));
    }

    if (alerts.length) await WebAlert.insertMany(alerts.map((a) => ({ ...a, day, provider: r.provider })));
    const status = alerts.length ? 'ok' : 'empty';
    await ResearchRun.create({ day, status, saved: alerts.length, found, provider: r.provider, queries: r.queries.slice(0, 10) });
    if (alerts.length) clearFeedCache();
    console.log(`[Research] ${status}: AI returned ${found}, saved ${alerts.length} (via ${r.provider}).`);
    return { status, saved: alerts.length, found, provider: r.provider, queries: r.queries, alerts };
  } finally {
    running = false;
  }
}

// ---- scheduler: checks every 30 minutes; the job itself makes sure it runs only once a day ----
function startResearchScheduler() {
  if (!R.enabled) return console.log('[Research] Daily web research is switched off (RESEARCH_ENABLED=false).');
  const tick = async () => {
    try {
      const hasRecent = await WebAlert.exists({ createdAt: { $gte: new Date(Date.now() - 3 * 86400000) } });
      if (hasRecent && pktHour() < R.runHourPKT) return;          // normal days: wait for the daily hour
      await runDailyResearch();                                    // first ever run (nothing stored yet): run right away
    } catch (e) { console.warn('[Research] scheduler error:', e.message); }
  };
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 30 * 60 * 1000).unref();
  console.log(`[Research] Scheduler on: once a day after ${R.runHourPKT}:00 Pakistan time, max ${R.maxAlertsPerDay} alerts.`);
}

async function researchStatus() {
  const [runs, alertCount, latest] = await Promise.all([
    ResearchRun.find().sort({ createdAt: -1 }).limit(7),
    WebAlert.countDocuments(),
    WebAlert.find().sort({ createdAt: -1 }).limit(5).select('title sourceUrl createdAt'),
  ]);
  return { enabled: R.enabled, runHourPKT: R.runHourPKT, maxAlertsPerDay: R.maxAlertsPerDay, storedAlerts: alertCount, runs, latest };
}

module.exports = { runDailyResearch, startResearchScheduler, researchStatus, cleanAlerts, groundedDomains };
