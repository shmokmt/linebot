import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { containsSensitiveEntities, isFormulaic, isNoOpTranslation, shouldReview } from './preprocess'

describe('isFormulaic', () => {
  it('skips chat interjections', () => {
    assert.equal(isFormulaic('w'), true)
    assert.equal(isFormulaic('www'), true)
    assert.equal(isFormulaic('笑'), true)
    assert.equal(isFormulaic('ok'), true)
    assert.equal(isFormulaic('了解'), true)
    assert.equal(isFormulaic('哈哈'), true)
  })

  it('does not skip real sentences', () => {
    assert.equal(isFormulaic('了解しました、明日行きます'), false)
    assert.equal(isFormulaic('ok, see you at 3'), false)
  })
})

describe('containsSensitiveEntities', () => {
  it('detects numbers, money, and dates', () => {
    assert.equal(containsSensitiveEntities('3時に集合'), true)
    assert.equal(containsSensitiveEntities('500円'), true)
    assert.equal(containsSensitiveEntities('明日会える？'), true)
    assert.equal(containsSensitiveEntities('それ行く？'), false)
  })
})

describe('shouldReview', () => {
  it('reviews low confidence', () => {
    assert.equal(shouldReview({ text: 'hi', confidence: 0.4, flags: [] }).review, true)
  })

  it('reviews ambiguous or numeric flags', () => {
    assert.equal(shouldReview({ text: 'それ', confidence: 0.9, flags: ['ambiguous'] }).review, true)
    assert.equal(shouldReview({ text: 'hello', confidence: 0.9, flags: ['contains_numbers'] }).review, true)
  })

  it('reviews long text', () => {
    const text = 'あ'.repeat(80)
    assert.equal(shouldReview({ text, confidence: 0.95, flags: [] }).review, true)
  })

  it('skips review for high-confidence short chat', () => {
    assert.equal(shouldReview({ text: 'それ行く？', confidence: 0.92, flags: [] }).review, false)
  })
})

describe('isNoOpTranslation', () => {
  it('treats identical normalized text as no-op', () => {
    assert.equal(isNoOpTranslation('OK', 'ok'), true)
    assert.equal(isNoOpTranslation('それ行く？', '那個要去嗎？'), false)
  })
})
