// 0.5.34: member_remove fails the messages waiting for that member, so a new member given the same name is not
// started by the queue to receive another member's old briefs.
import { expect, test } from 'claude-code/testing'

import { fileName } from './changes'
import { adopt, sessionAs, TEAM, world } from './test-world'

test('member_remove fails the queued messages for that member and leaves the others', async ($, on) => {
  const files = world(on, [], [])
  sessionAs(on)
  await adopt($, [{ name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h1' }, { name: 'W1', role: 'worker', level: 2, boss: 'Head', handle: 'term_w1' }, { name: 'W2', role: 'worker', level: 2, boss: 'Head', handle: 'term_w2' }])
  const q = (to: string, id: string) => {
    const k = `${TEAM}/queue/${fileName(Date.now(), id)}`
    files.set(k, JSON.stringify({ to, from: 'Head', message: 'old brief', created: Date.now(), state: 'pending', tries: 0 }))
    return k
  }
  const mine = q('W1', 'q1')
  const other = q('W2', 'q2')
  await $.tool.call({ tool: 'mcp__team-orchestrator__member_remove', team: 'Hualong', name: 'W1' } as any)
  const read = (k: string) => JSON.parse(files.get([...files.keys()].find(x => x.endsWith(k.slice(TEAM.length)))!)!)
  expect(read(mine).state).toBe('failed')
  expect(read(mine).error).toContain('removed from the roster')
  expect(read(other).state).toBe('pending')
})
