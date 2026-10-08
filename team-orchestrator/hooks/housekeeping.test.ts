import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { HEAD_NOTE, isCleanConfirmation, onReceive, onSend, senderOf, shouldPoll, WORKER_NOTE } from './housekeeping'

const m = (name: string, boss: string, extra: Partial<Member> = {}): Member => ({
  team: 'T', name, role: 'r', level: 1, boss, handle: '', sessionId: '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false, ...extra,
})
const ceo = m('CEO', 'user')
const lead = m('Data-Lead', 'CEO', { address: 'Data-and-Numbers-Lead' })
const w1 = m('Analyst', 'Data-Lead')
const other = m('Other', 'CEO')
const list = [ceo, lead, w1, other]
const peer = (from: string) => `<cross-session-message from="uds:x" from-name="${from}" from-mode="bypass">done</cross-session-message>`

test('a worker sending to its own boss (by name, address, or with a [ref]) is told to clean up', () => {
  expect(onSend(w1, list, 'Data-Lead')).toBe(WORKER_NOTE)
  expect(onSend(lead, list, 'CEO')).toBe(WORKER_NOTE)
  expect(onSend(w1, list, 'data-and-numbers-lead [8005a7]')).toBe(WORKER_NOTE) // the boss's address, with a ref
  expect(onSend(lead, list, 'CEO [548347]')).toBe(WORKER_NOTE)
})

test('a message to anyone but the own boss, or from the top of the tree, carries no note', () => {
  expect(onSend(w1, list, 'Other')).toBeUndefined()
  expect(onSend(lead, list, 'Analyst')).toBeUndefined()
  expect(onSend(ceo, list, 'Data-and-Numbers-Lead')).toBeUndefined()
})

test('a head hearing from one of its own reports (name or address) is told to check on that worker', () => {
  expect(onReceive(lead, list, peer('Analyst'))).toBe(HEAD_NOTE('Analyst'))
  expect(onReceive(ceo, list, peer('Data-and-Numbers-Lead'))).toBe(HEAD_NOTE('Data-Lead'))
  expect(onReceive(ceo, list, peer('other'))).toBe(HEAD_NOTE('Other'))
})

test('a message from a non-report, a boss, or with no sender carries no note', () => {
  expect(onReceive(ceo, list, peer('Analyst'))).toBeUndefined() // not a direct report
  expect(onReceive(w1, list, peer('Data-and-Numbers-Lead'))).toBeUndefined() // from the boss
  expect(onReceive(lead, list, 'plain text')).toBeUndefined()
  expect(senderOf(peer('X Y'))).toBe('X Y')
})

const say = (from: string, body: string) => `<cross-session-message from="uds:x" from-name="${from}" from-mode="bypass">\n${body}\n</cross-session-message>`

test('a cleanup confirmation does not trigger the head note again (no ping-pong)', () => {
  expect(isCleanConfirmation(say('Analyst', 'clean.'))).toBe(true)
  expect(isCleanConfirmation(say('Analyst', 'clean. My scratch and /tmp files are deleted; only the live tool runtime remains.'))).toBe(true)
  expect(isCleanConfirmation(say('Data-Lead', 'Data-Lead: clean. Analysts confirmed.'))).toBe(true)
  expect(isCleanConfirmation(say('Analyst', 'All clean: no processes left.'))).toBe(true)
  expect(onReceive(lead, list, say('Analyst', 'clean.'))).toBeUndefined()
})

test('a real report that mentions cleanup still triggers the head note', () => {
  expect(isCleanConfirmation(say('Analyst', 'Tables saved to report-tables/. Housekeeping: clean.'))).toBe(false)
  expect(isCleanConfirmation(say('Analyst', 'clean ' + 'x'.repeat(500)))).toBe(false)
  expect(onReceive(lead, list, say('Analyst', 'Tables saved. Housekeeping: clean.'))).toBe(HEAD_NOTE('Analyst'))
})

test('both notes cover idle browser-automation servers', () => {
  expect(WORKER_NOTE).toContain('playwright/mcp')
  expect(WORKER_NOTE).toContain('chrome-devtools-mcp')
  expect(HEAD_NOTE('Analyst')).toContain('browser-automation')
})

test('only the team top (boss "user") or a non-member session polls Orca', () => {
  expect(shouldPoll(ceo)).toBe(true)
  expect(shouldPoll(undefined)).toBe(true)
  expect(shouldPoll(lead)).toBe(false)
  expect(shouldPoll(w1)).toBe(false)
})
