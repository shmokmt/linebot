# linebot

[![CI](https://github.com/shmokmt/linebot/actions/workflows/ci.yml/badge.svg)](https://github.com/shmokmt/linebot/actions/workflows/ci.yml)

Cloudflare Workers + [Hono](https://hono.dev/) で動く、短文チャット向けの LINE 翻訳 Bot です。デフォルトの言語ペアは日本語 ↔ 台湾華語(繁体字)で、グループごとに `/lang` で変更できます。

- 判定した言語の「もう一方」へ翻訳する(双方向)
- 訳文だけを返す。説明や雑談はしない
- 確信度が低い・数値/日時を含むなど必要なときだけレビューして最大1回修正する

## 特徴

- **サーバーレス**: Cloudflare Workers 上で動作し、常時起動のサーバーは不要
- **翻訳エンジンは Cloudflare Workers AI**: 外部 LLM API のキー管理不要(`AI` バインディングのみ)
- **条件付きパイプライン**: 1回の翻訳を基本とし、曖昧さや数値などを含むときだけ Reviewer / Refiner を足す
- **会話の文脈**: 直近の発言を Cache API に残し、主語省略・指示語の翻訳に使う
- **翻訳できないメッセージは無視**: スタンプ・画像、絵文字のみ、URL のみ、`w` / `笑` / `ok` などの定型短文、言語ペア外の発言

## アーキテクチャ

```
LINE Platform
   │ Webhook (POST)
   ▼
[Webhook受信] ─ 署名検証 → 即200返却 → waitUntil
   ▼
[前処理 / スキップ判定] ─ スタンプ・URLのみ・絵文字のみ・定型短文は翻訳しない
   ▼
[言語判定] ─ 文字種ルール + ヒューリスティック。曖昧なら翻訳と同じ呼び出しに委譲
   ▼
[翻訳エージェント] ─ 直近履歴・用語集つきで1回呼び出し(構造化JSON)
   │  出力: 訳文 / 確信度 / フラグ
   ▼
[レビュー要否判定] ── 不要 ──────────┐
   │ 必要                             │
   ▼                                  │
[Reviewer (MQM)] → 重大な誤りあり → [Refiner] (最大1回)
   ▼                                  │
[返信] ◀──────────────────────────────┘
   Reply API(失敗時は Push API)
```

主なファイル:

| ファイル | 役割 |
| --- | --- |
| `src/index.ts` | Hono アプリ。Webhook・コマンド・返信の配線 |
| `src/pipeline.ts` | 言語判定 → キャッシュ → 翻訳 → 条件付きレビュー |
| `src/translate.ts` | 翻訳エージェント(構造化JSON) |
| `src/review.ts` | MQM レビューと最大1回の修正 |
| `src/detect.ts` | 文字種 + ヒューリスティックの言語判定 |
| `src/store.ts` | Cache API による設定・履歴・キャッシュ |
| `src/commands.ts` | `/lang` `/on` `/off` `/glossary` `/fix` |
| `src/line.ts` | 署名検証・Reply/Push・プロフィール取得 |
| `scripts/send-mock-event.mjs` | ローカル検証用の Webhook モック送信 |

履歴・設定・翻訳キャッシュは Redis の代わりに Workers の Cache API(TTL 付き)へ保存します。追加の KV / D1 は不要です。コロケーションや退避の都合で消えることがある点は、設計上の Redis+TTL と同じ割り切りです。

## 必要なもの

- Node.js 20 以上
- Cloudflare アカウント(Workers AI を利用するため、ローカル開発時も含めて `wrangler login` が必要)
- LINE Developers アカウントと Messaging API チャネル

## セットアップ

```sh
npm install
```

1. [LINE Developers コンソール](https://developers.line.biz/console/) で Messaging API チャネルを作成し、**チャネルアクセストークン**と**チャネルシークレット**を取得します。
2. 翻訳には Cloudflare Workers AI (`AI` バインディング) を使用するため、追加の API キーは不要です。ただし `wrangler dev` でのローカル実行・デプロイの両方で Cloudflare アカウントへのログインが必要です。

   ```sh
   npx wrangler login
   ```

### ローカル開発

`.dev.vars.example` を `.dev.vars` にコピーし、LINE のチャネルアクセストークン・チャネルシークレットを設定します(このファイルは `.gitignore` 済みでコミットされません)。

```sh
cp .dev.vars.example .dev.vars
```

```sh
npm run dev
```

`AI` バインディングはローカル実行時も実際の Cloudflare のリモート推論を呼び出すため、`wrangler login` 未実施だと `wrangler dev` の起動時にエラーになります。

#### Webhook 受信処理をモックで試す

実際の LINE アカウントや ngrok を用意しなくても、署名付きの Webhook イベントをローカルに送るスクリプトが用意されています。

```sh
npm run mock:event -- "你好，最近好嗎？"
```

`.dev.vars` の `LINE_CHANNEL_SECRET` を使って正しい署名を計算し、`http://127.0.0.1:8787/webhook` にPOSTします(`MOCK_WEBHOOK_URL` 環境変数で送信先を変更可能)。実際の LINE 返信 API はダミートークンのままだと失敗しますが、署名検証・メッセージのフィルタリング・翻訳呼び出し自体は確認できます。Reply token 失効時は Push API へフォールバックします。

実際に LINE アプリから動作確認したい場合は、ngrok などでトンネルを張り、その URL を LINE Developers コンソールの Webhook URL (`https://xxxx/webhook`) に設定してください。

### デプロイ

本番用の Secrets を設定します(初回のみ)。

```sh
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
```

```sh
npm run deploy
```

デプロイ後に表示される Workers の URL + `/webhook` を LINE Developers コンソールの Webhook URL に設定し、Webhook の利用を ON にしてください。

## 環境変数・Secrets

| 名前 | 種類 | 説明 |
| --- | --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Secret | LINE の Reply / Push API 呼び出しに使用 |
| `LINE_CHANNEL_SECRET` | Secret | Webhook の署名検証に使用 |
| `AI` | Binding | Cloudflare Workers AI へのバインディング(`wrangler.jsonc` の `ai.binding` で設定済み) |

## エンドポイント

| メソッド・パス | 説明 |
| --- | --- |
| `GET /` | ヘルスチェック |
| `POST /webhook` | LINE Messaging API の Webhook |

## Bot コマンド

| コマンド | 説明 |
| --- | --- |
| `/lang ja zh` | 言語ペアを設定(`zh` は台湾華語)。`/lang ja en` も可 |
| `/off` `/on` | 翻訳の一時停止・再開 |
| `/glossary add 田中=Tanaka` | グループ用語を登録 |
| `/glossary list` | 用語一覧 |
| `/glossary remove 田中` | 用語削除 |
| `/fix <正しい訳>` | 直前の訳を修正し、翻訳キャッシュに残す |
| `/help` | コマンド一覧 |

グループでは `🌐 [発言者名] 訳文` の形式で返し、`quoteToken` があれば引用返信します。Bot がグループに参加したとき(または 1:1 でフォローされたとき)に、外部 AI へ送信する旨を通知します。

## 翻訳をスキップする条件

以下のメッセージは翻訳・返信されず、無視されます。

- テキストメッセージ以外(スタンプ・画像・動画・位置情報など)
- Unicode 絵文字や LINE 独自絵文字のみで構成されたメッセージ
- URL のみのメッセージ(URL 自体はテキストから除去した上で翻訳するため、URL 以外に文字があれば翻訳は実行される)
- `w` / `笑` / `ok` などの定型短文
- 設定中の言語ペアに含まれない言語(高信頼度のとき)
- `/off` 中の会話(コマンドは受け付ける)

判定ロジックは `src/line.ts` の `hasTranslatableText` と `src/preprocess.ts` / `src/detect.ts` を参照してください。

## 開発用コマンド

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | `wrangler dev` でローカル起動 |
| `npm run deploy` | Cloudflare Workers にデプロイ |
| `npm run typecheck` | `tsc --noEmit` で型チェック(CI でも実行) |
| `npm test` | 言語判定・コマンド・レビュー判定などのユニットテスト |
| `npm run mock:event -- "テキスト"` | Webhook イベントのモック送信 |
| `npm run cf-typegen` | `wrangler.jsonc` の Bindings から型定義を生成 |

## 翻訳モデルの変更

翻訳・レビューには Cloudflare Workers AI の `@cf/meta/llama-4-scout-17b-16e-instruct` を使っています(レビューは別プロンプト)。差し替える場合は `src/constants.ts` の `TRANSLATE_MODEL` / `REVIEW_MODEL` を変更してください。利用可能なモデルは [Workers AI のモデル一覧](https://developers.cloudflare.com/workers-ai/models/) を参照してください。

## Contributing

Issue・Pull Request 歓迎です。変更を送る際は `npm run typecheck` と `npm test` が通ることを確認してください。

## License

[MIT](./LICENSE)
