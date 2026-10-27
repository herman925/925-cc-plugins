// The plan's acceptance rows that no test held yet: a coordinator reopening another member's home, an invalid target
// in a bulk restart, an explicit rename, and a lifecycle call from a member that has no authority over the target.

import { expect, test } from 'claude-code/testing'

import { MARKER } from './roles'
import { adopt, ID1, ID2, mountBand, saved, sessionAs, STATUS, TEAM, world } from './test-world'

const MODS = [
  { name: 'Mod CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_ceo', sessionId: ID1 },
  { name: 'Mod Builder', role: 'worker', level: 2, boss: 'Mod CEO', handle: 'term_w', sessionId: ID2 },
]
const ID3 = '33333333-3333-4333-8333-333333333333'
const creates = (files: any) => files.calls.filter((a: string[]) => a[1] === 'terminal' && a[2] === 'create')
const closes = (files: any) => files.calls.filter((a: string[]) => a[1] === 'terminal' && a[2] === 'close')
const workspaceOf = (create: string[]) => create[create.indexOf('--worktree') + 1]

const engine = (on: any, sid = ID1) => {
  sessionAs(on, sid)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
}

test('a coordinator reopening a member opens it in that member\'s own workspace, and its home is unchanged', async ($, on) => {
  const tabs: any[] = [
    { handle: 'term_ceo', title: 'Mod CEO' },
    { handle: 'term_w', title: 'Mod Builder', worktreePath: 'C:/other', worktreeId: 'repo::C:/other' },
  ]
  const files = world(on, tabs, [], (e: any) => {
    const a: string[] = e.argv
    if (a[1] === 'terminal' && a[2] === 'create') return '{"result":{"terminal":{"handle":"term_new"}}}'
    if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
    return undefined
  }, { worktrees: { 'repo::C:/other': 'C:/other' }, env: { ORCA_TERMINAL_HANDLE: 'term_ceo' } })
  engine(on)
  await adopt($, MODS, 'Mods')
  // its tab is gone, so only a start can bring it back: the home it was adopted with is all there is to go on
  tabs.splice(tabs.findIndex(t => t.handle === 'term_w'), 1)
  files.set(`${STATUS}/Mod_Builder.json`, JSON.stringify({ name: 'Mod Builder', sessionId: '', state: 'closed', heartbeat: Date.now() }))
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Mod Builder', message: 'start' } as any)
  // the CEO's own workspace is C:/proj; the member's is C:/other, and that is where its tab opens
  expect(creates(files).map(workspaceOf)).toEqual(['id:repo::C:/other'])
  expect(saved(files).find((m: any) => m.name === 'Mod Builder').worktree).toBe('repo::C:/other')
})

test('an invalid target in a bulk restart closes nothing and changes nothing', async ($, on) => {
  const files = world(on, [], [], undefined)
  engine(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('ui.close', async () => ({ value: undefined }) as any)
  await adopt($, [
    { name: 'Mod CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_ceo' },
    { name: 'Mod Builder', role: 'worker', level: 2, boss: 'Mod CEO', handle: 'term_w', sessionId: ID2 },
  ], 'Mods')
  // its saved home no longer answers, so no restart may target it
  const roster = saved(files).map((m: any) => (m.name === 'Mod Builder'
    ? { ...m, worktree: 'repo::C:/proj', registeredHome: { contextKind: 'worktree', executionHostId: 'host-test', originalPath: 'C:/gone' } }
    : m))
  files.set(`${TEAM}/roster.json`, JSON.stringify(roster))
  const band = await mountBand($, 300)
  await band.press({ key: 'refresh' })
  await band.press({ key: 'sel-Mods|Mod Builder' })
  await band.press({ key: 'tact-0' })
  await band.press({ key: 'tact-0-bulk' })
  await band.input({ key: 'bbase', text: 'Renamed', kind: 'change' })
  await band.press({ key: 'apply' })
  expect(closes(files).length).toBe(0)
  expect(creates(files).length).toBe(0)
  expect(saved(files).find((m: any) => m.name === 'Mod Builder').name).toBe('Mod Builder')
})

test('an explicit rename keeps the member\'s own notes, and a taken name is not taken', async ($, on) => {
  const files = world(on, [], [], undefined, { env: { ORCA_TERMINAL_HANDLE: 'term_ceo' } })
  engine(on)
  await adopt($, MODS, 'Mods')
  // the person's own notes below the generated part of the role file
  files.set(`${TEAM}/roles/Mod_Builder.md`, `# generated\n${MARKER}\n\nSpeak like a careful editor.\n`)
  const claim = (sessionId: string, name: string) => [{ sessionId, member: 'Mod Builder', team: 'Mods', tab: 'term_new', name, why: 'unclear tab', at: 1 }]
  files.set(`${TEAM}/claims.json`, JSON.stringify(claim(ID3, 'Mod Editor')))
  const ok: any = await $.tool.call({ tool: 'mcp__team-orchestrator__member_claim', sessionId: ID3, decision: 'is', member: 'Mod Builder' } as any)
  expect(JSON.stringify(ok)).toContain('Mod Editor')
  expect(saved(files).map((m: any) => m.name)).toEqual(['Mod CEO', 'Mod Editor'])
  expect(files.get(`${TEAM}/roles/Mod_Editor.md`)).toContain('Speak like a careful editor.')
  // the old name is left as a pointer, so a stale role pointer never reads the wrong person's notes
  expect(files.get(`${TEAM}/roles/Mod_Builder.md`)).toContain('is now Mod Editor')
  // a name another member already goes by is refused: the roster keeps its own name
  files.set(`${TEAM}/claims.json`, JSON.stringify(claim(ID3, 'Mod CEO')))
  await $.tool.call({ tool: 'mcp__team-orchestrator__member_claim', sessionId: ID3, decision: 'is', member: 'Mod Editor' } as any)
  expect(saved(files).map((m: any) => m.name)).toEqual(['Mod CEO', 'Mod Editor'])
})

test('a worker cannot remove, move or rename a member: only the team top may', async ($, on) => {
  const files = world(on, [], [], undefined, { env: { ORCA_TERMINAL_HANDLE: 'term_w' } })
  engine(on, ID2) // this session is Mod Builder: it reports to the CEO, so it is nobody's manager
  await adopt($, MODS, 'Mods')
  const before = saved(files)
  const removed: any = await $.tool.call({ tool: 'mcp__team-orchestrator__member_remove', team: 'Mods', name: 'Mod CEO' } as any)
  expect(String(removed.deny ?? '')).toContain('for the team top')
  const teamGone: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_remove', team: 'Mods' } as any)
  expect(String(teamGone.deny ?? '')).toContain('for the team top')
  expect(saved(files)).toEqual(before)
  expect(closes(files).length).toBe(0)
})
