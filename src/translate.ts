// Cloudflare Workers AI のモデル一覧: https://developers.cloudflare.com/workers-ai/models/
// 別モデルに差し替えたい場合はここを変更する。
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const

const SYSTEM_PROMPT = `あなたは日本語と台湾華語(繁体字中文、台湾で使われる言葉遣い)の翻訳を行う翻訳botです。
- 入力が台湾華語の場合は日本語に翻訳してください。
- 入力が日本語の場合は台湾華語(繁体字、台湾表現)に翻訳してください。
- 翻訳結果のテキストのみを出力してください。説明、注釈、原文の引用、前置きや後書きは一切不要です。`

/** テキストを日本語⇔台湾華語の一方向へ翻訳する(方向はモデル自身に判定させる)。 */
export async function translate(ai: Ai, text: string): Promise<string> {
  const response = await ai.run(MODEL, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  })

  if (typeof response === 'object' && response !== null && 'response' in response) {
    return (response.response ?? '').trim()
  }
  return ''
}
