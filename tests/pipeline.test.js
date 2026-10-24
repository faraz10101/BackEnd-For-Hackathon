const path = require('path');
const http = require('http');
const B = path.resolve(__dirname, '..');
process.env.ENCRYPTION_SECRET = 'test-secret'; process.env.SALT = 's';
const { encrypt } = require(`${B}/utils/crypto`);
const { localEmbed, cosine } = require(`${B}/utils/similarity`);
const { scriptSkeleton } = require(`${B}/utils/text`);

// ---------- fake AI servers ----------
const calls = { A: 0, B: 0 };
const mk = (name, mode) => new Promise((res) => {
  const s = http.createServer((req, rsp) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      calls[name]++;
      if (mode === '429') { rsp.writeHead(429, { 'content-type': 'application/json' }); return rsp.end(JSON.stringify({ error: { message: 'quota' } })); }
      const j = JSON.parse(body || '{}');
      rsp.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.endsWith('/embeddings')) return rsp.end(JSON.stringify({ data: [{ embedding: localEmbed(j.input).slice(0, 64) }] }));
      const sys = j.messages[0].content;
      let out;
      if (sys.includes('fraud-analysis')) out = { phoneNumbers: ['0300-1234567', '03999999999'], urls: ['bisp-claim.top'], impersonatedBrand: 'BISP', scamType: 'govt_benefit_fake', amountMentioned: 'Rs 25,000', urgencyTactics: ['deadline threat'], summary: 'Asks you to verify CNIC on a fake link.' };
      else if (sys.includes('verdict engine')) out = { verdict: 'safe', riskScore: 10, headline: 'Looks fine', reasons: ['AI thinks fine'], whatToDo: ['Nothing'] };
      else out = { ok: true };
      rsp.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
    });
  }).listen(0, () => res({ s, port: s.address().port }));
});

(async () => {
  const A = await mk('A', '429'); const Bs = await mk('B', 'ok');
  const providers = [
    { _id: 'a', name: 'A', type: 'openai', baseUrl: `http://127.0.0.1:${A.port}/v1`, model: 'm', embedModel: 'e', apiKeyEnc: encrypt('k'), priority: 1, enabled: true, failCount: 0, cooldownUntil: null },
    { _id: 'b', name: 'B', type: 'openai', baseUrl: `http://127.0.0.1:${Bs.port}/v1`, model: 'm', embedModel: 'e', apiKeyEnc: encrypt('k'), priority: 5, enabled: true, failCount: 0, cooldownUntil: null },
  ];
  const chain = (arr) => { const o = { select: () => o, sort: (s) => { if (s && s.priority) arr = [...arr].sort((x, y) => x.priority - y.priority); return o; }, limit: (n) => { arr = arr.slice(0, n); return o; }, then: (r, j) => Promise.resolve(arr).then(r, j) }; return o; };
  const reports = [];
  const stubs = {
    [`${B}/models/AIProvider.model.js`]: {
      find: (f = {}) => chain(providers.filter((p) => p.enabled && (!f.type || p.type === f.type) && (!f.embedModel || p.embedModel) && (!f.$or || !p.cooldownUntil || p.cooldownUntil <= new Date()))),
      updateOne: async (q, u) => { const p = providers.find((x) => x._id === q._id); if (u.$set) Object.assign(p, u.$set); if (u.$inc?.failCount) p.failCount++; return {}; },
    },
    [`${B}/models/Report.model.js`]: {
      aggregate: async (pipe) => { const [k, v] = Object.entries(pipe[0].$match)[0]; const m = reports.filter((r) => r[k].includes(v)); return m.length ? [{ totalReports: m.length, reporters: [...new Set(m.map((r) => r.reporterHash))], first: new Date(), last: new Date(), scamTypes: ['govt_benefit_fake'] }] : []; },
      find: () => chain(reports),
    },
  };
  for (const [p, exp] of Object.entries(stubs)) require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };

  // seed: number reported by 25 different people + a known script
  const known = 'Congratulations! Your BISP payment of Rs 25,000 is approved. Verify your CNIC now at https://x-y.top/v or your payment will be cancelled.';
  const sk = scriptSkeleton(known);
  for (let i = 0; i < 25; i++) reports.push({ numbers: ['03001234567'], hosts: ['bisp-claim.top'], reporterHash: 'h' + i, scamType: 'govt_benefit_fake', snippet: 'known', embedTag: 'local', embedding: [], localVec: localEmbed(sk), scriptHash: 'x' });

  const { checkContent } = require(`${B}/controllers/check.controller`);
  const run = async (content) => { let out; await checkContent({ body: { content } }, { json: (o) => (out = o) }); return out.data; };
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

  // 1) AI provider A fails (429), B answers; DB facts floor the "safe" AI verdict
  let d = await run('Your BISP payment of Rs 25,000 is approved. Verify your CNIC at bisp-claim.top or call 0300-1234567 today.');
  ok(calls.A >= 1 && calls.B >= 1, `failover: A=${calls.A} (429) -> B=${calls.B} answered`);
  ok(providers[0].cooldownUntil > new Date(), 'provider A is cooling down');
  ok(d.analysisMode === 'ai', 'analysisMode = ai');
  ok(d.verdict === 'scam' && d.riskScore >= 92, `AI said safe/10, DB facts forced verdict=${d.verdict} score=${d.riskScore}`);
  ok(d.extracted.numbers.includes('03001234567') && !d.extracted.numbers.includes('03999999999'), 'AI-invented number not in text was dropped');
  ok(d.reputation.numbers[0].level === 'critical', 'reputation level critical (25 reporters)');
  ok(d.similar.matchCount > 0, `similar scripts matched: ${d.similar.matchCount}`);
  console.log('   reasons:', d.reasons.slice(0, 3));

  // 2) clean message with nothing known
  d = await run('Hi, are we still meeting for lunch tomorrow at the usual place?');
  ok(d.verdict === 'safe', `harmless text -> ${d.verdict} (${d.riskScore})`);

  // 3) all AI down -> rule fallback still works
  providers.forEach((p) => (p.enabled = false));
  d = await run('Dear user your account is blocked, login at http://hbl-secure-login.xyz now');
  ok(d.analysisMode === 'fallback', 'AI down -> fallback mode');
  ok(d.ruleFindings.some((f) => f.code === 'LOOKALIKE') && d.verdict !== 'safe', `look-alike HBL link caught without AI -> ${d.verdict} (${d.riskScore})`);
  A.s.close(); Bs.s.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
