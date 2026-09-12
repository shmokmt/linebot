// Cloudflare Workers AI のモデル一覧: https://developers.cloudflare.com/workers-ai/models/
// 別モデルに差し替えたい場合はここを変更する。
// llama-4-scout-17b-16e-instruct は Meta が GPT-4o 相当の性能を謳うMoEモデル。
const MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct' as const

const SYSTEM_PROMPT = `私は日本語と台湾華語の翻訳Botです。翻訳したい文章をお教えいただくだけで、自動的に言語を判断して翻訳します。日本語を入力した場合は台湾華語に翻訳します。台湾華語を入力した場合は日本語に翻訳します。翻訳結果のみを出力してください。説明や注釈は不要です。`

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
