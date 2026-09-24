export const LANG_CODES = ['ja', 'zh-Hant', 'zh-Hans', 'en', 'ko'] as const
export type LangCode = (typeof LANG_CODES)[number]

export type TranslationFlag =
  | 'ambiguous'
  | 'slang'
  | 'contains_numbers'
  | 'mixed_language'
  | 'proper_nouns'

export type TranslationResult = {
  sourceLang: LangCode
  targetLang: LangCode
  translation: string
  confidence: number
  flags: TranslationFlag[]
  note?: string
}

export type ConversationSettings = {
  langA: LangCode
  langB: LangCode
  enabled: boolean
  glossary: GlossaryEntry[]
}

export type GlossaryEntry = {
  source: string
  target: string
}

export type HistoryItem = {
  userId?: string
  text: string
  translation?: string
  lang?: LangCode
  at: number
}

export type LastTranslation = {
  source: string
  translation: string
  sourceLang: LangCode
  targetLang: LangCode
}

export type Detection = {
  lang: LangCode | 'und'
  confidence: number
  method: 'script' | 'heuristic' | 'ambiguous'
}

export type Direction =
  | { skip: true; reason: string }
  | { skip: false; deferToLlm: true }
  | { skip: false; deferToLlm: false; sourceLang: LangCode; targetLang: LangCode }

export type ReviewError = {
  type: 'mistranslation' | 'omission' | 'addition' | 'number' | 'tone' | 'other'
  severity: 'critical' | 'major' | 'minor'
  comment: string
}

export type ReviewResult = {
  errors: ReviewError[]
  needsRefine: boolean
}
