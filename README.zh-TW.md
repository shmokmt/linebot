# linebot

[![CI](https://github.com/shmokmt/linebot/actions/workflows/ci.yml/badge.svg)](https://github.com/shmokmt/linebot/actions/workflows/ci.yml)

[日本語](./README.md) | 台灣華語

這是一個跑在 Cloudflare Workers + [Hono](https://hono.dev/) 上、專門做日文⇔台灣華語（繁體中文）翻譯的 LINE Bot。

- 收到台灣華語時翻譯成日文
- 收到日文時翻譯成台灣華語（繁體字、台灣用語）
- 只回覆翻譯結果，不會額外解釋意思

## 特色

- **Serverless**：在 Cloudflare Workers 上執行，不需要常駐的伺服器
- **翻譯引擎使用 OpenAI API（`gpt-6-luna`）**：不使用 SDK，直接用 `fetch` 呼叫 Chat Completions API。關閉推理（reasoning）以優先追求回應速度
- **未翻譯時自動重試**：如果翻譯結果仍是原本的語言（依是否含有平假名、片假名判斷），會明確指定翻譯方向後重新翻譯一次
- **忽略無法翻譯的訊息**：貼圖、圖片等非文字訊息，以及只有表情符號的訊息會被忽略；網址會先從文字中移除再翻譯
- **附本機模擬腳本**：不需要真的 LINE 帳號或 ngrok，就能測試 Webhook 的接收處理

## 架構

```
LINE Messaging API --(Webhook: POST /webhook)--> Cloudflare Workers (Hono)
                                                        |
                                                        |-- 簽章驗證 (x-line-signature)
                                                        |-- 排除貼圖／只有表情符號／只有網址的訊息
                                                        |-- 用 OpenAI API (gpt-6-luna) 翻譯
                                                        v
                                             用 LINE Messaging API (reply API) 回覆
```

主要檔案：

| 檔案 | 用途 |
| --- | --- |
| `src/index.ts` | Hono 應用程式本體。Webhook 端點與事件處理流程 |
| `src/line.ts` | LINE Messaging API 相關的型別、簽章驗證、回覆 API、訊息過濾 |
| `src/translate.ts` | 使用 OpenAI API 的翻譯處理 |
| `scripts/send-mock-event.mjs` | 本機測試用的 Webhook 模擬傳送腳本 |

## 需要準備

- Node.js 20 以上
- Cloudflare 帳號（部署用）
- OpenAI 的 API 金鑰
- LINE Developers 帳號與 Messaging API 頻道

## 設定

```sh
npm install
```

1. 在 [LINE Developers Console](https://developers.line.biz/console/) 建立 Messaging API 頻道，取得**頻道存取權杖（Channel access token）**與**頻道密鑰（Channel secret）**。
2. 在 [OpenAI Platform](https://platform.openai.com/api-keys) 建立翻譯用的 **API 金鑰**。

### 本機開發

把 `.dev.vars.example` 複製成 `.dev.vars`，填入 LINE 的頻道存取權杖、頻道密鑰，以及 OpenAI 的 API 金鑰（這個檔案已列在 `.gitignore`，不會被 commit）。

```sh
cp .dev.vars.example .dev.vars
```

```sh
npm run dev
```

在本機執行時也會呼叫真正的 OpenAI API，所以每次翻譯都會產生 API 使用費用。

#### 用模擬事件測試 Webhook 接收處理

不需要準備真的 LINE 帳號或 ngrok，也能用腳本把帶有簽章的 Webhook 事件送到本機。

```sh
npm run mock:event -- "こんにちは、元気ですか？"
```

腳本會用 `.dev.vars` 裡的 `LINE_CHANNEL_SECRET` 算出正確的簽章，再 POST 到 `http://127.0.0.1:8787/webhook`（可以用 `MOCK_WEBHOOK_URL` 環境變數更改目的地）。因為回覆用的是假的 token，實際呼叫 LINE 回覆 API 時會失敗，但可以確認簽章驗證、訊息過濾和翻譯呼叫本身是否正常。

如果想從 LINE App 實際測試，請用 ngrok 等工具建立通道，並把該網址設定到 LINE Developers Console 的 Webhook URL（`https://xxxx/webhook`）。

### 部署

設定正式環境用的 Secrets（只需要第一次）。

```sh
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put OPENAI_API_KEY
```

```sh
npm run deploy
```

部署後，把顯示的 Workers 網址加上 `/webhook` 設定到 LINE Developers Console 的 Webhook URL，並開啟「Use webhook」。

#### 使用自己的網域

預設會部署到 `*.workers.dev`。如果想用自己的網域，請把 `wrangler.jsonc` 中被註解掉的 `routes` 打開，並把 `pattern` 改成你在 Cloudflare 上管理的網域。也可以從 Cloudflare 控制台替 Worker 設定自訂網域（就算沒有設定 `routes` 就部署，在控制台設定的自訂網域也不會被刪除）。

## 環境變數・Secrets

| 名稱 | 種類 | 說明 |
| --- | --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Secret | 呼叫 LINE reply API 時使用 |
| `LINE_CHANNEL_SECRET` | Secret | 驗證 Webhook 簽章時使用 |
| `OPENAI_API_KEY` | Secret | 呼叫翻譯用的 OpenAI API 時使用 |

## 端點

| 方法・路徑 | 說明 |
| --- | --- |
| `GET /` | 健康檢查 |
| `POST /webhook` | LINE Messaging API 的 Webhook。驗證簽章後，只翻譯並回覆可翻譯的文字訊息 |

## 不會翻譯的情況

以下訊息不會被翻譯或回覆，會直接忽略。

- 文字以外的訊息（貼圖、圖片、影片、位置資訊等）
- 只由 Unicode 表情符號或 LINE 專屬表情貼構成的訊息
- 只有網址的訊息（網址會先從文字中移除再翻譯，所以只要除了網址之外還有其他文字，就會進行翻譯）

判斷邏輯請參考 `src/line.ts` 的 `hasTranslatableText`／`stripUrls`。

## 開發用指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 用 `wrangler dev` 在本機啟動 |
| `npm run deploy` | 部署到 Cloudflare Workers |
| `npm run typecheck` | 用 `tsc --noEmit` 做型別檢查（CI 也會執行） |
| `npm run mock:event -- "文字"` | 傳送模擬的 Webhook 事件 |
| `npm run cf-typegen` | 從 `wrangler.jsonc` 的 Bindings 產生型別定義 |

## 更換翻譯模型

翻譯使用 OpenAI API 的 `gpt-6-luna`，並設定 `reasoning_effort: 'none'`（關閉推理）。如果想換成其他模型，請修改 `src/translate.ts` 的 `MODEL` 常數。可用的模型請參考 [OpenAI 的模型列表](https://platform.openai.com/docs/models)。

## Contributing

歡迎提出 Issue 和 Pull Request。送出變更前，請確認 `npm run typecheck` 能通過。

## License

[MIT](./LICENSE)
