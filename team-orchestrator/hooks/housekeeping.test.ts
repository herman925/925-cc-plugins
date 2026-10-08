import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { HEAD_NOTE, onReceive, onSend, senderOf, WORKER_NOTE } from './housekeeping'

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
