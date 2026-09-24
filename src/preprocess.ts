import { CONFIDENCE_REVIEW_THRESHOLD, REVIEW_LENGTH_THRESHOLD } from './constants'
import type { TranslationFlag } from './types'

const PICTOGRAPHIC_REGEX = new RegExp('\\p{Extended_Pictographic}|\\uFE0F|\\u200D', 'gu')

const FORMULAIC = new Set(
  [
    'w',
    'ww',
    'www',
    'wwww',
    'wwwww',
    'ｗ',
    'ｗｗ',
    'ｗｗｗ',
    '笑',
    '草',
    'www',
    'ok',
    'okay',
    'おけ',
    'おけおけ',
    '了解',
    'りょ',
    'よし',
    'うん',
    'うむ',
    '嗯',
    '喔',
    '哦',
    '啊',
    '哈哈',
    '讚',
    '赞',
    'haha',
    'lol',
    'lmao',
    'yes',
    'no',
    'yeah',
    'yep',
    'nope',
    'thx',
    'thanks',
    'gdgd',
    'gk',
    'wwwww',
  ].map(normalizeKey),
)

const NUMBER_RE = /\d/
const MONEY_RE = /[¥$€£円元萬万NT\$]|円|ドル|usd|twd/i
const DATE_RE =
  /\d{1,4}[/\-.年]\d{1,2}([/\-.月]\d{0,2})?|[今明昨後][日天]|明天|昨天|後天|后天|今天/
const ADDRESS_RE = /[都道府県市区町村縣路街丁目巷弄號号]/

export function normalizeKey(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase()
}

export function normalizeForCache(text: string): string {
  const nfkc = text.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return /[\p{Script=Latin}]/u.test(nfkc) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(nfkc)
    ? nfkc.toLowerCase()
    : nfkc
}

export function isFormulaic(text: string): boolean {
  return FORMULAIC.has(normalizeKey(text.replace(PICTOGRAPHIC_REGEX, '')))
}

export function containsSensitiveEntities(text: string): boolean {
  return NUMBER_RE.test(text) || MONEY_RE.test(text) || DATE_RE.test(text) || ADDRESS_RE.test(text)
}

export function inferFlags(text: string, modelFlags: TranslationFlag[] = []): TranslationFlag[] {
  const flags = new Set<TranslationFlag>(modelFlags)
  if (containsSensitiveEntities(text)) flags.add('contains_numbers')
  return [...flags]
}

export function shouldReview(input: {
  text: string
  confidence: number
  flags: readonly string[]
}): { review: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (input.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
    reasons.push('low_confidence')
  }
  if (input.flags.includes('ambiguous') || input.flags.includes('contains_numbers')) {
    reasons.push('model_flags')
  }
  if (containsSensitiveEntities(input.text)) {
    reasons.push('sensitive_entities')
  }
  if ([...input.text].length >= REVIEW_LENGTH_THRESHOLD) {
    reasons.push('long_text')
  }
  return { review: reasons.length > 0, reasons }
}

export function isNoOpTranslation(source: string, translation: string): boolean {
  return normalizeForCache(source) === normalizeForCache(translation)
}
