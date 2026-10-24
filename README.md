# ScamShield Backend

Node + Express + MongoDB. AI: Gemini / Groq / OpenRouter (automatic failover).

## Run
```
npm install
cp .env.example .env     # then fill it in (see below)
npm run seed             # optional: clearly-fake demo data for the homepage
npm run dev              # or: npm start
```
Always run from THIS folder (it is the project root: `server.js`, `app.js`, `config/`, `services/` ...).

## Minimum .env
`MONGO_URI`, `JWT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ENCRYPTION_SECRET`, `SALT`, `ADMIN_KEY`, `CLIENT_ORIGIN`
and at least one AI key: `GEMINI_API_KEY` (needed for daily web research) and/or `GROQ_API_KEY`, `OPENROUTER_API_KEY`.
Without any AI key the app still works with rule-based answers only (`analysisMode: "fallback"`).
Models get renamed over time: if an AI call fails with 404/400, set `GEMINI_MODEL` / `GROQ_MODEL` / `OPENROUTER_MODEL` in `.env`.

## AI providers: set up everything in the admin panel (no .env needed)
Admin panel -> Add provider: type, name, (base URL), API key. Leave Model empty and the server loads the models, tests the best ones
and keeps the first that answers; the others are saved as backups. If a model stops working later, the same key switches to its backup
model by itself, and if a whole provider fails the next provider answers. Add as many providers as you like (River, apinex, Groq ...).
Keys are stored encrypted in MongoDB. (`.env` keys still work as an optional extra.)

## Live feed
- Public feed (everyone, no login): the server researches 4 topics every 6 hours and saves them in MongoDB (`LiveSnapshot`). Opening the home page never calls the AI.
- "Get current data now" (login, 5 a day): fresh search or the user's own words, saved in the user's account (`UserSearch`), different stories each time.
- News comes from Google News RSS; ANY provider writes the short answer. Admin panel -> "Refresh live feed now" runs it immediately.

## Link check
The AI is the main judge. For links in a message the server also opens the page safely (public sites only) and gives the AI the title / login-form info.

## Check the AI
```
npm run ai:check              # every provider: answer + embedding
npm run ai:check -- --search  # also Gemini web search
npm run ai:research           # run the daily web research now
npm test                      # offline test of the whole check pipeline (no DB / no keys needed)
```

## AI flow (POST /api/check)
1. Extract (regex + AI) -> 2. Link rules (code) -> 3. Community reputation (DB) -> 4. Similar scam wording (embeddings)
-> 5. Verdict (AI writes it, but DB facts set a minimum risk). If every AI provider fails, rule-based fallbacks answer.

Providers are tried by priority; a failing one rests (1 min, 2, 4 ... up to 6 h) and the next one answers. See `config/ai.config.js`.

## Deploy
Set `NODE_ENV=production` and `CLIENT_ORIGIN=https://your-frontend`. API docs: `API.md`.
