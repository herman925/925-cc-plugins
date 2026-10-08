import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { MARKER, mergeRole, orgOf, pointer, roleText, WELCOME } from './roles'

const m = (name: string, boss: string, team: string, role = 'r'): Member => ({
  team, name, role, level: 1, boss, handle: '', sessionId: '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false,
})
const all = [m('CEO', 'user', 'Org'), m('A-Head', 'CEO', 'A'), m('A-W1', 'A-Head', 'A'), m('B-Head', 'CEO', 'B'), m('B-W1', 'B-Head', 'B')]

test('a role file knows the member, its boss, its reports and the team, including a CEO\'s heads in other teams', () => {
  expect(orgOf(all, 'Org').map(x => x.name)).toEqual(['CEO', 'A-Head', 'B-Head'])
  expect(orgOf(all, 'A').map(x => x.name)).toEqual(['CEO', 'A-Head', 'A-W1'])
  const ceo = roleText(all[0]!, orgOf(all, 'Org'))
  expect(ceo).toContain('Direct reports: A-Head, B-Head.')
  expect(ceo).toContain('team_message')
  const w = roleText(all[2]!, orgOf(all, 'A'))
  expect(w).toContain('Boss: A-Head.')
  expect(w).toContain('Talk only to your boss')
  expect(w).toContain('roles/A-W1.md')
})

test('a rewrite keeps the person\'s notes below the marker and replaces only the generated part', () => {
  const first = mergeRole(undefined, 'GEN 1\r\n')
  expect(first).toContain(MARKER)
  expect(first).toContain('## Personality and notes')
  const edited = first.replace('(Optional.', 'Speak like a careful editor.\r\n(Optional.')
  const second = mergeRole(edited, 'GEN 2\r\n')
  expect(second.startsWith('GEN 2\r\n')).toBe(true)
  expect(second).toContain('Speak like a careful editor.')
  expect(second).not.toContain('GEN 1')
  expect(mergeRole(second, 'GEN 2\r\n')).toBe(second)
})

test('the start-up pointer is short, safe for cmd.exe, and names the role file', () => {
  const p = pointer({ ...all[1]!, name: 'A-Head', role: 'say "hi" 100%' }, all)
  expect(p).toContain('.claude/team-orchestrator/roles/A-Head.md')
  expect(p).toContain('team_message')
  expect(/["%\r\n]/.test(p)).toBe(false)
  expect(p.length).toBeLessThan(600)
  expect(/["%\r\n]/.test(WELCOME)).toBe(false)
})
