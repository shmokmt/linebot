import { langLabel, parseLangCode } from './detect'
import type { ConversationSettings, LangCode, LastTranslation } from './types'

export type Command =
  | { type: 'lang'; a: LangCode; b: LangCode }
  | { type: 'on' }
  | { type: 'off' }
  | { type: 'help' }
  | { type: 'glossary-add'; source: string; target: string }
  | { type: 'glossary-list' }
  | { type: 'glossary-remove'; source: string }
  | { type: 'fix'; translation: string }

const HELP_TEXT = [
  '/lang ja zh  — 言語ペアを設定 / 設定語言配對',
  '/on  /off  — 翻訳の再開・停止 / 恢復或暫停翻譯',
  '/glossary add 田中=Tanaka  — 用語登録',
  '/glossary list  — 用語一覧',
  '/glossary remove 田中  — 用語削除',
  '/fix <正しい訳>  — 直前の訳を修正して記憶',
].join('\n')

export function parseCommand(text: string): Command | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return undefined

  const [head, ...rest] = trimmed.split(/\s+/)
  const name = head.toLowerCase()
  const arg = rest.join(' ').trim()

  if (name === '/help') return { type: 'help' }
  if (name === '/on') return { type: 'on' }
  if (name === '/off') return { type: 'off' }

  if (name === '/lang') {
    const [rawA, rawB] = rest
    const a = rawA ? parseLangCode(rawA) : undefined
    const b = rawB ? parseLangCode(rawB) : undefined
    if (!a || !b || a === b) return undefined
    return { type: 'lang', a, b }
  }

  if (name === '/fix') {
    if (!arg) return undefined
    return { type: 'fix', translation: arg }
  }

  if (name === '/glossary') {
    const sub = (rest[0] ?? '').toLowerCase()
    if (sub === 'list' || rest.length === 0) return { type: 'glossary-list' }
    if (sub === 'remove') {
      const source = rest.slice(1).join(' ').trim()
      if (!source) return undefined
      return { type: 'glossary-remove', source }
    }
    if (sub === 'add') {
      const spec = rest.slice(1).join(' ')
      const split = spec.split('=')
      if (split.length < 2) return undefined
      const source = split[0].trim()
      const target = split.slice(1).join('=').trim()
      if (!source || !target) return undefined
      return { type: 'glossary-add', source, target }
    }
  }

  return undefined
}

export function applyCommand(
  command: Command,
  settings: ConversationSettings,
  last: LastTranslation | null,
): { settings: ConversationSettings; reply: string; cacheUpdate?: LastTranslation } {
  switch (command.type) {
    case 'help':
      return { settings, reply: HELP_TEXT }
    case 'on':
      return { settings: { ...settings, enabled: true }, reply: '翻訳を再開しました。/ Translation is on.' }
    case 'off':
      return { settings: { ...settings, enabled: false }, reply: '翻訳を停止しました。/on で再開します。' }
    case 'lang':
      return {
        settings: { ...settings, langA: command.a, langB: command.b, enabled: true },
        reply: `言語ペアを ${langLabel(command.a)} ↔ ${langLabel(command.b)} に設定しました。`,
      }
    case 'glossary-list': {
      if (settings.glossary.length === 0) return { settings, reply: '用語集は空です。' }
      const lines = settings.glossary.map((e) => `${e.source} = ${e.target}`).join('\n')
      return { settings, reply: lines }
    }
    case 'glossary-add': {
      const glossary = settings.glossary.filter(
        (e) => e.source !== command.source && e.target !== command.source,
      )
      glossary.push({ source: command.source, target: command.target })
      return {
        settings: { ...settings, glossary },
        reply: `用語を登録しました: ${command.source} = ${command.target}`,
      }
    }
    case 'glossary-remove': {
      const glossary = settings.glossary.filter(
        (e) => e.source !== command.source && e.target !== command.source,
      )
      return { settings: { ...settings, glossary }, reply: `用語を削除しました: ${command.source}` }
    }
    case 'fix': {
      if (!last) return { settings, reply: '直近の翻訳がありません。' }
      return {
        settings,
        reply: '翻訳メモリに保存しました。',
        cacheUpdate: { ...last, translation: command.translation },
      }
    }
  }
}

export function isCommandLike(text: string): boolean {
  return text.trim().startsWith('/')
}
