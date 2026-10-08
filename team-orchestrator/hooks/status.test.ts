import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import type { Status } from './status'
import { admit, MIN, needsTabCheck, nextCheckInterval, openCount, shownState, statusFile, TEAM_SETTINGS0, toClose } from './status'

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
