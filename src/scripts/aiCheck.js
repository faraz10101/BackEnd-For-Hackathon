// Checks that the AI really works. Run it in a SECOND terminal (the server can keep running):
//   npm run ai:check              tests every provider (answer + embedding)
//   npm run ai:check -- --search  also tests Gemini web search
//   npm run ai:research           runs the daily web research once, right now, and prints what it found
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { syncProviders } = require('../services/ai/providerSync');
const { healthCheck } = require('../services/ai/aiRouter');
const { runDailyResearch } = require('../services/research.service');

const mark = (r) => (!r ? '  -  ' : r.ok ? `OK ${String(r.ms).padStart(5)} ms` : 'FAILED');

(async () => {
  await connectDB();
  const wanted = await syncProviders({ quiet: true });
  if (!wanted.length) console.log('\nNo AI keys found in .env (GEMINI_API_KEY=...). Add one and run this again.');

  if (process.argv.includes('--research')) {
    console.log('\nRunning web research (this can take up to a minute)...');
    const r = await runDailyResearch({ force: true });
    console.log(`Result: ${r.status}${r.error ? ' - ' + r.error : ''}`);
    if (r.alerts) r.alerts.forEach((a, i) => console.log(`\n${i + 1}. ${a.title}\n   ${a.summary}\n   Source: ${a.sourceName}  ${a.sourceUrl}`));
    if (r.status === 'empty') console.log(`AI answered but nothing passed the checks (AI returned ${r.found}). Try again later or widen topics in config/ai.config.js.`);
  } else {
    console.log('\nTesting providers...');
    const rows = await healthCheck({ search: process.argv.includes('--search') });
    for (const p of rows) {
      if (p.skipped) { console.log(`- ${p.name}: skipped (${p.skipped})`); continue; }
      console.log(`- ${p.name.padEnd(12)} ${p.model.padEnd(34)} answer: ${mark(p.generate)}   embedding: ${p.embedModel ? mark(p.embed) : 'n/a'}${p.search ? '   web search: ' + mark(p.search) : ''}`);
      for (const k of ['generate', 'embed', 'search']) if (p[k] && !p[k].ok) console.log(`     ${k} error: ${p[k].error}`);
    }
    const ok = rows.filter((p) => p.generate?.ok).length;
    console.log(`\n${ok}/${rows.length} provider(s) working.${ok ? ' AI is connected.' : ' AI is NOT working, read the errors above.'}`);
  }
  await mongoose.disconnect();
  process.exit(0);
})();
