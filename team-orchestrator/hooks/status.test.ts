import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import type { Status } from './status'
import { admit, asleepWithin, awakeAge, chunk, heartbeatStale, localRef, MIN, modelArg, needsTabCheck, nextCheckInterval, noteTick, openCount, shownState, startsAtCreate, statusFile, TEAM_SETTINGS0, toClose } from './status'

const m = (name: string, boss: string): Member => ({
  team: 'T', name, role: 'r', level: 1, boss, handle: '', sessionId: '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false,
})
const list = [m('Head', 'user'), m('Lead', 'Head'), m('W1', 'Lead'), m('W2', 'Lead')]
const NOW = 1_000 * MIN
const st = (name: string, state: string, beatAgo: number, extra: Partial<Status> = {}): Status => ({ name, sessionId: '', state, heartbeat: NOW - beatAgo, ...extra })

test('status files are one per member, with file-safe names', () => {
  expect(statusFile('KS-Survey-Analyst')).toBe('status/KS-Survey-Analyst.json')
  expect(statusFile('Hualong PC Worker A')).toBe('status/Hualong_PC_Worker_A.json')
})

test('a member silent for over five minutes shows offline; closed stays closed', () => {
  expect(shownState(st('W1', 'working', 4 * MIN), NOW)).toBe('working')
  expect(shownState(st('W1', 'working', 6 * MIN), NOW)).toBe('offline')
  expect(shownState(st('W1', 'closed', 60 * MIN), NOW)).toBe('closed')
  expect(shownState(undefined, NOW)).toBeUndefined()
})

test('the tab check runs only when an open member has been silent over two minutes, and backs off when Orca is slow', () => {
  expect(needsTabCheck([st('W1', 'idle', 1 * MIN), st('W2', 'closed', 50 * MIN)], NOW)).toBe(false)
  expect(needsTabCheck([st('W1', 'idle', 3 * MIN)], NOW)).toBe(true)
  expect(nextCheckInterval(2 * MIN, 900)).toBe(4 * MIN)
  expect(nextCheckInterval(8 * MIN, 900)).toBe(10 * MIN)
  expect(nextCheckInterval(8 * MIN, 100)).toBe(2 * MIN)
})

test('auto-close takes idle workers that said clean and waited the set minutes, never heads or exempt members', () => {
  const s = new Map([
    ['Lead', st('Lead', 'idle', 0, { turnEnd: NOW - 30 * MIN, lastClean: NOW - 30 * MIN })],
    ['W1', st('W1', 'idle', 0, { turnEnd: NOW - 12 * MIN, lastClean: NOW - 11 * MIN })],
    ['W2', st('W2', 'idle', 0, { turnEnd: NOW - 3 * MIN, lastClean: NOW - 3 * MIN })],
  ])
  expect(toClose(list, s, TEAM_SETTINGS0, NOW).map(x => x.name)).toEqual(['W1'])
  expect(toClose(list, s, { ...TEAM_SETTINGS0, exempt: ['W1'] }, NOW)).toEqual([])
  expect(toClose(list, s, { ...TEAM_SETTINGS0, autoClose: false }, NOW)).toEqual([])
  expect(toClose(list, s, { ...TEAM_SETTINGS0, idleMinutes: 2 }, NOW).map(x => x.name)).toEqual(['W1', 'W2'])
  // a worker that never said clean stays open
  s.set('W1', st('W1', 'idle', 0, { turnEnd: NOW - 30 * MIN }))
  expect(toClose(list, s, TEAM_SETTINGS0, NOW)).toEqual([])
})

test('a closed worker reopens under the cap, makes room by closing the longest-idle worker, or waits in the queue', () => {
  const s = new Map([
    ['Head', st('Head', 'working', 0)],
    ['Lead', st('Lead', 'idle', 0)],
    ['W1', st('W1', 'idle', 0, { turnEnd: NOW - 9 * MIN })],
    ['W2', st('W2', 'closed', 40 * MIN)],
  ])
  expect(openCount(s, NOW)).toBe(3)
  expect(admit(list, s, { ...TEAM_SETTINGS0, maxOpen: 8 }, NOW)).toEqual({ kind: 'open' })
  expect(admit(list, s, { ...TEAM_SETTINGS0, maxOpen: 3 }, NOW)).toEqual({ kind: 'evict', name: 'W1' })
  s.set('W1', st('W1', 'working', 0))
  expect(admit(list, s, { ...TEAM_SETTINGS0, maxOpen: 3 }, NOW)).toEqual({ kind: 'queue' })
  expect(admit(list, s, { ...TEAM_SETTINGS0, maxOpen: 0 }, NOW)).toEqual({ kind: 'open' })
})

test('on-demand Create starts the top and, under a CEO, the team heads; leads and workers wait', () => {
  const t = (name: string, boss: string, team: string): Member => ({ ...m(name, boss), team })
  const org = [t('CEO', 'user', 'Org'), t('A-Head', 'CEO', 'A'), t('A-W1', 'A-Head', 'A'), t('B-Head', 'CEO', 'B'), t('B-Lead', 'B-Head', 'B')]
  expect(org.filter(x => startsAtCreate(x, org)).map(x => x.name)).toEqual(['CEO', 'A-Head', 'B-Head'])
  expect(list.filter(x => startsAtCreate(x, list)).map(x => x.name)).toEqual(['Head'])
  expect(TEAM_SETTINGS0.launch).toBe('demand')
  expect(TEAM_SETTINGS0.batch).toBe(3)
})

test('sessions start in batches of the set size', () => {
  expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]])
  expect(chunk([1, 2], 0)).toEqual([[1], [2]])
  expect(chunk([], 3)).toEqual([])
})

test('a message goes to the session on this machine, never a Remote Control copy of the same name', () => {
  const listing = [
    'Peer sessions (3):',
    '  Citation-Checker [0a0f17]  ·  Remote Control  ·  idle',
    '  Citation-Checker [3c9e21]  ·  interactive  ·  working  ·  started 1m ago',
    '  Citation-Checker-2 [777777]  ·  interactive  ·  idle',
  ].join('\r\n')
  expect(localRef(listing, 'Citation-Checker')).toBe('Citation-Checker [3c9e21]')
  expect(localRef(listing, 'Press-Conference-Analyst')).toBe('')
})

test('a start or reopen passes a model name the API accepts, never the short name shown on screen', () => {
  expect(modelArg('haiku-5-5')).toBe('claude-haiku-5-5')
  expect(modelArg('Haiku 5.5')).toBe('claude-haiku-5-5')
  expect(modelArg('opus-5-5[1m]')).toBe('claude-opus-5-5[1m]')
  expect(modelArg('claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
  expect(modelArg('haiku')).toBe('haiku')
  expect(modelArg('Sonnet')).toBe('sonnet')
  expect(modelArg('default')).toBe('')
  expect(modelArg('keep')).toBe('')
  expect(modelArg('')).toBe('')
  expect(modelArg('gpt-4o')).toBe('gpt-4o')
})

// ── 0.5.16, #71: sleep-aware clocks ──

test('a tick more than three minutes late is sleep; windows older than a day drop out; ages skip the time asleep', () => {
  const every = 30_000
  expect(noteTick(0, NOW, every, [])).toEqual([])
  expect(noteTick(NOW - every, NOW, every, [])).toEqual([])
  // three minutes late is still a slow tick, not sleep
  expect(noteTick(NOW - every - 3 * MIN, NOW, every, [])).toEqual([])
  const slept = noteTick(NOW - 120 * MIN, NOW, every, [])
  expect(slept).toEqual([{ from: NOW - 120 * MIN + every, to: NOW }])
  expect(noteTick(NOW + 25 * 60 * MIN - every, NOW + 25 * 60 * MIN, every, slept)).toEqual([])
  expect(asleepWithin(slept, NOW - 200 * MIN, NOW)).toBe(120 * MIN - every)
  // idle 5 minutes before a two-hour sleep: 5 minutes and the one tick, not 125 minutes
  expect(awakeAge(NOW - 125 * MIN, NOW, slept)).toBe(5 * MIN + every)
  expect(awakeAge(NOW - 125 * MIN, NOW)).toBe(125 * MIN)
})

test('waking up closes nothing: idle and silent ages leave the sleep out, so nobody is closed, offline or crash-checked on wake', () => {
  const slept = noteTick(NOW - 120 * MIN, NOW, 30_000, [])
  // W1 said clean and went idle 8 minutes before the machine slept; its last heartbeat was just before the sleep
  const before = NOW - 120 * MIN
  const s = new Map([['W1', st('W1', 'idle', 120 * MIN, { turnEnd: before - 8 * MIN, lastClean: before - 8 * MIN })]])
  // the clock without the sleep: offline, and (once it beats again) closed at once
  expect(shownState(s.get('W1'), NOW)).toBe('offline')
  expect(heartbeatStale(s.get('W1')!, NOW)).toBe(true)
  // with it: still idle and fresh
  expect(shownState(s.get('W1'), NOW, slept)).toBe('idle')
  expect(heartbeatStale(s.get('W1')!, NOW, slept)).toBe(false)
  expect(needsTabCheck([s.get('W1')], NOW, slept)).toBe(false)
  // it beats again on wake: the plain clock would close it now, the sleep-aware one waits for its 10 awake minutes
  const fresh = new Map([['W1', { ...s.get('W1')!, heartbeat: NOW }]])
  expect(toClose(list, fresh, TEAM_SETTINGS0, NOW).map(x => x.name)).toEqual(['W1'])
  expect(toClose(list, fresh, TEAM_SETTINGS0, NOW, slept)).toEqual([])
  expect(toClose(list, fresh, TEAM_SETTINGS0, NOW + 2 * MIN, slept).map(x => x.name)).toEqual(['W1'])
  // the members silent through the sleep still count as open at the cap
  expect(openCount(s, NOW, slept)).toBe(1)
  expect(openCount(s, NOW)).toBe(0)
})

test('a hung top only delays auto-close, never brings it forward', () => {
  // the top hung for 10 minutes while W1 and W2 kept beating
  const hung = noteTick(NOW - 10 * MIN, NOW, 30_000, [])
  const s = new Map([
    ['W1', st('W1', 'idle', 0, { turnEnd: NOW - 12 * MIN, lastClean: NOW - 12 * MIN })],
    ['W2', st('W2', 'idle', 0, { turnEnd: NOW - 30 * MIN, lastClean: NOW - 30 * MIN })],
  ])
  const plain = toClose(list, s, TEAM_SETTINGS0, NOW).map(x => x.name)
  const aware = toClose(list, s, TEAM_SETTINGS0, NOW, hung).map(x => x.name)
  expect(plain).toEqual(['W1', 'W2'])
  expect(aware).toEqual(['W2'])
  expect(aware.every(n => plain.includes(n))).toBe(true)
})
