// Safe roster writes across sessions, versions and machines (0.5.12, #59 and #64). Pure rules from data (no $), so a
// test can call them.
//
//  - One writer. Only the team top's session (on the top's machine) writes roster.json and settings.json. Every other
//    session writes a small change file, changes/<ms>-<rand>.json, holding the member fields it changed (or a settings
//    patch). Every session reads the roster as the file plus the change files not yet applied, in time order, field
//    by field; the top folds them into the file and records them in changes/applied.json. The mod's file API cannot
//    delete, so an applied change file stays where it is and the index says it is done; files older than 7 days are
//    ignored by their name alone.
//  - A schema stamp beside the roster (meta.json): schemaVersion, writtenBy (the writer's mod version) and topMachine.
//    roster.json stays a plain array, so older copies of the mod still read it. A session whose mod is older than
//    writtenBy writes only change files, which wait for a current top.
//  - The queue: one file per message, queue/<ms>-<rand>.json, with a state. Delivered and failed entries are kept a day,
//    everything at most 7 days; queue/pruned.json lists the entries the top's round has pruned.
//  - Machines: a member records its home machine; a member whose home is another PC is never matched, reopened, closed
//    or messaged from here.

import type { Member } from '../types'
import type { TeamSettings } from './status'

export const SCHEMA = 2
export const MIN_MS = 60_000
export const DAY = 24 * 60 * MIN_MS
/** change files and queue entries older than this are ignored by their name alone */
export const KEEP_MS = 7 * DAY
/** a queue entry marked sending this long ago was left by a round that stopped: it is tried again */
export const SENDING_MS = 5 * MIN_MS
export const MAX_TRIES = 3

/** The member fields kept in the roster file. */
export const STRUCT = ['team', 'name', 'address', 'role', 'level', 'boss', 'handle', 'sessionId', 'worktree', 'machine', 'short', 'allowAgent', 'allowWrite', 'briefed', 'noted', 'statusFile', 'pending', 'model', 'effort', 'location', 'cli'] as const

export const keyOf = (m: Partial<Member>) => `${m.team ?? ''}|${m.name ?? ''}`

/** A member as the roster file keeps it: its structure fields only. */
export const project = (m: Partial<Member>): Partial<Member> => {
  const out: Record<string, unknown> = {}
  for (const k of STRUCT) if ((m as any)[k] !== undefined) out[k] = (m as any)[k]
  return out as Partial<Member>
}

// ── change files ──

export type Op =
  | { op: 'set'; key: string; patch: Record<string, unknown> }
  | { op: 'add'; member: Partial<Member> }
  | { op: 'del'; key: string }
/** who wrote a change: shown when the top applies a change of rights */
export type By = { session: string; member: string; machine: string; version: string }
export type Change =
  | { v: 1; kind: 'roster'; at: number; by: By; ops: Op[] }
  | { v: 1; kind: 'settings'; at: number; by: By; patch: Partial<TeamSettings> }

const NAME = /^(\d{13})-[a-z0-9]{4,16}\.json$/

/** A change or queue file name: the time first, so names sort in time order. */
export const fileName = (at: number, rand: string) => `${String(Math.max(0, Math.floor(at))).padStart(13, '0')}-${rand.replace(/[^a-z0-9]/g, '').slice(0, 16).padEnd(4, '0')}.json`

/** The time in a change or queue file's name; NaN for any other file. */
export const timeOf = (name: string) => {
  const m = name.match(NAME)
  return m ? Number(m[1]) : NaN
}

/** The names still to apply: well formed, not older than 7 days, not in the applied index, oldest first. */
export const pendingNames = (names: string[], applied: ReadonlySet<string>, now: number) =>
  names.filter(n => !applied.has(n) && now - timeOf(n) <= KEEP_MS).sort()

/** The applied index after adding names: entries older than 7 days are dropped (their files are ignored by name). */
export const appliedAfter = (prev: string[], add: string[], now: number) =>
  [...new Set([...prev, ...add])].filter(n => now - timeOf(n) <= KEEP_MS).sort()

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * What one session changed in the roster since it last read it: added members, removed members, and per member only
 * the fields that differ (null clears a field). statusFile is derived from the name, so it is never a change of its own.
 */
export function diffOps(base: Partial<Member>[], local: Partial<Member>[]): Op[] {
  const b = new Map(base.map(m => [keyOf(m), project(m)]))
  const l = new Map(local.map(m => [keyOf(m), project(m)]))
  const ops: Op[] = []
  for (const [k, m] of l) {
    const old = b.get(k)
    if (!old) {
      ops.push({ op: 'add', member: m })
      continue
    }
    const patch: Record<string, unknown> = {}
    for (const f of STRUCT) {
      if (f === 'statusFile') continue
      if (!same((m as any)[f], (old as any)[f])) patch[f] = (m as any)[f] ?? null
    }
    if (Object.keys(patch).length > 0) ops.push({ op: 'set', key: k, patch })
  }
  for (const k of b.keys()) if (!l.has(k)) ops.push({ op: 'del', key: k })
  return ops
}

const merge = <T extends object>(m: T, patch: Record<string, unknown>): T => {
  const out = { ...m } as Record<string, unknown>
  for (const [f, v] of Object.entries(patch)) {
    if (v === null) delete out[f]
    else out[f] = v
  }
  return out as T
}

/** The roster with ops applied in order, field by field. A set or del of a member that is gone does nothing. */
export function applyOps<T extends Partial<Member>>(list: T[], ops: Op[]): T[] {
  let out = list.slice()
  for (const o of ops) {
    if (o.op === 'del') out = out.filter(m => keyOf(m) !== o.key)
    else if (o.op === 'set') out = out.map(m => (keyOf(m) === o.key ? merge(m, o.patch) : m))
    else {
      const k = keyOf(o.member)
      out = out.some(m => keyOf(m) === k) ? out.map(m => (keyOf(m) === k ? merge(m, o.member as Record<string, unknown>) : m)) : [...out, o.member as T]
    }
  }
  return out
}

/** The roster changes in a set of change files, oldest first. */
export const rosterOps = (changes: { name: string; change: Change }[]) =>
  changes.flatMap(c => (c.change.kind === 'roster' && Array.isArray(c.change.ops) ? c.change.ops : []))

/** The settings with every settings patch applied, oldest first. */
export const applySettings = (s: TeamSettings, changes: { name: string; change: Change }[]): TeamSettings =>
  changes.reduce((acc, c) => (c.change.kind === 'settings' && c.change.patch && typeof c.change.patch === 'object' ? { ...acc, ...c.change.patch } : acc), s)

/** The changes of rights (Allow writes, Allow subagents) a set of change files makes, in words, for the top's toast. */
export function rightsChanges(changes: { name: string; change: Change }[]): string[] {
  const out: string[] = []
  for (const { change: c } of changes) {
    if (c.kind !== 'roster') continue
    const from = [c.by?.member || 'a session not on the roster', c.by?.machine ? `on ${c.by.machine}` : ''].filter(Boolean).join(' ')
    for (const o of c.ops ?? []) {
      const p: Record<string, unknown> = o.op === 'set' ? o.patch : o.op === 'add' ? (o.member as Record<string, unknown>) : {}
      const name = o.op === 'set' ? o.key.slice(o.key.indexOf('|') + 1) : o.op === 'add' ? String(o.member.name ?? '') : ''
      const words: string[] = []
      if ('allowWrite' in p && (o.op === 'set' || p.allowWrite === true)) words.push(`Allow writes ${p.allowWrite === true ? 'on' : 'off'}`)
      if ('allowAgent' in p && (o.op === 'set' || p.allowAgent === true)) words.push(`Allow subagents ${p.allowAgent === true ? 'on' : 'off'}`)
      if (words.length > 0) out.push(`${name}: ${words.join(', ')} (from ${from})`)
    }
  }
  return out
}

// ── the schema stamp ──

export type Meta = { schemaVersion: number; writtenBy: string; topMachine: string }
export const META0: Meta = { schemaVersion: 1, writtenBy: '', topMachine: '' }

/** a < b for dotted versions ("0.5.9" < "0.5.12"); an unknown version on either side is never older. */
export function olderThan(a: string, b: string): boolean {
  if (!a || !b) return false
  const pa = a.split('.').map(x => parseInt(x, 10) || 0)
  const pb = b.split('.').map(x => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

/** The stamp after a write by the top on `here`: the newer version, and the top's machine kept unless none is set. */
export const metaAfter = (m: Meta, version: string, here: string): Meta => ({
  schemaVersion: Math.max(SCHEMA, m.schemaVersion || 0),
  writtenBy: olderThan(m.writtenBy, version) || !m.writtenBy ? version || m.writtenBy : m.writtenBy,
  topMachine: m.topMachine || here,
})

// ── machines ──

export const sameMachine = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The member's home is another PC. A member with no machine recorded, or a PC that does not know its own name, is local. */
export const isAway = (m: Partial<Member>, here: string) => !!here && !!m.machine && !sameMachine(m.machine, here)

/** The top machine is recorded and is not this one: team-top actions here are off. */
export const topElsewhere = (meta: Meta, here: string) => !!here && !!meta.topMachine && !sameMachine(meta.topMachine, here)

/** The roster's team top for writing: its first member that reports to the user. */
export const projectTop = <T extends Partial<Member>>(list: T[]): T | undefined => list.find(m => m.boss === 'user')

/**
 * The folder name of a project under <claude config dir>/team-orchestrator/, made from the project root the way Claude
 * names its projects folders: every character but a letter or a digit becomes "-" (the drive letter upper case).
 */
export function projectKey(root: string): string {
  const r = root.replace(/[\\/]+$/, '').replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`)
  const key = r.replace(/[^A-Za-z0-9]/g, '-')
  if (key.length <= 200) return key
  let h = 5381
  for (const ch of r) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0
  return `${key.slice(0, 200)}-${h.toString(36)}`
}

// ── the queue ──

export type QState = 'pending' | 'sending' | 'delivered' | 'failed'
/**
 * reason (0.5.16, #65): why a pending entry waits for its member to answer rather than for room. hung: its claude
 * process runs but it has written no status for a while; unsure: whether it runs could not be proved. Either is tried
 * when the member's heartbeat is fresh again, or once it is proved dead and closed (then it is reopened first). told:
 * when the team top was told the member looks hung (once per member per hour, across sessions).
 */
export type QReason = 'hung' | 'unsure'
export type QEntry = { to: string; from: string; message: string; created: number; state: QState; tries: number; updated?: number; error?: string; reason?: QReason; told?: number }

/** What the top's round does with one entry: prune it, keep it as it is, or try to deliver it. */
export function queueAction(q: QEntry, now: number): 'prune' | 'keep' | 'try' {
  if (now - q.created > KEEP_MS) return 'prune'
  const since = now - (q.updated ?? q.created)
  if (q.state === 'delivered' || q.state === 'failed') return since > DAY ? 'prune' : 'keep'
  if (q.state === 'sending' && since < SENDING_MS) return 'keep'
  return 'try'
}

/** The entry after one try: delivered; back to pending when there was no room (not a failed try); failed after the third failure. */
export function afterTry(q: QEntry, ok: boolean | undefined, now: number, error = ''): QEntry {
  if (ok === true) return { ...q, state: 'delivered', updated: now, error: undefined }
  if (ok === undefined) return { ...q, state: 'pending', updated: now }
  const tries = q.tries + 1
  return { ...q, tries, state: tries >= MAX_TRIES ? 'failed' : 'pending', updated: now, error }
}

/** The old single queue.json (before 0.5.12) as queue entries. */
export const fromOldQueue = (rows: unknown, now: number): QEntry[] =>
  (Array.isArray(rows) ? rows : [])
    .filter((r: any) => r && typeof r.to === 'string' && typeof r.message === 'string')
    .map((r: any) => ({ to: r.to, from: String(r.from ?? 'someone'), message: r.message, created: Number(r.at) || now, state: 'pending' as const, tries: 0 }))
