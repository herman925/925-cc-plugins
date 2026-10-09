// 0.5.16: a member gone silent (#71 and #65). Before a message goes to a member silent for over 90 s, its process is
// looked up: dead (proved) is closed, reopened with --resume and sent to; alive but silent (hung) or any doubt keeps
// the message in the queue and never reopens anything.

import { expect, test } from 'claude-code/testing'

import { adopt, HUALONG, ID1, ID2, mountBand, rawSaved, STATUS, TEAM, world } from './test-world'

const MIN = 60_000
const ROSTER = `${TEAM}/roster.json`
const PC = 'PC-B'
// the CEO, Workers and Worker 5 have session ids; Workers keeps its tab handle when given one
const withIds = (rows: typeof HUALONG, workersTab = '') =>
  rows.map(r => ({
    ...r,
    handle: r.name === 'Hualong Workers' ? workersTab : '',
    sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : r.name === 'Hualong Worker 5' ? '33333333-3333-4333-8333-333333333333' : '',
  }))
type Seen = { sends: any[]; toasts: string[] }
const engine = (on: any, sid: string) => {
  const seen: Seen = { sends: [], toasts: [] }
  on('session.id', async () => ({ value: sid }) as any)
  on('session.send', async (_$: any, e: any) => (seen.sends.push(e), { isDelivered: true }) as any)
  on('ui.toast', async (_$: any, e: any) => (seen.toasts.push(String(e.text)), { value: undefined }) as any)
  on('tool.call', { tool: 'ListAgents' } as any, async () => ({ result: '' }) as any)
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }) as any)
  return seen
}
const message = ($: any, to: string, text = 'build it') => $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to, message: text } as any)
const refresh = async (band: any) => {
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
}
/** Workers' status file: last written `ago` ms ago */
const beat = (files: Map<string, string>, ago: number, state = 'idle') =>
  files.set(`${STATUS}/Hualong_Workers.json`, JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state, heartbeat: Date.now() - ago }))
const queued = (files: Map<string, string>) =>
  [...files.keys()].filter(k => k.startsWith(`${TEAM}/queue/`) && !k.endsWith('pruned.json')).sort().map(k => JSON.parse(files.get(k)!))
const procChecks = (files: { calls: string[][] }) => files.calls.filter(a => a[0] === 'powershell.exe' && String(a[3] ?? '').includes('Win32_Process -Filter'))
const creates = (files: { calls: string[][] }) => files.calls.filter(a => a[1] === 'terminal' && a[2] === 'create')

/**
 * The process lookup answers from `alive` (pid: command line; missing: no such process; 'fail': PowerShell answers
 * nothing usable); Orca answers a reopen.
 */
const answers = (alive: Record<number, string>, fail = { on: false }) => (e: any) => {
  const a: string[] = e.argv
  if (a[0] === 'powershell.exe' && String(a[3] ?? '').includes('Win32_Process -Filter')) {
    if (fail.on) return 'Get-CimInstance : Access denied'
    const ids = [...String(a[3]).matchAll(/ProcessId=(\d+)/g)].map(m => Number(m[1]))
    return [...ids.map(i => (alive[i] ? `RUN|${i}|${alive[i]}` : `NONE|${i}`)), 'DONE'].join('\r\n')
  }
  if (a[1] === 'worktree' && a[2] === 'current') return '{"result":{"worktree":{"id":"r1::C:/proj"}}}'
  if (a[1] === 'terminal' && a[2] === 'create') return '{"result":{"terminal":{"handle":"term_ae5"}}}'
  if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
  return undefined
}
// this machine's registry: the CEO (this session) at pid 100, Workers at pid 101
const REG = [{ sessionId: ID1 }, { sessionId: ID2 }]
const CLAUDE = `"C:\\Users\\me\\.local\\bin\\claude.exe" --resume ${ID2} --name "Hualong Workers"`

test('a crash (no process holds the session): the member is marked closed, reopened with --resume and the message delivered', async ($, on) => {
  // its registry entry was left behind by the crash: pid 101 runs nothing now
  const files = world(on, [], [], answers({}), { env: { COMPUTERNAME: PC }, registry: REG })
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG))
  // the team reopens fresh, but a member proved dead keeps its conversation
  files.set(`${TEAM}/settings.json`, JSON.stringify({ reopen: 'fresh' }))
  beat(files, 10 * MIN)
  const r: any = await message($, 'Hualong Workers')
  // one lookup, of that pid alone
  expect(procChecks(files).length).toBe(1)
  expect(String(procChecks(files)[0]![3])).toContain("-Filter 'ProcessId=101'")
  const create = creates(files)
  expect(create.length).toBe(1)
  expect(String(create[0]![create[0]!.indexOf('--command') + 1])).toContain(`--resume ${ID2}`)
  expect(String(r.result)).toContain('had stopped')
  expect(String(r.result)).toContain('Sent to Hualong Workers.')
  expect(seen.sends.length).toBe(1)
  expect(JSON.stringify(seen.sends[0].to)).toContain(ID2)
  expect(seen.sends[0].text).toBe('build it')
  expect(queued(files)).toEqual([])
})

test('a member that answers within 90 s is sent to at once: no process lookup', async ($, on) => {
  const files = world(on, [], [], answers({}), { env: { COMPUTERNAME: PC }, registry: REG })
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG))
  beat(files, 60_000)
  const r: any = await message($, 'Hualong Workers')
  expect(String(r.result)).toBe('Sent to Hualong Workers.')
  expect(procChecks(files).length).toBe(0)
  expect(seen.sends.length).toBe(1)
})

test('a hung member (its process runs, its status is silent): queued with a note to the sender, the top told once; delivered when it answers', async ($, on) => {
  const tabs = [{ handle: 'term_w', title: 'Hualong Workers' }]
  const files = world(on, tabs, [], answers({ 101: CLAUDE }), { env: { COMPUTERNAME: PC }, registry: REG })
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG, 'term_w'))
  beat(files, 10 * MIN)
  const r: any = await message($, 'Hualong Workers')
  expect(String(r.result)).toBe('Hualong Workers looks hung; message queued, it will be delivered when it answers or when its tab is closed.')
  expect(seen.sends.length).toBe(0)
  expect(creates(files).length).toBe(0)
  const q = queued(files)
  expect(q.length).toBe(1)
  expect(q[0]).toMatchObject({ to: 'Hualong Workers', from: 'Hualong CEO', message: 'build it', state: 'pending', reason: 'hung' })
  expect(q[0].told).toBeGreaterThan(0)
  // this session is the top: it is told by a toast, once per member per hour
  const hungNotes = () => seen.toasts.filter(t => t.includes('Hualong Workers looks hung')).length
  expect(hungNotes()).toBe(1)
  await message($, 'Hualong Workers', 'second')
  expect(hungNotes()).toBe(1)
  expect(queued(files).length).toBe(2)
  // while it stays silent (its tab still open) the round neither delivers nor looks its process up again
  const checks = procChecks(files).length
  const band = await mountBand($, 300)
  await refresh(band)
  expect(procChecks(files).length).toBe(checks)
  expect(seen.sends.length).toBe(0)
  // it answers: the next round delivers both, in order
  beat(files, 0)
  await refresh(band)
  expect(seen.sends.map(s => s.text)).toEqual(['[queued message from Hualong CEO] build it', '[queued message from Hualong CEO] second'])
  expect(queued(files).map(x => x.state)).toEqual(['delivered', 'delivered'])
  expect(creates(files).length).toBe(0)
})

test('a member not proved to live on this PC is never reopened; nor is one whose process check fails: queued, and the sender told why', async ($, on) => {
  const fail = { on: false }
  const files = world(on, [], [], answers({}, fail), { env: { COMPUTERNAME: PC }, registry: REG })
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG))
  // no home machine on record for it
  files.set(ROSTER, JSON.stringify(rawSaved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, machine: '' } : x))))
  beat(files, 10 * MIN)
  const r: any = await message($, 'Hualong Workers')
  expect(String(r.result)).toContain('its home is not recorded as this PC (PC-B)')
  expect(String(r.result)).toContain('It was not reopened')
  expect(procChecks(files).length).toBe(0)
  // its home is this PC, but the lookup answers nothing usable
  files.set(ROSTER, JSON.stringify(rawSaved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, machine: PC } : x))))
  fail.on = true
  const r2: any = await message($, 'Hualong Workers', 'again')
  expect(String(r2.result)).toContain('the process check did not answer')
  expect(creates(files).length).toBe(0)
  expect(seen.sends.length).toBe(0)
  expect(queued(files).map(x => [x.state, x.reason])).toEqual([['pending', 'unsure'], ['pending', 'unsure']])
  // nothing was marked closed
  expect(JSON.parse(files.get(`${STATUS}/Hualong_Workers.json`)!).state).toBe('idle')
})

test('a tab closed by hand: once proved dead the member is marked closed, and its queued message reopens it', async ($, on) => {
  const tabs = [{ handle: 'term_w', title: 'Hualong Workers' }]
  const alive: Record<number, string> = { 101: CLAUDE }
  const files = world(on, tabs, [], answers(alive), { env: { COMPUTERNAME: PC }, registry: REG })
  const seen = engine(on, ID1)
  await adopt($, withIds(HUALONG, 'term_w'))
  beat(files, 10 * MIN)
  const r: any = await message($, 'Hualong Workers')
  expect(String(r.result)).toContain('looks hung')
  // Herman closes its tab: the tab and the process are gone
  tabs.length = 0
  delete alive[101]
  const band = await mountBand($, 300)
  await refresh(band)
  expect(JSON.parse(files.get(`${STATUS}/Hualong_Workers.json`)!).state).toBe('closed')
  expect(seen.toasts.some(t => t.includes("Hualong Workers's tab is gone"))).toBe(true)
  // the next round reopens it with its conversation and delivers
  await refresh(band)
  const create = creates(files)
  expect(create.length).toBe(1)
  expect(String(create[0]![create[0]!.indexOf('--command') + 1])).toContain(`--resume ${ID2}`)
  expect(seen.sends.map(s => s.text)).toEqual(['[queued message from Hualong CEO] build it'])
  expect(queued(files)[0].state).toBe('delivered')
})
