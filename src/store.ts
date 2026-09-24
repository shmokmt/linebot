import {
  CACHE_TTL_SECONDS,
  DEFAULT_SETTINGS,
  HISTORY_LIMIT,
  HISTORY_TTL_SECONDS,
  LAST_TRANSLATION_TTL_SECONDS,
  PROFILE_TTL_SECONDS,
  SETTINGS_TTL_SECONDS,
} from './constants'
import type { ConversationSettings, HistoryItem, LastTranslation } from './types'

const CACHE_ORIGIN = 'https://linebot.internal'

export type Store = {
  get<T>(key: string): Promise<T | null>
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>
}

export function createMemoryStore(): Store {
  const memory = new Map<string, { value: unknown; expiresAt: number }>()
  return {
    async get<T>(key: string): Promise<T | null> {
      const hit = memory.get(key)
      if (!hit) return null
      if (hit.expiresAt < Date.now()) {
        memory.delete(key)
        return null
      }
      return hit.value as T
    },
    async put(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    },
  }
}

/** Workers の Cache API。KV を増やさずに TTL 付きの履歴・設定・キャッシュを持つ。 */
export function createCacheStore(): Store {
  return {
    async get<T>(key: string): Promise<T | null> {
      const res = await caches.default.match(new Request(`${CACHE_ORIGIN}/${key}`))
      if (!res) return null
      try {
        return (await res.json()) as T
      } catch {
        return null
      }
    },
    async put(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      await caches.default.put(
        new Request(`${CACHE_ORIGIN}/${key}`),
        new Response(JSON.stringify(value), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttlSeconds}`,
          },
        }),
      )
    },
  }
}

export async function getSettings(store: Store, conversationId: string): Promise<ConversationSettings> {
  const saved = await store.get<ConversationSettings>(`settings:${conversationId}`)
  if (!saved) return { ...DEFAULT_SETTINGS, glossary: [] }
  return {
    langA: saved.langA ?? DEFAULT_SETTINGS.langA,
    langB: saved.langB ?? DEFAULT_SETTINGS.langB,
    enabled: saved.enabled ?? true,
    glossary: Array.isArray(saved.glossary) ? saved.glossary : [],
  }
}

export async function putSettings(
  store: Store,
  conversationId: string,
  settings: ConversationSettings,
): Promise<void> {
  await store.put(`settings:${conversationId}`, settings, SETTINGS_TTL_SECONDS)
}

export async function getHistory(store: Store, conversationId: string): Promise<HistoryItem[]> {
  return (await store.get<HistoryItem[]>(`history:${conversationId}`)) ?? []
}

export async function pushHistory(
  store: Store,
  conversationId: string,
  item: HistoryItem,
): Promise<void> {
  const history = await getHistory(store, conversationId)
  history.push(item)
  await store.put(`history:${conversationId}`, history.slice(-HISTORY_LIMIT), HISTORY_TTL_SECONDS)
}

export async function getLastTranslation(
  store: Store,
  conversationId: string,
  userId: string,
): Promise<LastTranslation | null> {
  return store.get<LastTranslation>(`last:${conversationId}:${userId}`)
}

export async function putLastTranslation(
  store: Store,
  conversationId: string,
  userId: string,
  value: LastTranslation,
): Promise<void> {
  await store.put(`last:${conversationId}:${userId}`, value, LAST_TRANSLATION_TTL_SECONDS)
}

export async function getCachedTranslation(store: Store, cacheKey: string): Promise<string | null> {
  const hit = await store.get<{ translation: string }>(`cache:${cacheKey}`)
  return hit?.translation ?? null
}

export async function putCachedTranslation(
  store: Store,
  cacheKey: string,
  translation: string,
): Promise<void> {
  await store.put(`cache:${cacheKey}`, { translation }, CACHE_TTL_SECONDS)
}

export async function getCachedProfile(store: Store, userId: string): Promise<string | null> {
  const hit = await store.get<{ name: string }>(`profile:${userId}`)
  return hit?.name ?? null
}

export async function putCachedProfile(store: Store, userId: string, name: string): Promise<void> {
  await store.put(`profile:${userId}`, { name }, PROFILE_TTL_SECONDS)
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function translationCacheKey(
  langA: string,
  langB: string,
  normalizedText: string,
): Promise<string> {
  const hash = await sha256Hex(`${langA}:${langB}:${normalizedText}`)
  return `${langA}:${langB}:${hash}`
}

export function speakerPriorLang(history: HistoryItem[], userId: string | undefined): HistoryItem['lang'] {
  if (!userId) return undefined
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i]
    if (item.userId === userId && item.lang) return item.lang
  }
  return undefined
}
