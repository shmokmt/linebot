import { REVIEW_MODEL } from './constants'
import { asRecord, asString, extractJson } from './json'
import { shouldReview } from './preprocess'
import { runChat } from './translate'
import type { LangCode, ReviewError, ReviewResult } from './types'

export { shouldReview }

const REVIEW_PROMPT = `You are a translation reviewer using MQM.
Compare SOURCE and TRANSLATION. Do not translate from scratch unless listing an error.

Output ONLY JSON:
{
  "errors": [
    {
      "type": "mistranslation" | "omission" | "addition" | "number" | "tone" | "other",
      "severity": "critical" | "major" | "minor",
      "comment": "short"
    }
  ]
}

Severity:
- critical: meaning flipped, wrong number/date/money/name, or unusable
- major: important meaning error or missing content
- minor: style/tone nits that do not change meaning

Ignore minor fluency polish. Be stricter than a self-score.`

const REFINE_PROMPT = `You are a translation refiner. Fix ONLY the listed critical/major errors.
Keep tone, emoji, and names. Output ONLY JSON: {"translation":"..."}`

export function parseReviewResult(raw: string): ReviewResult {
  const parsed = asRecord(extractJson(raw))
  const errorsRaw = parsed?.errors
  const errors: ReviewError[] = []
  if (Array.isArray(errorsRaw)) {
    for (const item of errorsRaw) {
      const rec = asRecord(item)
      if (!rec) continue
      const type = asString(rec.type)
      const severity = asString(rec.severity)
      if (
        type !== 'mistranslation' &&
        type !== 'omission' &&
        type !== 'addition' &&
        type !== 'number' &&
        type !== 'tone' &&
        type !== 'other'
      ) {
        continue
      }
      if (severity !== 'critical' && severity !== 'major' && severity !== 'minor') continue
      errors.push({
        type,
        severity,
        comment: asString(rec.comment) ?? '',
      })
    }
  }
  return {
    errors,
    needsRefine: errors.some((e) => e.severity === 'critical' || e.severity === 'major'),
  }
}

export async function reviewTranslation(
  ai: Ai,
  input: { source: string; translation: string; sourceLang: LangCode; targetLang: LangCode },
): Promise<ReviewResult> {
  const raw = await runChat(
    ai,
    REVIEW_MODEL,
    [
      { role: 'system', content: REVIEW_PROMPT },
      {
        role: 'user',
        content: [
          `source_lang=${input.sourceLang}`,
          `target_lang=${input.targetLang}`,
          `<source>${input.source}</source>`,
          `<translation>${input.translation}</translation>`,
        ].join('\n'),
      },
    ],
    { temperature: 0, max_tokens: 350 },
  )
  return parseReviewResult(raw)
}

export async function refineTranslation(
  ai: Ai,
  input: {
    source: string
    translation: string
    sourceLang: LangCode
    targetLang: LangCode
    errors: ReviewError[]
  },
): Promise<string | undefined> {
  const raw = await runChat(
    ai,
    REVIEW_MODEL,
    [
      { role: 'system', content: REFINE_PROMPT },
      {
        role: 'user',
        content: [
          `source_lang=${input.sourceLang}`,
          `target_lang=${input.targetLang}`,
          `<source>${input.source}</source>`,
          `<translation>${input.translation}</translation>`,
          `<errors>${JSON.stringify(input.errors.filter((e) => e.severity !== 'minor'))}</errors>`,
        ].join('\n'),
      },
    ],
    { temperature: 0, max_tokens: 300 },
  )
  const parsed = asRecord(extractJson(raw))
  const translation = asString(parsed?.translation)?.trim()
  return translation || undefined
}

