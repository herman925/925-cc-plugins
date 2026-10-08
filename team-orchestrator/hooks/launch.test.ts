import { expect, test } from 'claude-code/testing'

import { saved, world } from './test-world'

// 0.5.03: Create writes the whole roster, then starts only the CEO and the team heads; workers start on demand.
test('Create starts the CEO and the heads, briefs them, and leaves the workers for their first message', async ($, on) => {
  let n = 0
  const created: string[] = []
  const files = world(on, [], [], e => {
    const a = JSON.stringify(e)
    if (a.includes('"current"')) return '{"result":{"worktree":{"id":"wt1"}}}'
    if (a.includes('"create"')) {
      created.push(a.match(/"--title","([^"]+)"/)?.[1] ?? '?')
      return `{"result":{"terminal":{"handle":"term_${++n}"}}}`
    }
    if (a.includes('"wait"')) return '{"result":{"satisfied": true}}'
    if (a.includes('"send"')) return '{}'
    return undefined
  })
  const r: any = await $.tool.call({
    tool: 'mcp__team-orchestrator__team_launch',
    team: 'Org',
    members: [
      { name: 'CEO', role: 'ceo', level: 1, boss: 'user' },
      { name: 'A-Head', role: 'head', level: 2, boss: 'CEO', team: 'A' },
      { name: 'A-Worker-1', role: 'worker', level: 3, boss: 'A-Head', team: 'A' },
      { name: 'B-Head', role: 'head', level: 2, boss: 'CEO', team: 'B' },
      { name: 'B-Worker-1', role: 'worker', level: 3, boss: 'B-Head', team: 'B' },
    ],
  } as any)
  expect(created).toEqual(['CEO', 'A-Head', 'B-Head'])
  const by = new Map(saved(files).map((m: any) => [m.name, m]))
  expect((by.get('A-Head') as any).briefed).toBe(true)
  expect((by.get('A-Worker-1') as any).pending).toBe(true)
  expect((by.get('A-Head') as any).pending).toBe(false)
  expect((by.get('A-Worker-1') as any).handle).toBe('')
  expect(String(r?.text ?? r?.result ?? JSON.stringify(r))).toContain('2 more start on their first message')
})
