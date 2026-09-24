import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_SETTINGS } from './constants'
import { normalizeForCache } from './preprocess'
import { runTranslationPipeline } from './pipeline'
import { createMemoryStore, putCachedTranslation, translationCacheKey } from './store'

describe('runTranslationPipeline', () => {
  it('skips high-confidence language outside the pair', async () => {
    const result = await runTranslationPipeline({} as Ai, createMemoryStore(), {
      text: 'See you tomorrow',
      settings: { ...DEFAULT_SETTINGS, glossary: [] },
      history: [],
    })
    assert.equal(result.skipped, true)
  })

  it('returns a cache hit without calling AI', async () => {
    const store = createMemoryStore()
    const text = '最近仕事が忙しいです'
    const key = await translationCacheKey('ja', 'zh-Hant', normalizeForCache(text))
    await putCachedTranslation(store, key, '最近工作很忙')

    const result = await runTranslationPipeline({} as Ai, store, {
      text,
      settings: { ...DEFAULT_SETTINGS, glossary: [] },
      history: [],
    })
    assert.equal(result.skipped, false)
    if (!result.skipped) {
      assert.equal(result.cached, true)
      assert.equal(result.result.translation, '最近工作很忙')
    }
  })
})
