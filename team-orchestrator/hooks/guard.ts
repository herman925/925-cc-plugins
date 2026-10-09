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

const SEND = 'Hand the work to your worker with SendMessage, or allow it yourself'
const SEND_ZH = '把工作用 SendMessage 交給你的 worker，或自行授權'

/**
 * Claude Code's own helper agents that a slash command starts (/statusline, the Claude Code guide): they only change
 * the person's settings or answer questions about Claude Code, so they pass the Agent guard (0.5.13, #76).
 */
export const HELPER_AGENTS = ['statusline-setup', 'claude-code-guide'] as const

export type Verdict =
  | { kind: 'deny'; reason: string; line: string }
  | { kind: 'allow'; line: string }
  | undefined

/** The pathOf of a call: where a Write, Edit or NotebookEdit goes. */
export const pathOf = (e: Record<string, unknown>): string => String(e.file_path ?? e.notebook_path ?? '')

/**
 * Judge one tool call of the session `me` (a roster member). undefined: nothing to say, let it through. subagentType is
 * the Agent call's subagent_type.
 */
export function judge(args: { me: Member; list: Member[]; tool: string; path: string; grants: Grants; claudeDirs: string[]; subagentType?: string }): Verdict {
  const { me, list, tool, path, grants, claudeDirs } = args
  if (tool === AGENT_TOOL) {
    const kind = String(args.subagentType ?? '').trim()
    if ((HELPER_AGENTS as readonly string[]).includes(kind)) return { kind: 'allow', line: `allowed Agent: ${me.name} (${kind}, a built-in Claude Code helper)` }
    if (me.allowAgent) return { kind: 'allow', line: `allowed Agent: ${me.name} (Allow subagents is on)` }
    if (grants.agent) return { kind: 'allow', line: `allowed Agent: ${me.name} (${KEYWORDS.agent}, this turn only)` }
    return {
      kind: 'deny',
      reason: `Blocked Agent: ${me.name} has no subagent permission. ${SEND} (Settings → Allow subagents, or type ${KEYWORDS.agent} in your next message). ${SEND_ZH}（設定 → Allow subagents，或在下一則訊息輸入 ${KEYWORDS.agent}）。`,
      line: `blocked Agent: ${me.name} has no subagent permission`,
    }
  }
  if (!(WRITE_TOOLS as readonly string[]).includes(tool) || !isBoss(me, list)) return undefined
  if (isMemoryPath(path, claudeDirs)) return undefined
  if (me.allowWrite) return { kind: 'allow', line: `allowed ${tool}: ${me.name} (Allow writes is on)` }
  if (grants.write) return { kind: 'allow', line: `allowed ${tool}: ${me.name} (${KEYWORDS.write}, this turn only)` }
  return {
    kind: 'deny',
    reason: `Blocked ${tool}: ${me.name} has reports, so it does not write files itself (its own memory folder is open). ${SEND} (Settings → Allow writes, or type ${KEYWORDS.write} in your next message). ${SEND_ZH}（設定 → Allow writes，或在下一則訊息輸入 ${KEYWORDS.write}）。`,
    line: `blocked ${tool}: ${me.name} has reports and no write permission`,
  }
}

// ── The team files (0.5.11, #58) ──────────────────────────────────────────────────────────────────────────────
// roster.json and settings.json in .claude/team-orchestrator/ carry every member's rights (Allow writes, Allow
// subagents) and the team's settings (auto-approve, the session cap). Only the mod's own code (it writes through
// $.fs, not a tool), sessions that are not on the roster (the person's own) and the team top (boss "user") may change
// them. Every other member is refused Write, Edit and NotebookEdit on them, and any Bash or PowerShell command that
// names them and is not plainly read-only. From 0.5.12 (#59) the same holds for meta.json (the schema stamp) and the
// change files in changes/, which the top folds into the roster: a forged change file would be a forged roster.
// roles/ and queue/ stay writable; status files live on each machine, outside the project.

export const SHELL_TOOLS = ['Bash', 'PowerShell'] as const

// one path segment as Windows reads it: no alternate stream (":$DATA"), no trailing dots or spaces
const plain = (s: string) => s.replace(/:.*$/, '').replace(/[. ]+$/, '')
const TEAM_DIR = /^(team-orchestrator|team-o~\d+)$/
const TEAM_FILE = /^(roster\.json|settings\.json|meta\.json|roster~\d+\.jso|settin~\d+\.jso|meta~\d+\.jso)$/
const CHANGES_DIR = /^(changes|change~\d+)$/

/**
 * The path is .claude/team-orchestrator/roster.json, settings.json or meta.json, or a file in its changes/ folder (any
 * root; "." and ".." folded; 8.3 names too).
 */
export function isTeamFilePath(path: string): boolean {
  const segs: string[] = []
  for (const s of path.replace(/\\/g, '/').toLowerCase().split('/')) {
    if (s === '' || s === '.') continue
    if (s === '..') segs.pop()
    else segs.push(s)
  }
  const n = segs.length
  if (n >= 3 && CHANGES_DIR.test(plain(segs[n - 2] as string)) && TEAM_DIR.test(plain(segs[n - 3] as string))) return true
  return n >= 2 && TEAM_FILE.test(plain(segs[n - 1] as string)) && TEAM_DIR.test(plain(segs[n - 2] as string))
}

/**
 * The command names a team file: roster.json anywhere; settings.json beside the team folder's name or bare (the shell
 * may stand in the team folder); or the team folder with a wildcard, a variable or a substitution (the target is
 * then unknowable). Best effort: a name built at run time is not seen.
 */
export function namesTeamFile(command: string): boolean {
  const c = command.replace(/\\/g, '/').toLowerCase()
  const dir = /team-orchestrator|team-o~\d/.test(c)
  if (/roster(\.json|~\d)/.test(c)) return true
  if (/(team-orchestrator|team-o~\d)\/+(changes|change~\d)\b/.test(c)) return true
  if (dir && /meta(\.json|~\d)/.test(c)) return true
  if (/settin(gs\.json|~\d)/.test(c) && (dir || /(^|[\s'"=(,;|&<>])settings\.json/.test(c))) return true
  return dir && /[*?[\]{}$`]/.test(c)
}

const READERS = /^(cat|type|get-content|gc|ls|dir|get-childitem|gci|grep|select-string|sls|jq)$/
// a redirect that only drops output or merges stderr writes nothing
const HARMLESS = /\d?>>?\s*(&\d|\/dev\/null|\$null|nul)(?=$|[\s;|&)])/gi

/** Why the command is not plainly read-only, or '' when it is: only cat, type, Get-Content, ls, dir, grep, Select-String or jq (without -i). */
export function notReadOnly(command: string): string {
  if (/`|\$\(|\$\{|<\(|>\(/.test(command)) return 'it runs a substitution, so what it does is unclear'
  // quoted text is an argument (a jq filter, a grep pattern), never a redirect or a second command
  const c = command.replace(/'[^']*'|"[^"]*"/g, ' Q ').replace(HARMLESS, ' ')
  if (/['"]/.test(c)) return 'its quoting is unbalanced, so what it does is unclear'
  if (/>/.test(c)) return 'it redirects output into a file'
  const parts = c.replace(/<\s*\S+/g, ' ').split(/&&|\|\||[;|&\n\r]/).map(p => p.trim()).filter(p => p !== '')
  if (parts.length === 0) return 'it is empty'
  for (const p of parts) {
    const w = p.split(/\s+/)
    const first = (w[0] ?? '').toLowerCase()
    if (!READERS.test(first)) return `it runs "${first}", which is not a plain read (cat, type, Get-Content, ls, dir, grep, Select-String, jq)`
    if (first === 'jq' && w.some(x => x === '--in-place' || /^-[a-z]*i[a-z]*$/i.test(x))) return 'it runs jq -i, which writes in place'
  }
  return ''
}

const LOCKED = '.claude/team-orchestrator/roster.json, settings.json, meta.json and changes/'

/**
 * Judge one call against the team files. `confirmed` is false for a held session, which is locked whatever its boss.
 * undefined: the call does not touch them, or this member may (the team top).
 */
export function judgeTeamFiles(args: { me: Member; confirmed: boolean; tool: string; path: string; command: string }): Verdict {
  const { me, confirmed, tool, path, command } = args
  if (confirmed && me.boss === 'user') return undefined
  const who = `${me.name}${confirmed ? '' : ' (on hold)'}`
  const tail = `Only the team top and the Team Orchestrator itself change ${LOCKED}; ask the team top, or the user (Settings in the Team Orchestrator panel).`
  if ((WRITE_TOOLS as readonly string[]).includes(tool)) {
    if (!isTeamFilePath(path)) return undefined
    return { kind: 'deny', reason: `Blocked ${tool}: ${who} may not change the team file ${path}. ${tail}`, line: `blocked ${tool}: ${me.name} on a team file` }
  }
  if (!(SHELL_TOOLS as readonly string[]).includes(tool) || !namesTeamFile(command)) return undefined
  const why = notReadOnly(command)
  if (why === '') return undefined
  return {
    kind: 'deny',
    reason: `Blocked ${tool}: this command names a team file (${LOCKED}) and is not plainly read-only: ${why}. ${who} may only read them (cat, type, Get-Content, ls, dir, grep, Select-String, jq without -i), one plain command at a time. ${tail}`,
    line: `blocked ${tool}: ${me.name} on a team file`,
  }
}

// ── Grants changed outside the mod (0.5.11, #58) ──
// What the mod last wrote for each member's Allow writes and Allow subagents is recorded beside the roster; the team
// top's refresh compares the file with it and reports a difference. Nothing is reverted.

export type GrantMap = Record<string, { agent: boolean; write: boolean }>

/** team|name → the two standing switches, from roster rows. */
export const grantMap = (rows: Partial<Member>[]): GrantMap =>
  Object.fromEntries(rows.filter(r => typeof r?.name === 'string').map(r => [`${r.team ?? ''}|${r.name}`, { agent: r.allowAgent === true, write: r.allowWrite === true }]))

const same = (a?: { agent: boolean; write: boolean }, b?: { agent: boolean; write: boolean }) => !!a && !!b && a.agent === b.agent && a.write === b.write

/**
 * The record after the mod writes the roster. A member whose switches this write changed (or that is new) is recorded
 * as written; one the write left as the file had it keeps its earlier record, so a change somebody else made to the
 * file, pulled in and written back unchanged, is not taken as the mod's.
 */
export function recordAfterWrite(prev: GrantMap | undefined, before: GrantMap, written: GrantMap): GrantMap {
  const out: GrantMap = {}
  for (const [k, v] of Object.entries(written)) out[k] = same(before[k], v) && prev?.[k] ? (prev[k] as GrantMap[string]) : v
  return out
}

/** The members whose switches in the file differ from what the mod last wrote, with the rights in words. */
export function grantChanges(recorded: GrantMap, file: GrantMap): { key: string; name: string; changes: string[] }[] {
  const out: { key: string; name: string; changes: string[] }[] = []
  for (const [k, v] of Object.entries(file)) {
    const r = recorded[k]
    if (!r || same(r, v)) continue
    const changes: string[] = []
    if (r.write !== v.write) changes.push(`Allow writes ${v.write ? 'on' : 'off'}`)
    if (r.agent !== v.agent) changes.push(`Allow subagents ${v.agent ? 'on' : 'off'}`)
    out.push({ key: k, name: k.slice(k.indexOf('|') + 1), changes })
  }
  return out
}
