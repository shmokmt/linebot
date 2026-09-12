import { Hono } from 'hono'
import {
  hasTranslatableText,
  replyMessage,
  stripUrls,
  verifySignature,
  type LineWebhookBody,
} from './line'
import { translate } from './translate'

type Bindings = {
  LINE_CHANNEL_ACCESS_TOKEN: string
  LINE_CHANNEL_SECRET: string
  AI: Ai
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.text('OK')
})

app.post('/webhook', async (c) => {
  // 署名検証は JSON.parse 前の生ボディに対して行う必要がある
  const rawBody = await c.req.text()
  const signature = c.req.header('x-line-signature')

  const valid = await verifySignature(c.env.LINE_CHANNEL_SECRET, rawBody, signature)
  if (!valid) {
    return c.text('Invalid signature', 401)
  }

  const body: LineWebhookBody = JSON.parse(rawBody)

  await Promise.all(
    body.events.map(async (event) => {
      if (event.type === 'message' && event.replyToken && hasTranslatableText(event.message)) {
        const text = stripUrls(event.message?.text ?? '')
        try {
          const translated = await translate(c.env.AI, text)
          await replyMessage(c.env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [
            { type: 'text', text: translated },
          ])
        } catch (error) {
          // 失敗してもWebhookへは200を返す(LINE側の再送・重複翻訳を防ぐ)
          console.error('Failed to translate or reply:', error)
        }
      }
    }),
  )

  return c.text('OK')
})

export default app
