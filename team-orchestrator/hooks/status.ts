// Event-driven member status. Each session writes only its own small status file (status/<name>.json inside
// .claude/team-orchestrator/), on turn start and end, when it asks the person something, and on a 60 s heartbeat while
// it works. Nobody reads other members' terminal screens, so Orca is not asked about every member on every refresh.
//
// The team top also decides, from these files alone, which idle workers to close and whether a message to a closed
// worker can reopen it now or must wait (the session cap). Pure rules from data (no $), so a test can call them.

import type { Member } from '../types'
import type { CleanupReport } from './housekeeping'
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
  /** what the member is on now: the Session Panel step, else the first line of the last order from its boss */
  task?: string
  /** Legacy worker-reported "clean" timestamp. It is not OS-verified and never authorizes automatic closure. */
  lastClean?: number
  /** Legacy process count from old turn-end census; it does not prove owned resources were removed. */
  leftover?: number
  /** When the legacy process count was sampled, not a cleanup-verification time. */
  countedAt?: number
  /** Latest explicit cleanup field reported to the boss; always self-reported, never proof. */
  cleanupReport?: CleanupReport & { at: number; taskLabel?: string; deliveryId?: string; reportedLeftover?: number }
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
  /** Legacy switch retained for saved settings; cleanup auto-approval is paused in the interim safety mode. */
  autoScratch: boolean
  /** show each member's open assumptions from Session Panel (#89); reads its files only when Session Panel is on here */
  assumptions: boolean
  /** Legacy project scratch path retained for settings compatibility; never auto-approved in interim mode. */
  scratchDir: string
}

export const TEAM_SETTINGS0: TeamSettings = { autoClose: true, idleMinutes: 10, exempt: [], reopen: 'resume', maxOpen: 8, launch: 'demand', batch: 3, autoScratch: true, assumptions: false, scratchDir: '.claude/scratch' }

export const MIN = 60_000
/** a member with no write for this long shows as offline */
export const STALE_MS = 5 * MIN
/** the tab check runs only when some heartbeat is older than this */
export const CHECK_AFTER_MS = 2 * MIN

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

/** Automatic closure is paused until native cleanup ownership can be verified. */
export function toClose(_list: Member[], _statuses: Map<string, Status>, t: TeamSettings, _now: number, _sleeps: readonly Sleep[] = [], _held: ReadonlySet<string> = new Set()): Member[] {
  // No native verifier is implemented in this phase. Legacy lastClean/leftover status fields are not evidence.
  if (!t.autoClose) return []
  return []
}

/** Count known and uncertain sessions as occupying capacity; only two closed views free a slot. */
export const openCount = (statuses: Map<string, Status>, _now: number, _sleeps: readonly Sleep[] = [], held: ReadonlySet<string> = new Set(), members: Member[] = []) => {
  const open = new Set<string>()
  for (const [name, s] of statuses) if (s.state !== 'closed') open.add(name) // offline/unknown is not proof of closure
  for (const name of held) if (statuses.get(name)?.state !== 'closed') open.add(name)
  for (const m of members) {
    const s = statuses.get(m.name)
    if (!s && !m.pending && m.state !== 'closed' && m.state !== 'unstarted' && (!!m.handle || !!m.sessionId)) open.add(m.name) // roster identifies an open session; missing status is unknown
    else if (s && m.state !== 'closed' && m.state !== 'unstarted') open.add(m.name)
  }
  return open.size
}

export type Admit = { kind: 'open' } | { kind: 'queue' }

/** Never evict by worker cleanup claims; at the cap, wait for an explicit user-directed close. */
export function admit(list: Member[], statuses: Map<string, Status>, t: TeamSettings, now: number, sleeps: readonly Sleep[] = [], held: ReadonlySet<string> = new Set()): Admit {
  if (t.maxOpen <= 0 || openCount(statuses, now, sleeps, held, list) < t.maxOpen) return { kind: 'open' }
  return { kind: 'queue' }
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
 * On a custom config (`env`: the ANTHROPIC_DEFAULT_*_MODEL values set), a family's alias and short names start with that
 * family's value, and a name equal to a set value goes through as typed, never given the "claude-" prefix.
 */
export type EnvModels = Partial<Record<'opus' | 'sonnet' | 'haiku' | 'fable', string>>
export function modelArg(model: string, env: EnvModels = {}): string {
  const raw = model.trim()
  const s = raw.toLowerCase().replace(/\s+/g, '-').replace(/(\d)\.(\d)/g, '$1-$2')
  if (s === '' || s === 'default' || s === 'keep') return ''
  const safe = (x: string) => /^[A-Za-z0-9._:/@+-]+(\[1m\])?$/i.test(x)
  if (Object.values(env).some(v => v?.toLowerCase() === raw.toLowerCase()) && safe(raw)) return raw
  const fam = /^(opus|sonnet|haiku|fable)(-\d[\w.-]*)?(\[1m\])?$/.exec(s)
  const set = fam ? env[fam[1] as keyof EnvModels]?.trim() : undefined
  if (fam && set && safe(set)) return fam[3] && !/\[1m\]$/i.test(set) ? `${set}[1m]` : set
  if (/^(opus|sonnet|haiku|fable)-\d[\w.-]*(\[1m\])?$/.test(s)) return `claude-${s}`
  if (/^(opus|sonnet|haiku|fable|best|opusplan)(\[1m\])?$/.test(s)) return s
  return safe(raw) ? raw : ''
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
