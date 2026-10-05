import { expect, test } from 'claude-code/testing'

test('@team forwards the rest of the message to the head via SendMessage and drops the prompt', async ($, on) => {
  const sent: any[] = []
  const files = new Map<string, string>()
  on('session.root', async () => ({ value: 'C:\proj' }) as any)
  on('fs.exists', async (_$, e: any) => ({ value: files.has(e.path) }) as any)
  on('fs.read', async (_$, e: any) => ({ value: files.get(e.path) }) as any)
  on('fs.write', async (_$, e: any) => (files.set(e.path, e.text), { value: undefined }) as any)
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'no orca in test' } }) as any)
  on('prompt.submit', async (_$, e: any) => ({ text: e.text }) as any)
  on('tool.call', { tool: 'SendMessage' }, async (_$, e: any) => {
    sent.push(e)
    return { result: 'ok' } as any
  })
  await $.tool.call({
    tool: 'mcp__team-orchestrator__team_adopt',
    team: 'Demo-Team',
    members: [
      { name: 'Demo-Head', address: 'Demo Head', role: 'head', level: 1, boss: 'user', handle: 'term_x' },
      { name: 'Demo-W1', address: 'Demo W1', role: 'worker', level: 2, boss: 'Demo-Head', handle: 'term_y' },
    ],
  } as any)
  const out: any = await $.prompt.submit({ text: 'please @Demo-Team check the errors', asUser: true })
  expect(sent.length).toBe(1)
  expect(sent[0].to).toBe('Demo Head')
  expect(String(sent[0].message)).toContain('check the errors')
  expect(String(sent[0].message)).toContain('@Demo-Team')
  expect(out.drop).toContain('Demo-Team')
  expect(JSON.parse([...files.values()][0]!).map((m: any) => m.team)).toEqual(['Demo-Team', 'Demo-Team'])
})

test('a prompt without a team mention is untouched', async ($, on) => {
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'no orca in test' } }) as any)
  on('prompt.submit', async (_$, e: any) => ({ text: e.text }) as any)
  on('tool.call', { tool: 'SendMessage' }, async () => ({ result: 'ok' }) as any)
  const out: any = await $.prompt.submit({ text: 'hello there', asUser: true })
  expect(out.drop).toBeUndefined()
})

test('a launch of two teams under a CEO keeps names unique and @team reaches the head of that team', async ($, on) => {
  const files = new Map<string, string>()
  const sent: any[] = []
  let n = 0
  on('session.root', async () => ({ value: 'C:\proj' }) as any)
  on('fs.exists', async (_$, e: any) => ({ value: files.has(e.path) }) as any)
  on('fs.read', async (_$, e: any) => ({ value: files.get(e.path) }) as any)
  on('fs.write', async (_$, e: any) => (files.set(e.path, e.text), { value: undefined }) as any)
  on('process.run', async (_$, e: any) => {
    const a = JSON.stringify(e)
    const ok = (out: string) => ({ value: { exitCode: 0, stdout: out, stderr: '' } }) as any
    if (a.includes('"current"')) return ok('{"result":{"worktree":{"id":"wt1"}}}')
    if (a.includes('"create"')) return ok(`{"result":{"terminal":{"handle":"term_${++n}"}}}`)
    if (a.includes('"wait"')) return ok('{"result":{"satisfied": true}}')
    if (a.includes('"send"')) return ok('{}')
    return { value: { exitCode: 1, stdout: '', stderr: 'no' } } as any
  })
  on('prompt.submit', async (_$, e: any) => ({ text: e.text }) as any)
  on('tool.call', { tool: 'SendMessage' }, async (_$, e: any) => (sent.push(e), { result: 'ok' }) as any)
  await $.tool.call({
    tool: 'mcp__team-orchestrator__team_launch',
    team: 'Org',
    members: [
      { name: 'CEO', team: 'Org', role: 'ceo', level: 1, boss: 'user' },
      { name: 'Head', team: 'Alpha', role: 'head', level: 2, boss: 'CEO' },
      { name: 'Head', team: 'Beta', role: 'head', level: 2, boss: 'CEO' },
    ],
  } as any)
  const saved = JSON.parse([...files.values()][0]!)
  expect(saved.map((m: any) => m.name)).toEqual(['CEO', 'Head', 'Beta-Head'])
  expect(saved.map((m: any) => m.team)).toEqual(['Org', 'Alpha', 'Beta'])
  expect(saved[2].boss).toBe('CEO')
  await $.prompt.submit({ text: '@Beta ship it', asUser: true })
  expect(sent.length).toBe(1)
  expect(sent[0].to).toBe('Beta-Head')
})
