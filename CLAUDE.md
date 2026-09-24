# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A LINE bot on Cloudflare Workers (Hono) that does one thing: translate between Japanese and Taiwanese Mandarin (Traditional Chinese). Translation only — no explanations, no chit-chat. See README.md for user-facing setup (LINE Developers console, secrets, deployment).

## Commands

```sh
npm install
npm run dev              # wrangler dev — requires `npx wrangler login` first (see below)
npm run typecheck        # tsc --noEmit; also runs in CI (.github/workflows/ci.yml)
npm test                 # language detection / cleanup / Taiwan-variant unit tests
npm run deploy           # wrangler deploy --minify
npm run mock:event -- "テキスト"   # send a signed mock LINE webhook event to the local server
npm run cf-typegen       # regenerate Cloudflare binding types from wrangler.jsonc
```

Verification is: `npm run typecheck` + `npm test` (language detection / output cleanup / Taiwan-variant rewriting) + manual exercise via `npm run mock:event` against `wrangler dev`.

The `AI` binding always calls Cloudflare's real Workers AI service, even under `wrangler dev` — local dev will fail to start with an auth error unless `npx wrangler login` has been run (or `CLOUDFLARE_API_TOKEN` is set), and every local run incurs real Workers AI usage.

### Testing the webhook locally without a real LINE account

`scripts/send-mock-event.mjs` reads `LINE_CHANNEL_SECRET` from `.dev.vars`, computes a valid `x-line-signature`, and POSTs a synthetic webhook payload to `http://127.0.0.1:8787/webhook` (override with `MOCK_WEBHOOK_URL`). This exercises signature verification, message filtering, and the real translation call end-to-end. The final `replyMessage()` call will fail against LINE's real API (`Invalid reply token`) since the mock's replyToken isn't real — that failure is expected and is caught/logged, not a bug.

## Architecture

Everything lives in three small files under `src/`, wired together in `src/index.ts` (the Worker's entry point, per `wrangler.jsonc`'s `main`):

- **`src/index.ts`** — the Hono app. `GET /` is a health check. `POST /webhook` verifies the LINE signature against the *raw* request body (must happen before `JSON.parse`), then loops over `body.events`. An event is skipped (not translated) if it's not a `message` event, has no `replyToken`, is a LINE webhook redelivery (`deliveryContext.isRedelivery`), or has no translatable text (see `hasTranslatableText`).
- **`src/line.ts`** — hand-rolled LINE Messaging API types and helpers (no LINE SDK): `verifySignature` (HMAC-SHA256 via Web Crypto), `replyMessage` (reply API), `stripUrls`, and `hasTranslatableText` (filters out stickers/images, LINE-native emoji, Unicode emoji, and URL-only messages so they're never sent to translation).
- **`src/translate.ts`** — the Workers AI call. Model, direction-specific prompts, language detection, output cleanup, and Taiwan-variant rewriting live here.

### Why translation runs in `ctx.waitUntil()`

The webhook handler schedules `translate()` + `replyMessage()` via `c.executionCtx.waitUntil(...)` and returns `200` immediately, rather than awaiting them inline. Model inference can take a couple of seconds; awaiting it inline risks LINE's webhook client timing out and redelivering the same event (which would double-run the translation). Errors inside the `waitUntil` task are caught and `console.error`-logged, never thrown — the webhook response is always `200` regardless of translation/reply success, for the same reason (a `5xx` here would also trigger a LINE redelivery).

### Prompt design (`src/translate.ts`)

`detectSourceLanguage()` picks a one-way prompt when the script is unambiguous (kana / Japanese endings → JA→zh-TW; simplified-only characters or Chinese particles → ZH→JA). Kanji-only shorts such as 了解 or 你好 stay `unknown` so the model still chooses the direction. The user text is wrapped in `<text>...</text>` and the system prompt treats the tag's contents as an opaque string to translate — never as a question or instruction to follow — with few-shot examples (including Taiwan lexicon: 超商 / 捷運 / 軟體). `temperature: 0` is set for deterministic behavior; `max_tokens` is raised above Workers AI's 256 default so longer LINE messages are not truncated. After the model returns, `cleanTranslation()` strips labels/quotes/tags, and Chinese output is passed through `toTaiwanMandarin()` (Mainland terms + common simplified characters). Known residual limitation: self-identification questions can still leak an answer even with this mitigation — see conversation/issue history before assuming a prompt tweak will fully fix it.

### Bindings and secrets

Configured in `wrangler.jsonc`:
- `AI` — Workers AI binding (no key needed; local dev calls it remotely, see above).
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — secrets, not `vars`. Set via `wrangler secret put <NAME>` for production; via `.dev.vars` (gitignored, copy from `.dev.vars.example`) for local dev.
- `routes` — custom domain (`linebot.shmokmt.dev`) via `custom_domain: true`.

No KV/D1/R2/Durable Objects — the Worker is fully stateless.
