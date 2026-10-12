// SendMessage to a member that is closed (or saved as not yet started) is answered by the mod, which starts the member
// and delivers: the answer must be SendMessage's own shape, an object, or the engine fails the call with
// "SendMessage output is not an object".

import { expect, test } from 'claude-code/testing'

import { adopt, ID1, STATUS, TEAM, world } from './test-world'

test('SendMessage to a closed member answers with an object, as SendMessage does', async ($, on) => {
  const files = world(on, [{ handle: 'term_w', title: 'Worker', worktreePath: 'C:/proj' }], [{ id: ID1, title: 'Worker' }])
  await adopt($, [
    { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h' },
    { name: 'Worker', role: 'worker', level: 2, boss: 'Head', handle: 'term_w', sessionId: ID1 },
  ])
  // off Windows the engine hands fs hooks the path made absolute: the status file goes where the roster went
  const roster = [...files.keys()].find(k => k.endsWith(`${TEAM}/roster.json`))!
  const at = roster.slice(0, roster.length - `${TEAM}/roster.json`.length)
  files.set(`${at}${STATUS}/Worker.json`, JSON.stringify({ name: 'Worker', sessionId: ID1, state: 'closed', heartbeat: Date.now() }))
  const r: any = await $.tool.call({ tool: 'SendMessage', to: 'Worker', message: 'hello' } as any)
  expect(typeof r.result).toBe('object')
  expect(String(r.result.message)).toContain('Worker')
})
