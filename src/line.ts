// LINE Messaging API とやり取りするための最小限の型定義とヘルパー関数。
// 参考: https://developers.line.biz/ja/reference/messaging-api/

export type LineEmoji = {
  index: number
  length: number
  productId: string
  emojiId: string
}

export type LineSource = {
  type: 'user' | 'group' | 'room' | string
  userId?: string
  groupId?: string
  roomId?: string
}

export type LineMessage = {
  id: string
  type: string
  text?: string
  emojis?: LineEmoji[]
  quoteToken?: string
}

export type LineWebhookEvent = {
  type: string
  replyToken?: string
  // isRedelivery が true のイベントは、応答遅延等でLINEが再送してきたもの。
  // 元の配信が処理中/処理済みの可能性があるため、再送分は処理をスキップする。
  deliveryContext?: {
    isRedelivery: boolean
  }
  source?: LineSource
  message?: LineMessage
  [key: string]: unknown
}

export type LineWebhookBody = {
  destination: string
  events: LineWebhookEvent[]
}

export type LineTextMessage = {
  type: 'text'
  text: string
  quoteToken?: string
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

export function conversationId(source: LineSource | undefined): string {
  return source?.groupId ?? source?.roomId ?? source?.userId ?? 'unknown'
}

export function pushDestination(source: LineSource | undefined): string | undefined {
  return source?.groupId ?? source?.roomId ?? source?.userId
}

export function isGroupSource(source: LineSource | undefined): boolean {
  return source?.type === 'group' || source?.type === 'room'
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

async function lineFetch(channelAccessToken: string, url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      ...(init.headers ?? {}),
    },
  })
}

/**
 * reply API でメッセージを返信する。
 * replyToken は Webhook イベントごとに発行される一度限り・有効期限つきのトークンのため、
 * 受信から時間をおかずに呼び出す必要がある。
 */
export async function replyMessage(
  channelAccessToken: string,
  replyToken: string,
  messages: LineTextMessage[],
): Promise<void> {
  const res = await lineFetch(channelAccessToken, 'https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LINE reply API error: ${res.status} ${text}`)
  }
}

/** replyToken 失効時のフォールバック。Push は送信数にカウントされる。 */
export async function pushMessage(
  channelAccessToken: string,
  to: string,
  messages: LineTextMessage[],
): Promise<void> {
  const res = await lineFetch(channelAccessToken, 'https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, messages }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LINE push API error: ${res.status} ${text}`)
  }
}

export function isExpiredReplyTokenError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /reply API error: 400/.test(error.message) || /Invalid reply token/i.test(error.message)
}

export async function sendLineText(options: {
  channelAccessToken: string
  replyToken?: string
  source?: LineSource
  text: string
  quoteToken?: string
}): Promise<void> {
  const messages: LineTextMessage[] = [
    {
      type: 'text',
      text: options.text,
      ...(options.quoteToken ? { quoteToken: options.quoteToken } : {}),
    },
  ]

  if (options.replyToken) {
    try {
      await replyMessage(options.channelAccessToken, options.replyToken, messages)
      return
    } catch (error) {
      if (!isExpiredReplyTokenError(error)) throw error
    }
  }

  const to = pushDestination(options.source)
  if (!to) {
    throw new Error('No destination for LINE push fallback')
  }
  // quoteToken は reply 専用。Push では引用できない。
  await pushMessage(options.channelAccessToken, to, [{ type: 'text', text: options.text }])
}

export async function getDisplayName(
  channelAccessToken: string,
  source: LineSource | undefined,
  timeoutMs: number,
): Promise<string | undefined> {
  const userId = source?.userId
  if (!userId) return undefined

  const url =
    source?.type === 'group' && source.groupId
      ? `https://api.line.me/v2/bot/group/${source.groupId}/member/${userId}`
      : source?.type === 'room' && source.roomId
        ? `https://api.line.me/v2/bot/room/${source.roomId}/member/${userId}`
        : `https://api.line.me/v2/bot/profile/${userId}`

  try {
    const res = await lineFetch(channelAccessToken, url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { displayName?: string }
    return data.displayName
  } catch {
    return undefined
  }
}
