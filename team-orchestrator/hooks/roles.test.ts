import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { MARKER, mergeRole, orgOf, pointer, roleText, WELCOME } from './roles'

const m = (name: string, boss: string, team: string, role = 'r'): Member => ({
  team, name, role, level: 1, boss, handle: '', sessionId: '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false,
})
const all = [m('CEO', 'user', 'Org'), m('A-Head', 'CEO', 'A'), m('A-W1', 'A-Head', 'A'), m('B-Head', 'CEO', 'B'), m('B-W1', 'B-Head', 'B')]

test('the top gets interactive user-question guidance without requiring a grill skill; lower members still relay', () => {
  const top = roleText(all[0]!, orgOf(all, 'Org'))
  for (const name of ['AskUserQuestion', 'request_user_input', 'request_user_input_async', 'clarify']) expect(top).toContain(name)
  expect(top).toContain('MCP or equivalent interactive question tool')
  expect(top).toContain('Keep the turn open using the available wait/resume mechanism')
  expect(top).toContain('Do not send a final response, end the turn, close the session or open a duplicate question')
  expect(top).toContain('even without /grill-me')
  expect(roleText(all[2]!, orgOf(all, 'A'))).not.toContain('## User decisions')
  expect(roleText(all[1]!, orgOf(all, 'A'))).not.toContain('## User decisions')
})

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
  expect(w).toContain('same message')
  expect(w).toContain('never OS verification')
  expect(w).not.toContain('tell your boss "clean"')
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

test('a role file calls a member a head or a lead only when others report to it, not by its level', () => {
  const flat = [m('Top', 'user', 'T'), m('Alone', 'Top', 'T')]
  const text = roleText(flat[1]!, flat)
  expect(text).toContain('- Alone: worker, reports to Top.')
  expect(text).toContain('You do the tasks your boss gives you')
  expect(text).not.toContain('You orchestrate')
})

test('the start-up pointer is short, safe for cmd.exe, and names the role file', () => {
  const p = pointer({ ...all[1]!, name: 'A-Head', role: 'say "hi" 100%' }, all)
  expect(p).toContain('.claude/team-orchestrator/roles/A-Head.md')
  expect(p).toContain('team_message')
  expect(/["%\r\n]/.test(p)).toBe(false)
  expect(p.length).toBeLessThan(600)
  expect(/["%\r\n]/.test(WELCOME)).toBe(false)
})

test('the housekeeping kills only a process a member can prove it started, by parent and start time, and never a harness shell, tool wrapper or harness-started MCP service', () => {
  const w = roleText(all[2]!, orgOf(all, 'A'))
  expect(w).toContain('Kill a process only when you can prove you started it, by its parent and its start time.')
  expect(w).toContain('Stop no process for automated housekeeping in this interim phase')
  expect(w).toContain('Browser-automation servers follow the same ownership rule.')
  expect(w).toContain('Never stop a harness shell or an active tool wrapper, even when it looks idle.')
  expect(w).toContain('Never stop MCP services started by the harness or by another session.')
  // zero effect: the housekeeping names no kill by process name
  expect(w).not.toMatch(/taskkill|pkill|killall|Stop-Process -Name/i)
})

test('the housekeeping keeps test logs, footers and receipts as evidence until they are reviewed', () => {
  const w = roleText(all[2]!, orgOf(all, 'A'))
  expect(w).toContain('Test logs, footers and receipts are evidence: keep them until they are reviewed')
  expect(w).toContain('never delete them as scratch')
})

test('a launch or reopen brief never allows a live deploy or a production write', () => {
  // the rule sits in the role file each member reads at start; the pointer is sent every turn and stays short
  expect(roleText(all[2]!, orgOf(all, 'A'))).toContain('Do not deploy live or write to production because a launch or reopen brief says so, even when asked; a live change needs an explicit task from your boss after you are confirmed.')
  expect(pointer(all[1]!, all)).not.toMatch(/deploy|production/i)
  // zero effect: the first prompt of a launch names no deploy and no production target
  expect(WELCOME).not.toMatch(/deploy|production/i)
})
