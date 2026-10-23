// ============================================================================
//  AI CONTROL PANEL  (the one file to tune everything about the AI)
//  - how providers rest after errors / quota limits
//  - temperature + timeout for every AI task
//  - what the daily web research should look for, and how much to show
//  Keys and provider choice live in .env (see .env.example). Nothing secret here.
// ============================================================================

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

module.exports = {
  // ---- What happens when a provider fails -------------------------------
  // The router skips a provider while it is "cooling down" and tries the next one.
  cooldown: {
    quotaBaseMs: 60 * 1000,          // 429 (limit reached): 1 min, then 2, 4, 8 ... on repeated failures
    quotaMaxMs: 6 * 60 * 60 * 1000,  // ... but never more than 6 hours
    authMs: 30 * 60 * 1000,          // 401/403: wrong or blocked key
    modelMs: 2 * 60 * 1000,          // 400/404: usually a wrong model name
    otherMs: 30 * 1000,              // timeouts, 5xx, bad JSON
  },

  // ---- Per task tuning (task name is passed by each service) -------------
  tasks: {
    default:   { temperature: 0.2, timeoutMs: 12000 },
    extract:   { temperature: 0.1, timeoutMs: 12000 }, // numbers / links / brand from a message
    verdict:   { temperature: 0.2, timeoutMs: 15000 }, // final scam / suspicious / safe
    summary:   { temperature: 0.3, timeoutMs: 12000 }, // homepage bulletin
    complaint: { temperature: 0.2, timeoutMs: 15000 }, // complaint text
    embed:     { timeoutMs: 12000 },
    research:  { temperature: 0.2, timeoutMs: 90000 }, // web search takes longer
  },

  // ---- Providers that are recognised straight from .env ------------------
  // GEMINI_API_KEY, GEMINI_API_KEY_2 ... GROQ_API_KEY ... OPENROUTER_API_KEY ...
  // Lower priority number = tried first. Model names can be overridden in .env.
  presets: [
    { id: 'gemini', type: 'gemini', keyEnv: 'GEMINI_API_KEY', priority: 1,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      embedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001' },
    { id: 'groq', type: 'openai', keyEnv: 'GROQ_API_KEY', priority: 5,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', embedModel: '' },
    { id: 'openrouter', type: 'openai', keyEnv: 'OPENROUTER_API_KEY', priority: 8,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', embedModel: '' },
  ],

  // ---- Daily web research (shown on the homepage as "Web alerts") ---------
  // Needs a Gemini key: Gemini's Google Search tool is what browses the web.
  research: {
    enabled: process.env.RESEARCH_ENABLED !== 'false',
    runHourPKT: num(process.env.RESEARCH_HOUR_PKT, 6),        // runs once a day after this hour (Pakistan time)
    maxAlertsPerDay: num(process.env.RESEARCH_MAX_ALERTS, 5), // hard cap on items saved per run
    showOnHome: 6,           // how many web alerts the homepage shows
    showLastDays: 7,         // ... taken from the last N days
    recencyDays: 14,         // ignore news older than this
    keepDays: 30,            // old alerts are deleted automatically
    retryAfterFailureMs: 60 * 60 * 1000, // after a failed run, try again in 1 hour
    country: 'Pakistan',
    outputLanguage: 'English',
    // WHAT should the AI look for? Edit this list to change the research.
    topics: [
      'SMS, WhatsApp and phone-call scams that are currently circulating in Pakistan',
      'fake government benefit scams using BISP, NADRA, FBR or Ehsaas as bait',
      'mobile wallet fraud (Easypaisa, JazzCash) and bank phishing in Pakistan',
      'official scam warnings or advisories from FIA, NR3C, SBP, PTA, PKCERT or banks',
      'fake courier, job offer, investment or crypto scams reported in Pakistan',
    ],
    // Hints only. An item is kept only if its link really came from the search results.
    preferredSources: ['fia.gov.pk', 'sbp.org.pk', 'pta.gov.pk', 'pkcert.gov.pk', 'dawn.com', 'tribune.com.pk', 'geo.tv', 'thenews.com.pk', 'propakistani.pk'],
  },
};
