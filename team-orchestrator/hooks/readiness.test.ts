// Guardrail 6: a tab Orca created but whose session never registered is still a created tab. It keeps its identity,
// its message waits in the queue, nothing is closed, and a second message starts no second tab.

import { expect, test } from 'claude-code/testing'

import { adopt, ID1, ID2, mountBand, saved, sessionAs, STATUS, TEAM, world } from './test-world'

const ROWS = [
  { name: 'Mod CEO', role: 'head', level: 1, boss: 'user', handle: '' },
  { name: 'Mod Builder 2', role: 'specs', level: 2, boss: 'Mod CEO', handle: '', sessionId: ID2 },
]

// Orca opens the tab and its shell goes idle, but this PC's registry never lists the session: readiness is not proved.
const unready = async ($: any, on: any) => {
  const files = world(on, [], [], (e: any) => {
    const a: string[] = e.argv
    if (a[1] === 'terminal' && a[2] === 'create') return '{"result":{"terminal":{"handle":"term_abcd"}}}'
    if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
    return undefined
  }, { registry: [{ sessionId: ID1 }] })
  sessionAs(on, ID1)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await adopt($, ROWS, 'Mods')
  files.set(`${STATUS}/Mod_Builder_2.json`, JSON.stringify({ name: 'Mod Builder 2', sessionId: ID2, state: 'closed', heartbeat: Date.now() }))
  return files
}

const queued = (files: Map<string, string>) =>
  [...files].filter(([k]) => k.startsWith(`${TEAM}/queue/`)).map(([, v]) => JSON.parse(v!)).map((q: any) => [q.to, q.state])
const creates = (files: any) => files.calls.filter((a: string[]) => a[1] === 'terminal' && a[2] === 'create').length
const closes = (files: any) => files.calls.filter((a: string[]) => a[1] === 'terminal' && a[2] === 'close').length

test('a created tab whose session never registered stays starting, keeps its identity, and its message waits', async ($, on) => {
  const files = await unready($, on)
  const r: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Mod Builder 2', message: 'hello' } as any)
  expect(creates(files)).toBe(1)
  const row = saved(files).find((m: any) => m.name === 'Mod Builder 2')
  expect([row.handle, row.sessionId]).toEqual(['term_abcd', ID2])
  // nothing proved this session is ready, so its status file must not claim idle
  expect(JSON.parse(files.get(`${STATUS}/Mod_Builder_2.json`)!).state).toBe('starting')
  expect(queued(files)).toEqual([['Mod Builder 2', 'pending']])
  expect(String(r.result)).toContain('queued')
  expect(closes(files)).toBe(0)
})

test('a message held for a starting member keeps its place and spends none of its tries', async ($, on) => {
  const files = await unready($, on)
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Mod Builder 2', message: 'hello' } as any)
  const band = await mountBand($, 300)
  await band.press({ key: 'refresh' })
  const [q] = [...files].filter(([k]) => k.startsWith(`${TEAM}/queue/`)).map(([, v]) => JSON.parse(v!))
  expect([q.state, q.tries]).toEqual(['pending', 0])
  expect(creates(files)).toBe(1)
})

test('a second message to an unready member starts no second tab and waits too', async ($, on) => {
  const files = await unready($, on)
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Mod Builder 2', message: 'one' } as any)
  const r2: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Mod Builder 2', message: 'two' } as any)
  expect(creates(files)).toBe(1)
  expect(String(r2.result)).toContain('queued')
})

test('a launch intent left unresolved by a crash blocks a second terminal create', async ($, on) => {
  const files = await unready($, on)
  files.set(`${TEAM}/launches/Mod_Builder_2.json`, JSON.stringify({ name: 'Mod Builder 2', sessionId: ID2, at: Date.now(), state: 'pending' }))
  const r: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Mod Builder 2', message: 'hello' } as any)
  expect(creates(files)).toBe(0)
  expect(String(r.result)).toContain('queued')
})
