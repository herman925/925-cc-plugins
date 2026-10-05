// What a roster member may do with the Agent tool (subagents) and with Write, Edit and NotebookEdit, from the roster
// and the grants alone: no $, no state, so a test can call it.
//
//  - Every roster member is refused the Agent tool, unless the person allowed it (see below).
//  - A member that is somebody's boss (a head, a CEO) is refused Write, Edit and NotebookEdit, except in its own
//    memory folder, unless the person allowed it.
//  - A session that is not on the roster is never judged.
//
// The person allows in two ways: a standing switch per member (Settings: "Allow subagents", "Allow writes", kept in
// the roster file), or one turn at a time by typing #allow-subagent or #allow-write in the prompt. Only a prompt the
// person typed at the terminal counts (origin kind "composer"); a message from another session, a tool result, a
// pasted text or a plugin's own prompt never allows anything.

import type { Member } from '../types'

export const AGENT_TOOL = 'Agent'
export const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'] as const
export const KEYWORDS = { agent: '#allow-subagent', write: '#allow-write' } as const

export type Grants = { agent: boolean; write: boolean }
export const NO_GRANTS: Grants = { agent: false, write: false }

const has = (text: string, word: string) => new RegExp(`(^|\\s)${word.replace(/[-]/g, '\\-')}(?=$|[\\s.,;:!?)])`, 'i').test(text)

/**
 * The grants one prompt carries, or undefined when the prompt is not the person's own typing (it then changes
 * nothing). A later prompt of the person's replaces the grants, so a prompt without the keyword takes them back.
 */
export function grantsFrom(origin: { kind?: string } | undefined, text: string): Grants | undefined {
  if (origin?.kind !== 'composer') return undefined
  return { agent: has(text, KEYWORDS.agent), write: has(text, KEYWORDS.write) }
}

/** Somebody reports to this member. */
export const isBoss = (m: Member, list: Member[]) => list.some(x => x !== m && x.boss === m.name)

/**
 * The path is inside <dir>/projects/<project>/memory/ for one of the Claude config folders given (the person's own
 * memory folders). A path with ".." in it is never taken as inside.
 */
export function isMemoryPath(path: string, claudeDirs: string[]): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase()
  if (p.split('/').includes('..')) return false
  return claudeDirs.some(d => {
    const root = `${d.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/projects/`
    return d !== '' && p.startsWith(root) && /^[^/]+\/memory\/./.test(p.slice(root.length))
  })
}

const SEND = 'Hand the work to your worker with SendMessage, or ask Herman to authorize it.'
const SEND_ZH = '把工作用 SendMessage 交給你的 worker，或者請 Herman 授權。'

export type Verdict =
  | { kind: 'deny'; reason: string; line: string }
  | { kind: 'allow'; line: string }
  | undefined

/** The pathOf of a call: where a Write, Edit or NotebookEdit goes. */
export const pathOf = (e: Record<string, unknown>): string => String(e.file_path ?? e.notebook_path ?? '')

/** Judge one tool call of the session `me` (a roster member). undefined: nothing to say, let it through. */
export function judge(args: { me: Member; list: Member[]; tool: string; path: string; grants: Grants; claudeDirs: string[] }): Verdict {
  const { me, list, tool, path, grants, claudeDirs } = args
  if (tool === AGENT_TOOL) {
    if (me.allowAgent) return { kind: 'allow', line: `allowed Agent: ${me.name} (Allow subagents is on)` }
    if (grants.agent) return { kind: 'allow', line: `allowed Agent: ${me.name} (${KEYWORDS.agent}, this turn only)` }
    return {
      kind: 'deny',
      reason: `Blocked Agent: ${me.name} has no subagent permission. ${SEND} (Settings → Allow subagents, or ${KEYWORDS.agent} in his next message.) ${SEND_ZH}`,
      line: `blocked Agent: ${me.name} has no subagent permission`,
    }
  }
  if (!(WRITE_TOOLS as readonly string[]).includes(tool) || !isBoss(me, list)) return undefined
  if (isMemoryPath(path, claudeDirs)) return undefined
  if (me.allowWrite) return { kind: 'allow', line: `allowed ${tool}: ${me.name} (Allow writes is on)` }
  if (grants.write) return { kind: 'allow', line: `allowed ${tool}: ${me.name} (${KEYWORDS.write}, this turn only)` }
  return {
    kind: 'deny',
    reason: `Blocked ${tool}: ${me.name} has reports, so it does not write files itself (its own memory folder is open). ${SEND} (Settings → Allow writes, or ${KEYWORDS.write} in his next message.) ${SEND_ZH}`,
    line: `blocked ${tool}: ${me.name} has reports and no write permission`,
  }
}
