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
/** At most this many wrong assumptions are quoted in full; any others are listed as ids after "also wrong:". */
export const WRONG_QUOTED = 5
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
  /**
   * True when the entry shares a file (files > 0) or a meaningful word (overlap > 0) with the prompt. Only a matching
   * entry can be kept by the local score: status, age and kind rank the matches, they never make one.
   */
  matched: boolean
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

export const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p

/**
 * 1 when the entry names a file the prompt also names, 0 otherwise.
 *
 * A prompt path that carries a folder (`hooks/decide.ts`) matches only by the full path or by a path suffix, so an
 * entry for `src/hooks/decide.ts` matches `hooks/decide.ts`. A bare file name in the prompt (`decide.ts`) still
 * matches by base name, whatever folder either path sits in.
 */
export function filesTouched(a: Scorable, prompt: string): number {
  const named = promptPaths(prompt)
  if (named.length === 0) return 0
  const mine = pathsOf(a).map(p => p.replace(/\\/g, '/').toLowerCase())
  const hit = mine.some(p =>
    named.some(n => (n.includes('/') ? p === n || p.endsWith(`/${n}`) : baseName(p) === n)),
  )
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
  const isWrong = a.status === 'wrong'
  return { id: a.id, text: a.text, score, parts, candidateKind: 'assumption', isWrong, matched: parts.files > 0 || parts.overlap > 0 }
}

export const scoreAll = (entries: readonly Scorable[], prompt: string, now: number): Scored[] =>
  entries.map(a => scoreAssumption(a, prompt, now))

/**
 * The keep rule. A wrong entry is always kept. Any other entry is kept only when BOTH hold:
 *
 * - it matches the prompt at all (`matched`: it shares a file or a meaningful word), and
 * - its score is strictly over the threshold.
 *
 * Status, age and kind only rank the matches; they never make one, so a fresh, declared, open assumption about
 * something else entirely is not kept. At most `maxPerKind` scored entries are kept for each kind. Wrong entries come
 * first, then the rest by score, highest first.
 */
export function keepShortlist(items: readonly Scored[], threshold: number, maxPerKind = MAX_PER_KIND): Scored[] {
  const t = clampThreshold(threshold)
  const byKind = new Map<string, Scored[]>()
  for (const i of items) {
    if (i.isWrong || !i.matched || i.score <= t) continue
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
 * tells the model to skip the rest. Nothing is kept means no digest at all.
 *
 * The five newest wrong assumptions are quoted in full; any others are listed as ids only after `also wrong:`. Wrong
 * entries always fit, however long they are. A scored entry is dropped once the budget is spent, so the digest stays
 * near 60-90 tokens.
 */
export function digestOf(kept: readonly Scored[], cap = DIGEST_CHAR_CAP): string {
  if (kept.length === 0) return ''
  const wrong = [...kept.filter(k => k.isWrong)].sort((a, b) => b.id - a.id)
  const quoted = wrong.slice(0, WRONG_QUOTED)
  const rest = wrong.slice(WRONG_QUOTED)
  const parts: string[] = quoted.map(i => `#${i.id} (wrong: "${oneLine(i.text)}")`)
  let len = DIGEST_HEAD.length + DIGEST_TAIL.length + parts.reduce((n, s) => n + s.length + 2, 0)
  const alsoWrong = rest.length > 0 ? `also wrong: ${rest.map(i => `#${i.id}`).join(', ')}` : ''
  if (alsoWrong !== '') {
    parts.push(alsoWrong)
    len += alsoWrong.length + 2
  }
  for (const i of kept.filter(k => !k.isWrong)) {
    const s = `#${i.id}`
    if (len + s.length > cap) break
    parts.push(s)
    len += s.length + 2
  }
  return `${DIGEST_HEAD}${parts.join(', ')}${DIGEST_TAIL}`
}

// ---------- the rules file: `.claude/session-panel/decide.json` ----------

/** The threshold rules of one project. Keys are matched in lower case. */
export type DecideRules = {
  version: number
  default?: number
  paths: Record<string, number>
  roles: Record<string, number>
  /** thresholds by task type, the label Jev's Choice gives the prompt (slice 2) */
  tasks: Record<string, number>
}
export const EMPTY_RULES: DecideRules = { version: 1, paths: {}, roles: {}, tasks: {} }

/** The task types the Jev Choice labels a prompt with, and what each means to the model. */
export const TASK_TYPES = ['build', 'fix', 'review', 'research', 'docs', 'other'] as const
export type TaskType = (typeof TASK_TYPES)[number]
export const TASK_CRITERIA: Record<TaskType, string> = {
  build: 'Add or change behaviour: a new feature, page, or file',
  fix: 'Repair something broken: a bug, a failing test, an error',
  review: 'Read and judge work that already exists, without changing it',
  research: 'Find out something and report back: an investigation or a question',
  docs: 'Write or update explanation: a README, comment or guide',
  other: 'A request that fits none of the above',
}

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
  return { ok: true, rules: { version: 1, default: num(o.default), paths: map(o.paths), roles: map(o.roles), tasks: map(o.tasks) } }
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
  return pickThresholdFor(rules, { paths, role }, fallback)
}

/**
 * The threshold for this turn, with the task type in the order. The most specific rule wins: a path glob that matches
 * one of the turn's paths (the longest matching glob when several do), then the session's role, then the task type the
 * Jev Choice labelled the prompt with, then the file's own default, then the Settings value.
 */
export function pickThresholdFor(
  rules: DecideRules,
  ctx: { paths?: readonly string[]; role?: string | undefined; task?: string | undefined },
  fallback: number,
): number {
  const hits = Object.entries(rules.paths).filter(([glob]) => (ctx.paths ?? []).some(p => globMatch(glob, p)))
  if (hits.length > 0) return clampThreshold([...hits].sort((a, b) => b[0].length - a[0].length)[0][1])
  const key = ctx.role?.trim().toLowerCase()
  if (key !== undefined && key !== '' && Object.hasOwn(rules.roles, key)) return clampThreshold(rules.roles[key])
  const task = ctx.task?.trim().toLowerCase()
  if (task !== undefined && task !== '' && Object.hasOwn(rules.tasks, task)) return clampThreshold(rules.tasks[task])
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

// ---------- the Jev pass (slice 2): TypeSafe System One, opt-in ----------

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'
export const JEV_KEY_VAR = 'TYPESAFE_API_KEY'
/** The Jev pass must answer inside this many milliseconds, or the local score is used instead. */
export const JEV_TIMEOUT_MS = 1500
/** A Jev Noul keeps an assertion at this probability and above. */
export const JEV_KEEP = 0.8
/** The one question asked of every shortlist item. */
export const JEV_QUESTION = 'Is this assumption relevant to this prompt?'
export const JEV_NO_KEY_TOAST = '' // no key means Jev is off: nothing is said
export const JEV_FAIL_TOAST = 'Session Panel: the Jev pass could not answer, so the local score was used.'

/** What one Jev call returned: the probability for each id, and the task type the prompt was labelled with. */
export type JevAnswer = { isOk: true; scores: Record<number, number>; task: TaskType } | { isOk: false; reason: string }

/** The HTTP call the Jev pass makes. The band hands over `$.http.fetch`; tests hand over their own. */
export type JevFetch = (args: { url: string; method: string; headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<{ status: number; body: string }>

export const jevId = (id: number) => `assumption_${id}`

/** The request body: one Noul per shortlist item, and one Choice for the task type. */
export function jevRequestBody(items: readonly Scored[], prompt: string): string {
  const questions: Record<string, unknown> = {}
  for (const i of items) questions[jevId(i.id)] = { type: 'noul', instructions: JEV_QUESTION }
  questions.task_type = { type: 'choice', instructions: 'What kind of request is this?', criteria: TASK_CRITERIA }
  return JSON.stringify({ state: prompt, model: JEV_MODEL, questions })
}

/** Reads the answers back. A missing or malformed answer leaves that item to the local score. */
export function parseJevReply(body: string, items: readonly Scored[]): { scores: Record<number, number>; task: TaskType } {
  const scores: Record<number, number> = {}
  let task: TaskType = 'other'
  let parsed: any
  try {
    parsed = JSON.parse(body)
  } catch {
    return { scores, task }
  }
  const answers = parsed?.answers
  if (typeof answers !== 'object' || answers === null) return { scores, task }
  for (const i of items) {
    const noul = answers[jevId(i.id)]?.noul
    if (typeof noul === 'number' && Number.isFinite(noul)) scores[i.id] = clampThreshold(noul)
  }
  const chosen = answers.task_type?.choice
  if (typeof chosen === 'string' && (TASK_TYPES as readonly string[]).includes(chosen)) task = chosen as TaskType
  return { scores, task }
}

/** Why a Jev answer cannot be used: no key, an HTTP error, or an answer that took too long. */
export type JevIo = {
  key: () => Promise<string | undefined>
  fetch: JevFetch
  now: () => Promise<number>
}

/**
 * One Jev request for the whole shortlist. It returns isOk:false for no key, a non-200 answer, a thrown call, a reply
 * that is not JSON, and an answer that arrived after JEV_TIMEOUT_MS. It never throws and never retries.
 */
export async function runJev(io: JevIo, items: readonly Scored[], prompt: string): Promise<JevAnswer> {
  let key: string | undefined
  try {
    key = await io.key()
  } catch {
    return { isOk: false, reason: 'no key' }
  }
  if (key === undefined || key.trim() === '') return { isOk: false, reason: 'no key' }
  const started = await io.now()
  let status = 0
  let body = ''
  try {
    const r = await io.fetch({
      url: JEV_URL,
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: jevRequestBody(items, prompt),
      timeoutMs: JEV_TIMEOUT_MS,
    })
    status = r?.status ?? 0
    body = typeof r?.body === 'string' ? r.body : ''
  } catch (err) {
    return { isOk: false, reason: String((err as any)?.message ?? err).slice(0, 80) }
  }
  // the clock is read after the call, so a slow answer falls back however long the call itself took
  const took = (await io.now()) - started
  if (took > JEV_TIMEOUT_MS) return { isOk: false, reason: 'over 1.5 s' }
  if (status !== 200) return { isOk: false, reason: `HTTP ${status}` }
  let scores: Record<number, number>
  let task: TaskType
  try {
    const out = parseJevReply(body, items)
    scores = out.scores
    task = out.task
  } catch {
    return { isOk: false, reason: 'the reply could not be read' }
  }
  if (Object.keys(scores).length === 0) return { isOk: false, reason: 'the reply held no answer' }
  return { isOk: true, scores, task }
}

/**
 * The Jev keep rule: keep a scored item when Jev's probability is over 0.8, at most five per kind. A wrong assumption
 * is always kept, whatever Jev said. An item Jev did not answer keeps its local place.
 */
export function keepJev(items: readonly Scored[], scores: Record<number, number>, maxPerKind = MAX_PER_KIND): Scored[] {
  const byScore = (a: Scored, b: Scored) => b.score - a.score || a.id - b.id
  const byKind = new Map<string, Scored[]>()
  for (const i of items) {
    if (i.isWrong) continue
    const p = scores[i.id]
    if (p === undefined || p <= JEV_KEEP) continue
    const group = byKind.get(i.candidateKind) ?? []
    group.push(i)
    byKind.set(i.candidateKind, group)
  }
  const kept: Scored[] = []
  for (const group of byKind.values()) kept.push(...[...group].sort(byScore).slice(0, maxPerKind))
  return [...items.filter(i => i.isWrong).sort(byScore), ...kept.sort(byScore)]
}

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
  prefs: () => Promise<Pick<Prefs, 'decide' | 'decideThreshold' | 'jev'>>
  now: () => Promise<number>
  toast: (text: string) => void
  /** the TYPESAFE_API_KEY, or undefined when it is not set */
  key: () => Promise<string | undefined>
  /** the TypeSafe call; the band passes this through from $.http.fetch, never from a direct fetch */
  fetch: JevFetch
}

export type DecideOutcome = { text: string; warned: boolean }

/**
 * Runs the step for one turn. It never throws and never blocks the turn: on any error it returns no digest and asks
 * for one toast, at most once per load.
 *
 * Order (ticket #91): the settings rules build the local score and the shortlist first. Then, when the Jev pass is on
 * and a key is set, ONE TypeSafe request re-scores that shortlist and labels the task type. The task type then picks the
 * threshold, and the digest is built from the Jev keep rule. The digest is '' when the step is off, there is nothing to
 * point at, or nothing is kept.
 */
export async function runDecide(io: DecideIo, warned: boolean): Promise<DecideOutcome> {
  const say = (text: string) => {
    try {
      if (text !== '') io.toast(text)
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
    // the path rules read the prompt's paths and the files this turn has touched, so a rule fits the work at hand
    const paths = [...new Set([...promptPaths(prompt), ...(await io.paths())])]
    // the settings rules first: the local score and the shortlist they build
    const local = scoreAll(entries, prompt, now)
    const shortlist = keepShortlist(local, pickThreshold(rules, paths, role, prefs.decideThreshold))
    if (shortlist.length === 0) return { text: '', warned: seen }

    // then the Jev pass, when it is on and a key is set. A failure here always falls back to the local shortlist.
    if (prefs.jev) {
      const jev = await runJev({ key: io.key, fetch: io.fetch, now: io.now }, shortlist, prompt)
      if (jev.isOk) {
        const threshold = pickThresholdFor(rules, { paths, role, task: jev.task }, prefs.decideThreshold)
        return { text: digestOf(keepJev(keepJevShortlist(shortlist, threshold), jev.scores)), warned: seen }
      }
      if (jev.reason !== 'no key' && !seen) {
        say(JEV_FAIL_TOAST)
        seen = true
      }
    }
    return { text: digestOf(shortlist), warned: seen }
  } catch {
    if (!warned) say(FAIL_TOAST)
    return { text: '', warned: true }
  }
}

/**
 * The shortlist the task type re-thresholds before Jev scores it: the local cut again, on the same list, with the
 * threshold the task type picked. The cut is strict, as #91 says (`score > threshold`). A wrong assumption still stays,
 * and Jev's own `p > 0.8` is the relevance check from here on, so nothing else is filtered.
 */
export function keepJevShortlist(items: readonly Scored[], threshold: number): Scored[] {
  const t = clampThreshold(threshold)
  return items.filter(i => i.isWrong || i.score > t)
}