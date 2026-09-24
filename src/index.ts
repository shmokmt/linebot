import { Hono } from 'hono'
import { applyCommand, isCommandLike, parseCommand } from './commands'
import { PRIVACY_NOTICE, PROFILE_TIMEOUT_MS } from './constants'
import { formatReply } from './format'
import {
  conversationId,
  getDisplayName,
  hasTranslatableText,
  isGroupSource,
  sendLineText,
  stripUrls,
  verifySignature,
  type LineWebhookBody,
  type LineWebhookEvent,
} from './line'
import { runTranslationPipeline } from './pipeline'
import { isFormulaic, normalizeForCache } from './preprocess'
import {
  createCacheStore,
  getCachedProfile,
  getLastTranslation,
  getSettings,
  getHistory,
  putCachedProfile,
  putLastTranslation,
  putSettings,
  pushHistory,
  speakerPriorLang,
  translationCacheKey,
  putCachedTranslation,
} from './store'

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

  const body = JSON.parse(rawBody) as LineWebhookBody
  const store = createCacheStore()

  for (const event of body.events) {
    if (event.deliveryContext?.isRedelivery) continue

    if (event.type === 'join' || event.type === 'follow') {
      const token = event.replyToken
      if (!token) continue
      c.executionCtx.waitUntil(
        sendLineText({
          channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          replyToken: token,
          source: event.source,
          text: PRIVACY_NOTICE,
        }).catch((error) => console.error('Failed to send privacy notice:', error)),
      )
      continue
    }

    if (event.type !== 'message' || !event.replyToken) continue

    c.executionCtx.waitUntil(handleMessage(c.env, store, event))
  }

  return c.text('OK')
})

async function handleMessage(env: Bindings, store: ReturnType<typeof createCacheStore>, event: LineWebhookEvent) {
  try {
    const text = event.message?.text ?? ''
    const convId = conversationId(event.source)
    const userId = event.source?.userId ?? 'unknown'
    const settings = await getSettings(store, convId)

    if (isCommandLike(text)) {
      const command = parseCommand(text)
      if (!command) {
        await sendLineText({
          channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
          replyToken: event.replyToken,
          source: event.source,
          text: 'コマンドを解釈できませんでした。/help を見てください。',
        })
        return
      }

      const last = await getLastTranslation(store, convId, userId)
      const applied = applyCommand(command, settings, last)
      await putSettings(store, convId, applied.settings)
      if (applied.cacheUpdate) {
        await putLastTranslation(store, convId, userId, applied.cacheUpdate)
        await putCachedTranslation(
          store,
          await translationCacheKey(
            applied.settings.langA,
            applied.settings.langB,
            normalizeForCache(applied.cacheUpdate.source),
          ),
          applied.cacheUpdate.translation,
        )
      }
      await sendLineText({
        channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
        replyToken: event.replyToken,
        source: event.source,
        text: applied.reply,
      })
      return
    }

    if (!settings.enabled) return
    if (!hasTranslatableText(event.message)) return

    const stripped = stripUrls(text)
    if (!stripped || isFormulaic(stripped)) return

    const history = await getHistory(store, convId)
    const isGroup = isGroupSource(event.source)
    const namePromise = isGroup
      ? resolveDisplayName(env.LINE_CHANNEL_ACCESS_TOKEN, store, event)
      : Promise.resolve(undefined)

    const pipeline = await runTranslationPipeline(env.AI, store, {
      text: stripped,
      settings,
      history,
      speakerPrior: speakerPriorLang(history, event.source?.userId),
    })

    const displayName = await namePromise

    if (pipeline.skipped) return

    await Promise.all([
      pushHistory(store, convId, {
        userId: event.source?.userId,
        text: stripped,
        translation: pipeline.result.translation,
        lang: pipeline.result.sourceLang,
        at: Date.now(),
      }),
      putLastTranslation(store, convId, userId, {
        source: stripped,
        translation: pipeline.result.translation,
        sourceLang: pipeline.result.sourceLang,
        targetLang: pipeline.result.targetLang,
      }),
    ])

    await sendLineText({
      channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
      replyToken: event.replyToken,
      source: event.source,
      text: formatReply(pipeline.result.translation, displayName, isGroup),
      quoteToken: event.message?.quoteToken,
    })
  } catch (error) {
    // ここで投げ直さない: Webhookへの応答は既に返却済みで、
    // 失敗してもLINE側の再送・重複翻訳にはつながらないようにする
    console.error('Failed to translate or reply:', error)
  }
}

async function resolveDisplayName(
  token: string,
  store: ReturnType<typeof createCacheStore>,
  event: LineWebhookEvent,
): Promise<string | undefined> {
  const userId = event.source?.userId
  if (!userId) return undefined
  const cached = await getCachedProfile(store, userId)
  if (cached) return cached
  const name = await getDisplayName(token, event.source, PROFILE_TIMEOUT_MS)
  if (name) await putCachedProfile(store, userId, name)
  return name
}

export default app
