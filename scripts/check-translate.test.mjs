import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cleanTranslation, detectSourceLanguage, toTaiwanMandarin } from '../src/translate.ts'

describe('detectSourceLanguage', () => {
  it('treats kana or Japanese endings as Japanese', () => {
    assert.equal(detectSourceLanguage('今日は仕事が忙しいです'), 'ja')
    assert.equal(detectSourceLanguage('コンビニで弁当を買った'), 'ja')
    assert.equal(detectSourceLanguage('カタカナだけ'), 'ja')
    assert.equal(detectSourceLanguage('あなたは何のLLMモデルですか'), 'ja')
  })

  it('treats simplified-only characters or Chinese particles as Chinese', () => {
    assert.equal(detectSourceLanguage('这是什么'), 'zh')
    assert.equal(detectSourceLanguage('你好嗎'), 'zh')
    assert.equal(detectSourceLanguage('先這樣吧'), 'zh')
    assert.equal(detectSourceLanguage('好喔'), 'zh')
  })

  it('uses tinyld for longer undetermined CJK, but not short or Latin text', () => {
    assert.equal(detectSourceLanguage('最近工作很忙'), 'zh')
    assert.equal(detectSourceLanguage('我在超商買了便當'), 'zh')
    assert.equal(detectSourceLanguage('大丈夫'), 'ja')
    assert.equal(detectSourceLanguage('沒問題'), 'zh')
    assert.equal(detectSourceLanguage('了解'), 'unknown')
    assert.equal(detectSourceLanguage('確認'), 'unknown')
    assert.equal(detectSourceLanguage('你好'), 'unknown')
    assert.equal(detectSourceLanguage('OK'), 'unknown')
    assert.equal(detectSourceLanguage('LLM'), 'unknown')
  })
})

describe('cleanTranslation', () => {
  it('strips wrappers, labels, and matching quotes', () => {
    assert.equal(cleanTranslation('  <text>今天工作很忙</text>  '), '今天工作很忙')
    assert.equal(cleanTranslation('翻訳: 今日は忙しい'), '今日は忙しい')
    assert.equal(cleanTranslation('翻譯結果：最近工作很忙'), '最近工作很忙')
    assert.equal(cleanTranslation('"今天工作很忙"'), '今天工作很忙')
    assert.equal(cleanTranslation('「今日は忙しい」'), '今日は忙しい')
    assert.equal(cleanTranslation('```\n今天工作很忙\n```'), '今天工作很忙')
  })
})

describe('toTaiwanMandarin', () => {
  it('rewrites Mainland terms and simplified characters', () => {
    assert.equal(toTaiwanMandarin('我坐出租车去地铁站'), '我坐計程車去捷運站')
    assert.equal(toTaiwanMandarin('这个软件的默认设置'), '這個軟體的預設設定')
    assert.equal(toTaiwanMandarin('请在服务器上搜索视频'), '請在伺服器上搜尋影片')
  })
})
