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
    default:   { temperature: 0.2, timeoutMs: 25000 },
    extract:   { temperature: 0.1, timeoutMs: 20000 }, // numbers / links / brand from a message
    verdict:   { temperature: 0.2, timeoutMs: 30000 }, // final scam / suspicious / safe
    summary:   { temperature: 0.3, timeoutMs: 25000 }, // homepage bulletin
    complaint: { temperature: 0.2, timeoutMs: 30000 }, // complaint text
    embed:     { timeoutMs: 15000 },
    research:  { temperature: 0.2, timeoutMs: 90000 }, // web search takes longer
    live:      { temperature: 0.2, timeoutMs: 75000 }, // user pressed "search now" on the homepage
  },

  // ---- Providers that are recognised straight from .env ------------------
  // GEMINI_API_KEY, GEMINI_API_KEY_2 ... GROQ_API_KEY ... OPENROUTER_API_KEY ...
  // Lower priority number = tried first. Model names can be overridden in .env.
  presets: [
    { id: 'gemini', type: 'gemini', keyEnv: 'GEMINI_API_KEY', priority: 1,
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      embedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001' },
    { id: 'groq', type: 'openai', keyEnv: 'GROQ_API_KEY', priority: 5,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', embedModel: '' },
    { id: 'openrouter', type: 'openai', keyEnv: 'OPENROUTER_API_KEY', priority: 8,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', embedModel: '' },
  ],

  // ---- Live search: the "What is happening today?" button on the homepage ------
  live: {
    dailyLimitPerUser: num(process.env.LIVE_SEARCH_DAILY_LIMIT, 5), // fresh searches one verified user may run per Pakistan day
    recencyDays: 7,          // incidents older than this are ignored
    feedRefreshHours: 6,     // the PUBLIC live feed (what every visitor sees, login or not) is refreshed this often by the server
    feedEnabled: process.env.LIVE_FEED_ENABLED !== 'false',
    // How live search finds news:
    //   'news'   = read Google News RSS (free, no key) and let ANY AI provider write the short answer
    //   'gemini' = Gemini + Google Search only (needs Gemini quota)
    //   'auto'   = news first, Gemini as a backup, then saved results  (default)
    mode: process.env.LIVE_SEARCH_MODE || 'auto',
    // Different "lenses" so the short answer reads differently each time.
    lenses: ['what victims are losing', 'the newest official warnings', 'how the scammers contact people', 'what happened in the last 24 hours', 'who is being targeted most'],
    // Topic buttons. `query` = news searches (| separates them). `angles` = extra searches: every refresh / user search
    // picks a different one, so the results are not the same every time.
    topics: {
      today: { label: "Today's biggest scam", query: 'scam OR fraud OR "scam alert" Pakistan|FIA cybercrime scam Pakistan',
        angles: ['online fraud victims lost money Pakistan', 'fake SMS WhatsApp scam warning Pakistan', 'police arrest fraud gang Pakistan', 'NR3C cybercrime alert Pakistan', 'scam advisory issued Pakistan'],
        focus: 'the biggest and most talked-about scam incidents and official scam warnings in Pakistan right now (today and the last few days)' },
      wallet: { label: 'Bank & wallet fraud', query: 'Easypaisa OR JazzCash OR OTP OR bank fraud Pakistan|phishing SMS Pakistan',
        angles: ['ATM card skimming fraud Pakistan', 'SBP warning bank customers fraud', 'mobile wallet account hacked Pakistan', 'fake bank call OTP fraud Pakistan', 'online banking phishing Pakistan'],
        focus: 'bank, Easypaisa, JazzCash, ATM, OTP and phishing fraud in Pakistan' },
      job: { label: 'Job & investment', query: 'fake job OR online earning OR crypto OR forex OR investment scam Pakistan|fraud arrested Pakistan',
        angles: ['fake overseas job agent fraud Pakistan', 'crypto investment scam Pakistan', 'online earning app fraud Pakistan', 'forex trading fraud Pakistan', 'work from home scam Pakistan'],
        focus: 'fake job offers, online earning, investment, crypto and forex scams in Pakistan' },
      govt: { label: 'Fake govt messages', query: 'BISP OR NADRA OR FBR OR Ehsaas OR PTA fake message scam|FIA impersonation fraud Pakistan',
        angles: ['BISP fake message Pakistan', 'NADRA fake call fraud', 'FBR tax notice scam Pakistan', 'PTA SIM block message scam Pakistan', 'fake police FIA call fraud Pakistan'],
        focus: 'fake BISP, NADRA, FBR, Ehsaas, PTA or police/FIA impersonation scams in Pakistan' },
    },
  },

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
