import { expect, test } from 'claude-code/testing'

import type { Assumption } from '../types'
import {
  DECIDE_FILE,
  DEFAULT_THRESHOLD,
  JEV_FAIL_TOAST,
  JEV_KEY_VAR,
  JEV_KEEP,
  JEV_MODEL,
  JEV_QUESTION,
  JEV_TIMEOUT_MS,
  JEV_URL,
  TASK_CRITERIA,
  TASK_TYPES,
  WRONG_QUOTED,
  DIGEST_CHAR_CAP,
  DIGEST_HEAD,
  DIGEST_TAIL,
  EMPTY_RULES,
  FAIL_TOAST,
  MAX_PER_KIND,
  RULES_TOAST,
  baseName,
  clampThreshold,
  digestOf,
  filesTouched,
  globMatch,
  jevId,
  jevRequestBody,
  keepJev,
  keepJevShortlist,
  keepShortlist,
  overlapOf,
  parseRules,
  parseJevReply,
  pathsOf,
  pickThreshold,
  pickThresholdFor,
  roleFor,
  runDecide,
  runJev,
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

test('keep: the cut is strict, so a score equal to the threshold is dropped', () => {
  const items = scoreAll(
    [
      at({ id: 1, text: 'the bakery page' }),
      at({ id: 2, text: 'nothing at all alike here' }),
    ],
    'build the bakery page',
    NOW,
  )
  // item 1 shares words with the prompt, so only the cut decides it
  const match = items.find(i => i.id === 1)!
  expect(match.matched).toBe(true)
  expect(keepShortlist([match], Math.max(0, match.score - 0.01)).map(k => k.id)).toEqual([1])
  expect(keepShortlist([match], match.score)).toEqual([])
  // a matching item is kept at any threshold under its score, and the stranger is dropped by must-match whatever it is
  expect(keepShortlist(items, 0).map(k => k.id)).toEqual([1])
})

// 1 of the review fixes (0.3.53): the local score only keeps an entry that matches the prompt at all
test('keep: with the local score, a non-wrong item needs a file or a meaningful word to be kept', () => {
  // all three are fresh, declared and open, so status, age and kind rank them the same way
  const stranger = at({ id: 1, text: 'The invoices go out on Fridays' })
  const sharesWord = at({ id: 2, text: 'The bakery page needs a footer' })
  const sharesFile = at({ id: 3, kind: 'flagged', text: 'A line about something else', path: 'hooks/decide.ts', paths: ['hooks/decide.ts'] })
  const items = scoreAll([stranger, sharesWord, sharesFile], 'build the bakery page in hooks/decide.ts', NOW)

  expect(items.find(i => i.id === 1)!.matched).toBe(false)
  expect(items.find(i => i.id === 2)!.matched).toBe(true)
  expect(items.find(i => i.id === 3)!.matched).toBe(true)

  const kept = keepShortlist(items, 0.01)
  expect(kept.map(k => k.id).sort()).toEqual([2, 3])
  // the stranger is dropped however high its status, age and kind would rank it
  const fresh = scoreAll([at({ id: 9, kind: 'declared', status: 'open', at: NOW, text: 'A line about something else' })], 'build the bakery page', NOW)
  expect(fresh[0].parts.status + fresh[0].parts.age + fresh[0].parts.kind).toBeGreaterThan(0.5)
  expect(keepShortlist(fresh, 0.01)).toEqual([])
})

test('keep: a wrong item is kept even when it matches nothing at all', () => {
  const wrong = at({ id: 5, status: 'wrong', text: 'A line about something else' })
  const items = scoreAll([wrong], 'build the bakery page', NOW)
  expect(items[0].matched).toBe(false)
  expect(items[0].isWrong).toBe(true)
  expect(keepShortlist(items, 1).map(k => k.id)).toEqual([5])
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

// 2 of the review fixes (0.3.53): at most five wrong assumptions are quoted in full
test('digest: at most five wrong entries are quoted in full, the rest show as ids', () => {
  const wrong = (id: number) => at({ id, status: 'wrong', text: `Wrong number ${id}.` })
  const kept = scoreAll([wrong(1), wrong(2), wrong(3), wrong(4), wrong(5), wrong(6), wrong(7)], 'x', NOW)
  const text = digestOf(keepShortlist(kept, 1))
  // the five newest are quoted in full
  for (const id of [3, 4, 5, 6, 7]) expect(text).toContain(`#${id} (wrong: "Wrong number ${id}.")`)
  // the two oldest are ids only, after the marker
  expect(text).toContain('also wrong: #2, #1')
  expect(text).not.toContain('#1 (wrong:')
  expect(text).not.toContain('#2 (wrong:')
  // a quoted wrong entry still never counts against the budget, and the skip line is last
  expect(text.endsWith('Skip the rest.')).toBe(true)
  expect(WRONG_QUOTED).toBe(5)
})

test('digest: with five wrong entries or fewer there is no "also wrong" line', () => {
  const wrong = (id: number) => at({ id, status: 'wrong', text: `Wrong ${id}.` })
  const five = digestOf(scoreAll([wrong(1), wrong(2), wrong(3), wrong(4), wrong(5)], 'x', NOW))
  expect(five).toContain('#5 (wrong: "Wrong 5.")')
  expect(five).not.toContain('also wrong')
  const six = digestOf(scoreAll([wrong(1), wrong(2), wrong(3), wrong(4), wrong(5), wrong(6)], 'x', NOW))
  expect(six).toContain('also wrong: #1')
})

// 4 of the review fixes (0.3.53): how a prompt path matches an entry path
test('files: a prompt path with a folder matches by full path or path suffix, never by bare name', () => {
  const entry = (path: string) => at({ id: 1, kind: 'flagged', path, paths: [path] })
  // full path: a match
  expect(filesTouched(entry('hooks/decide.ts'), 'work on hooks/decide.ts please')).toBe(1)
  // path suffix: a match
  expect(filesTouched(entry('src/hooks/decide.ts'), 'work on hooks/decide.ts please')).toBe(1)
  // the same bare name in another folder: NOT a match, because the prompt names a folder
  expect(filesTouched(entry('README/decide.ts'), 'work on hooks/decide.ts please')).toBe(0)
  expect(filesTouched(entry('src/decide.ts'), 'work on hooks/decide.ts please')).toBe(0)
  // a deeper folder that still ends in the prompt's path is a suffix match
  expect(filesTouched(entry('other/place/hooks/decide.ts'), 'work on hooks/decide.ts please')).toBe(1)
  // a bare file name in the prompt still matches by base name, whatever folder either path sits in
  expect(filesTouched(entry('src/hooks/decide.ts'), 'work on decide.ts please')).toBe(1)
  expect(filesTouched(entry('decide.ts'), 'work on decide.ts please')).toBe(1)
  expect(filesTouched(entry('src/other.ts'), 'work on decide.ts please')).toBe(0)
  // the comparison ignores case and backslashes
  expect(filesTouched(entry('Hooks\\Decide.ts'), 'work on hooks/decide.ts please')).toBe(1)
  expect(baseName('src\\a\\b.ts')).toBe('b.ts')
})

// ---------- 4. the rules file and the rule order ----------

test('rules: the file path is fixed, a missing or empty file is no rules', () => {
  expect(DECIDE_FILE).toBe('.claude/session-panel/decide.json')
  expect(parseRules(undefined)).toEqual({ ok: true, rules: EMPTY_RULES })
  expect(parseRules('   ')).toEqual({ ok: true, rules: EMPTY_RULES })
})

test('rules: the three rule kinds are read; junk is a reason and a clamped number is kept', () => {
  const r = parseRules(JSON.stringify({ default: 0.6, paths: { 'src/**': 0.7 }, roles: { tester: 0.8 } }))
  expect(r).toEqual({ ok: true, rules: { version: 1, default: 0.6, paths: { 'src/**': 0.7 }, roles: { tester: 0.8 }, tasks: {} } })
  // task rules arrived in slice 2: the key is read like the other two, and an absent one is an empty map
  expect((r as any).rules.tasks).toEqual({})
  expect(parseRules(JSON.stringify({ tasks: { docs: 0.7 } }))).toEqual({
    ok: true,
    rules: { version: 1, default: undefined, paths: {}, roles: {}, tasks: { docs: 0.7 } },
  })
  expect(parseRules('not json')).toEqual({ ok: false, reason: 'not JSON' })
  expect(parseRules('[1,2]')).toEqual({ ok: false, reason: 'not an object' })
  const junk = parseRules(JSON.stringify({ default: 'x', paths: { 'a/**': 'x', 'b/**': 0.9 }, roles: [] }))
  expect(junk).toEqual({ ok: true, rules: { version: 1, default: undefined, paths: { 'b/**': 0.9 }, roles: {}, tasks: {} } })
  const clamp = parseRules(JSON.stringify({ default: 4, paths: { 'a': -1 } }))
  expect(clamp).toEqual({ ok: true, rules: { version: 1, default: 1, paths: { a: 0 }, roles: {}, tasks: {} } })
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
  const rules = { version: 1, paths: { 'src/**': 0.7, 'src/app/**': 0.9, '**': 0.2 }, roles: {}, tasks: {} }
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

function ioOf(opts: {
  rules?: string | undefined
  role?: string
  box?: string
  paths?: string[]
  entries?: Assumption[]
  decide?: boolean
  jev?: boolean
  threshold?: number
  key?: string
  reply?: { status: number; body: string } | 'throw' | 'slow'
  fail?: 'box' | 'entries' | 'rules' | 'now' | 'paths'
} = {}) {
  const toasts: string[] = []
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string; timeoutMs: number }> = []
  let clock = NOW
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
    prefs: async () => ({ decide: opts.decide ?? true, decideThreshold: opts.threshold ?? DEFAULT_THRESHOLD, jev: opts.jev ?? false }),
    now: async () => {
      if (opts.fail === 'now') throw new Error('boom')
      return clock
    },
    toast: t => void toasts.push(t),
    key: async () => opts.key,
    fetch: async args => {
      calls.push(args)
      if (opts.reply === 'throw') throw new Error('the network is down')
      // a slow answer: the clock jumps past the Jev timeout while the call is in flight
      if (opts.reply === 'slow') clock += 5000
      return opts.reply ?? { status: 200, body: '{}' }
    },
  }
  return { io, toasts, calls }
}

/** A Jev reply: one noul answer per assumption id, plus the task-type choice. */
const jevReply = (byId: Record<number, number>, task = 'build') => ({
  status: 200,
  body: JSON.stringify({
    model: 'jev-1.13.0',
    answers: {
      ...Object.fromEntries(Object.entries(byId).map(([id, noul]) => [`assumption_${id}`, { type: 'noul', noul }])),
      task_type: { type: 'choice', choice: task, confidence: 0.9, probabilities: { [task]: 0.9 } },
    },
  }),
})

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

// ---------- 6. the Jev pass (slice 2): TypeSafe System One, opt-in ----------

test('jev: no key means Jev is off, nothing is asked, and nothing is said', async () => {
  const { io, toasts, calls } = ioOf({ jev: true, key: undefined })
  const r = await runDecide(io, false)
  expect(calls).toEqual([])
  expect(toasts).toEqual([])
  expect(r.text).toContain('#1')
})

test('jev: an empty or blank key counts as no key', async () => {
  for (const key of ['', '   ']) {
    const { io, calls, toasts } = ioOf({ jev: true, key })
    await runDecide(io, false)
    expect(calls).toEqual([])
    expect(toasts).toEqual([])
  }
})

test('jev: with the pass off, no request is made even when a key is set', async () => {
  const { io, calls } = ioOf({ jev: false, key: 'k-123' })
  await runDecide(io, false)
  expect(calls).toEqual([])
})

test('jev: one request, to the fixed endpoint, with the model, the Nouls and the task Choice', async () => {
  const { io, calls } = ioOf({
    jev: true,
    key: 'k-123',
    entries: [entry(19, { status: 'wrong', text: 'Prices are in dollars.' }), entry(24)],
    reply: jevReply({ 19: 0.2, 24: 0.95 }),
  })
  await runDecide(io, false)
  expect(calls.length).toBe(1)
  const call = calls[0]
  expect(call.url).toBe(JEV_URL)
  expect(call.method).toBe('POST')
  expect(call.headers.Authorization).toBe('Bearer k-123')
  expect(call.timeoutMs).toBe(JEV_TIMEOUT_MS)
  const body = JSON.parse(call.body)
  expect(body.model).toBe(JEV_MODEL)
  expect(body.state).toBe('the bakery page')
  expect(body.questions[jevId(19)]).toEqual({ type: 'noul', instructions: JEV_QUESTION })
  expect(body.questions[jevId(24)]).toEqual({ type: 'noul', instructions: JEV_QUESTION })
  expect(body.questions.task_type.type).toBe('choice')
  expect(Object.keys(body.questions.task_type.criteria).sort()).toEqual([...TASK_TYPES].sort())
})

test('jev: the keep rule is p over 0.8, at most five per kind, and a wrong item always stays', async () => {
  const items = scoreAll(
    [
      at({ id: 1, text: 'the bakery page' }),
      at({ id: 2, text: 'the bakery page' }),
      at({ id: 3, text: 'the bakery page' }),
      at({ id: 4, status: 'wrong', text: 'nothing shared' }),
    ],
    'the bakery page',
    NOW,
  )
  // exactly 0.8 is not over it; 0.81 and 0.99 are. The wrong item is kept whatever Jev said.
  const kept = keepJev(items, { 1: 0.81, 2: 0.8, 3: 0.99 })
  expect(kept.map(k => k.id).sort()).toEqual([1, 3, 4])
  const kept2 = keepJev(items, { 1: 0.8, 2: 0.5, 3: 0.79 })
  expect(kept2.map(k => k.id)).toEqual([4])
  // an item Jev did not answer is left to the local score: it is not kept here
  expect(keepJev(items, {}).map(k => k.id)).toEqual([4])
})

test('jev: at most five per kind survive the Jev keep rule', async () => {
  const many = Array.from({ length: 8 }, (_, i) => at({ id: i + 1, text: 'the bakery page' }))
  const scores = Object.fromEntries(many.map(a => [a.id, 0.99]))
  const kept = keepJev(scoreAll(many, 'the bakery page', NOW), scores)
  expect(kept.length).toBe(5)
  expect(JEV_KEEP).toBe(0.8)
})

test('jev: a good answer changes which entries the digest points at', async () => {
  // two entries tie on the local score; Jev prefers the second, so the digest drops the first
  const entries = [entry(1, { text: 'the bakery page' }), entry(2, { text: 'the bakery page' })]
  const { io } = ioOf({ jev: true, key: 'k', entries, reply: jevReply({ 1: 0.1, 2: 0.99 }) })
  const r = await runDecide(io, false)
  expect(r.text).toContain('#2')
  expect(r.text).not.toContain('#1')
})

test('jev: an HTTP error falls back to the local score, with one toast per load', async () => {
  const { io, toasts } = ioOf({ jev: true, key: 'k', reply: { status: 401, body: '{"error":"bad key"}' } })
  const first = await runDecide(io, false)
  expect(first.text).toContain('#1')
  expect(toasts).toEqual([JEV_FAIL_TOAST])
  const second = await runDecide(io, true)
  expect(toasts).toEqual([JEV_FAIL_TOAST])
  expect(second.text).toContain('#1')
})

test('jev: a thrown call falls back, and the turn is never blocked', async () => {
  const { io, toasts } = ioOf({ jev: true, key: 'k', reply: 'throw' })
  const r = await runDecide(io, false)
  expect(r.text).toContain('#1')
  expect(toasts).toEqual([JEV_FAIL_TOAST])
})

test('jev: an answer slower than 1.5 s falls back to the local score', async () => {
  const { io, toasts } = ioOf({ jev: true, key: 'k', reply: 'slow' })
  const r = await runDecide(io, false)
  expect(r.text).toContain('#1')
  expect(toasts).toEqual([JEV_FAIL_TOAST])
  expect(JEV_TIMEOUT_MS).toBe(1500)
})

test('jev: a reply that is not JSON, or holds no answer, falls back', async () => {
  for (const body of ['not json at all', '{"answers":{}}', '{"answers":null}']) {
    const { io, toasts } = ioOf({ jev: true, key: 'k', reply: { status: 200, body } })
    const r = await runDecide(io, false)
    expect(r.text).toContain('#1')
    expect(toasts).toEqual([JEV_FAIL_TOAST])
  }
})

test('jev: the reply shape is read strictly, and a junk task type becomes other', async () => {
  const items = scoreAll([at({ id: 7 }), at({ id: 8 })], 'x', NOW)
  const out = parseJevReply(
    JSON.stringify({ answers: { assumption_7: { type: 'noul', noul: 0.9 }, assumption_8: { type: 'noul', noul: 'x' }, task_type: { choice: 'nonsense' } } }),
    items,
  )
  expect(out.scores).toEqual({ 7: 0.9 })
  expect(out.task).toBe('other')
  const missing = parseJevReply('{}', items)
  expect(missing).toEqual({ scores: {}, task: 'other' })
})

test('jev: the request body names every shortlist item and no more', async () => {
  const items = scoreAll([at({ id: 1 }), at({ id: 2 })], 'x', NOW)
  const body = JSON.parse(jevRequestBody(items, 'the prompt'))
  expect(Object.keys(body.questions)).toEqual(['assumption_1', 'assumption_2', 'task_type'])
  expect(jevId(3)).toBe('assumption_3')
})

test('jev: with the step off, the pass is never asked for anything', async () => {
  const { io, calls, toasts } = ioOf({ decide: false, jev: true, key: 'k' })
  expect((await runDecide(io, false)).text).toBe('')
  expect(calls).toEqual([])
  expect(toasts).toEqual([])
})

// 3 of the review fixes (0.3.53): the Jev path re-cuts with the same strict rule, and Jev's p > 0.8 is its own check
test('jev: the task-type re-cut is strict too, and a wrong item still stays', () => {
  const items = scoreAll(
    [at({ id: 1, text: 'the bakery page' }), at({ id: 2, status: 'wrong', text: 'nothing shared' })],
    'the bakery page',
    NOW,
  )
  const match = items.find(i => i.id === 1)!
  expect(keepJevShortlist(items, match.score).map(k => k.id)).toEqual([2])
  expect(keepJevShortlist(items, Math.max(0, match.score - 0.01)).map(k => k.id).sort()).toEqual([1, 2])
})

test('jev: Jev relevance is its own check, so a matched item Jev rejects is dropped', async () => {
  const items = scoreAll([at({ id: 1, text: 'the bakery page' })], 'the bakery page', NOW)
  expect(keepJev(items, { 1: 0.79 }).map(k => k.id)).toEqual([])
  expect(keepJev(items, { 1: 0.81 }).map(k => k.id)).toEqual([1])
})

// ---------- 7. the rule order with the task type (slice 2) ----------

test('order: path, then role, then task type, then default, then the Settings value', () => {
  const rules = {
    version: 1,
    default: 0.6,
    paths: { 'src/**': 0.7 },
    roles: { tester: 0.8 },
    tasks: { docs: 0.9, build: 0.55 },
  }
  // path beats everything
  expect(pickThresholdFor(rules, { paths: ['src/a.ts'], role: 'tester', task: 'docs' }, 0.5)).toBe(0.7)
  // role beats the task type and the default
  expect(pickThresholdFor(rules, { paths: ['docs/a.md'], role: 'tester', task: 'docs' }, 0.5)).toBe(0.8)
  // the task type beats the default
  expect(pickThresholdFor(rules, { paths: ['docs/a.md'], role: 'builder', task: 'docs' }, 0.5)).toBe(0.9)
  // the default beats the Settings value
  expect(pickThresholdFor(rules, { paths: [], role: undefined, task: 'other' }, 0.5)).toBe(0.6)
  // no rule at all: the Settings value
  expect(pickThresholdFor(EMPTY_RULES, { paths: [], role: undefined, task: 'build' }, 0.42)).toBe(0.42)
  // a task rule is matched without case, and an unknown task falls through
  expect(pickThresholdFor(rules, { paths: [], task: 'BUILD' }, 0.5)).toBe(0.55)
  expect(pickThresholdFor({ ...EMPTY_RULES, tasks: { docs: 0.9 } }, { paths: [], task: 'fix' }, 0.5)).toBe(0.5)
})

test('order: the task type read from the rules file itself is used', () => {
  const parsed = parseRules(JSON.stringify({ default: 0.5, tasks: { research: 0.75 } }))
  expect(parsed.ok).toBe(true)
  const rules = parsed.ok ? parsed.rules : EMPTY_RULES
  expect(rules.tasks).toEqual({ research: 0.75 })
  expect(pickThresholdFor(rules, { paths: [], task: 'research' }, 0.5)).toBe(0.75)
})

test('order: the Jev task type picks the threshold the digest is built with', async () => {
  // a docs rule of 1 keeps nothing scored; only a wrong item would survive it
  const rules = JSON.stringify({ default: 0.5, tasks: { docs: 1 } })
  const entries = [entry(1, { text: 'the bakery page' })]
  const strict = await runDecide(ioOf({ jev: true, key: 'k', rules, entries, reply: jevReply({ 1: 0.99 }, 'docs') }).io, false)
  expect(strict.text).toBe('')
  const loose = await runDecide(ioOf({ jev: true, key: 'k', rules, entries, reply: jevReply({ 1: 0.99 }, 'other') }).io, false)
  expect(loose.text).toContain('#1')
})
