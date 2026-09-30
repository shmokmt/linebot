# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A LINE bot on Cloudflare Workers (Hono) that does one thing: translate between Japanese and Taiwanese Mandarin (Traditional Chinese). Translation only — no explanations, no chit-chat. See README.md for user-facing setup (LINE Developers console, secrets, deployment).

## Commands

```sh
npm install
npm run dev              # wrangler dev — requires `npx wrangler login` first (see below)
npm run typecheck        # tsc --noEmit; also runs in CI (.github/workflows/ci.yml)
npm run deploy           # wrangler deploy --minify
npm run mock:event -- "テキスト"   # send a signed mock LINE webhook event to the local server
npm run cf-typegen       # regenerate Cloudflare binding types from wrangler.jsonc
```

There is no test suite. Verification is: `npm run typecheck` + manual exercise via `npm run mock:event` against `wrangler dev`.

Translation calls the real OpenAI API (`OPENAI_API_KEY` in `.dev.vars`), even under `wrangler dev` — every local run incurs real OpenAI usage.

### Testing the webhook locally without a real LINE account

`scripts/send-mock-event.mjs` reads `LINE_CHANNEL_SECRET` from `.dev.vars`, computes a valid `x-line-signature`, and POSTs a synthetic webhook payload to `http://127.0.0.1:8787/webhook` (override with `MOCK_WEBHOOK_URL`). This exercises signature verification, message filtering, and the real translation call end-to-end. The final `replyMessage()` call will fail against LINE's real API (`Invalid reply token`) since the mock's replyToken isn't real — that failure is expected and is caught/logged, not a bug.

## Architecture

Everything lives in three small files under `src/`, wired together in `src/index.ts` (the Worker's entry point, per `wrangler.jsonc`'s `main`):

- **`src/index.ts`** — the Hono app. `GET /` is a health check. `POST /webhook` verifies the LINE signature against the *raw* request body (must happen before `JSON.parse`), then loops over `body.events`. An event is skipped (not translated) if it's not a `message` event, has no `replyToken`, is a LINE webhook redelivery (`deliveryContext.isRedelivery`), or has no translatable text (see `hasTranslatableText`).
- **`src/line.ts`** — hand-rolled LINE Messaging API types and helpers (no LINE SDK): `verifySignature` (HMAC-SHA256 via Web Crypto), `replyMessage` (reply API), `stripUrls`, and `hasTranslatableText` (filters out stickers/images, LINE-native emoji, Unicode emoji, and URL-only messages so they're never sent to translation).
- **`src/translate.ts`** — the OpenAI Chat Completions API call (plain `fetch`, no SDK). Model and system prompt live here as the two things most likely to need tuning.

### Why translation runs in `ctx.waitUntil()`

The webhook handler schedules `translate()` + `replyMessage()` via `c.executionCtx.waitUntil(...)` and returns `200` immediately, rather than awaiting them inline. Model inference can take a couple of seconds; awaiting it inline risks LINE's webhook client timing out and redelivering the same event (which would double-run the translation). Errors inside the `waitUntil` task are caught and `console.error`-logged, never thrown — the webhook response is always `200` regardless of translation/reply success, for the same reason (a `5xx` here would also trigger a LINE redelivery).

### Prompt design (`src/translate.ts`)

The system prompt wraps the user's text in `<text>...</text>` and explicitly instructs the model to treat the tag's contents as an opaque string to translate — never as a question or instruction to follow — with few-shot examples reinforcing this. `temperature: 0` is set for deterministic behavior. This exists because smaller open-weight instruct models (unlike frontier hosted APIs) are prone to breaking character on self-referential input (e.g. answering "what model are you?" instead of translating it as text). Known residual limitation: that specific phrasing can still leak a self-identification answer even with this mitigation — see conversation/issue history before assuming a prompt tweak will fully fix it.

### Untranslated-output retry (`src/translate.ts`)

The model is `gpt-6-luna` with `reasoning_effort: 'none'`. Even so, short Chinese headlines sometimes come back as a Chinese paraphrase instead of Japanese. `translate()` detects this without an extra model call: text containing hiragana/katakana is Japanese, otherwise Chinese, and if the input and output land on the same side it retries **once** with the source/target language spelled out in the user message (re-sending the identical request is pointless at `temperature: 0`). Known limitation: kana-free Japanese (e.g. `台風接近`) is classified as Chinese, so it costs one wasted retry and may come back unchanged.

### Bindings and secrets

Configured in `wrangler.jsonc`:
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `OPENAI_API_KEY` — secrets, not `vars`. Set via `wrangler secret put <NAME>` for production; via `.dev.vars` (gitignored, copy from `.dev.vars.example`) for local dev.
- `routes` — custom domain (`linebot.shmokmt.dev`) via `custom_domain: true`.

No AI binding and no KV/D1/R2/Durable Objects — the Worker is fully stateless.
