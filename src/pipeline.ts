import { TOTAL_BUDGET_MS, TRANSLATE_BUDGET_MS } from './constants'
import { detectLanguage, inLanguagePair, otherLang, resolveDirection, samePairSide } from './detect'
import { inferFlags, isNoOpTranslation, normalizeForCache, shouldReview } from './preprocess'
import { refineTranslation, reviewTranslation } from './review'
import {
  getCachedTranslation,
  putCachedTranslation,
  translationCacheKey,
  type Store,
} from './store'
import { translateMessage } from './translate'
import type { ConversationSettings, HistoryItem, LangCode, TranslationResult } from './types'

export type PipelineSkip = {
  skipped: true
  reason: string
}

export type PipelineOk = {
  skipped: false
  result: TranslationResult
  reviewed: boolean
  refined: boolean
  cached: boolean
}

export type PipelineResult = PipelineSkip | PipelineOk

export async function runTranslationPipeline(
  ai: Ai,
  store: Store,
  input: {
    text: string
    settings: ConversationSettings
    history: HistoryItem[]
    speakerPrior?: LangCode
  },
): Promise<PipelineResult> {
  const started = Date.now()
  const detection = detectLanguage(input.text)
  const direction = resolveDirection(detection, input.settings, input.speakerPrior)

  if (direction.skip) {
    return { skipped: true, reason: direction.reason }
  }

  const cacheKey = await translationCacheKey(
    input.settings.langA,
    input.settings.langB,
    normalizeForCache(input.text),
  )
  const cached = await getCachedTranslation(store, cacheKey)
  if (cached) {
    const sourceLang = direction.deferToLlm
      ? (detection.lang !== 'und' && inLanguagePair(detection.lang, input.settings)
        ? (samePairSide(detection.lang, input.settings.langA) ? input.settings.langA : input.settings.langB)
        : input.settings.langA)
      : direction.sourceLang
    const targetLang = direction.deferToLlm ? otherLang(sourceLang, input.settings) : direction.targetLang
    return {
      skipped: false,
      cached: true,
      reviewed: false,
      refined: false,
      result: {
        sourceLang,
        targetLang,
        translation: cached,
        confidence: 1,
        flags: [],
      },
    }
  }

  const translated = await translateMessage(ai, {
    text: input.text,
    settings: input.settings,
    history: input.history,
    sourceLang: direction.deferToLlm ? undefined : direction.sourceLang,
    targetLang: direction.deferToLlm ? undefined : direction.targetLang,
  })

  if (!inLanguagePair(translated.sourceLang, input.settings)) {
    return { skipped: true, reason: 'model detected language outside pair' }
  }
  if (isNoOpTranslation(input.text, translated.translation)) {
    return { skipped: true, reason: 'translation equals source' }
  }

  translated.flags = inferFlags(input.text, translated.flags)
  if (direction.deferToLlm) {
    translated.targetLang = otherLang(translated.sourceLang, input.settings)
  }

  let reviewed = false
  let refined = false
  let result = translated
  const reviewGate = shouldReview({
    text: input.text,
    confidence: result.confidence,
    flags: result.flags,
  })

  if (reviewGate.review && Date.now() - started < TRANSLATE_BUDGET_MS) {
    try {
      const review = await reviewTranslation(ai, {
        source: input.text,
        translation: result.translation,
        sourceLang: result.sourceLang,
        targetLang: result.targetLang,
      })
      reviewed = true
      if (review.needsRefine && Date.now() - started < TOTAL_BUDGET_MS - 400) {
        const refinedText = await refineTranslation(ai, {
          source: input.text,
          translation: result.translation,
          sourceLang: result.sourceLang,
          targetLang: result.targetLang,
          errors: review.errors,
        })
        if (refinedText && !isNoOpTranslation(input.text, refinedText)) {
          result = { ...result, translation: refinedText }
          refined = true
        }
      }
    } catch (error) {
      console.error('Review/refine failed; keeping first translation:', error)
    }
  }

  await putCachedTranslation(store, cacheKey, result.translation)
  return { skipped: false, result, reviewed, refined, cached: false }
}
