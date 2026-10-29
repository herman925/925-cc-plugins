// One running copy of each member, and none lost, on a PC that gives no name (COMPUTERNAME and HOSTNAME unset, as on
// Linux):
//  - a member of this PC whose session has stopped starts as a fresh copy when the user said yes (startHere)
//  - a member still running is never started a second time, whatever the roster says and whether Orca finds its tab
//  - a start reaches the roster even when the status write after it fails
//  - the first message waits for the new session to register: Orca's tui-idle can come before claude has started

import { expect, test } from 'claude-code/testing'

import { adopt, HUALONG, ID1, ID2, STATUS, TEAM, world } from './test-world'

const ROSTER = `${TEAM}/roster.json`
const CLAUDE = `"C:\\Users\\me\\.local\\bin\\claude.exe" --session-id ${ID2} --name "Hualong Workers"`

/**
 * The CEO in its own tab, Workers with session ID2. running: the pids whose process runs (Workers at 101), with their
 * command line; late: how many one-second pauses pass before a newly started session registers; refuse: a write that
 * fails with EACCES.
 */
const setup = async ($: any, on: any, o: { running?: Record<number, string>; late?: number; refuse?: (path: string) => boolean; machine?: string } = {}) => {
  const running = o.running ?? {}
  let at = ''
  let started = ''
  let pauses = 0
  // the registry: one file per process, in this host's form of the test's paths
  const reg = (pid: number, sessionId: string) =>
    files.set(`${at}C:/home/.claude/sessions/${pid}.json`, JSON.stringify({ pid, sessionId, cwd: 'C:/proj', name: '', kind: 'interactive' }))
  const files = world(on, [], [], (e: any) => {
    const a: string[] = e.argv
    if (a[0] === 'powershell.exe' && String(a[3] ?? '').includes('Win32_Process -Filter')) {
      const ids = [...String(a[3]).matchAll(/ProcessId=(\d+)/g)].map(m => Number(m[1]))
      return [...ids.map(i => (running[i] ? `RUN|${i}|${running[i]}` : `NONE|${i}`)), 'DONE'].join('\r\n')
    }
    if (a[0] === 'powershell.exe' && String(a[3] ?? '').includes('Start-Sleep')) {
      if (++pauses === o.late) reg(150, started)
      return ''
    }
    if (a[1] === 'worktree' && a[2] === 'current') return '{"result":{"worktree":{"id":"r1::C:/proj"}}}'
    if (a[1] === 'terminal' && a[2] === 'create') {
      started = String(a[a.indexOf('--command') + 1]).match(/--(?:session-id|resume) (\S+)/)![1]!
      if (!o.late) reg(150, started)
      return '{"result":{"terminal":{"handle":"term_ae5"}}}'
    }
    if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
    return undefined
  }, { env: { ORCA_TERMINAL_HANDLE: 'term_c', COMPUTERNAME: o.machine ?? 'PC-LOCAL' }, registry: [], refuse: o.refuse })
  // a message reaches only a session the registry lists, as the engine's does
  const listed = (to: unknown) =>
    [...files.entries()].some(([k, v]) => k.includes('/.claude/sessions/') && JSON.stringify(to).includes(JSON.parse(v).sessionId))
  const sends: any[] = []
  on('session.id', async () => ({ value: ID1 }) as any)
  on('session.send', async (_$: any, e: any) =>
    (listed(e.to) ? (sends.push(e), { isDelivered: true }) : { isDelivered: false, reason: `no live session on this machine has id ${JSON.stringify(e.to)}` }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await adopt($, HUALONG.map(r => ({ ...r, handle: r.name === 'Hualong CEO' ? 'term_c' : '', sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : '' })))
  // where this host's engine puts the test's paths ('' on Windows; off Windows a relative C:/ path is made absolute)
  at = [...files.keys()].find(k => k.endsWith(ROSTER))!.slice(0, -ROSTER.length)
  reg(100, ID1)
  if (running[101]) reg(101, ID2)
  const workers = () => JSON.parse(files.get(`${at}${ROSTER}`)!).find((x: any) => x.name === 'Hualong Workers')
  const setWorkers = (patch: object) =>
    files.set(`${at}${ROSTER}`, JSON.stringify(JSON.parse(files.get(`${at}${ROSTER}`)!).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, ...patch } : x))))
  const creates = () => files.calls.filter(a => a[1] === 'terminal' && a[2] === 'create')
  const message = (extra: object = {}): Promise<any> =>
    $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Hualong Workers', message: 'build it', ...extra } as any)
  return { files, at: () => at, sends, creates, message, workers, setWorkers }
}

test('a remote startHere request at capacity is not queued; retry after capacity frees starts it fresh', async ($, on) => {
  const { files, at, creates, message, setWorkers } = await setup($, on, { machine: 'PC-LOCAL' })
  setWorkers({ machine: 'PC-REMOTE', location: 'remote', worktree: 'remote::C:/other', handle: '', sessionId: ID2, state: 'idle' })
  files.set(`${at()}${TEAM}/settings.json`, JSON.stringify({ maxOpen: 1 }))
  const ordinary: any = await message()
  expect(String(ordinary.result)).toContain('PC-REMOTE')
  expect(String(ordinary.result)).not.toContain('queued')
  expect(creates().length).toBe(0)

  const full: any = await message({ startHere: true })
  expect(String(full.result)).toContain('was not started')
  expect(String(full.result)).toContain('not queued')
  expect(String(full.result)).toContain('retry team_message with startHere: true')
  expect(creates().length).toBe(0)
  expect([...files.keys()].some(k => k.includes('/queue/'))).toBe(false)

  files.set(`${at()}${TEAM}/settings.json`, JSON.stringify({ maxOpen: 2 }))
  const retried: any = await message({ startHere: true })
  expect(creates().length).toBe(1)
  expect(String(retried.result)).toContain('Sent to Hualong Workers.')
  expect(files.calls.filter(a => a[1] === 'terminal' && a[2] === 'create')).toHaveLength(1)
})

test('startHere on a member of this PC whose session has stopped resumes its saved session and sends to it', async ($, on) => {

  const { files, at, sends, creates, message } = await setup($, on)
  // its last status was written 10 minutes ago, by the start whose session then stopped
  files.set(`${at()}${STATUS}/Hualong_Workers.json`, JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state: 'idle', heartbeat: Date.now() - 10 * 60_000 }))
  const r = await message({ startHere: true })
  expect(creates().length).toBe(1)
  const cmd = String(creates()[0]![creates()[0]!.indexOf('--command') + 1])
  expect(cmd).toContain(`--resume ${ID2}`)
  expect(cmd).not.toContain('--session-id ')
  expect(String(r.result)).toContain('resumed')
  expect(String(r.result)).toContain('Sent to Hualong Workers.')
  expect(sends.length).toBe(1)
  expect(JSON.stringify(sends[0].to)).toContain(ID2)
})

test('startHere cannot exceed Max open; a proven-dead local member is marked closed, then the fresh start queues at cap', async ($, on) => {
  const { files, at, creates, message } = await setup($, on)
  files.set(`${at()}${TEAM}/settings.json`, JSON.stringify({ maxOpen: 1 }))
  files.set(`${at()}${STATUS}/Hualong_Workers.json`, JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state: 'idle', heartbeat: Date.now() - 10 * 60_000 }))
  const result = await message({ startHere: true })
  expect(String(result.result)).toContain('queued')
  expect(creates().length).toBe(0)
  expect(files.calls.some(a => a[1] === 'terminal' && a[2] === 'close')).toBe(false)
  expect(JSON.parse(files.get(`${at()}${STATUS}/Hualong_Workers.json`)!).state).toBe('closed')
})

test('a running member the roster still calls "not started", whose tab Orca does not find, is sent to and never started again', async ($, on) => {
  const { sends, creates, message, workers, setWorkers } = await setup($, on, { running: { 101: CLAUDE } })
  setWorkers({ pending: true, briefed: false })
  const r = await message()
  expect(creates().length).toBe(0)
  expect(String(r.result)).toContain('Sent to Hualong Workers.')
  expect(sends.length).toBe(1)
  expect(JSON.stringify(sends[0].to)).toContain(ID2)
  // the roster follows: the next message goes straight to it
  expect(workers().pending).toBe(false)
})

test('a start reaches the roster even when the status write after it fails', async ($, on) => {
  const { creates, message, workers, setWorkers } = await setup($, on, { refuse: path => path.endsWith('/status/Hualong_Workers.json') })
  setWorkers({ pending: true, briefed: false, sessionId: '' })
  await message().catch(() => undefined)
  expect(creates().length).toBe(1)
  // not "not started": a later message must not start a second copy
  expect(workers()).toMatchObject({ pending: false, briefed: true, handle: 'term_ae5' })
})

test('the first message waits for the new session to register, not only for its tab to go idle', async ($, on) => {
  const { sends, creates, message, setWorkers } = await setup($, on, { late: 3 })
  setWorkers({ pending: true, briefed: false, sessionId: '' })
  const r = await message()
  expect(creates().length).toBe(1)
  expect(String(r.result)).toContain('Sent to Hualong Workers.')
  expect(sends.length).toBe(1)
})
