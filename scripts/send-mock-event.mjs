// LINE Messaging API の Webhook を模擬したリクエストをローカルの /webhook に送るスクリプト。
// 実際の LINE アカウントや ngrok なしで、署名検証を含む受信処理を手元で試せる。
//
// 使い方: npm run dev を起動した状態で
//   npm run mock:event -- "翻訳したいテキスト"
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

function loadDevVars() {
  try {
    const content = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    const vars = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
    }
    return vars
  } catch {
    return {}
  }
}

const devVars = loadDevVars()
const channelSecret = process.env.LINE_CHANNEL_SECRET ?? devVars.LINE_CHANNEL_SECRET
if (!channelSecret) {
  console.error('LINE_CHANNEL_SECRET not found. Set it in .dev.vars or as an env var.')
  process.exit(1)
}

const url = process.env.MOCK_WEBHOOK_URL ?? 'http://127.0.0.1:8787/webhook'
const text = process.argv[2] ?? 'こんにちは'

const body = JSON.stringify({
  destination: 'mock-destination',
  events: [
    {
      type: 'message',
      replyToken: 'mock-reply-token',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'mock-user-id' },
      message: {
        id: String(Date.now()),
        type: 'text',
        text,
      },
    },
  ],
})

const signature = createHmac('sha256', channelSecret).update(body).digest('base64')

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-line-signature': signature,
  },
  body,
})

console.log(`${res.status} ${res.statusText}`)
console.log(await res.text())
