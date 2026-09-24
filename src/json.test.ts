import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractJson } from './json'
import { parseReviewResult } from './review'
import { parseTranslationResult } from './translate'
import { formatReply } from './format'

describe('extractJson', () => {
  it('parses raw and fenced JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
    assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 })
    assert.equal(extractJson('not json'), null)
  })
})

describe('parseTranslationResult', () => {
  it('reads structured output', () => {
    const result = parseTranslationResult(
      '{"source_lang":"ja","target_lang":"zh-Hant","translation":"那個要去嗎？","confidence":0.8,"flags":["ambiguous"]}',
      { sourceLang: 'ja', targetLang: 'zh-Hant', original: 'それ行く？' },
    )
    assert.equal(result.translation, '那個要去嗎？')
    assert.equal(result.confidence, 0.8)
    assert.deepEqual(result.flags, ['ambiguous'])
  })

  it('falls back when the model returns plain text', () => {
    const result = parseTranslationResult('那個要去嗎？', {
      sourceLang: 'ja',
      targetLang: 'zh-Hant',
      original: 'それ行く？',
    })
    assert.equal(result.translation, '那個要去嗎？')
    assert.ok(result.flags.includes('ambiguous'))
  })
})

describe('parseReviewResult', () => {
  it('refines only on critical or major errors', () => {
    const minor = parseReviewResult('{"errors":[{"type":"tone","severity":"minor","comment":"x"}]}')
    assert.equal(minor.needsRefine, false)
    const major = parseReviewResult(
      '{"errors":[{"type":"number","severity":"major","comment":"wrong amount"}]}',
    )
    assert.equal(major.needsRefine, true)
  })
})

describe('formatReply', () => {
  it('prefixes group replies with speaker name', () => {
    assert.equal(formatReply('那個要去嗎？', '田中', true), '🌐 [田中] 那個要去嗎？')
    assert.equal(formatReply('那個要去嗎？', undefined, true), '🌐 那個要去嗎？')
    assert.equal(formatReply('那個要去嗎？', '田中', false), '那個要去嗎？')
  })
})
