// Event-driven member status. Each session writes only its own small status file (status/<name>.json inside
// .claude/team-orchestrator/), on turn start and end, when it asks the person something, and on a 60 s heartbeat while
// it works. Nobody reads other members' terminal screens, so Orca is not asked about every member on every refresh.
//
// The team top also decides, from these files alone, which idle workers to close and whether a message to a closed
// worker can reopen it now or must wait (the session cap). Pure rules from data (no $), so a test can call them.

import type { Member } from '../types'

export type Status = {
  name: string
  sessionId: string
  /** working | idle | asking | offline | closed */
  state: string
  turnStart?: number
  turnEnd?: number
  heartbeat: number
  model?: string
  effort?: string
  /** context used, percent */
  ctx?: number
  /** what the member is on now: the Clean View step, else the first line of the last order from its boss */
  task?: string
  /** when it last told its boss "clean" */
  lastClean?: number
  /** its own leftover shells and runtimes at the last count, -1 when the count could not be made */
  leftover?: number
  countedAt?: number
}

/** Team-wide settings for worker auto-close, kept in .claude/team-orchestrator/settings.json. */
export type TeamSettings = {
  autoClose: boolean
  /** minutes idle after "clean" before a worker is closed */
  idleMinutes: number
  /** members never closed, besides anyone with reports */
  exempt: string[]
  /** reopen with claude --resume (keeps context) or fresh (briefed again) */
  reopen: 'resume' | 'fresh'
  /** most sessions open at once; 0 = no cap */
  maxOpen: number
  /** at Create: start only the top and the team heads under it (the rest on their first message), or everyone */
  launch: 'demand' | 'all'
  /** sessions started at once at Create; the next batch waits until these are ready and briefed */
  batch: number
}

export const TEAM_SETTINGS0: TeamSettings = { autoClose: true, idleMinutes: 10, exempt: [], reopen: 'resume', maxOpen: 8, launch: 'demand', batch: 3 }

export const MIN = 60_000
/** a member with no write for this long shows as offline */
export const STALE_MS = 5 * MIN
/** the tab check runs only when some heartbeat is older than this */
export const CHECK_AFTER_MS = 2 * MIN
/** at most one leftover-process count per member per this long */
export const COUNT_EVERY_MS = 5 * MIN

/** A file-safe name for a member's status file. */
export const statusFile = (name: string) => `status/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.json`

/** The state to show: a silent member is offline; a closed one stays closed. */
export const shownState = (s: Status | undefined, now: number) =>
  !s ? undefined : s.state === 'closed' ? 'closed' : now - s.heartbeat > STALE_MS ? 'offline' : s.state

/** Whether the tab check is worth an Orca call: some open member has been silent for over two minutes. */
export const needsTabCheck = (statuses: (Status | undefined)[], now: number) =>
  statuses.some(s => s && s.state !== 'closed' && now - s.heartbeat > CHECK_AFTER_MS)

/** The next tab-check interval: doubled while Orca answers slowly (over 500 ms), back to the base when it is fast. */
export const nextCheckInterval = (current: number, tookMs: number, base = 2 * MIN, cap = 10 * MIN) =>
  tookMs > 500 ? Math.min(cap, Math.max(base, current) * 2) : base

const hasReports = (m: Member, list: Member[]) => list.some(x => x !== m && x.boss === m.name)

/** When a member went idle: after its last turn end or its last "clean", whichever is later. */
const idleSince = (s: Status) => Math.max(s.turnEnd ?? 0, s.lastClean ?? 0)

/** Workers that may be closed: no reports, not exempt, idle, said "clean", and idle for the set minutes. */
export function toClose(list: Member[], statuses: Map<string, Status>, t: TeamSettings, now: number): Member[] {
  if (!t.autoClose) return []
  return list.filter(m => {
    const s = statuses.get(m.name)
    return (
      !!s &&
      !hasReports(m, list) &&
      !t.exempt.includes(m.name) &&
      shownState(s, now) === 'idle' &&
      !!s.lastClean &&
      now - idleSince(s) >= t.idleMinutes * MIN
    )
  })
}

/** How many sessions are open: members whose state is neither offline nor closed. */
export const openCount = (statuses: Map<string, Status>, now: number) =>
  [...statuses.values()].filter(s => !['offline', 'closed'].includes(shownState(s, now) ?? 'offline')).length

export type Admit = { kind: 'open' } | { kind: 'evict'; name: string } | { kind: 'queue' }

/**
 * Whether a closed member can reopen now: under the cap it opens; at the cap the longest-idle closable worker makes
 * room; with no worker to close, the message waits in the queue.
 */
export function admit(list: Member[], statuses: Map<string, Status>, t: TeamSettings, now: number): Admit {
  if (t.maxOpen <= 0 || openCount(statuses, now) < t.maxOpen) return { kind: 'open' }
  const idle = list
    .filter(m => !hasReports(m, list) && !t.exempt.includes(m.name) && shownState(statuses.get(m.name), now) === 'idle')
    .sort((a, b) => idleSince(statuses.get(a.name)!) - idleSince(statuses.get(b.name)!))
  return idle.length ? { kind: 'evict', name: idle[0]!.name } : { kind: 'queue' }
}

/** One short line for the task field. */
export const taskLine = (text: string) => text.trim().split(/\r?\n/)[0]!.slice(0, 120)

/**
 * Who starts at Create when the rest start on demand: the top (boss "user") and, under a CEO, each team's head (a
 * report of the top in another team). Leads and workers start the first time someone messages them.
 */
export const startsAtCreate = (m: Member, list: Member[]) =>
  m.boss === 'user' || list.some(t => t.boss === 'user' && t.name === m.boss && t.team !== m.team)

/** xs in groups of n (n below 1 counts as 1). */
export const chunk = <T>(xs: T[], n: number): T[][] => {
  const size = Math.max(1, Math.floor(n) || 1)
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/**
 * The "name [ref]" of the session on this machine named name, from a ListAgents listing, or '' when there is none.
 * Remote Control mirrors of old sessions often share a member's name, and then the bare name is ambiguous.
 */
export const localRef = (listing: string, name: string) => {
  for (const line of listing.split(/\r?\n/)) {
    const m = line.match(/^\s*(.+?) \[([0-9a-f]+)\]\s+·\s+interactive\b/)
    if (m && m[1] === name) return `${name} [${m[2]}]`
  }
  return ''
}
