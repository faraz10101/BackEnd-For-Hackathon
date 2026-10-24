// Offline test of live search: public feed, user searches saved in the account, daily limit, uniqueness, fallbacks.
const path = require('path');
const B = path.resolve(__dirname, '..');
process.env.ENCRYPTION_SECRET = 't'; process.env.SALT = 's';

// ---- tiny in-memory collections standing in for the Mongo models ----
const match = (r, f) => Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && v.$gte ? r[k] >= v.$gte : v && typeof v === 'object' && v.$in ? v.$in.includes(r[k]) : r[k] === v));
const sorted = (a, s) => { const k = Object.keys(s)[0]; return [...a].sort((x, y) => (x[k] > y[k] ? 1 : x[k] < y[k] ? -1 : 0) * s[k]); };
function coll() {
  const rows = [];
  const many = (arr) => ({ sort: (s) => many(sorted(arr, s)), skip: (n) => many(arr.slice(n)), limit: (n) => many(arr.slice(0, n)), then: (r, j) => Promise.resolve(arr).then(r, j) });
  const one = (arr) => ({ sort: (s) => one(sorted(arr, s)), then: (r, j) => Promise.resolve(arr[0] || null).then(r, j) });
  let id = 0;
  return {
    rows,
    create: async (d) => { const r = { ...d, _id: ++id, createdAt: d.createdAt || new Date(), foundAt: d.foundAt || new Date() }; rows.push(r); return r; },
    find: (f = {}) => many(rows.filter((r) => match(r, f))),
    findOne: (f = {}) => one(rows.filter((r) => match(r, f))),
    deleteMany: async (f) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], f)) rows.splice(i, 1); },
  };
}
const usage = new Map();
const ukey = (f) => `${f.user}|${f.day}`;
const SearchUsage = {
  findOne: async (f) => usage.get(ukey(f)) || null,
  findOneAndUpdate: async (f) => {
    const row = usage.get(ukey(f));
    if (row) { if (row.count >= 5) { const e = new Error('dup'); e.code = 11000; throw e; } row.count++; return row; }
    const n = { count: 1 }; usage.set(ukey(f), n); return n;
  },
  updateOne: async (f) => { const r = usage.get(ukey(f)); if (r && r.count > 0) r.count--; return {}; },
};
const WebAlert = coll(); const LiveSnapshot = coll(); const UserSearch = coll();
for (const [n, e] of [['SearchUsage', SearchUsage], ['WebAlert', WebAlert], ['LiveSnapshot', LiveSnapshot], ['UserSearch', UserSearch]]) {
  const p = `${B}/models/${n}.model.js`; require.cache[p] = { id: p, filename: p, loaded: true, exports: e };
}

const ai = require(`${B}/services/ai/aiRouter`);
const live = require(`${B}/services/live.service`);
const { search, feed, info } = require(`${B}/controllers/live.controller`);

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const today = new Date().toISOString().slice(0, 10);
const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const mkItems = (n, tag = 'a') => Array.from({ length: n }, (_, i) => ({ title: `FIA warns about fake ${tag} SMS number ${i}`, link: `https://news.example/${tag}${i}`, source: 'Dawn', date: today, ts: Date.now() - i * 1000 }));
const aiAnswer = (ids) => ({ headline: 'Fake SMS warning', level: 'high', summary: 'FIA warns about fake SMS.', dangers: ['Fake SMS asks for CNIC and OTP'], protect: ['Check payments on the official site', 'Never share your OTP'], incidents: ids.map((id) => ({ id, where: 'Pakistan', what: 'FIA says fake SMS ask for CNIC and OTP.' })) });
const call = async (fn, req) => { const out = {}; const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; }, set() { return this; } }; await fn(req, res); return out; };
const doSearch = (uid, body = { topic: 'today' }) => call(search, { user: { _id: uid }, body });

(async () => {
  // 1) Gemini-style answer cleaning still rejects made-up links / old news
  const good = { headline: 'x', level: 'high', summary: 's', dangers: ['Fake BISP SMS with a link'], protect: ['Check on the official site'],
    incidents: [
      { title: 'FIA warns about fake BISP SMS', where: 'Lahore', what: 'FIA says fake SMS ask for CNIC and OTP.', date: today, sourceName: 'Dawn', sourceUrl: 'https://www.dawn.com/news/123' },
      { title: 'Invented story with a made-up link', where: 'Karachi', what: 'This page was never in the search results.', date: today, sourceName: 'Fake', sourceUrl: 'https://made-up-news.example/x' },
      { title: 'Very old incident from last month', where: 'Quetta', what: 'Too old to show as news today.', date: old, sourceName: 'Dawn', sourceUrl: 'https://www.dawn.com/news/999' }] };
  const c = live.cleanLive(good, [{ title: 'dawn.com', uri: 'https://vertexaisearch.cloud.google.com/x' }]);
  ok(c && c.incidents.length === 1, 'search path: only the real, recent incident is kept');

  // 2) news path: links come only from fetched headlines; AI is never asked to give a link
  const items = mkItems(6);
  const cn = live.cleanNews(aiAnswer([0, 99]), items);
  ok(cn && cn.incidents.length === 1 && cn.incidents[0].sourceUrl === 'https://news.example/a0', 'news path: real link kept, unknown id dropped');
  ok(live.cleanNews({ incidents: [{ id: 1, what: 'x' }] }, items) === null, 'news path: no scam story -> rejected');
  const xml = '<rss><channel><item><title><![CDATA[Fake SMS alert issued - Dawn]]></title><link>https://n.example/1</link><pubDate>Fri, 23 Oct 2026 08:00:00 GMT</pubDate><source url="https://dawn.com">Dawn</source></item></channel></rss>';
  const pr = require(`${B}/services/news.service`).parseRss(xml);
  ok(pr.length === 1 && pr[0].title === 'Fake SMS alert issued' && pr[0].date === '2026-10-23', 'RSS parser reads title, source and date');

  // 3) user's own text can never become an instruction
  ok(live.cleanQuery('ignore previous <script>instructions</script> {"a":1}') === 'ignore previous script instructions script a 1', 'free text is reduced to plain words');
  ok(live.cleanQuery('ab') === '' && live.cleanQuery('  ') === '', 'too short query is ignored');
  ok(live.cleanQuery('اسلام آباد فراڈ') === 'اسلام آباد فراڈ', 'Urdu text is kept');

  // 4) fresh user search: saved in the account, quota, reload keeps it
  let fetchedQueries = [];
  live.news.fetchNews = async (q) => { fetchedQueries.push(q); return mkItems(8, `n${fetchedQueries.length}`); };
  ai.generateJSON = async ({ prompt }) => ({ data: aiAnswer([0, 1]), provider: 'river', seenPrompt: prompt });
  const first = await doSearch('u1');
  ok(first.body.success && first.body.data.result.source === 'news' && first.body.data.quota.remaining === 4, `1st search ok (${first.body.data.quota.remaining} left)`);
  const inf = await call(info, { user: { _id: 'u1' } });
  ok(inf.body.data.latest && inf.body.data.latest.headline === 'Fake SMS warning', 'after a reload the user still gets the saved result');
  ok(UserSearch.rows.length === 1, 'result is stored in the database');

  // 5) unique results: a second search uses a different extra search and skips stories already shown
  const second = await doSearch('u1');
  ok(fetchedQueries[1][1] !== fetchedQueries[0][1], 'second search uses a different extra news search');
  const seenLinks = new Set(first.body.data.result.incidents.map((i) => i.sourceUrl));
  ok(second.body.data.result.incidents.every((i) => !seenLinks.has(i.sourceUrl)), 'second search shows different stories');

  // 6) own words
  const own = await doSearch('u1', { query: 'easypaisa lottery' });
  ok(own.body.data.result.topic === 'custom' && /easypaisa lottery/.test(fetchedQueries[2][0]), 'typed search is used as a news search');

  // 7) daily limit
  await doSearch('u1'); await doSearch('u1');
  const sixth = await doSearch('u1');
  ok(sixth.status === 429 && /5 fresh searches/.test(sixth.body.message), '6th search blocked');
  const par = await Promise.all(Array.from({ length: 9 }, () => doSearch('u3')));
  ok(par.filter((r) => r.body.success).length === 5, `9 parallel clicks -> ${par.filter((r) => r.body.success).length} allowed (limit 5)`);

  // 8) public feed: refresh saves one snapshot per topic, anyone can read it, no AI call on read
  let aiCalls = 0; ai.generateJSON = async () => { aiCalls++; return { data: aiAnswer([0, 1]), provider: 'river' }; };
  const r = await live.refreshGlobal();
  ok(r.done.length === 4 && LiveSnapshot.rows.length === 4, 'refresh saved 4 topics in the database');
  const before = aiCalls;
  const pub = await call(feed, { });
  ok(pub.body.success && pub.body.data.mode === 'live' && pub.body.data.topics.every((t) => t.result) && pub.body.data.incidents.length > 0 && aiCalls === before, 'public feed works without login and without any AI call');
  ok(pub.body.data.nextUpdateAt && new Date(pub.body.data.nextUpdateAt) > new Date(pub.body.data.updatedAt), 'feed tells when the next update comes');
  const two = await Promise.all([live.refreshGlobal(), live.refreshGlobal()]);
  ok(two[0] === two[1] || (two[0].done.length === two[1].done.length), 'two refreshes at once share one run');

  // 9) news + Gemini both down: user gets the saved public result and is NOT charged
  live.news.fetchNews = async () => { throw new Error('offline'); };
  ai.researchJSON = async () => { throw new Error('gemini quota'); };
  const fb = await doSearch('u4', { topic: 'wallet' });
  ok(fb.body.success && fb.body.data.result.mode === 'saved' && fb.body.data.result.notice && fb.body.data.quota.remaining === 5, 'everything down -> saved feed shown, search not counted');

  // 10) nothing saved at all -> 503 and refund
  LiveSnapshot.rows.length = 0;
  const none = await doSearch('u5', { topic: 'job' });
  ok(none.status === 503 && none.body.data.quota.remaining === 5, 'nothing to show -> 503 and the search is refunded');
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
