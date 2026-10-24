# ScamShield Backend

The server behind ScamShield, a scam-awareness service for people in Pakistan.
Node.js + Express + MongoDB. AI comes from any providers you add in the admin panel (Gemini, River, Groq, OpenRouter, apinex, any OpenAI-compatible API) with automatic failover.

> Frontend (website) lives in `../frontend`, see its README. API reference for developers: [`API.md`](./API.md).

---

## What it does (features)

| Feature | What the user gets |
|---|---|
| **Check a message / link / number** | Paste anything suspicious. A 5-layer check returns a verdict (scam / suspicious / safe), a risk score, reasons in simple English and what to do. |
| **AI is the judge** | The AI reads the message with its own knowledge of scams (look-alike domains, fake login pages, OTP requests ...). Community data is extra evidence, not the only evidence. |
| **Link inspection** | For links, the server safely opens the page (public sites only, never internal addresses) and gives the AI the page title / login-form info. |
| **Community reports** | Verified users report scams. Numbers and sites get a reputation level (suspicious / dangerous / critical) from the number of unique reporters. |
| **Similar-wording detection** | Scammers change numbers but reuse wording. Messages are compared with past reports using embeddings. |
| **Lookup + complaint text** | Quick reputation lookup of a number or link; copy-ready complaint text once 20+ people reported the same target. |
| **Home page "scam weather"** | Today's report statistics, trends, top cities, top reported numbers. |
| **Public live scam feed** | Real-world scam news, researched by the server **every 6 hours**, saved in the database and shown to every visitor (no login). |
| **"Get current data now"** | A logged-in user can run a fresh search (a ready topic or their own words), 5 per day. Saved in their account, different stories each time. |
| **Accounts** | Register with email OTP (Resend), login by cookie or Bearer token. Only verified accounts can report or run fresh searches. |
| **Admin panel (AI control)** | Add AI providers from the website. Models are picked and tested automatically, with backups. Nothing AI-related needs `.env`. |
| **Never fully down** | If AI fails, rule-based answers still work. If a model fails, the same key tries backup models; then the next provider answers. |

---

## How the AI works

```
                       +--------------------------------------+
   user request -----> |  AI Router  (services/ai/aiRouter.js) |
                       +--------------------------------------+
                          | tries providers by priority (lowest number first)
                          v
        provider 1 --fail--> provider 2 --fail--> provider 3 ...  --all fail--> rule-based answer
            |
            +-- model A fails (404 / bad JSON)? same key tries backup model B, C ... (best one becomes the main model)
```

- Providers are stored in **MongoDB** (keys encrypted with `ENCRYPTION_SECRET`). Manage them in the admin panel.
- A failing provider rests for a while (limit reached: 1 min, 2, 4 ... up to 6 h; bad key: 30 min; wrong model: 2 min; timeout: 30 s) and the next one answers. The user never sees the switch.
- Tuning (timeouts, rest times, topics, live-feed settings): `config/ai.config.js`.

### The check pipeline (`POST /api/check`)
1. **Extract**: regex + AI find numbers, links, brand, scam type.
2. **Link rules** (code): look-alike domains, shorteners, odd endings ...
3. **Community reputation** (database).
4. **Similar wording** (embeddings) and **page peek** (what is on the linked site).
5. **Verdict**: AI writes the verdict; hard database facts set a *minimum* risk (AI cannot call a heavily reported number "safe").

### The live feed
- **Public feed**: a scheduler checks every 10 minutes. If the newest snapshot is older than 6 hours it researches 4 topics (today's biggest scam, bank & wallet, job & investment, fake government messages) and saves them (`LiveSnapshot`). Visitors only *read* the database, so page views cost no AI quota. After a failed run it retries in 1 hour.
- **How news is found**: Google News RSS (free, no key) gives real headlines; **any** AI provider writes the short answer (headline, red "Watch out", green "Protect yourself", up to 3 incidents). Links always come from the real headlines, so the AI cannot invent a link. Gemini web search is used as a backup.
- **Personal search**: 5 per user per Pakistan day (resets at midnight PKT). A different extra search is used each time and stories the user already saw are skipped. The user's own words are only used as a news search, never as an instruction to the AI.

---

## Requirements
- Node.js 18 or newer
- A MongoDB database (MongoDB Atlas free tier works)
- A [Resend](https://resend.com) account (sends the email verification code) and a verified sender domain
- At least one AI provider key (added later in the admin panel)

## Quick start (local)
```bash
cd backend
npm install
cp .env.example .env        # Windows: copy .env.example .env   -> then fill it in (see table below)
npm run seed                # optional: clearly-fake demo data for the home page
npm run dev                 # or: npm start      -> http://localhost:5000
```
Always run commands from this `backend` folder. Open `http://localhost:5000/api/health`, it should answer `{ "success": true }`.
Then start the frontend (see its README).

### Make yourself an admin
Registration never creates admins. Register normally on the website, verify your email, then in MongoDB set `role: "admin"` on your user document (Atlas: Browse Collections -> `users` -> edit). Log in again and an **Admin** link appears in the top bar.

### First AI setup (no `.env` editing)
1. Website -> **Admin** -> enter your `ADMIN_KEY` (from `.env`).
2. **Add provider**: pick the type, give it a name, paste the base URL (type `openai` only, e.g. `https://api.river.ai/v1`) and the API key. Leave **Model empty**. Press **Add provider**.
3. The server loads the model list, tests the best ones and keeps the first that answers. The others are kept as backups. You see a message such as `Automatic: "DeepSeek-V4.1-Flash" passed the test. 3 backup model(s) saved.`
4. Add as many providers as you want (different companies, several keys). Lower **priority** number = tried first.
5. Press **Refresh live feed now** to fill the public feed immediately (otherwise it fills itself within a minute after the server starts).

Other buttons: **Test all providers**, **Reset cooldowns**, **Model** (pick a model by hand, **Auto-pick best model**, **Load available models**), enable / disable, delete.
Note: for providers created in the panel, the panel's choice always wins. Providers that come from `.env` keys are re-applied from `.env` at every start.

---

## Environment variables (`.env`)

| Variable | Required | Meaning |
|---|---|---|
| `MONGO_URI` | yes | MongoDB connection string. Database name `Scam-Shield-database`. |
| `JWT_SECRET` | yes | Long random string, signs login tokens. |
| `RESEND_API_KEY`, `EMAIL_FROM` | yes | Email sending (verification codes). `EMAIL_FROM` must use a domain verified in Resend. |
| `ENCRYPTION_SECRET` | yes | Long random string. Encrypts AI keys in the database. **Never change it later**, or stored keys cannot be read (you would have to add them again). |
| `SALT` | yes | Random string used to hash reporter identities. |
| `ADMIN_KEY` | yes (for admin) | Password for the admin panel. Long and random. |
| `CLIENT_ORIGIN` | production | Your website address, e.g. `https://your-site.vercel.app` (comma-separated for several). Empty = allow all (development only). |
| `PORT` | no | Default 5000. |
| `NODE_ENV` | production | Set `production` so the login cookie is `Secure` + `SameSite=None`. |
| `TRUST_PROXY_HOPS` | no | Proxies in front of the server (for the real visitor IP used by rate limits). Render/Railway: 1 (default). **Vercel rewrite + Cloudflare Tunnel: 2.** |
| `COOKIE_SAMESITE` | no | Override cookie SameSite (`lax` / `none`). |
| `APP_NAME`, `EMAIL_LOGO_URL` | no | Email branding. |
| `ALLOW_REPEAT_REPORTS` | no | `true` lets one account report the same target again (testing). |
| `LIVE_SEARCH_DAILY_LIMIT` | no | Fresh searches per user per day (default 5). |
| `LIVE_SEARCH_MODE` | no | `auto` (news, then Gemini backup, default), `news` or `gemini`. |
| `LIVE_FEED_ENABLED` | no | `false` switches the automatic 6-hour refresh off. |
| `RESEARCH_ENABLED`, `RESEARCH_HOUR_PKT`, `RESEARCH_MAX_ALERTS` | no | Older daily "web alerts" research (needs a Gemini key). |
| `DNS_SERVERS` | no | e.g. `8.8.8.8,8.8.4.4` if your network cannot resolve `mongodb+srv://` addresses. |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (+ `_2`...) , `AI_PROVIDER_n_*` | no | Optional: AI keys straight from `.env`. You do not need them if you use the admin panel. |

---

## Deploy: website on Vercel, server on your own laptop (Cloudflare Tunnel)

```
visitor --> Vercel (website + /api rewrite) --> Cloudflare Tunnel --> your laptop (this server, port 5000) --> MongoDB Atlas
```

1. Start the server: `npm start` (keep it running).
2. Start the tunnel in a second terminal: `cloudflared tunnel --url http://localhost:5000`. It prints an address like `https://something-random.trycloudflare.com`.
3. In `.env` set `NODE_ENV=production`, `CLIENT_ORIGIN=https://your-site.vercel.app` and **`TRUST_PROXY_HOPS=2`**. Restart the server.
4. In the frontend `vercel.json` the rewrite must be **exactly**:
   ```json
   { "source": "/api/:path*", "destination": "https://something-random.trycloudflare.com/api/:path*" }
   ```
   The `/api/:path*` at the end of the destination is essential. Without it every request lands on the server's root and the website shows **"Route not found."**
5. Redeploy the frontend on Vercel.

Things to know about this setup:
- A quick tunnel gets a **new address every time you restart it**. Then you must update `vercel.json` and redeploy. For a permanent address use a named Cloudflare Tunnel (free Cloudflare account) or host the server on Render / Railway / a VPS.
- The site only works while the laptop is on, online, with both `npm start` and `cloudflared` running.
- Quick tunnels have no uptime guarantee. Fine for demos and testing, not for production.
- Very long requests can be cut by the hosting proxy. Typical checks and searches are fast; if a fresh search sometimes fails with a timeout, try again.
- Keep the **public feed** working: the 6-hour refresh runs inside this server, so the server must be running at least occasionally.

### Hosting on Render / Railway instead
Create a Web Service with root directory `backend`, build `npm install`, start `npm start`, add the environment variables above (`NODE_ENV=production`, `CLIENT_ORIGIN`, leave `TRUST_PROXY_HOPS` unset), and use the service address in `vercel.json`.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Server with auto-restart (nodemon). |
| `npm start` | Server. |
| `npm test` | Offline tests (no database, no keys, no internet): check pipeline, live feed, model auto-selection, safe page peek. |
| `npm run ai:check` | Tests every provider (answer + embedding). Add `-- --search` for Gemini web search. |
| `npm run ai:research` | Runs the older daily web research once. |
| `npm run seed` / `seed:reset` | Fake demo data for the home page. |

## Folder map
```
server.js, app.js          start-up, routes
config/ai.config.js        ALL AI tuning: cooldowns, timeouts, live-feed topics and settings
controllers/               request handlers (auth, check, report, feed, live, admin)
services/ai/               aiRouter (failover), modelPicker (auto model), providers/ (gemini, openai-compatible)
services/live.service.js   public feed + personal searches   news.service.js (Google News RSS)
services/pagePeek.service.js   safe website inspection for the link check
services/verdict.service.js    final verdict      extract / rules / similarity / lookup ...
models/                    MongoDB models (User, Report, AIProvider, LiveSnapshot, UserSearch, ...)
middleware/                auth, admin key, rate limits, validation
tests/                     offline tests
```

## Troubleshooting

| Problem | Cause / fix |
|---|---|
| Website shows **"Route not found."** | Wrong `vercel.json` rewrite (missing `/api/:path*` at the end of the destination), or the tunnel address changed. |
| Live feed says "being prepared" | Nothing researched yet. Admin -> **Refresh live feed now**, and make sure at least one provider works (**Test all providers**). |
| `HTTP 429 quota exceeded` on Gemini | Free quota used up. Live search does not need Gemini any more; add another provider. |
| `HTTP 404 Model not found` | Open the provider -> **Model** -> **Auto-pick best model**. |
| Login works locally, not online | Set `NODE_ENV=production`, `CLIENT_ORIGIN`, and use the `/api` rewrite (same-site cookies). |
| Everyone gets "too many requests" | Proxy count wrong: set `TRUST_PROXY_HOPS=2` behind Vercel + Cloudflare Tunnel. |
| Stored AI keys stopped working | `ENCRYPTION_SECRET` changed. Restore it, or add the providers again. |
| Cannot reach MongoDB (`ENOTFOUND` / `ECONNREFUSED`) | Set `DNS_SERVERS=8.8.8.8,8.8.4.4`, and allow your IP in Atlas Network Access. |

## Security notes
- Never commit `.env`. If an API key was ever pasted in a chat or screenshot, rotate it.
- Keep `ADMIN_KEY` long and secret; only admins see the Admin link, but the key is what protects the API.
- AI answers can be wrong. The app always shows a disclaimer and links to its sources.
