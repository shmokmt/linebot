export function formatReply(translation: string, displayName: string | undefined, isGroup: boolean): string {
  if (!isGroup) return translation
  if (displayName) return `🌐 [${displayName}] ${translation}`
  return `🌐 ${translation}`
}
