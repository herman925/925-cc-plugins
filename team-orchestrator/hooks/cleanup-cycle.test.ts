import { expect, test } from 'claude-code/testing'

import { adopt, ID1, ID2, STATUS, TEAM, world } from './test-world'

const wait = () => new Promise(resolve => setTimeout(resolve, 0))

test('completion reports can include cleanup once; clean-only and progress messages do not trigger another note', async ($, on) => {
  const env = { ORCA_TERMINAL_HANDLE: 'term_h' }
  const files = world(on, [{ handle: 'term_h', title: 'Head', worktreePath: 'C:/proj' }, { handle: 'term_w', title: 'Worker', worktreePath: 'C:/proj' }], [], undefined, { env })
  let id = ID1
  on('session.id', async () => ({ value: id }) as any)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text, context: e.context }) as any)
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }) as any)
  on('tool.call', { tool: 'SendMessage' } as any, async () => ({ result: { success: true } }) as any)
  await adopt($, [
    { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h', sessionId: ID1 },
    { name: 'Worker', role: 'worker', level: 2, boss: 'Head', handle: 'term_w', sessionId: ID2 },
  ], 'T')
  id = ID2
  env.ORCA_TERMINAL_HANDLE = 'term_w'
  const send = (message: string) => $.tool.call({ tool: 'SendMessage', to: 'Head', message } as any) as any
  for (const text of ['Progress: parser done; tests still running.', 'Waiting for Head.', 'Not done; build is still running.']) {
    const result: any = await send(text)
    expect(result.context?.some((x: string) => x.includes('HOUSEKEEPING')) ?? false).toBe(false)
  }
  const completion: any = await send('Task complete. Cleanup: clean.')
  expect(completion.context?.some((x: string) => x.includes('HOUSEKEEPING')) ?? false).toBe(false)
  const report = JSON.parse(files.get(`${STATUS}/Worker.json`)!).cleanupReport
  expect(report).toMatchObject({ status: 'reported-clean', verified: false })
  expect(report.deliveryId).toBeTruthy()
  expect(JSON.parse(files.get(`${STATUS}/Worker.json`)!).lastClean).toBeUndefined()
  const ack: any = await send('Cleanup: clean.')
  expect(ack.context?.some((x: string) => x.includes('HOUSEKEEPING')) ?? false).toBe(false)
  const duplicate: any = await send('Task complete. Cleanup: clean.')
  expect(duplicate.context?.some((x: string) => x.includes('HOUSEKEEPING')) ?? false).toBe(false)
})

test('turn completion and incoming reports perform no process census or automatic kills', async ($, on) => {
  const files = world(on)
  on('session.id', async () => ({ value: ID1 }) as any)
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text }) as any)
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }) as any)
  await adopt($, [
    { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h', sessionId: ID1 },
    { name: 'Worker', role: 'worker', level: 2, boss: 'Head', handle: 'term_w', sessionId: ID2 },
  ], 'T')
  const before = files.calls.length
  await $.prompt.submit({ text: '<cross-session-message from="uds:x" from-name="Worker">Progress: running tests.</cross-session-message>', origin: { kind: 'peer' }, wait: false } as any)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await wait()
  const calls = files.calls.slice(before).map(args => args.join(' '))
  expect(calls.some(c => /(?:^|\s)ps\s+-eo\s+pid|Get-CimInstance Win32_Process/i.test(c))).toBe(false)
  expect(calls.some(c => /terminal close|taskkill|Stop-Process/i.test(c))).toBe(false)
  expect(files.get(`${TEAM}/roster.json`)).toBeTruthy()
})

test('team_message records a cleanup report only after confirmed delivery to the worker own boss', async ($, on) => {
  const env = { ORCA_TERMINAL_HANDLE: 'term_h' }
  const files = world(on, [{ handle: 'term_h', title: 'Head', worktreePath: 'C:/proj' }, { handle: 'term_w', title: 'Worker', worktreePath: 'C:/proj' }], [], undefined, { env })
  let id = ID1
  let delivered = true
  on('session.id', async () => ({ value: id }) as any)
  on('session.send', async () => ({ isDelivered: delivered, ...(delivered ? {} : { reason: 'offline' }) }) as any)
  await adopt($, [
    { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h', sessionId: ID1 },
    { name: 'Worker', role: 'worker', level: 2, boss: 'Head', handle: 'term_w', sessionId: ID2 },
  ], 'T')
  id = ID2
  env.ORCA_TERMINAL_HANDLE = 'term_w'
  const sent: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Head', message: 'Task complete. Cleanup: clean.' } as any)
  expect(String(sent.result)).toContain('Sent to Head.')
  const path = `${STATUS}/Worker.json`
  const report = JSON.parse(files.get(path)!).cleanupReport
  expect(report).toMatchObject({ status: 'reported-clean', verified: false })
  expect(report.deliveryId).toBeTruthy()

  const before = files.get(path)
  delivered = false
  const failed: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Head', message: 'Task complete. Cleanup: incomplete.' } as any)
  expect(String(failed.result)).toContain('Not sent to Head')
  expect(files.get(path)).toBe(before)
})

test('a queued team_message with cleanup text does not mark the report delivered', async ($, on) => {
  const env = { ORCA_WORKTREE_ID: 'repo::C:/proj', ORCA_TERMINAL_HANDLE: 'term_head' }
  const files = world(on, [{ handle: 'term_head', title: 'Head', worktreePath: 'C:/proj' }, { handle: 'term_worker', title: 'Worker', worktreePath: 'C:/proj' }], [], undefined, { env })
  let id = ID1
  on('session.id', async () => ({ value: id }) as any)
  on('session.send', async () => ({ isDelivered: true }) as any)
  await adopt($, [
    { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_head', sessionId: ID1, worktree: 'repo::C:/proj' },
    { name: 'Worker', role: 'worker', level: 2, boss: 'Head', handle: 'term_worker', sessionId: ID2, worktree: 'repo::C:/proj' },
  ], 'T')
  const rosterPath = `${TEAM}/roster.json`
  files.set(rosterPath, JSON.stringify(JSON.parse(files.get(rosterPath)!).map((m: any) => m.name === 'Head' ? { ...m, state: 'closed', handle: '' } : m)))
  files.set(`${TEAM}/settings.json`, JSON.stringify({ maxOpen: 1 }))
  files.set(`${STATUS}/Head.json`, JSON.stringify({ name: 'Head', sessionId: ID1, state: 'closed', heartbeat: Date.now() }))
  files.set(`${STATUS}/Worker.json`, JSON.stringify({ name: 'Worker', sessionId: ID2, state: 'idle', heartbeat: Date.now() }))
  id = ID2
  env.ORCA_TERMINAL_HANDLE = 'term_worker'
  const queued: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Head', message: 'Task complete. Cleanup: clean.' } as any)
  expect(String(queued.result)).toContain('queued')
  expect(JSON.parse(files.get(`${STATUS}/Worker.json`)!).cleanupReport).toBeUndefined()
  expect(files.calls.some(a => a[1] === 'terminal' && a[2] === 'close')).toBe(false)
})

test('cleanup deletes remain ordinary asks even when AutoScratch is enabled, with deny decisions unchanged', async ($, on) => {
  const temp = 'C:/Users/me/AppData/Local/Temp'
  const own = `${temp}/claude/proj/${ID2}/scratchpad`
  const files = world(on, [], [], undefined, { env: { TEMP: temp }, dirs: { [own]: [{ name: 'link-to-retained-file.txt', kind: 'other', isLink: true }] } })
  on('session.id', async () => ({ value: ID1 }) as any)
  for (const tool of ['Bash', 'PowerShell']) on('tool.check', { tool } as any, async (_$: any, e: any) =>
    String(e.input?.command ?? '').includes('denied-marker') ? ({ decision: 'deny', reason: 'policy deny' }) as any : ({ decision: 'ask', reason: 'engine asks' }) as any)
  await adopt($, [
    { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h', sessionId: ID1 },
    { name: 'Worker', role: 'worker', level: 2, boss: 'Head', handle: 'term_w', sessionId: ID2 },
  ], 'T')
  files.set(`${TEAM}/settings.json`, JSON.stringify({ autoScratch: true, scratchDir: '.claude/scratch' }))
  const commands = [
    `rm ${own}/notes.tmp`,
    `rm ${own}/final_answer.md`,
    `rm ${own}/benchmark.csv`,
    'rm C:/Users/me/AppData/Local/Temp/shared/cache.tmp',
    'rm .claude/scratch/report.md',
    `rm -rf ${own}/nested`,
    `rm ${own}/link-to-retained-file.txt`,
  ]
  for (const command of commands) {
    const checked: any = await $.tool.check({ tool: 'Bash', input: { command } } as any)
    expect(checked.decision).toBe('ask')
    expect(checked.reason).toBe('engine asks')
  }
  const denied: any = await $.tool.check({ tool: 'Bash', input: { command: `rm ${own}/denied-marker.tmp` } } as any)
  expect(denied).toEqual({ decision: 'deny', reason: 'policy deny' })
})
