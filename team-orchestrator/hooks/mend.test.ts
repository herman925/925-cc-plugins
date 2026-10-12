// 0.5.30: a write refused with EACCES on macOS or Linux (a folder made without its x bit under a parent's default ACL)
// mends the folders on the way and is written once more.
import { expect, test } from 'claude-code/testing'

import { MEND_DIRS } from './platform'
import { adopt, HUALONG, TEAM, world } from './test-world'

test('a write refused with EACCES mends the folders on the way and writes once more', async ($, on) => {
  const ROSTER = '/.claude/team-orchestrator/roster.json' // off Windows the engine hands fs hooks the path made absolute
  let tries = 0
  const refuse = (path: string) => path.endsWith(ROSTER) && !tries++
  const files = world(on, [], [], e => (e.argv[0] === 'sh' ? '' : undefined), { env: { OS: 'Linux' }, refuse })
  await adopt($, HUALONG)
  expect(tries).toBeGreaterThan(1)
  expect(files.calls).toContainEqual(['sh', '-c', MEND_DIRS, 'sh', TEAM])
  expect([...files.keys()].some(k => k.endsWith(ROSTER))).toBe(true)
})
