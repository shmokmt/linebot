import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyCommand, parseCommand } from './commands'
import { DEFAULT_SETTINGS } from './constants'

describe('parseCommand', () => {
  it('parses language pair aliases', () => {
    assert.deepEqual(parseCommand('/lang ja en'), { type: 'lang', a: 'ja', b: 'en' })
    assert.deepEqual(parseCommand('/lang ja zh'), { type: 'lang', a: 'ja', b: 'zh-Hant' })
  })

  it('rejects identical pair or missing args', () => {
    assert.equal(parseCommand('/lang ja ja'), undefined)
    assert.equal(parseCommand('/lang ja'), undefined)
  })

  it('parses on/off/help', () => {
    assert.deepEqual(parseCommand('/off'), { type: 'off' })
    assert.deepEqual(parseCommand('/on'), { type: 'on' })
    assert.deepEqual(parseCommand('/help'), { type: 'help' })
  })

  it('parses glossary add/remove/list', () => {
    assert.deepEqual(parseCommand('/glossary add 田中=Tanaka'), {
      type: 'glossary-add',
      source: '田中',
      target: 'Tanaka',
    })
    assert.deepEqual(parseCommand('/glossary remove 田中'), {
      type: 'glossary-remove',
      source: '田中',
    })
    assert.deepEqual(parseCommand('/glossary list'), { type: 'glossary-list' })
  })

  it('parses /fix', () => {
    assert.deepEqual(parseCommand('/fix 那個要去嗎？'), { type: 'fix', translation: '那個要去嗎？' })
    assert.equal(parseCommand('/fix'), undefined)
  })

  it('ignores normal messages', () => {
    assert.equal(parseCommand('それ行く？'), undefined)
  })
})

describe('applyCommand', () => {
  it('toggles enabled and sets language pair', () => {
    const off = applyCommand({ type: 'off' }, { ...DEFAULT_SETTINGS, glossary: [] }, null)
    assert.equal(off.settings.enabled, false)
    const lang = applyCommand({ type: 'lang', a: 'ja', b: 'en' }, off.settings, null)
    assert.equal(lang.settings.langB, 'en')
    assert.equal(lang.settings.enabled, true)
  })

  it('adds glossary entries', () => {
    const added = applyCommand(
      { type: 'glossary-add', source: '田中', target: 'Tanaka' },
      { ...DEFAULT_SETTINGS, glossary: [] },
      null,
    )
    assert.deepEqual(added.settings.glossary, [{ source: '田中', target: 'Tanaka' }])
  })

  it('stores /fix into translation memory when last exists', () => {
    const last = {
      source: 'それ行く？',
      translation: 'wrong',
      sourceLang: 'ja' as const,
      targetLang: 'zh-Hant' as const,
    }
    const fixed = applyCommand({ type: 'fix', translation: '那個要去嗎？' }, { ...DEFAULT_SETTINGS, glossary: [] }, last)
    assert.equal(fixed.cacheUpdate?.translation, '那個要去嗎？')
  })
})
