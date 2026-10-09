// Event-driven member status. Each session writes only its own small status file (status/<name>.json inside
// .claude/team-orchestrator/), on turn start and end, when it asks the person something, and on a 60 s heartbeat while
// it works. Nobody reads other members' terminal screens, so Orca is not asked about every member on every refresh.
//
// The team top also decides, from these files alone, which idle workers to close and whether a message to a closed
// worker can reopen it now or must wait (the session cap). Pure rules from data (no $), so a test can call them.

import type { Member } from '../types'
import { isAway } from './changes'

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
  /** the session's live context window in tokens, from $.session.usage().context.window (0.5.13, #63) */
  window?: number
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
  /** deletes of a member's own scratch are approved without asking (platform.ts) */
  autoScratch: boolean
  /** the project's scratch folder, relative to the project; heads and leads may clean it without asking */
  scratchDir: string
}

export const TEAM_SETTINGS0: TeamSettings = { autoClose: true, idleMinutes: 10, exempt: [], reopen: 'resume', maxOpen: 8, launch: 'demand', batch: 3, autoScratch: true, scratchDir: '.claude/scratch' }

export const MIN = 60_000
/** a member with no write for this long shows as offline */
export const STALE_MS = 5 * MIN
/** the tab check runs only when some heartbeat is older than this */
export const CHECK_AFTER_MS = 2 * MIN
/** at most one leftover-process count per member per this long */
export const COUNT_EVERY_MS = 5 * MIN

/** A file-safe name for a member's status file. */
export const statusFile = (name: string) => `status/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.json`

/** A member's role file, beside its status file: roles/<name>.md (read by the member through its start-up pointer). */
export const roleFile = (name: string) => `roles/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.md`

// ── Sleep-aware clocks (0.5.16, #71) ──
// A session's 30 s round notes the time of each tick. A gap more than three minutes beyond the interval is time the
// machine slept (or the session hung): it is kept as a sleep window for a day, and every age below (silent, idle) skips
// the time spent asleep. Waking up closes nothing, and a hung top only delays auto-close, never brings it forward.

/** a time the machine slept, from..to (ms) */
export type Sleep = { from: number; to: number }
/** a tick this much later than expected counts as sleep */
export const SLEEP_SLACK_MS = 3 * MIN
/** sleep windows are kept this long */
export const SLEEP_KEEP_MS = 24 * 60 * MIN
/** a member silent for longer than this is checked (is its process alive?) before a message is sent to it */
export const CRASH_CHECK_MS = 90_000

/** The sleep windows after a tick at now, the previous one at prev (0: none yet), the ticks every ms apart. */
export function noteTick(prev: number, now: number, every: number, sleeps: readonly Sleep[]): Sleep[] {
  const kept = sleeps.filter(w => now - w.to <= SLEEP_KEEP_MS)
  return prev > 0 && now - prev > every + SLEEP_SLACK_MS ? [...kept, { from: prev + every, to: now }] : kept
}

/** How much of from..to was spent asleep. */
export const asleepWithin = (sleeps: readonly Sleep[], from: number, to: number) =>
  sleeps.reduce((n, w) => n + Math.max(0, Math.min(to, w.to) - Math.max(from, w.from)), 0)

/** The age of a time stamp, the time spent asleep since then left out. */
export const awakeAge = (since: number, now: number, sleeps: readonly Sleep[] = []) => Math.max(0, now - since - asleepWithin(sleeps, since, now))

/** The state to show: a silent member is offline; a closed one stays closed. Time asleep is not silence. */
export const shownState = (s: Status | undefined, now: number, sleeps: readonly Sleep[] = []) =>
  !s ? undefined : s.state === 'closed' ? 'closed' : awakeAge(s.heartbeat, now, sleeps) > STALE_MS ? 'offline' : s.state

/** The member has been silent long enough that a message to it first checks whether its session is alive (#71). */
export const heartbeatStale = (s: Status, now: number, sleeps: readonly Sleep[] = []) => s.state !== 'closed' && awakeAge(s.heartbeat, now, sleeps) > CRASH_CHECK_MS

/** Whether the tab check is worth an Orca call: some open member has been silent for over two minutes. */
export const needsTabCheck = (statuses: (Status | undefined)[], now: number, sleeps: readonly Sleep[] = []) =>
  statuses.some(s => s && s.state !== 'closed' && awakeAge(s.heartbeat, now, sleeps) > CHECK_AFTER_MS)

/** The next tab-check interval: doubled while Orca answers slowly (over 500 ms), back to the base when it is fast. */
export const nextCheckInterval = (current: number, tookMs: number, base = 2 * MIN, cap = 10 * MIN) =>
  tookMs > 500 ? Math.min(cap, Math.max(base, current) * 2) : base

const hasReports = (m: Member, list: Member[]) => list.some(x => x !== m && x.boss === m.name)

/** When a member went idle: after its last turn end or its last "clean", whichever is later. */
const idleSince = (s: Status) => Math.max(s.turnEnd ?? 0, s.lastClean ?? 0)

/** Workers that may be closed: no reports, not exempt, idle, said "clean", and idle for the set minutes (awake). */
export function toClose(list: Member[], statuses: Map<string, Status>, t: TeamSettings, now: number, sleeps: readonly Sleep[] = []): Member[] {
  if (!t.autoClose) return []
  return list.filter(m => {
    const s = statuses.get(m.name)
    return (
      !!s &&
      !hasReports(m, list) &&
      !t.exempt.includes(m.name) &&
      shownState(s, now, sleeps) === 'idle' &&
      !!s.lastClean &&
      awakeAge(idleSince(s), now, sleeps) >= t.idleMinutes * MIN
    )
  })
}

/** How many sessions are open: members whose state is neither offline nor closed. */
export const openCount = (statuses: Map<string, Status>, now: number, sleeps: readonly Sleep[] = []) =>
  [...statuses.values()].filter(s => !['offline', 'closed'].includes(shownState(s, now, sleeps) ?? 'offline')).length

export type Admit = { kind: 'open' } | { kind: 'evict'; name: string } | { kind: 'queue' }

/**
 * Whether a closed member can reopen now: under the cap it opens; at the cap the longest-idle closable worker makes
 * room; with no worker to close, the message waits in the queue.
 */
export function admit(list: Member[], statuses: Map<string, Status>, t: TeamSettings, now: number, sleeps: readonly Sleep[] = []): Admit {
  if (t.maxOpen <= 0 || openCount(statuses, now, sleeps) < t.maxOpen) return { kind: 'open' }
  const idle = list
    .filter(m => !hasReports(m, list) && !t.exempt.includes(m.name) && shownState(statuses.get(m.name), now, sleeps) === 'idle')
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

/**
 * A model name as claude --model accepts it (0.5.13, #63). The roster may keep the old short name shown on screen
 * ("haiku-5-5", or "Haiku 5.5" from a status line), which the API rejects: only that form (opus, sonnet, haiku or fable
 * followed by digits) gets the "claude-" prefix back. The aliases stay. Any other name (a full id with or without [1m],
 * a gateway's model) goes through as typed, so a wrong one fails visibly at start. "default", "keep" and "" give no
 * --model, and so does a name a shell would read as more than one word.
 */
export function modelArg(model: string): string {
  const raw = model.trim()
  const s = raw.toLowerCase().replace(/\s+/g, '-').replace(/(\d)\.(\d)/g, '$1-$2')
  if (s === '' || s === 'default' || s === 'keep') return ''
  if (/^(opus|sonnet|haiku|fable)-\d[\w.-]*(\[1m\])?$/.test(s)) return `claude-${s}`
  if (/^(opus|sonnet|haiku|fable|best|opusplan)(\[1m\])?$/.test(s)) return s
  return /^[A-Za-z0-9._:/@+-]+(\[1m\])?$/i.test(raw) ? raw : ''
}

/** A model id as the roster shows it: the "claude-" prefix cut, the rest as typed. */
export const shownModel = (model: string) => model.replace(/^claude-/i, '')

/**
 * The context window to count a transcript's tokens against when the member has not reported its own (#63): the
 * window its status file records, else 1M for an id with [1m] or a session already past 200k, else 200k.
 */
export const windowFor = (model: string, used: number, reported?: number) =>
  reported && reported > 0 ? reported : /\[1m\]$/i.test(model) || used > 200000 ? 1000000 : 200000

// ── Where a member runs, and which CLI (0.5.13, #67 and #69) ──

/** The CLIs a tab can run; anything else is "other". */
export const CLIS = ['claude', 'codex', 'hermes', 'gemini', 'opencode', 'qwen'] as const

/**
 * The CLI an Orca tab runs: Orca's own agentIdentity when it gives one, else the one CLI its command line or screen
 * names. '' when unknown (several CLIs named, or none): the member is then treated as Claude, as before.
 */
export function cliOf(tab: { agentIdentity?: unknown; command?: unknown; preview?: unknown } | undefined): string {
  if (!tab) return ''
  const id = typeof tab.agentIdentity === 'string' ? tab.agentIdentity.trim().toLowerCase() : ''
  if (id !== '') return CLIS.find(c => id.includes(c)) ?? 'other'
  const text = [tab.command, tab.preview].filter((x): x is string => typeof x === 'string').join('\n').toLowerCase()
  const named = new Set([...text.matchAll(/(?:^|[\s>"'\\/])(claude|codex|hermes|gemini|opencode|qwen)(?:\.exe|\.cmd|\.ps1)?(?=["'\s]|$)/gm)].map(x => x[1] as string))
  return named.size === 1 ? ([...named][0] as string) : ''
}

/** A member the mod runs: a Claude Code session. One adopted from another CLI is "not managed" (#69). */
export const isManaged = (m: Pick<Member, 'cli'>) => !m.cli || m.cli === 'claude'

export type Location = 'local' | 'remote' | 'other-cli'

/**
 * How a message reaches a member from this machine (#67): local (send by session id), remote (another PC, or recorded
 * remote: the messenger route of #72) or other-cli (not messaged).
 */
export const locationOf = (m: Member, here: string): Location =>
  !isManaged(m) ? 'other-cli' : isAway(m, here) || m.location === 'remote' ? 'remote' : 'local'

// ── Orca workspaces (0.5.13, #68) ──

/** The folder in an Orca worktree id ("<repo>::<folder>"), '' when the id carries none. */
export const pathInWorktreeId = (id: string) => {
  const cut = id.indexOf('::')
  return cut < 0 ? '' : id.slice(cut + 2).trim()
}

const slashed = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The workspace folder contains the project root (or is it). */
export const worktreeHolds = (folder: string, root: string) => folder.trim() !== '' && `${slashed(root)}/`.startsWith(`${slashed(folder)}/`)
