// A closed member reopened by a message keeps its whole name, spaces and all: the start command quotes --name, so a
// shell does not split "Mod Builder 2" into --name Mod plus a first prompt "Builder".

import { expect, test } from 'claude-code/testing'

import { adopt, ID1, ID2, ID3, STATUS, world } from './test-world'

const ROWS = [
  { name: 'Mod CEO', role: 'head', level: 1, boss: 'user', handle: '', sessionId: ID1 },
  { name: 'Mod Builder 2', role: 'specs', level: 2, boss: 'Mod CEO', handle: '', sessionId: ID2 },
  { name: 'W1', role: 'worker', level: 2, boss: 'Mod CEO', handle: '', sessionId: ID3 },
]

const startCommandFor = async ($: any, on: any, name: string, sessionId: string) => {
  const files = world(on, [], [{ id: sessionId }], (e: any) => {
    const a: string[] = e.argv
    if (a[1] === 'worktree' && a[2] === 'current') return '{"result":{"worktree":{"id":"r1::C:/proj"}}}'
    if (a[1] === 'terminal' && a[2] === 'create') return '{"result":{"terminal":{"handle":"term_new"}}}'
    if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
    return undefined
  })
  on('session.id', async () => ({ value: ID1 }) as any)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await adopt($, ROWS, 'Mods')
  files.set(`${STATUS}/${name.replace(/ /g, '_')}.json`, JSON.stringify({ name, sessionId, state: 'closed', heartbeat: Date.now() }))
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: name, message: 'hello' } as any)
  const create = files.calls.find(a => a[1] === 'terminal' && a[2] === 'create')!
  return String(create[create.indexOf('--command') + 1])
}

test('a reopened member whose name has spaces is started with its whole name quoted', async ($, on) => {
  const cmd = await startCommandFor($, on, 'Mod Builder 2', ID2)
  expect(cmd).toContain('--name "Mod Builder 2"')
  expect(cmd).not.toContain('--name Mod ')
})

test('a reopened member whose name has no spaces is started with that name', async ($, on) => {
  const cmd = await startCommandFor($, on, 'W1', ID3)
  expect(cmd).toContain('--name "W1"')
})
