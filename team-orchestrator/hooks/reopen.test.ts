// A member reopened by a message is not auto-closed straight away: its old "clean" from before it was closed no longer
// counts, so the team top's idle round waits for a new one.

import { expect, test } from 'claude-code/testing'

import { MIN, TEAM_SETTINGS0, toClose } from './status'
import { adopt, ID1, ID2, saved, STATUS, world } from './test-world'

const ROWS = [
  { name: 'Mod CEO', role: 'head', level: 1, boss: 'user', handle: '', sessionId: ID1 },
  { name: 'Mod Builder 2', role: 'specs', level: 2, boss: 'Mod CEO', handle: '', sessionId: ID2 },
]

test('a member reopened by a message is not picked by auto-close for its old idle time', async ($, on) => {
  const files = world(on, [], [{ id: ID2 }], (e: any) => {
    const a: string[] = e.argv
    if (a[1] === 'worktree' && a[2] === 'current') return '{"result":{"worktree":{"id":"r1::C:/proj"}}}'
    if (a[1] === 'terminal' && a[2] === 'create') return '{"result":{"terminal":{"handle":"term_ae1"}}}'
    if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
    return undefined
  })
  on('session.id', async () => ({ value: ID1 }) as any)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await adopt($, ROWS, 'Mods')
  // closed after its last turn and its last "clean", both 15 minutes ago
  const long = Date.now() - 15 * MIN
  const path = `${STATUS}/Mod_Builder_2.json`
  files.set(path, JSON.stringify({ name: 'Mod Builder 2', sessionId: ID2, state: 'closed', heartbeat: long, turnEnd: long, lastClean: long }))
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Mod Builder 2', message: 'hello' } as any)
  const status = JSON.parse(files.get(path)!)
  expect(status.state).toBe('idle')
  expect(toClose(saved(files), new Map([['Mod Builder 2', status]]), TEAM_SETTINGS0, Date.now())).toEqual([])
})
