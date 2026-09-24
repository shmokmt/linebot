import { DETECT_DEFER_THRESHOLD } from './constants'
import type { ConversationSettings, Detection, Direction, LangCode } from './types'

const HIRAGANA = /\p{Script=Hiragana}/u
const KATAKANA = /\p{Script=Katakana}/u
const HAN = /\p{Script=Han}/u
const HANGUL = /\p{Script=Hangul}/u
const LATIN = /\p{Script=Latin}/u

// 繁体字に偏る字形 / 簡体字に偏る字形。短文の漢字のみ判定用。
const TRADITIONAL_MARKERS = /[個語這過時後點東買為學國麼開關對來們說嗎麼體發經會現們條]/u
const SIMPLIFIED_MARKERS = /[个语这过时后点东买为学国么开关对来们说吗体发经会现们条]/u

const JA_PARTICLES = /[はをにのがですますだよしてけど]/u
const ZH_PARTICLES = /[的了是在嗎吧呢我你他這那嗎]/u

const ROMAJI_HINTS = /\b(desu|masu|arigato|konnichiwa|nani|kawaii|sugoi|onegaishimasu|doko|ima)\b/i

export const LANG_ALIASES: Record<string, LangCode> = {
  ja: 'ja',
  jp: 'ja',
  'zh-hant': 'zh-Hant',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  zh: 'zh-Hant',
  tw: 'zh-Hant',
  hant: 'zh-Hant',
  'zh-hans': 'zh-Hans',
  'zh-cn': 'zh-Hans',
  cn: 'zh-Hans',
  hans: 'zh-Hans',
  en: 'en',
  eng: 'en',
  ko: 'ko',
  kr: 'ko',
  kor: 'ko',
}

export function parseLangCode(input: string): LangCode | undefined {
  return LANG_ALIASES[input.trim().toLowerCase()]
}

export function isZh(lang: string): boolean {
  return lang === 'zh-Hant' || lang === 'zh-Hans' || lang === 'zh'
}

export function samePairSide(a: string, b: LangCode): boolean {
  if (a === b) return true
  return isZh(a) && isZh(b)
}

export function langLabel(lang: LangCode): string {
  switch (lang) {
    case 'ja':
      return '日本語'
    case 'zh-Hant':
      return '台湾華語(繁体字)'
    case 'zh-Hans':
      return '簡体字中国語'
    case 'en':
      return 'English'
    case 'ko':
      return '한국어'
  }
}

function count(text: string, re: RegExp): number {
  return (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? [])
    .length
}

function letterRatio(text: string, re: RegExp): number {
  const letters = text.replace(/\s+/g, '')
  if (letters.length === 0) return 0
  return count(letters, re) / letters.length
}

/** 文字種ルール + 助詞ヒューリスティック。lingua 等が使えない Workers 向け。 */
export function detectLanguage(text: string): Detection {
  const compact = text.replace(/\s+/g, '')
  if (!compact) return { lang: 'und', confidence: 0, method: 'ambiguous' }

  const kana = letterRatio(text, HIRAGANA) + letterRatio(text, KATAKANA)
  const han = letterRatio(text, HAN)
  const hangul = letterRatio(text, HANGUL)
  const latin = letterRatio(text, LATIN)

  if (hangul >= 0.3) {
    return { lang: 'ko', confidence: 0.95, method: 'script' }
  }

  if (kana >= 0.08 || (HIRAGANA.test(text) && han > 0)) {
    return { lang: 'ja', confidence: 0.95, method: 'script' }
  }

  if (KATAKANA.test(text) && !HAN.test(text) && latin < 0.5) {
    return { lang: 'ja', confidence: 0.9, method: 'script' }
  }

  if (han >= 0.4) {
    const trad = count(text, TRADITIONAL_MARKERS)
    const simp = count(text, SIMPLIFIED_MARKERS)
    const jaHint = JA_PARTICLES.test(text)
    const zhHint = ZH_PARTICLES.test(text)

    if (kana > 0) {
      return { lang: 'ja', confidence: 0.92, method: 'script' }
    }
    if (trad > simp + 1) {
      return { lang: 'zh-Hant', confidence: 0.88, method: 'heuristic' }
    }
    if (simp > trad + 1) {
      return { lang: 'zh-Hans', confidence: 0.88, method: 'heuristic' }
    }
    if (zhHint && !jaHint) {
      return { lang: 'zh-Hant', confidence: 0.78, method: 'heuristic' }
    }
    if (jaHint && !zhHint) {
      return { lang: 'ja', confidence: 0.62, method: 'heuristic' }
    }
    return { lang: 'und', confidence: 0.4, method: 'ambiguous' }
  }

  if (latin >= 0.7) {
    if (ROMAJI_HINTS.test(text)) {
      return { lang: 'ja', confidence: 0.4, method: 'ambiguous' }
    }
    return { lang: 'en', confidence: 0.72, method: 'heuristic' }
  }

  return { lang: 'und', confidence: 0.2, method: 'ambiguous' }
}

export function inLanguagePair(lang: string, settings: ConversationSettings): boolean {
  return samePairSide(lang, settings.langA) || samePairSide(lang, settings.langB)
}

export function otherLang(lang: string, settings: ConversationSettings): LangCode {
  return samePairSide(lang, settings.langA) ? settings.langB : settings.langA
}

/**
 * 検出結果とグループ言語ペアから翻訳方向を決める。
 * 確信度が低い・混在が疑われる場合は翻訳と同じ呼び出しに判定を委譲する。
 */
export function resolveDirection(
  detection: Detection,
  settings: ConversationSettings,
  speakerPrior?: LangCode,
): Direction {
  if (detection.confidence < DETECT_DEFER_THRESHOLD || detection.method === 'ambiguous') {
    if (speakerPrior && inLanguagePair(speakerPrior, settings) && detection.confidence < 0.45) {
      return {
        skip: false,
        deferToLlm: false,
        sourceLang: speakerPrior,
        targetLang: otherLang(speakerPrior, settings),
      }
    }
    return { skip: false, deferToLlm: true }
  }

  if (detection.lang === 'und') {
    return { skip: false, deferToLlm: true }
  }

  if (!inLanguagePair(detection.lang, settings)) {
    return { skip: true, reason: `language ${detection.lang} is outside the configured pair` }
  }

  return {
    skip: false,
    deferToLlm: false,
    sourceLang: samePairSide(detection.lang, settings.langA) ? settings.langA : settings.langB,
    targetLang: otherLang(detection.lang, settings),
  }
}
