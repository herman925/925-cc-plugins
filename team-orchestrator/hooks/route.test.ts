// 0.5.13: model and effort chosen vs running (#63), messages by session id (#67), the workspace after /cd or a move
// (#68) and members of other CLIs (#69).

import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { cliOf, isManaged, locationOf, modelArg, pathInWorktreeId, shownModel, windowFor, worktreeHolds } from './status'
import { adopt, HUALONG, ID1, ID2, ID3, mountBand, rawSaved, saved, STATUS, TEAM, world } from './test-world'

const mk = (extra: Partial<Member> = {}): Member => ({
  team: 'T', name: 'W', role: 'r', level: 2, boss: 'H', handle: '', sessionId: ID2, state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false, ...extra,
})

test('modelArg: only the old short form gets "claude-" back; full ids, [1m] and gateway names pass as typed', () => {
  expect(modelArg('opus-5-5')).toBe('claude-opus-5-5')
  expect(modelArg('Fable 5.1')).toBe('claude-fable-5-1')
  expect(modelArg('opus[1m]')).toBe('opus[1m]')
  expect(modelArg('claude-opus-5-5[1m]')).toBe('claude-opus-5-5[1m]')
  expect(modelArg('deepseek-chat')).toBe('deepseek-chat')
  expect(modelArg('openrouter/qwen3-coder')).toBe('openrouter/qwen3-coder')
  expect(modelArg('Kimi-K2')).toBe('Kimi-K2')
  // nothing a shell would read as more than one word
  for (const bad of ['default', 'keep', '', 'gpt 4o & calc', 'a;b', '$(x)', 'm"x']) expect(modelArg(bad)).toBe('')
  expect(shownModel('claude-haiku-5-5')).toBe('haiku-5-5')
  expect(shownModel('deepseek-chat')).toBe('deepseek-chat')
})

test('windowFor: the member\'s own reported window wins over the guess', () => {
  expect(windowFor('claude-opus-5', 50000)).toBe(200000)
  expect(windowFor('claude-opus-5[1m]', 50000)).toBe(1000000)
  expect(windowFor('claude-opus-5', 300000)).toBe(1000000)
  expect(windowFor('claude-opus-5', 50000, 1000000)).toBe(1000000)
  expect(windowFor('gw-model', 50000, 128000)).toBe(128000)
})

test('cliOf: Orca\'s agentIdentity first, else the one CLI the tab\'s command line names', () => {
  expect(cliOf({ agentIdentity: 'claude' })).toBe('claude')
  expect(cliOf({ agentIdentity: 'codex' })).toBe('codex')
  expect(cliOf({ agentIdentity: 'Gemini CLI' })).toBe('gemini')
  expect(cliOf({ agentIdentity: 'aider' })).toBe('other')
  expect(cliOf({ preview: 'C:\\proj>codex --full-auto\n> working' })).toBe('codex')
  expect(cliOf({ preview: 'C:\\proj>claude "--resume" "x"' })).toBe('claude')
  expect(cliOf({ preview: 'C:\\proj>hermes.exe\n' })).toBe('hermes')
  // two CLIs named, or none: unknown, treated as Claude
  expect(cliOf({ preview: 'claude\ncodex' })).toBe('')
  expect(cliOf({ preview: 'C:\\proj>dir' })).toBe('')
  expect(cliOf(undefined)).toBe('')
})

test('isManaged and locationOf: local by default, remote on another PC, other-cli for another CLI', () => {
  expect(isManaged(mk())).toBe(true)
  expect(isManaged(mk({ cli: 'claude' }))).toBe(true)
  expect(isManaged(mk({ cli: 'codex' }))).toBe(false)
  expect(locationOf(mk(), 'PC-B')).toBe('local')
  expect(locationOf(mk({ machine: 'PC-B' }), 'pc-b')).toBe('local')
  expect(locationOf(mk({ machine: 'PC-A' }), 'PC-B')).toBe('remote')
  expect(locationOf(mk({ location: 'remote' }), 'PC-B')).toBe('remote')
  expect(locationOf(mk({ cli: 'qwen', machine: 'PC-A' }), 'PC-B')).toBe('other-cli')
})

test('worktreeHolds and pathInWorktreeId: a workspace counts only while its folder contains the project root', () => {
  expect(pathInWorktreeId('c953::C:/Users/h/orca/ws/bullhead')).toBe('C:/Users/h/orca/ws/bullhead')
  expect(pathInWorktreeId('plain-id')).toBe('')
  expect(worktreeHolds('C:/proj', 'C:\\proj')).toBe(true)
  expect(worktreeHolds('C:/proj', 'C:/proj/sub')).toBe(true)
  expect(worktreeHolds('C:/proj-old', 'C:/proj')).toBe(false)
  expect(worktreeHolds('C:/proj/sub', 'C:/proj')).toBe(false)
  expect(worktreeHolds('', 'C:/proj')).toBe(false)
})

// ── in the engine ──

const ROSTER = `${TEAM}/roster.json`
const ok = (stdout: string) => stdout
const withIds = (rows: typeof HUALONG) =>
  rows.map(r => ({ ...r, handle: '', sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : r.name === 'Hualong Worker 5' ? ID3 : '' }))
type Seen = { sends: any[]; messages: any[]; listings: number; toasts: string[] }
const engine = (on: any, sid: string, deliver: (e: any) => any = () => ({ isDelivered: true })) => {
  const seen: Seen = { sends: [], messages: [], listings: 0, toasts: [] }
  on('session.id', async () => ({ value: sid }) as any)
  on('session.send', async (_$: any, e: any) => (seen.sends.push(e), deliver(e)) as any)
  on('ui.toast', async (_$: any, e: any) => (seen.toasts.push(String(e.text)), { value: undefined }) as any)
  on('tool.call', { tool: 'ListAgents' } as any, async () => ((seen.listings += 1), { result: '' }) as any)
  on('tool.call', { tool: 'SendMessage' } as any, async (_$: any, e: any) => (seen.messages.push(e), { result: 'sent', text: 'sent' }) as any)
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }) as any)
  return seen
}
const message = ($: any, to: string, text = 'build it') => $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to, message: text } as any)

test('team_message reaches a running local member by its session id: no ListAgents, no SendMessage by name', async ($, on) => {
  world(on)
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG))
  const r: any = await message($, 'Hualong Workers')
  expect(String(r.result)).toBe('Sent to Hualong Workers.')
  expect(seen.sends.length).toBe(1)
  expect(JSON.stringify(seen.sends[0].to)).toContain(ID2)
  expect(seen.sends[0].text).toBe('build it')
  expect([seen.listings, seen.messages.length]).toEqual([0, 0])
})

test('a failed send says why; a member with no session id yet is not messaged by name', async ($, on) => {
  world(on)
  const seen = engine(on, ID1, () => ({ isDelivered: false, reason: 'no live session on this machine has id' }))
  await adopt($, withIds(HUALONG))
  const r: any = await message($, 'Hualong Workers')
  expect(String(r.result)).toBe('Not sent to Hualong Workers: no live session on this machine has id')
  const none: any = await message($, 'Hualong PC Worker A')
  expect(String(none.result)).toContain('no session id for it yet')
  expect(seen.sends.length).toBe(1)
  expect(seen.messages.length).toBe(0)
})

test('a member recorded remote is not messaged: the messenger route (#72) is not built yet', async ($, on) => {
  const files = world(on)
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG))
  files.set(ROSTER, JSON.stringify(rawSaved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, location: 'remote' } : x))))
  const r: any = await message($, 'Hualong Workers')
  expect(String(r.result)).toContain('messenger role, which is not built yet (#72)')
  expect(seen.sends.length).toBe(0)
})

test('a codex tab adopted today is marked "not managed": never messaged, reopened, closed, briefed or tab-polled', async ($, on) => {
  const tabs: any[] = [
    { handle: 'term_c', title: 'Hualong CEO', agentIdentity: 'claude' },
    { handle: 'term_x', title: 'Codex Helper', agentIdentity: 'codex' },
  ]
  // this session runs in the CEO's tab
  const files = world(on, tabs, [], undefined, { env: { ORCA_TERMINAL_HANDLE: 'term_c' } })
  const seen = engine(on, ID1)
  await adopt($, [
    { name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_c', sessionId: ID1 },
    { name: 'Codex Helper', role: 'worker', level: 2, boss: 'Hualong CEO', handle: 'term_x', sessionId: '' },
  ])
  const rows = rawSaved(files)
  expect(rows.find((x: any) => x.name === 'Codex Helper')).toMatchObject({ cli: 'codex', location: 'other-cli' })
  expect(rows.find((x: any) => x.name === 'Hualong CEO')).toMatchObject({ cli: 'claude', location: 'local' })
  // closed by hand: still never reopened by a message
  files.set(`${STATUS}/Codex_Helper.json`, JSON.stringify({ name: 'Codex Helper', sessionId: '', state: 'closed', heartbeat: Date.now() }))
  const r: any = await message($, 'Codex Helper')
  expect(String(r.result)).toContain('is a codex session, not a Claude Code one')
  expect(seen.sends.length).toBe(0)
  const verb = (v: string) => files.calls.filter(a => a[1] === 'terminal' && a[2] === v && a.includes('term_x'))
  const band = await mountBand($, 300)
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
  expect(JSON.stringify(await band.drawn())).toContain('not managed (codex)')
  // its tab is never shown, read, closed, sent to (briefing) or created
  for (const v of ['show', 'read', 'close', 'send']) expect(verb(v).length).toBe(0)
  expect(files.calls.filter(a => a[1] === 'terminal' && a[2] === 'create').length).toBe(0)
})

test('a reopen uses the member\'s last requested model as typed, and replaces a workspace that no longer holds the project', async ($, on) => {
  const transcript = [
    JSON.stringify({ type: 'assistant', requestedModel: 'claude-opus-5-5[1m]', message: { model: 'claude-opus-5-5', usage: { input_tokens: 5000 } } }),
    // a subagent's own model is not the member's
    JSON.stringify({ type: 'assistant', isSidechain: true, requestedModel: 'haiku', message: { model: 'claude-haiku-5-5', usage: { input_tokens: 10 } } }),
  ].join('\n')
  const files = world(on, [], [{ id: ID2 }], (e: any) => {
    const a: string[] = e.argv
    if (a[0] === 'powershell.exe') return String(e.init.env.TO_FILES).split('|').map(() => `\0${transcript}`).join('')
    if (a[1] === 'worktree' && a[2] === 'current') return ok('{"result":{"worktree":{"id":"r1::C:/proj"}}}')
    if (a[1] === 'terminal' && a[2] === 'create') return ok('{"result":{"terminal":{"handle":"term_ae1"}}}')
    if (a[1] === 'terminal' && a[2] === 'wait') return ok('{"result":{"satisfied": true}}')
    return undefined
  }, { env: { ORCA_WORKTREE_ID: 'r0::C:/moved-away' } })
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG))
  // saved in a workspace Orca no longer has; closed by auto-close
  files.set(ROSTER, JSON.stringify(rawSaved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, worktree: 'gone::C:/proj', model: 'sonnet' } : x))))
  files.set(`${STATUS}/Hualong_Workers.json`, JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state: 'closed', heartbeat: Date.now() }))
  const r: any = await message($, 'Hualong Workers')
  const create = files.calls.find(a => a[1] === 'terminal' && a[2] === 'create')!
  const cmd = String(create[create.indexOf('--command') + 1])
  expect(cmd).toContain(`--resume ${ID2}`)
  expect(cmd).toContain('--model "claude-opus-5-5[1m]"')
  // ORCA_WORKTREE_ID names a folder that does not hold the project: Orca's current workspace is used, and recorded
  expect(create[create.indexOf('--worktree') + 1]).toBe('id:r1::C:/proj')
  expect(saved(files).find((x: any) => x.name === 'Hualong Workers')).toMatchObject({ worktree: 'r1::C:/proj', model: 'claude-opus-5-5[1m]', location: 'local' })
  expect(String(r.result)).toBe('Sent to Hualong Workers.')
  expect(JSON.stringify(seen.sends[0].to)).toContain(ID2)
})

test('a member writes its own context window into its status file; the roster counts against it', async ($, on) => {
  const transcript = JSON.stringify({ type: 'assistant', requestedModel: 'claude-opus-5', message: { model: 'claude-opus-5', usage: { input_tokens: 100000 } } })
  const files = world(on, [], [{ id: ID1 }], (e: any) =>
    e.argv[0] === 'powershell.exe' && String(e.init.env.TO_FILES).includes(ID1) ? String(e.init.env.TO_FILES).split('|').map(() => `\0${transcript}`).join('') : undefined,
  )
  engine(on, ID1)
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] } }) as any)
  await adopt($, withIds(HUALONG))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  const path = `${STATUS}/Hualong_CEO.json`
  const band = await mountBand($, 300)
  for (let i = 0; i < 40 && !JSON.parse(files.get(path) ?? '{}').window; i++) await band.drawn()
  const s = JSON.parse(files.get(path)!)
  // 100k of a 1M window is 10%, not the 50% the 200k guess gave
  expect([s.window, s.ctx, s.model]).toEqual([1000000, 10, 'claude-opus-5'])
})

test('a fresh reopen sends to the new session id, not the old one', async ($, on) => {
  const files = world(on, [], [], (e: any) => {
    const a: string[] = e.argv
    if (a[1] === 'worktree' && a[2] === 'current') return ok('{"result":{"worktree":{"id":"r1::C:/proj"}}}')
    if (a[1] === 'terminal' && a[2] === 'create') return ok('{"result":{"terminal":{"handle":"term_ae2"}}}')
    if (a[1] === 'terminal' && a[2] === 'wait') return ok('{"result":{"satisfied": true}}')
    return undefined
  })
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG))
  files.set(`${TEAM}/settings.json`, JSON.stringify({ reopen: 'fresh' }))
  files.set(`${STATUS}/Hualong_Workers.json`, JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state: 'closed', heartbeat: Date.now() }))
  const r: any = await message($, 'Hualong Workers')
  expect(String(r.result)).toBe('Sent to Hualong Workers.')
  const fresh = saved(files).find((x: any) => x.name === 'Hualong Workers').sessionId
  expect(fresh).not.toBe(ID2)
  expect(JSON.stringify(seen.sends[0].to)).toContain(fresh)
})
