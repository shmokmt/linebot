import type { ConversationSettings, LangCode } from './types'

export const HISTORY_LIMIT = 8
export const HISTORY_TTL_SECONDS = 60 * 60
export const CACHE_TTL_SECONDS = 60 * 60 * 24
export const SETTINGS_TTL_SECONDS = 60 * 60 * 24 * 30
export const LAST_TRANSLATION_TTL_SECONDS = 60 * 60
export const PROFILE_TTL_SECONDS = 60 * 60

export const CONFIDENCE_REVIEW_THRESHOLD = 0.7
export const DETECT_DEFER_THRESHOLD = 0.6
export const REVIEW_LENGTH_THRESHOLD = 80
export const TRANSLATE_BUDGET_MS = 2500
export const TOTAL_BUDGET_MS = 4000
export const PROFILE_TIMEOUT_MS = 800

export const DEFAULT_LANG_A: LangCode = 'ja'
export const DEFAULT_LANG_B: LangCode = 'zh-Hant'

export const DEFAULT_SETTINGS: ConversationSettings = {
  langA: DEFAULT_LANG_A,
  langB: DEFAULT_LANG_B,
  enabled: true,
  glossary: [],
}

export const TRANSLATE_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'
export const REVIEW_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'

export const PRIVACY_NOTICE = [
  'このBotはメッセージを翻訳するため外部AIに送信します。',
  '一時停止: /off  再開: /on  言語ペア: /lang ja zh  ヘルプ: /help',
  '',
  '此機器人會將訊息傳送至外部AI進行翻譯。',
  '暫停: /off  恢復: /on  語言配對: /lang ja zh  說明: /help',
].join('\n')
