import type { Assumption, Prefs } from '../types'
import { STALE_OPEN_MS } from './logic'

/**
 * The decision step, slice 1 (#91): a free local score for assumptions, the keep rule, the threshold rules read from
 * `.claude/session-panel/decide.json`, and the pointer digest the band injects through `prompt.compose`.
 * Everything here is pure, so the tests use it directly. No model call, no live HTTP and no new dependency: TypeSafe
 * Jev, the skill and context-source candidates, file spans and self-tuning are slice 2 and later.
 */

/** At most this many scored items are kept for each candidate kind. Wrong assumptions are never dropped by the cap. */
export const MAX_PER_KIND = 5
/** The threshold a session starts with, before `decide.json` and Settings are read. */
export const DEFAULT_THRESHOLD = 0.5
/** The thresholds the Settings row offers. */
export const THRESHOLD_CHOICES = [0.4, 0.5, 0.6, 0.7, 0.8] as const
/** The digest's character budget: about 60-90 tokens. */
export const DIGEST_CHAR_CAP = 360
export const DIGEST_HEAD = 'Read only these assumptions: '
export const DIGEST_TAIL = '\nSkip the rest.'
/** The per-project rules file, relative to the project root. */
export const DECIDE_FILE = '.claude/session-panel/decide.json'
/** What each part of the score is worth. The five parts add up to 1. */
export const SCORE_WEIGHTS = { status: 0.3, age: 0.15, kind: 0.2, files: 0.2, overlap: 0.15 } as const
export const RULES_TOAST = 'Session Panel: decide.json could not be read, so the default threshold was used.'
export const FAIL_TOAST = 'Session Panel: the decision step could not run. No pointer was added.'

const STATUS_SCORE: Record<string, number> = { wrong: 1, open: 0.6, confirmed: 0.2 }
const KIND_SCORE: Record<string, number> = { declared: 1, flagged: 0.3 }

/** Words too common to say anything about what a turn is about. */
const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'not', 'but', 'are', 'was', 'were', 'you', 'your', 'its', 'it',
  'into', 'than', 'then', 'them', 'they', 'she', 'him', 'his', 'her', 'our', 'out', 'any', 'all', 'can', 'will',
  'would', 'should', 'could', 'have', 'has', 'had', 'does', 'did', 'use', 'using', 'get', 'got', 'one', 'two', 'when',
  'what', 'which', 'who', 'how', 'why', 'where', 'each', 'only', 'also', 'more', 'most', 'some', 'such', 'per',
])

export type ScoreParts = { status: number; age: number; kind: number; files: number; overlap: number }

/** The entry fields the score reads. A plain object is enough, so the tests need no whole track. */
export type Scorable = Pick<Assumption, 'id' | 'text' | 'status' | 'kind' | 'at'> & Partial<Pick<Assumption, 'path' | 'paths'>>

export type Scored = {
  id: number
  text: string
  score: number
  parts: ScoreParts
  /** every candidate kind is an assumption in slice 1; the field is here so slice 2 can add kinds */
  candidateKind: string
  isWrong: boolean
}

export const clampThreshold = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : DEFAULT_THRESHOLD)

/** The words that carry meaning, in lower case: no punctuation, no very short words, no common words. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 2 && !STOP.has(w))
}

/** The share of the entry's own words that the prompt also uses, 0 to 1. */
export function overlapOf(text: string, prompt: string): number {
  const mine = [...new Set(words(text))]
  if (mine.length === 0) return 0
  const theirs = new Set(words(prompt))
  return clampThreshold(mine.filter(w => theirs.has(w)).length / mine.length)
}

/** The path-like words in a prompt: `src/app/page.tsx`, `hooks/decide.ts`, `notes.md`. */
export function promptPaths(prompt: string): string[] {
  const out: string[] = []
  for (const m of prompt.matchAll(/[\w.@-]+(?:[/\\][\w.@-]+)+|[\w-]+\.[A-Za-z0-9]{1,5}\b/g)) out.push(m[0].replace(/\\/g, '/').toLowerCase())
  return [...new Set(out)]
}

export const pathsOf = (a: Scorable): string[] => [...new Set([...(a.path === undefined ? [] : [a.path]), ...(a.paths ?? [])])]

/** 1 when the entry names a file the prompt also names, 0 otherwise. */
export function filesTouched(a: Scorable, prompt: string): number {
  const named = promptPaths(prompt)
  if (named.length === 0) return 0
  const mine = pathsOf(a).map(p => p.replace(/\\/g, '/').toLowerCase())
  const base = (p: string) => p.split('/').pop() ?? p
  const hit = mine.some(p => named.includes(p) || named.some(n => base(n) === base(p)))
  return hit ? 1 : 0
}

/** The five parts and the weighted total for one entry, 0 to 1. */
export function scoreAssumption(a: Scorable, prompt: string, now: number): Scored {
  const parts: ScoreParts = {
    status: STATUS_SCORE[a.status] ?? 0,
    age: clampThreshold(1 - Math.max(0, now - a.at) / STALE_OPEN_MS),
    kind: KIND_SCORE[a.kind] ?? 0,
    files: filesTouched(a, prompt),
    overlap: overlapOf(a.text, prompt),
  }
  const score = clampThreshold(
    parts.status * SCORE_WEIGHTS.status +
      parts.age * SCORE_WEIGHTS.age +
      parts.kind * SCORE_WEIGHTS.kind +
      parts.files * SCORE_WEIGHTS.files +
      parts.overlap * SCORE_WEIGHTS.overlap,
  )
  return { id: a.id, text: a.text, score, parts, candidateKind: 'assumption', isWrong: a.status === 'wrong' }
}

export const scoreAll = (entries: readonly Scorable[], prompt: string, now: number): Scored[] =>
  entries.map(a => scoreAssumption(a, prompt, now))

/**
 * The keep rule: a wrong entry is always kept; any other entry is kept when its score reaches the threshold; at most
 * `maxPerKind` scored entries are kept for each kind. Wrong entries come first, then the rest by score, highest first.
 */
export function keepShortlist(items: readonly Scored[], threshold: number, maxPerKind = MAX_PER_KIND): Scored[] {
  const t = clampThreshold(threshold)
  const byKind = new Map<string, Scored[]>()
  for (const i of items) {
    if (i.isWrong || i.score < t) continue
    const group = byKind.get(i.candidateKind) ?? []
    group.push(i)
    byKind.set(i.candidateKind, group)
  }
  const byScore = (a: Scored, b: Scored) => b.score - a.score || a.id - b.id
  const scored: Scored[] = []
  for (const group of byKind.values()) scored.push(...[...group].sort(byScore).slice(0, maxPerKind))
  return [...items.filter(i => i.isWrong).sort(byScore), ...scored.sort(byScore)]
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * The pointer digest: one line naming the assumptions to read this turn, wrong ones quoted in full, then the line that
 * tells the model to skip the rest. Nothing is kept means no digest at all. Wrong entries always fit; a scored entry is
 * dropped once the budget is spent, so the digest stays near 60-90 tokens.
 */
export function digestOf(kept: readonly Scored[], cap = DIGEST_CHAR_CAP): string {
  if (kept.length === 0) return ''
  const piece = (i: Scored) => (i.isWrong ? `#${i.id} (wrong: "${oneLine(i.text)}")` : `#${i.id}`)
  const parts: string[] = []
  let len = DIGEST_HEAD.length + DIGEST_TAIL.length
  for (const i of kept.filter(k => k.isWrong)) {
    const s = piece(i)
    parts.push(s)
    len += s.length + 2
  }
  for (const i of kept.filter(k => !k.isWrong)) {
    const s = piece(i)
    if (len + s.length > cap) break
    parts.push(s)
    len += s.length + 2
  }
  return `${DIGEST_HEAD}${parts.join(', ')}${DIGEST_TAIL}`
}

// ---------- the rules file: `.claude/session-panel/decide.json` ----------

/** The threshold rules of one project. Keys are matched in lower case. */
export type DecideRules = { version: number; default?: number; paths: Record<string, number>; roles: Record<string, number> }
export const EMPTY_RULES: DecideRules = { version: 1, paths: {}, roles: {} }

/** Reads the rules file. A missing file is no rules; junk is a reason, and the caller falls back to the default. */
export function parseRules(text: string | undefined): { ok: true; rules: DecideRules } | { ok: false; reason: string } {
  if (text === undefined || text.trim() === '') return { ok: true, rules: EMPTY_RULES }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'not an object' }
  const o = raw as Record<string, unknown>
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? clampThreshold(v) : undefined)
  const map = (v: unknown): Record<string, number> => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
    const out: Record<string, number> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = num(val)
      if (n !== undefined) out[k.toLowerCase()] = n
    }
    return out
  }
  return { ok: true, rules: { version: 1, default: num(o.default), paths: map(o.paths), roles: map(o.roles) } }
}

const escapeChar = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A small glob: `**` crosses folders, `*` and `?` stay inside one. Matching ignores case. */
export function globMatch(glob: string, path: string): boolean {
  const target = path.replace(/\\/g, '/').toLowerCase()
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') i++
        re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += escapeChar(c)
  }
  try {
    return new RegExp(`^${re}$`).test(target)
  } catch {
    return false
  }
}

/**
 * The threshold for this turn. The most specific rule wins: a path glob that matches one of the turn's paths (the
 * longest matching glob when several do), then the session's role, then the file's own default, then the Settings
 * value. Task-type rules are slice 2, because they need Jev's label.
 */
export function pickThreshold(rules: DecideRules, paths: readonly string[], role: string | undefined, fallback: number): number {
  const hits = Object.entries(rules.paths).filter(([glob]) => paths.some(p => globMatch(glob, p)))
  if (hits.length > 0) return clampThreshold([...hits].sort((a, b) => b[0].length - a[0].length)[0][1])
  const key = role?.trim().toLowerCase()
  if (key !== undefined && key !== '' && Object.hasOwn(rules.roles, key)) return clampThreshold(rules.roles[key])
  if (rules.default !== undefined) return clampThreshold(rules.default)
  return clampThreshold(fallback)
}

/** This session's role, from the team roster, or undefined when the roster cannot be read or is not on it. */
export function roleFor(rosterText: string, sessionId: string): string | undefined {
  try {
    const roster = JSON.parse(rosterText)
    if (!Array.isArray(roster)) return undefined
    const me = roster.find((m: any) => m && m.sessionId === sessionId)
    const role = me?.role
    return typeof role === 'string' && role.trim() !== '' ? role.trim() : undefined
  } catch {
    return undefined
  }
}

// ---------- the step itself ----------

/** What the step needs from the engine. The band builds this from `$` in session-panel.tsx. */
export type DecideIo = {
  /** the rules file's text, or undefined when it is missing or cannot be read */
  rules: () => Promise<string | undefined>
  /** this session's role, from the roster */
  role: () => Promise<string | undefined>
  /** the prompt box's text */
  box: () => Promise<string>
  /** the files this turn has touched, relative to the project root */
  paths: () => Promise<readonly string[]>
  entries: () => Promise<readonly Scorable[]>
  prefs: () => Promise<Pick<Prefs, 'decide' | 'decideThreshold'>>
  now: () => Promise<number>
  toast: (text: string) => void
}

export type DecideOutcome = { text: string; warned: boolean }

/**
 * Runs the step for one turn. It never throws and never blocks the turn: on any error it returns no digest and asks
 * for one toast, at most once per load. The digest is '' when the step is off, there is nothing to point at, or the
 * shortlist is empty.
 */
export async function runDecide(io: DecideIo, warned: boolean): Promise<DecideOutcome> {
  const say = (text: string) => {
    try {
      io.toast(text)
    } catch {
      // a toast that cannot be shown never breaks a turn
    }
  }
  try {
    const prefs = await io.prefs()
    if (!prefs.decide) return { text: '', warned }
    const entries = await io.entries()
    if (entries.length === 0) return { text: '', warned }
    const prompt = await io.box()
    const parsed = parseRules(await io.rules())
    let seen = warned
    if (!parsed.ok && !seen) {
      say(RULES_TOAST)
      seen = true
    }
    const rules = parsed.ok ? parsed.rules : EMPTY_RULES
    const role = parsed.ok ? await io.role().catch(() => undefined) : undefined
    const now = await io.now()
    // the path rules read the prompt box's paths and the files this turn has touched, so a rule fits the work at hand
    const paths = [...new Set([...promptPaths(prompt), ...(await io.paths())])]
    const threshold = pickThreshold(rules, paths, role, prefs.decideThreshold)
    return { text: digestOf(keepShortlist(scoreAll(entries, prompt, now), threshold)), warned: seen }
  } catch {
    if (!warned) say(FAIL_TOAST)
    return { text: '', warned: true }
  }
}