// LINE Messaging API とやり取りするための最小限の型定義とヘルパー関数。
// 参考: https://developers.line.biz/ja/reference/messaging-api/

export type LineEmoji = {
  index: number
  length: number
  productId: string
  emojiId: string
}

export type LineWebhookEvent = {
  type: string
  replyToken?: string
  // isRedelivery が true のイベントは、応答遅延等でLINEが再送してきたもの。
  // 元の配信が処理中/処理済みの可能性があるため、再送分は処理をスキップする。
  deliveryContext?: {
    isRedelivery: boolean
  }
  message?: {
    id: string
    type: string
    text?: string
    // LINE独自の絵文字(テキスト中の該当箇所を占めるプレースホルダの位置情報)
    emojis?: LineEmoji[]
  }
  [key: string]: unknown
}

export type LineWebhookBody = {
  destination: string
  events: LineWebhookEvent[]
}

// Unicode絵文字(異体字セレクタ️・ZWJ結合‍を含む)にマッチする
const PICTOGRAPHIC_REGEX = new RegExp('\\p{Extended_Pictographic}|\\uFE0F|\\u200D', 'gu')

const URL_REGEX = /https?:\/\/\S+/gi

// テキストからURLを取り除く(翻訳結果にURLが混ざらないようにする)
export function stripUrls(text: string): string {
  return text.replace(URL_REGEX, '').trim()
}

// テキストメッセージ以外(スタンプ・画像等)や、URL/LINE絵文字/Unicode絵文字のみで
// 翻訳対象となる文字が残らないメッセージを除外する
export function hasTranslatableText(message: LineWebhookEvent['message']): boolean {
  if (!message || message.type !== 'text') return false

  let text = message.text ?? ''
  if (message.emojis?.length) {
    for (const emoji of [...message.emojis].sort((a, b) => b.index - a.index)) {
      text = text.slice(0, emoji.index) + text.slice(emoji.index + emoji.length)
    }
  }
  text = stripUrls(text)
  text = text.replace(PICTOGRAPHIC_REGEX, '').trim()

  return text.length > 0
}

async function hmacSha256Base64(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

/**
 * `x-line-signature` ヘッダを検証する。
 * リクエストボディは JSON.parse する前の生の文字列を渡すこと(整形すると署名が一致しなくなる)。
 */
export async function verifySignature(
  channelSecret: string,
  body: string,
  signature: string | undefined | null,
): Promise<boolean> {
  if (!signature) return false
  const expected = await hmacSha256Base64(channelSecret, body)
  return expected === signature
}

/**
 * reply API でメッセージを返信する。
 * replyToken は Webhook イベントごとに発行される一度限り・有効期限つきのトークンのため、
 * 受信から時間をおかずに呼び出す必要がある。
 */
export async function replyMessage(
  channelAccessToken: string,
  replyToken: string,
  messages: { type: 'text'; text: string }[],
): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LINE reply API error: ${res.status} ${text}`)
  }
}
