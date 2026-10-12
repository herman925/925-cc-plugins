// A change that reached the team top stays in the roster (0.5.32):
//  - the top's refresh writes what it found onto the roster as it is when it writes, not onto the snapshot it began
//    with: a change folded in meanwhile (by a reopen in the same round, here) is kept
//  - a member's row sent again as an "add" from an older read never rolls the member's fields back

import { expect, test } from 'claude-code/testing'

import { fileName } from './changes'
import { adopt, HUALONG, ID1, ID2, mountBand, rawSaved, STATUS, TEAM, world } from './test-world'

const ROSTER = `${TEAM}/roster.json`
const by = { session: 'other', member: 'Hualong Workers', machine: '', version: '' }
/** a change file from another session, landing now */
const land = (files: Map<string, string>, tag: string, ops: any[]) => {
  const name = fileName(Date.now(), tag)
  files.set(`${TEAM}/changes/${name}`, JSON.stringify({ v: 1, kind: 'roster', ops, at: Date.now(), by }))
  return name
}
const row = (files: Map<string, string>, name: string) => rawSaved(files).find((x: any) => x.name === name)
const refresh = async ($: any) => {
  const band = await mountBand($, 300)
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
}
const engine = (on: any) => {
  on('session.id', async () => ({ value: ID1 }) as any)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
}
// the CEO (this session, the team top) in its own tab; Workers has session ID2, the rest none
const ROWS = HUALONG.map(r => ({ ...r, handle: r.name === 'Hualong CEO' ? 'term_c' : '', sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : '' }))

test('a change folded in while the top\'s refresh waits on Orca is not undone by that refresh', async ($, on) => {
  let landed = ''
  const files = world(on, [], [], (e: any) => {
    const a: string[] = e.argv
    if (a[1] === 'worktree' && a[2] === 'current') return '{"result":{"worktree":{"id":"r1::C:/proj"}}}'
    if (a[1] === 'terminal' && a[2] === 'create') {
      // while the round reopens Workers, another session's change lands; the reopen's own write folds it in
      landed = land(files, 'mid1', [{ op: 'set', key: 'Hualong|Hualong Worker 5', patch: { short: 'Five' } }])
      files.set('C:/home/.claude/sessions/150.json', JSON.stringify({ pid: 150, sessionId: ID2, cwd: 'C:/proj', name: '', kind: 'interactive' }))
      return '{"result":{"terminal":{"handle":"term_ae5"}}}'
    }
    if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
    return undefined
  }, { env: { ORCA_TERMINAL_HANDLE: 'term_c' }, registry: [{ sessionId: ID1 }] })
  engine(on)
  await adopt($, ROWS)
  // Workers is closed, and a message waits for it: the top's round reopens it, then asks Orca about every tab
  files.set(`${STATUS}/Hualong_Workers.json`, JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state: 'closed', heartbeat: Date.now() }))
  files.set(`${TEAM}/queue/${fileName(Date.now(), 'q1')}`, JSON.stringify({ to: 'Hualong Workers', from: 'Hualong CEO', message: 'hi', created: Date.now(), state: 'pending', tries: 0 }))
  await refresh($)
  expect(landed).not.toBe('')
  // the change is listed as applied, so it must be in the roster written
  expect(JSON.parse(files.get(`${TEAM}/changes/applied.json`)!).names).toContain(landed)
  expect(row(files, 'Hualong Worker 5').short).toBe('Five')
  // and the reopen made in the same round stays too
  expect(row(files, 'Hualong Workers')).toMatchObject({ handle: 'term_ae5', pending: false })
})

test('a member\'s row sent again as an "add" never rolls its fields back; a new member is still added', async ($, on) => {
  const files = world(on, [], [], undefined, { env: { ORCA_TERMINAL_HANDLE: 'term_c' }, registry: [{ sessionId: ID1 }] })
  engine(on)
  await adopt($, ROWS)
  files.set(ROSTER, JSON.stringify(rawSaved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, handle: 'term_w', briefed: true, pending: false } : x))))
  // another session's record of the roster predates Workers' start: its next change sends Workers' old row as an add
  const old = { ...row(files, 'Hualong Workers'), handle: '', sessionId: '', briefed: false, pending: true }
  land(files, 'add1', [
    { op: 'add', member: old },
    { op: 'add', member: { team: 'Hualong', name: 'Hualong New', address: 'Hualong New', role: 'worker', level: 3, boss: 'Hualong Workers', pending: true } },
  ])
  await refresh($)
  expect(row(files, 'Hualong Workers')).toMatchObject({ handle: 'term_w', sessionId: ID2, briefed: true, pending: false })
  expect(row(files, 'Hualong New')).toMatchObject({ boss: 'Hualong Workers', pending: true })
})
