import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_SETTINGS } from './constants'
import { detectLanguage, parseLangCode, resolveDirection } from './detect'

describe('detectLanguage', () => {
  it('detects Japanese from hiragana', () => {
    const d = detectLanguage('それ行く？')
    assert.equal(d.lang, 'ja')
    assert.ok(d.confidence >= 0.9)
  })

  it('detects Japanese from mixed kana and kanji', () => {
    const d = detectLanguage('最近仕事が忙しいです')
    assert.equal(d.lang, 'ja')
  })

  it('detects Traditional Chinese', () => {
    const d = detectLanguage('最近工作很忙，明天開會嗎')
    assert.equal(d.lang, 'zh-Hant')
    assert.ok(d.confidence >= 0.7)
  })

  it('detects Simplified Chinese', () => {
    const d = detectLanguage('这个东西怎么买')
    assert.equal(d.lang, 'zh-Hans')
  })

  it('detects Korean', () => {
    const d = detectLanguage('안녕하세요')
    assert.equal(d.lang, 'ko')
  })

  it('detects English', () => {
    const d = detectLanguage('See you tomorrow')
    assert.equal(d.lang, 'en')
  })

  it('treats romaji Japanese as ambiguous / low confidence', () => {
    const d = detectLanguage('arigato')
    assert.ok(d.confidence < 0.6 || d.method === 'ambiguous')
  })

  it('is uncertain on kanji-only text', () => {
    const d = detectLanguage('東京')
    assert.ok(d.confidence < 0.7 || d.method === 'ambiguous' || d.lang === 'und')
  })
})

describe('resolveDirection', () => {
  const settings = { ...DEFAULT_SETTINGS, glossary: [] }

  it('translates Japanese to the other pair language', () => {
    const dir = resolveDirection({ lang: 'ja', confidence: 0.95, method: 'script' }, settings)
    assert.equal(dir.skip, false)
    if (!dir.skip && !dir.deferToLlm) {
      assert.equal(dir.sourceLang, 'ja')
      assert.equal(dir.targetLang, 'zh-Hant')
    }
  })

  it('skips languages outside the pair', () => {
    const dir = resolveDirection({ lang: 'en', confidence: 0.9, method: 'heuristic' }, settings)
    assert.equal(dir.skip, true)
  })

  it('defers low-confidence detection to the LLM', () => {
    const dir = resolveDirection({ lang: 'und', confidence: 0.3, method: 'ambiguous' }, settings)
    assert.equal(dir.skip, false)
    if (!dir.skip) assert.equal(dir.deferToLlm, true)
  })

  it('uses speaker prior when detection is weak', () => {
    const dir = resolveDirection(
      { lang: 'und', confidence: 0.3, method: 'ambiguous' },
      settings,
      'ja',
    )
    assert.equal(dir.skip, false)
    if (!dir.skip && !dir.deferToLlm) {
      assert.equal(dir.sourceLang, 'ja')
      assert.equal(dir.targetLang, 'zh-Hant')
    }
  })
})

describe('parseLangCode', () => {
  it('normalizes aliases to zh-Hant by default', () => {
    assert.equal(parseLangCode('zh'), 'zh-Hant')
    assert.equal(parseLangCode('zh-TW'), 'zh-Hant')
    assert.equal(parseLangCode('jp'), 'ja')
  })
})
