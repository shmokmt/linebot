# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A LINE bot on Cloudflare Workers (Hono) that translates short chat messages. Default pair is Japanese ↔ Taiwanese Mandarin (Traditional Chinese); `/lang` can change the pair per conversation. Translation only — no explanations, no chit-chat. One LLM call is the default; a reviewer/refiner runs only when confidence is low or the text has numbers/dates/ambiguity. See README.md for user-facing setup.

## Commands

```sh
npm install
npm run dev              # wrangler dev — requires `npx wrangler login` first (see below)
npm run typecheck        # tsc --noEmit; also runs in CI (.github/workflows/ci.yml)
npm test                 # node:test via tsx (pure logic; no Workers AI)
npm run deploy           # wrangler deploy --minify
npm run mock:event -- "テキスト"   # send a signed mock LINE webhook event to the local server
npm run cf-typegen       # regenerate Cloudflare binding types from wrangler.jsonc
```

Verification is: `npm run typecheck` + `npm test` + optional `npm run mock:event` against `wrangler dev`.

The `AI` binding always calls Cloudflare's real Workers AI service, even under `wrangler dev` — local dev will fail to start with an auth error unless `npx wrangler login` has been run (or `CLOUDFLARE_API_TOKEN` is set), and every local run incurs real Workers AI usage.

### Testing the webhook locally without a real LINE account

`scripts/send-mock-event.mjs` reads `LINE_CHANNEL_SECRET` from `.dev.vars`, computes a valid `x-line-signature`, and POSTs a synthetic webhook payload to `http://127.0.0.1:8787/webhook` (override with `MOCK_WEBHOOK_URL`). This exercises signature verification, message filtering, and the real translation call end-to-end. The mock reply token is not real, so Reply API fails and the handler falls back to Push API (also expected to fail). Those failures are caught/logged, not a bug.

## Architecture

Entry point is `src/index.ts` (`wrangler.jsonc` `main`). The webhook verifies the LINE signature against the *raw* request body (before `JSON.parse`), returns 200 immediately, and runs work in `c.executionCtx.waitUntil(...)`.

- **`src/index.ts`** — Hono app. `GET /` health check. `POST /webhook` handles `join`/`follow` (privacy notice), bot commands, and translation. Redeliveries (`deliveryContext.isRedelivery`) are skipped.
- **`src/pipeline.ts`** — detect → cache → translate → maybe review/refine. Skips pair-external languages and no-op translations.
- **`src/translate.ts`** — structured JSON translation. User text is wrapped in `<text>...</text>`. `temperature: 0`.
- **`src/review.ts`** — MQM-style reviewer and a single refine pass. Different prompt from the translator (same model by default). Triggered by `shouldReview` in `src/preprocess.ts`.
- **`src/detect.ts`** — script rules (kana → ja, hangul → ko, traditional/simplified markers) plus particle heuristics. Low confidence defers detection to the translation call. lingua/fastText are not used (Workers-incompatible).
- **`src/store.ts`** — Cache API (TTL) for settings, last N history items, translation cache, glossary, last `/fix` source. `createMemoryStore()` is for tests.
- **`src/commands.ts`** — `/lang`, `/on`, `/off`, `/glossary`, `/fix`, `/help`.
- **`src/line.ts`** — LINE helpers (no SDK): signature, Reply + Push fallback, display name, `quoteToken`, skip filters.

### Why translation runs in `ctx.waitUntil()`

Model inference can take a couple of seconds; awaiting it inline risks LINE's webhook client timing out and redelivering the same event. Errors inside the `waitUntil` task are caught and `console.error`-logged, never thrown — the webhook response is always `200`. A `5xx` would also trigger a LINE redelivery.

### Prompt design (`src/translate.ts`)

The system prompt wraps the user's text in `<text>...</text>` and treats the tag as an opaque string — never as a question or instruction — with few-shot casual-chat examples. This exists because smaller open-weight instruct models are prone to breaking character on self-referential input. Known residual limitation: some phrasings can still leak a self-identification answer.

### Bindings and secrets

Configured in `wrangler.jsonc`:
- `AI` — Workers AI binding (no key needed; local dev calls it remotely, see above).
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — secrets, not `vars`. Set via `wrangler secret put <NAME>` for production; via `.dev.vars` (gitignored, copy from `.dev.vars.example`) for local dev.
- `routes` — custom domain (`linebot.shmokmt.dev`) via `custom_domain: true`.

No KV/D1/R2/Durable Objects. Conversation state uses the Cache API (`caches.default`) as a Redis-with-TTL stand-in.
