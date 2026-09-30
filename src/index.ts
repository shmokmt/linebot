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
  OPENAI_API_KEY: string
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

  const body = JSON.parse(rawBody) as LineWebhookBody

  for (const event of body.events) {
    const replyToken = event.replyToken
    if (
      event.type !== 'message' ||
      !replyToken ||
      event.deliveryContext?.isRedelivery ||
      !hasTranslatableText(event.message)
    ) {
      continue
    }

    const text = stripUrls(event.message?.text ?? '')
    // 翻訳の完了を待たずに200を返す(LINE側のタイムアウト・再送を避けるため)。
    // 実際の翻訳・返信はバックグラウンドで実行する。
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const translated = await translate(c.env.OPENAI_API_KEY, text)
          await replyMessage(c.env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, [
            { type: 'text', text: translated },
          ])
        } catch (error) {
          // ここで投げ直さない: Webhookへの応答は既に返却済みで、
          // 失敗してもLINE側の再送・重複翻訳にはつながらないようにする
          console.error('Failed to translate or reply:', error)
        }
      })(),
    )
  }

  return c.text('OK')
})

export default app
