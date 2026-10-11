// The open assumptions of each member (#89), read from its Session Panel's file. This mod only reads them: a confirm or
// a wrong goes to the member as one team message, and the member's own Session Panel changes its own file. A file is
// matched to its member by the sessionId inside it, since a tagged name (<id>-<hash>.json) can also exist.

export const ASSUMPTIONS_DIR = '.claude/session-panel/assumptions'

export type OpenAssumption = { id: string; text: string; kind: string; turn: number }

/** The open entries of one file and the session it belongs to; undefined when the text is not an assumptions file. */
export function openFrom(text: string): { sessionId: string; entries: OpenAssumption[] } | undefined {
  let v: any
  try {
    v = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.sessionId !== 'string' || !Array.isArray(v.entries)) return undefined
  const entries = v.entries
    .filter((e: any) => e && typeof e === 'object' && e.status === 'open' && typeof e.id === 'string' && typeof e.text === 'string')
    .map((e: any) => ({ id: e.id, text: e.text, kind: String(e.kind ?? ''), turn: Number(e.turn ?? 0) }))
  return { sessionId: v.sessionId, entries }
}

/** The open entries by session id over the given file texts. A text that does not read is skipped; an entry in two files counts once. */
export function collectOpen(texts: string[]): Record<string, OpenAssumption[]> {
  const out: Record<string, OpenAssumption[]> = {}
  for (const t of texts) {
    const f = openFrom(t)
    if (!f || f.sessionId === '') continue
    const have = out[f.sessionId] ?? []
    for (const e of f.entries) if (!have.some(h => h.id === e.id)) have.push(e)
    out[f.sessionId] = have
  }
  return out
}

/** The one line a confirm sends to the member. The Session Panel reads it inside the team message (0.3.3). */
export const confirmLine = (id: string) => `SESSION-PANEL: confirm ${id}`
/** The one line a wrong sends to the member. */
export const wrongLine = (id: string) => `SESSION-PANEL: wrong ${id}`
