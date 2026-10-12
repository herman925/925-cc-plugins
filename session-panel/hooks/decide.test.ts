import { expect, test } from 'claude-code/testing'

import type { Assumption } from '../types'
import {
  DECIDE_FILE,
  DEFAULT_THRESHOLD,
  DIGEST_CHAR_CAP,
  DIGEST_HEAD,
  DIGEST_TAIL,
  EMPTY_RULES,
  FAIL_TOAST,
  MAX_PER_KIND,
  RULES_TOAST,
  clampThreshold,
  digestOf,
  filesTouched,
  globMatch,
  keepShortlist,
  overlapOf,
  parseRules,
  pathsOf,
  pickThreshold,
  roleFor,
  runDecide,
  scoreAssumption,
  scoreAll,
  words,
  type DecideIo,
  type Scorable,
} from './decide'
import { DAY, STALE_OPEN_MS } from './logic'

const NOW = 1_700_000_000_000
const HOUR = 60 * 60 * 1000

const at = (a: Partial<Scorable> & { id: number }): Scorable => ({
  text: 'The page is for a bakery',
  status: 'open',
  kind: 'declared',
  at: NOW - HOUR,
  ...a,
})

/** One entry as the plugin stores it, for the score to read. */
const entry = (id: number, extra: Partial<Assumption> = {}): Assumption =>
  ({ id, text: 'The page is for a bakery', turn: 1, kind: 'declared', status: 'open', at: NOW - HOUR, sessionId: 's1', ...extra }) as Assumption

// ---------- 1. the score ----------

test('score: the five parts and the weighted total are all 0 to 1', () => {
  const s = scoreAssumption(at({ id: 1 }), 'build the bakery page', NOW)
  expect(Object.keys(s.parts).sort()).toEqual(['age', 'files', 'kind', 'overlap', 'status'])
  for (const v of Object.values(s.parts)) {
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(1)
  }
  expect(s.score).toBeGreaterThanOrEqual(0)
  expect(s.score).toBeLessThanOrEqual(1)
  expect(s.candidateKind).toBe('assumption')
  expect(s.isWrong).toBe(false)
})

test('score: a wrong entry scores higher on status, a flagged entry lower on kind', () => {
  const open = scoreAssumption(at({ id: 1 }), 'x', NOW)
  const wrong = scoreAssumption(at({ id: 2, status: 'wrong' }), 'x', NOW)
  const confirmed = scoreAssumption(at({ id: 3, status: 'confirmed' }), 'x', NOW)
  const flagged = scoreAssumption(at({ id: 4, kind: 'flagged' }), 'x', NOW)
  expect(wrong.parts.status).toBeGreaterThan(open.parts.status)
  expect(open.parts.status).toBeGreaterThan(confirmed.parts.status)
  expect(open.parts.kind).toBeGreaterThan(flagged.parts.kind)
  expect(wrong.isWrong).toBe(true)
})

test('score: age falls from 1 for a fresh entry to 0 at the stale mark and never below', () => {
  expect(scoreAssumption(at({ id: 1, at: NOW }), 'x', NOW).parts.age).toBe(1)
  expect(scoreAssumption(at({ id: 2, at: NOW - STALE_OPEN_MS }), 'x', NOW).parts.age).toBe(0)
  expect(scoreAssumption(at({ id: 3, at: NOW - 30 * DAY }), 'x', NOW).parts.age).toBe(0)
  const half = scoreAssumption(at({ id: 4, at: NOW - STALE_OPEN_MS / 2 }), 'x', NOW).parts.age
  expect(Math.abs(half - 0.5)).toBeLessThan(1e-6)
})

test('words: lower case, no punctuation, no short words, no common words', () => {
  expect(words('The Bakery page, for the shop!')).toEqual(['bakery', 'page', 'shop'])
  expect(words('a b c')).toEqual([])
  expect(words('')).toEqual([])
})

test('overlap: the share of the entry words the prompt also uses', () => {
  expect(overlapOf('the bakery page', 'build the bakery page')).toBe(1)
  expect(overlapOf('the bakery page', 'build something else')).toBe(0)
  expect(Math.abs(overlapOf('bakery page', 'the bakery shop') - 0.5)).toBeLessThan(1e-6)
  expect(overlapOf('a b c', 'anything')).toBe(0)
})

test('files: an entry naming a file the prompt names scores 1; a folder path matches on the file name', () => {
  const flagged = at({ id: 1, kind: 'flagged', path: 'hooks/decide.ts', paths: ['hooks/decide.ts'] })
  expect(filesTouched(flagged, 'add the decision step to hooks/decide.ts')).toBe(1)
  expect(filesTouched(flagged, 'add the decision step to decide.ts')).toBe(1)
  expect(filesTouched(flagged, 'add the decision step')).toBe(0)
  expect(filesTouched(flagged, 'work on session-panel/hooks/other.ts')).toBe(0)
  expect(pathsOf(flagged)).toEqual(['hooks/decide.ts'])
})

// ---------- 2. the keep rule ----------

test('keep: an item is kept at the threshold and above, dropped below it', () => {
  const items = scoreAll(
    [
      at({ id: 1, text: 'the bakery page' }),
      at({ id: 2, text: 'nothing at all alike here' }),
    ],
    'build the bakery page',
    NOW,
  )
  for (const s of items) {
    expect(keepShortlist([s], s.score).map(k => k.id)).toEqual([s.id])
    expect(keepShortlist([s], Math.min(1, s.score + 0.01))).toEqual([])
  }
  expect(keepShortlist(items, 0).map(k => k.id).sort()).toEqual([1, 2])
})

test("keep: a wrong item is always kept, even when its score is under the threshold", () => {
  const weak = at({ id: 7, status: 'wrong', kind: 'flagged', at: NOW - STALE_OPEN_MS, text: 'nothing shared here' })
  const scored = scoreAll([weak], 'a prompt with no words in common', NOW)
  expect(scored[0].score).toBeLessThan(0.9)
  expect(keepShortlist(scored, 0.99).map(k => k.id)).toEqual([7])
  expect(keepShortlist(scored, 1).map(k => k.id)).toEqual([7])
})

test('keep: at most five scored items per kind, wrong items are never dropped by the cap', () => {
  const many = Array.from({ length: 8 }, (_, i) => at({ id: i + 1, text: 'the bakery page', at: NOW - i * HOUR }))
  const wrong = Array.from({ length: 6 }, (_, i) => at({ id: 100 + i, status: 'wrong', text: 'wrong one' }))
  const kept = keepShortlist(scoreAll([...many, ...wrong], 'the bakery page', NOW), 0.5)
  const scored = kept.filter(k => !k.isWrong)
  expect(scored.length).toBe(MAX_PER_KIND)
  expect(kept.filter(k => k.isWrong).length).toBe(6)
})

test('keep: wrong items come first, then the rest by score, highest first', () => {
  const items = [
    scoreAssumption(at({ id: 1, text: 'bakery page', at: NOW - 8 * HOUR }), 'the bakery page', NOW),
    scoreAssumption(at({ id: 2, text: 'bakery page', at: NOW }), 'the bakery page', NOW),
    scoreAssumption(at({ id: 3, status: 'wrong', text: 'elsewhere', at: NOW - 5 * DAY }), 'the bakery page', NOW),
  ]
  const kept = keepShortlist(items, 0.3)
  expect(kept.map(k => k.id)).toEqual([3, 2, 1])
})

test('keep: a list with nothing over the threshold keeps nothing', () => {
  const items = scoreAll([at({ id: 1, text: 'nothing shared here', at: NOW - STALE_OPEN_MS, kind: 'flagged', status: 'confirmed' })], 'xyz', NOW)
  expect(keepShortlist(items, 0.9)).toEqual([])
})

// ---------- 3. the digest ----------

test('digest: the pointer line, the wrong quotation in full, and the skip line', () => {
  const kept = scoreAll([at({ id: 19, status: 'wrong', text: 'Prices are in dollars.' }), at({ id: 24 })], 'the bakery page', NOW)
  const text = digestOf(keepShortlist(kept, DEFAULT_THRESHOLD))
  expect(text).toBe(`${DIGEST_HEAD}#19 (wrong: "Prices are in dollars."), #24${DIGEST_TAIL}`)
  expect(text).toContain('Skip the rest')
})

test('digest: a wrong entry is quoted in full, over more than one line, as one line', () => {
  const long = at({ id: 4, status: 'wrong', text: 'The first line.\nThe second   line.' })
  const text = digestOf(scoreAll([long], 'x', NOW))
  expect(text).toContain('#4 (wrong: "The first line. The second line.")')
})

test('digest: nothing kept means no digest at all', () => {
  expect(digestOf([])).toBe('')
})

test('digest: a right entry is dropped when the budget is spent; a wrong one always fits', () => {
  const many = Array.from({ length: 20 }, (_, i) => at({ id: i + 1, text: 'the bakery page' }))
  const text = digestOf(scoreAll(many, 'the bakery page', NOW), 60)
  expect(text.match(/#\d+/g)!.length).toBeLessThan(20)
  expect(text.length).toBeLessThan(DIGEST_CHAR_CAP)
  // a wrong entry prints in full, however long, and is never dropped by the budget
  const longWrong = at({ id: 99, status: 'wrong', text: 'w'.repeat(500) })
  const withWrong = digestOf(scoreAll([longWrong, ...many], 'the bakery page', NOW), 60)
  expect(withWrong).toContain('#99 (wrong:')
  expect(withWrong).toContain('w'.repeat(500))
  expect(withWrong.match(/#\d+/g)).toEqual(['#99'])
})

test('digest: it reads about 60 to 90 tokens', () => {
  const kept = scoreAll([at({ id: 3, status: 'wrong', text: 'The bakery is a shop.' }), at({ id: 8 }), at({ id: 9 })], 'x', NOW)
  const text = digestOf(keepShortlist(kept, 0))
  expect(text.length).toBeGreaterThan(50)
  expect(text.length).toBeLessThan(DIGEST_CHAR_CAP)
})

// ---------- 4. the rules file and the rule order ----------

test('rules: the file path is fixed, a missing or empty file is no rules', () => {
  expect(DECIDE_FILE).toBe('.claude/session-panel/decide.json')
  expect(parseRules(undefined)).toEqual({ ok: true, rules: EMPTY_RULES })
  expect(parseRules('   ')).toEqual({ ok: true, rules: EMPTY_RULES })
})

test('rules: the three rule kinds are read; junk is a reason and a clamped number is kept', () => {
  const r = parseRules(JSON.stringify({ default: 0.6, paths: { 'src/**': 0.7 }, roles: { tester: 0.8 } }))
  expect(r).toEqual({ ok: true, rules: { version: 1, default: 0.6, paths: { 'src/**': 0.7 }, roles: { tester: 0.8 } } })
  // task rules are slice 2: the key is read as an ordinary field and never used, so it is simply absent here
  expect(Object.hasOwn((r as any).rules, 'tasks')).toBe(false)
  expect(parseRules('not json')).toEqual({ ok: false, reason: 'not JSON' })
  expect(parseRules('[1,2]')).toEqual({ ok: false, reason: 'not an object' })
  const junk = parseRules(JSON.stringify({ default: 'x', paths: { 'a/**': 'x', 'b/**': 0.9 }, roles: [] }))
  expect(junk).toEqual({ ok: true, rules: { version: 1, default: undefined, paths: { 'b/**': 0.9 }, roles: {} } })
  const clamp = parseRules(JSON.stringify({ default: 4, paths: { 'a': -1 } }))
  expect(clamp).toEqual({ ok: true, rules: { version: 1, default: 1, paths: { a: 0 }, roles: {} } })
})

test('glob: ** crosses folders, * and ? stay inside one, and the case is ignored', () => {
  expect(globMatch('src/**', 'src/app/page.tsx')).toBe(true)
  expect(globMatch('src/**/*.ts', 'src/app/page.ts')).toBe(true)
  expect(globMatch('src/*.ts', 'src/app/page.ts')).toBe(false)
  expect(globMatch('src/*.ts', 'src/page.ts')).toBe(true)
  expect(globMatch('?.ts', 'a.ts')).toBe(true)
  expect(globMatch('src/**', 'SRC/App/Page.TSX')).toBe(true)
  expect(globMatch('docs/**', 'src/app/page.tsx')).toBe(false)
})

test('order: path wins over role, role wins over default, default wins over the Settings value', () => {
  const rules = parseRules(JSON.stringify({ default: 0.6, paths: { 'src/**': 0.7 }, roles: { tester: 0.8 } })).ok
    ? (parseRules(JSON.stringify({ default: 0.6, paths: { 'src/**': 0.7 }, roles: { tester: 0.8 } })) as any).rules
    : EMPTY_RULES
  expect(pickThreshold(rules, ['src/app/page.tsx'], 'tester', 0.5)).toBe(0.7)
  expect(pickThreshold(rules, ['docs/a.md'], 'tester', 0.5)).toBe(0.8)
  expect(pickThreshold(rules, ['docs/a.md'], 'other', 0.5)).toBe(0.6)
  expect(pickThreshold(EMPTY_RULES, ['docs/a.md'], 'tester', 0.42)).toBe(0.42)
  expect(pickThreshold({ ...EMPTY_RULES, roles: { tester: 0.8 } }, [], undefined, 0.5)).toBe(0.5)
  expect(pickThreshold({ ...EMPTY_RULES, roles: { tester: 0.8 } }, [], 'Tester', 0.5)).toBe(0.8)
})

test('order: with two globs matching, the longer one wins', () => {
  const rules = { version: 1, paths: { 'src/**': 0.7, 'src/app/**': 0.9, '**': 0.2 }, roles: {} }
  expect(pickThreshold(rules, ['src/app/page.tsx'], undefined, 0.5)).toBe(0.9)
  expect(pickThreshold(rules, ['src/x.ts'], undefined, 0.5)).toBe(0.7)
  expect(pickThreshold(rules, ['docs/a.md'], undefined, 0.5)).toBe(0.2)
})

test('role: the roster role of this session, or none when the roster is junk or not on it', () => {
  const roster = JSON.stringify([
    { name: 'Mod CEO', team: 'Mods', boss: 'user', sessionId: '06e389e1', role: 'head' },
    { name: 'Mod Builder', team: 'Mods', boss: 'Mod CEO', sessionId: 'abc123', role: 'builder' },
  ])
  expect(roleFor(roster, 'abc123')).toBe('builder')
  expect(roleFor(roster, 'nobody')).toBeUndefined()
  expect(roleFor('not json', 'abc123')).toBeUndefined()
  expect(roleFor(JSON.stringify([{ sessionId: 'x' }]), 'x')).toBeUndefined()
})

test('clamp: a threshold is always 0 to 1, and junk is the default', () => {
  expect(clampThreshold(0.7)).toBe(0.7)
  expect(clampThreshold(-2)).toBe(0)
  expect(clampThreshold(9)).toBe(1)
  expect(clampThreshold(Number.NaN)).toBe(DEFAULT_THRESHOLD)
})

// ---------- 5. the step: it never throws and never blocks a turn ----------

function ioOf(opts: { rules?: string | undefined; role?: string; box?: string; paths?: string[]; entries?: Assumption[]; decide?: boolean; threshold?: number; fail?: 'box' | 'entries' | 'rules' | 'now' | 'paths' } = {}) {
  const toasts: string[] = []
  const io: DecideIo = {
    rules: async () => {
      if (opts.fail === 'rules') throw new Error('boom')
      return opts.rules
    },
    role: async () => opts.role,
    box: async () => {
      if (opts.fail === 'box') throw new Error('boom')
      return opts.box ?? 'the bakery page'
    },
    paths: async () => {
      if (opts.fail === 'paths') throw new Error('boom')
      return opts.paths ?? []
    },
    entries: async () => {
      if (opts.fail === 'entries') throw new Error('boom')
      return opts.entries ?? [entry(1)]
    },
    prefs: async () => ({ decide: opts.decide ?? true, decideThreshold: opts.threshold ?? DEFAULT_THRESHOLD }),
    now: async () => {
      if (opts.fail === 'now') throw new Error('boom')
      return NOW
    },
    toast: t => void toasts.push(t),
  }
  return { io, toasts }
}

test('step: off adds nothing and says nothing', async () => {
  const { io, toasts } = ioOf({ decide: false })
  expect(await runDecide(io, false)).toEqual({ text: '', warned: false })
  expect(toasts).toEqual([])
})

test('step: the digest is injected, with the wrong entry quoted in full', async () => {
  const { io, toasts } = ioOf({ entries: [entry(19, { status: 'wrong', text: 'Prices are in dollars.' }), entry(24)] })
  const r = await runDecide(io, false)
  expect(r.text).toContain('Read only these assumptions:')
  expect(r.text).toContain('#19 (wrong: "Prices are in dollars.")')
  expect(r.text).toContain('#24')
  expect(r.text).toContain('Skip the rest.')
  expect(toasts).toEqual([])
})

test('step: no assumptions means no digest, and no toast', async () => {
  const { io, toasts } = ioOf({ entries: [] })
  expect(await runDecide(io, false)).toEqual({ text: '', warned: false })
  expect(toasts).toEqual([])
})

test('step: a junk rules file falls back to the Settings threshold and shows one toast, once per load', async () => {
  const { io, toasts } = ioOf({ rules: 'not json', threshold: DEFAULT_THRESHOLD })
  const first = await runDecide(io, false)
  expect(first.warned).toBe(true)
  expect(toasts).toEqual([RULES_TOAST])
  expect(first.text).toContain('#1')
  // the toast shows once per load, not once per turn
  const second = await runDecide(io, true)
  expect(toasts).toEqual([RULES_TOAST])
  expect(second.warned).toBe(true)
  // a strict Settings value still applies when the file cannot be read
  const strict = ioOf({ rules: 'not json', threshold: 0.9 })
  expect((await runDecide(strict.io, false)).text).toBe('')
})

test('step: a rules file that reads the threshold through wins over the Settings value', async () => {
  const entries = [entry(1, { text: 'the bakery page' })]
  const loose = await runDecide(ioOf({ entries, rules: JSON.stringify({ default: 0.1 }), threshold: 0.99 }).io, false)
  expect(loose.text).toContain('#1')
  const tight = await runDecide(ioOf({ entries, rules: JSON.stringify({ default: 0.99 }), threshold: 0.1 }).io, false)
  expect(tight.text).toBe('')
})

test('step: any error gives no digest and one toast, and never throws', async () => {
  for (const fail of ['box', 'entries', 'rules', 'now', 'paths'] as const) {
    const { io, toasts } = ioOf({ fail })
    const r = await runDecide(io, false)
    expect(r.text).toBe('')
    expect(toasts).toEqual([FAIL_TOAST])
    expect(r.warned).toBe(true)
    expect((await runDecide(io, true)).text).toBe('')
  }
})

test('step: a toast that cannot be shown still returns a digest', async () => {
  const { io } = ioOf({ rules: 'not json' })
  const broken: DecideIo = { ...io, toast: () => { throw new Error('no band') } }
  const r = await runDecide(broken, false)
  expect(r.text).not.toBe('')
  expect(r.warned).toBe(true)
})

test('step: a path rule fits the files this turn has touched, so the prompt box may name none', async () => {
  const entries = [entry(1, { text: 'the bakery page' })]
  const rules = JSON.stringify({ default: 0.1, paths: { 'hooks/**': 0.99 } })
  expect((await runDecide(ioOf({ entries, rules, paths: ['hooks/decide.ts'] }).io, false)).text).toBe('')
  expect((await runDecide(ioOf({ entries, rules, paths: ['docs/a.md'] }).io, false)).text).toContain('#1')
})

test('step: the rules file and the role decide the threshold the keep rule uses', async () => {
  const entries = [entry(1, { text: 'the bakery page' }), entry(2, { text: 'the bakery page', at: NOW - 6 * DAY })]
  const loose = ioOf({ entries, threshold: DEFAULT_THRESHOLD })
  const wide = await runDecide(loose.io, false)
  expect(wide.text).toContain('#1')
  // a role rule of 1 keeps only what scores a perfect 1: here, nothing
  const strict = ioOf({ entries, rules: JSON.stringify({ roles: { builder: 1 } }), role: 'Builder' })
  const narrow = await runDecide(strict.io, false)
  expect(narrow.text).not.toContain('#1')
})