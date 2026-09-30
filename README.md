# linebot

[![CI](https://github.com/shmokmt/linebot/actions/workflows/ci.yml/badge.svg)](https://github.com/shmokmt/linebot/actions/workflows/ci.yml)

Cloudflare Workers + [Hono](https://hono.dev/) で動く、日本語⇔台湾華語(繁体字)翻訳専用の LINE Bot です。

- 台湾華語が送られてきたら日本語に翻訳
- 日本語が送られてきたら台湾華語(繁体字・台湾表現)に翻訳
- 翻訳結果のみを返信し、意味の解説などは行いません

## 特徴

- **サーバーレス**: Cloudflare Workers 上で動作し、常時起動のサーバーは不要
- **翻訳エンジンは OpenAI API (`gpt-6-luna`)**: SDK を使わず Chat Completions API を `fetch` で直接呼び出す。推論(reasoning)はオフにして応答速度を優先
- **未翻訳の自動リトライ**: 翻訳結果が元の言語のまま返ってきた場合(ひらがな・カタカナの有無で判定)、翻訳方向を明示して1回だけ再翻訳する
- **翻訳できないメッセージは無視**: スタンプ・画像などの非テキストメッセージ、絵文字のみのメッセージは無視し、URL はテキストから除去してから翻訳する
- **ローカルモックスクリプト付き**: 実際の LINE アカウントや ngrok を使わずに Webhook の受信処理を試せる

## アーキテクチャ

```
LINE Messaging API --(Webhook: POST /webhook)--> Cloudflare Workers (Hono)
                                                        |
                                                        |-- 署名検証 (x-line-signature)
                                                        |-- スタンプ/絵文字のみ/URL のみのメッセージを除外
                                                        |-- OpenAI API (gpt-6-luna) で翻訳
                                                        v
                                             LINE Messaging API (reply API) で返信
```

主なファイル:

| ファイル | 役割 |
| --- | --- |
| `src/index.ts` | Hono アプリ本体。Webhook のエンドポイントとイベント処理のフロー |
| `src/line.ts` | LINE Messaging API 関連の型・署名検証・返信API・メッセージのフィルタリング |
| `src/translate.ts` | OpenAI API を使った翻訳処理 |
| `scripts/send-mock-event.mjs` | ローカル検証用の Webhook モック送信スクリプト |

## 必要なもの

- Node.js 20 以上
- Cloudflare アカウント(デプロイ用)
- OpenAI の API キー
- LINE Developers アカウントと Messaging API チャネル

## セットアップ

```sh
npm install
```

1. [LINE Developers コンソール](https://developers.line.biz/console/) で Messaging API チャネルを作成し、**チャネルアクセストークン**と**チャネルシークレット**を取得します。
2. [OpenAI Platform](https://platform.openai.com/api-keys) で翻訳に使う **API キー**を発行します。

### ローカル開発

`.dev.vars.example` を `.dev.vars` にコピーし、LINE のチャネルアクセストークン・チャネルシークレットと OpenAI の API キーを設定します(このファイルは `.gitignore` 済みでコミットされません)。

```sh
cp .dev.vars.example .dev.vars
```

```sh
npm run dev
```

ローカル実行時も実際の OpenAI API を呼び出すため、翻訳のたびに API の利用料金が発生します。

#### Webhook 受信処理をモックで試す

実際の LINE アカウントや ngrok を用意しなくても、署名付きの Webhook イベントをローカルに送るスクリプトが用意されています。

```sh
npm run mock:event -- "你好，最近好嗎？"
```

`.dev.vars` の `LINE_CHANNEL_SECRET` を使って正しい署名を計算し、`http://127.0.0.1:8787/webhook` にPOSTします(`MOCK_WEBHOOK_URL` 環境変数で送信先を変更可能)。実際の LINE 返信 API はダミートークンのままだと 401 になりますが、署名検証・メッセージのフィルタリング・翻訳呼び出し自体は確認できます。

実際に LINE アプリから動作確認したい場合は、ngrok などでトンネルを張り、その URL を LINE Developers コンソールの Webhook URL (`https://xxxx/webhook`) に設定してください。

### デプロイ

本番用の Secrets を設定します(初回のみ)。

```sh
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put OPENAI_API_KEY
```

```sh
npm run deploy
```

デプロイ後に表示される Workers の URL + `/webhook` を LINE Developers コンソールの Webhook URL に設定し、Webhook の利用を ON にしてください。

## 環境変数・Secrets

| 名前 | 種類 | 説明 |
| --- | --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Secret | LINE の reply API 呼び出しに使用 |
| `LINE_CHANNEL_SECRET` | Secret | Webhook の署名検証に使用 |
| `OPENAI_API_KEY` | Secret | 翻訳に使う OpenAI API の呼び出しに使用 |

## エンドポイント

| メソッド・パス | 説明 |
| --- | --- |
| `GET /` | ヘルスチェック |
| `POST /webhook` | LINE Messaging API の Webhook。署名検証後、翻訳可能なテキストメッセージのみ翻訳して返信する |

## 翻訳をスキップする条件

以下のメッセージは翻訳・返信されず、無視されます。

- テキストメッセージ以外(スタンプ・画像・動画・位置情報など)
- Unicode 絵文字や LINE 独自絵文字のみで構成されたメッセージ
- URL のみのメッセージ(URL 自体はテキストから除去した上で翻訳するため、URL 以外に文字があれば翻訳は実行される)

判定ロジックは `src/line.ts` の `hasTranslatableText` / `stripUrls` を参照してください。

## 開発用コマンド

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | `wrangler dev` でローカル起動 |
| `npm run deploy` | Cloudflare Workers にデプロイ |
| `npm run typecheck` | `tsc --noEmit` で型チェック(CI でも実行) |
| `npm run mock:event -- "テキスト"` | Webhook イベントのモック送信 |
| `npm run cf-typegen` | `wrangler.jsonc` の Bindings から型定義を生成 |

## 翻訳モデルの変更

翻訳には OpenAI API の `gpt-6-luna` を `reasoning_effort: 'none'`(推論オフ)で使用しています。別モデルに差し替えたい場合は `src/translate.ts` の `MODEL` 定数を変更してください。利用可能なモデルは [OpenAI のモデル一覧](https://platform.openai.com/docs/models) を参照してください。

## Contributing

Issue・Pull Request 歓迎です。変更を送る際は `npm run typecheck` が通ることを確認してください。

## License

[MIT](./LICENSE)
