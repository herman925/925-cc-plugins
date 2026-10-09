// 0.5.12: one writer for the team files (#59) and teams spread over two PCs (#64).

import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { afterTry, appliedAfter, applyOps, DAY, diffOps, fileName, isAway, KEEP_MS, metaAfter, olderThan, pendingNames, projectKey, queueAction, rightsChanges, rosterOps } from './changes'
import type { Change, QEntry } from './changes'
import { identify } from './identity'
import { adopt, HUALONG, ID1, ID2, ID3, mountBand, pendingChanges, rawSaved, saved, STATUS, TEAM, world } from './test-world'

const m = (name: string, boss: string, extra: Partial<Member> = {}): Member => ({
  team: 'T', name, role: 'r', level: 1, boss, handle: '', sessionId: '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false, ...extra,
})
const by = { session: ID2, member: 'Hualong Workers', machine: '', version: '0.5.12' }
const change = (at: number, ops: any[]): Change => ({ v: 1, kind: 'roster', at, by, ops })

// ── the rules ──

test('a change file holds only the fields a session changed; change files apply in time order, field by field', () => {
  const base = [m('A', 'user', { short: 'x' }), m('B', 'A')]
  // one field changed: one field in the change
  expect(diffOps(base, [{ ...base[0]!, allowWrite: true }, base[1]!])).toEqual([{ op: 'set', key: 'T|A', patch: { allowWrite: true } }])
  // a cleared field is null; a rename is the old member out and the new one in, whole
  expect(diffOps(base, [{ ...base[0]!, short: undefined }, base[1]!])).toEqual([{ op: 'set', key: 'T|A', patch: { short: null } }])
  const renamed = diffOps(base, [base[0]!, { ...base[1]!, name: 'C' }])
  expect(renamed.map(o => o.op)).toEqual(['add', 'del'])
  // three sessions: the names carry the time, so the oldest applies first whatever order the files came in
  const now = 10 * DAY
  const files = new Map([
    [fileName(now - 1000, 'b2'), change(now - 1000, [{ op: 'set', key: 'T|A', patch: { short: 'two' } }, { op: 'set', key: 'T|B', patch: { role: 'r2' } }])],
    [fileName(now - 3000, 'c3'), change(now - 3000, [{ op: 'set', key: 'T|A', patch: { allowWrite: true, short: 'zero' } }])],
    [fileName(now - 2000, 'a1'), change(now - 2000, [{ op: 'set', key: 'T|A', patch: { short: 'one' } }])],
    [fileName(now - KEEP_MS - 1, 'old1'), change(now - KEEP_MS - 1, [{ op: 'del', key: 'T|A' }])],
  ])
  const todo = pendingNames([...files.keys(), 'applied.json'], new Set(), now)
  expect(todo).toEqual([fileName(now - 3000, 'c3'), fileName(now - 2000, 'a1'), fileName(now - 1000, 'b2')])
  const out = applyOps(base, rosterOps(todo.map(name => ({ name, change: files.get(name)! }))))
  // the last short name wins; the right set earlier stays; the other member's field is its own
  expect(out.map(x => [x.name, x.short, x.allowWrite, x.role])).toEqual([['A', 'two', true, 'r'], ['B', undefined, undefined, 'r2']])
  // the applied index: what is listed is not applied again; entries past 7 days drop out (their files are ignored by name)
  const idx = appliedAfter([fileName(now - KEEP_MS - 5, 'gone')], todo, now)
  expect(idx).toEqual(todo)
  expect(pendingNames([...files.keys()], new Set(idx), now)).toEqual([])
  // a member added, and a member removed
  expect(applyOps(base, [{ op: 'add', member: { team: 'T', name: 'N', boss: 'A' } }, { op: 'del', key: 'T|B' }]).map(x => x.name)).toEqual(['A', 'N'])
  // a change of rights is named, with who made it, for the top's toast
  expect(rightsChanges([{ name: 'x', change: change(now, [{ op: 'set', key: 'T|A', patch: { allowWrite: true } }]) }])).toEqual(['A: Allow writes on (from Hualong Workers)'])
})

test('versions: an older mod is told apart from a newer one; the stamp keeps the newest writer and the first top machine', () => {
  expect(olderThan('0.5.9', '0.5.12')).toBe(true)
  expect(olderThan('0.5.12', '0.5.12')).toBe(false)
  expect(olderThan('0.6.0', '0.5.12')).toBe(false)
  // an unknown version on either side is never older
  expect(olderThan('', '0.5.12')).toBe(false)
  expect(olderThan('0.5.12', '')).toBe(false)
  expect(metaAfter({ schemaVersion: 1, writtenBy: '', topMachine: '' }, '0.5.12', 'PC-A')).toEqual({ schemaVersion: 2, writtenBy: '0.5.12', topMachine: 'PC-A' })
  expect(metaAfter({ schemaVersion: 2, writtenBy: '0.5.13', topMachine: 'PC-A' }, '0.5.12', 'PC-B')).toEqual({ schemaVersion: 2, writtenBy: '0.5.13', topMachine: 'PC-A' })
})

test('the queue: delivered, back to pending when there is no room, failed after three failed tries, pruned after a day or a week', () => {
  const now = 30 * DAY
  const q: QEntry = { to: 'W', from: 'H', message: 'hi', created: now - 1000, state: 'pending', tries: 0 }
  expect(queueAction(q, now)).toBe('try')
  expect(afterTry(q, true, now).state).toBe('delivered')
  // no room is not a failed try
  expect(afterTry(q, undefined, now)).toMatchObject({ state: 'pending', tries: 0 })
  const one = afterTry(q, false, now, 'x')
  const two = afterTry(one, false, now, 'x')
  const three = afterTry(two, false, now, 'x')
  expect([one.state, two.state, three.state, three.tries]).toEqual(['pending', 'pending', 'failed', 3])
  // delivered and failed entries stay a day, then go; anything goes after 7 days
  expect(queueAction({ ...q, state: 'delivered', updated: now - DAY + 1000 }, now)).toBe('keep')
  expect(queueAction({ ...q, state: 'delivered', updated: now - DAY - 1000 }, now)).toBe('prune')
  expect(queueAction({ ...q, state: 'failed', updated: now - DAY - 1000 }, now)).toBe('prune')
  expect(queueAction({ ...q, created: now - KEEP_MS - 1 }, now)).toBe('prune')
  // one marked sending by a round that stopped is tried again after five minutes
  expect(queueAction({ ...q, state: 'sending', updated: now - 1000 }, now)).toBe('keep')
  expect(queueAction({ ...q, state: 'sending', updated: now - 6 * 60_000 }, now)).toBe('try')
})

test('status files go under the config folder, in a project folder named the way Claude names its projects folders', () => {
  expect(projectKey("C:\\Users\\hkkchan\\orca\\projects\\Teacher's Well-being Research")).toBe('C--Users-hkkchan-orca-projects-Teacher-s-Well-being-Research')
  expect(projectKey('c:/proj/')).toBe('C--proj')
  expect(projectKey('/home/lin/proj')).toBe('-home-lin-proj')
})

test('identify: a member from another PC is never matched by tab or registry; one with no machine takes this one', () => {
  const list = [m('Head', 'user', { handle: 'term_h', sessionId: ID1, machine: 'PC-A' }), m('W', 'Head', { handle: 'term_w', sessionId: ID2, machine: 'PC-A' }), m('X', 'Head', { handle: 'term_x', sessionId: ID3 })]
  const live = new Set<string>()
  // this PC's tab term_w is another session's: W's handle is PC-A's
  expect(identify({ list, facts: { tab: 'term_w', sessionId: 'fresh', name: '' }, local: true, live, here: 'PC-B' }).level).toBe('none')
  // its id and name with this PC's registry proof: held for Herman, with the reason
  const held = identify({ list, facts: { tab: '', sessionId: ID2, name: 'W' }, local: true, live, here: 'PC-B' })
  expect(held.level).toBe('restricted')
  expect(held.why).toContain('its home is PC-A')
  // on its own PC it is W, as before
  expect(identify({ list, facts: { tab: 'term_w', sessionId: ID2, name: 'W' }, local: true, live, here: 'PC-A' }).level).toBe('full')
  // a member with no machine recorded is confirmed here and takes this PC
  const x = identify({ list, facts: { tab: 'term_x', sessionId: ID3, name: 'X' }, local: true, live, here: 'PC-B' })
  expect([x.level, x.changed, x.member?.machine]).toEqual(['full', true, 'PC-B'])
  // a PC that does not know its name keeps the old rules
  expect(isAway(list[1]!, '')).toBe(false)
})

// ── in the engine ──

const ROSTER = `${TEAM}/roster.json`
const ids = (rows: typeof HUALONG) =>
  rows.map(r => ({ ...r, handle: '', sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : r.name === 'Hualong Worker 5' ? ID3 : '' }))
type Seen = { toasts: string[]; sends: any[]; contexts: (readonly string[] | undefined)[]; messages: any[] }
// failTo: the session id whose sends fail (0.5.13, #67: members are messaged by session id)
const engine = (on: any, sid: { id: string }, failTo = '') => {
  const seen: Seen = { toasts: [], sends: [], contexts: [], messages: [] }
  on('session.id', async () => ({ value: sid.id }) as any)
  on('session.send', async (_$: any, e: any) => {
    seen.sends.push(e)
    return (failTo && JSON.stringify(e.to).includes(failTo) ? { isDelivered: false, reason: 'no live session on this machine has id' } : { isDelivered: true }) as any
  })
  on('ui.toast', async (_$: any, e: any) => (seen.toasts.push(String(e.text)), { value: undefined }) as any)
  on('prompt.submit', async (_$: any, e: any) => (seen.contexts.push(e.context), { text: e.text }) as any)
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }) as any)
  on('tool.call', { tool: 'ListAgents' } as any, async () => ({ result: '' }) as any)
  on('tool.call', { tool: 'AskUserQuestion' } as any, async () => ({ result: 'Take over' }) as any)
  on('tool.call', { tool: 'SendMessage' } as any, async (_$: any, e: any) => {
    seen.messages.push(e)
    return { result: 'sent', text: 'sent' } as any
  })
  return seen
}
const refresh = async (band: any) => {
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
}
const row = (rows: any[], name: string) => rows.find((x: any) => x.name === name)

test('a member\'s change goes to a change file: its own view has it at once, the roster file waits, the top\'s refresh applies it', async ($, on) => {
  const files = world(on)
  const sid = { id: ID3 } // Hualong Worker 5
  const seen = engine(on, sid)
  await adopt($, ids(HUALONG))
  const before = files.get(ROSTER)
  const band = await mountBand($, 300)
  await band.press({ key: 'settings' })
  await band.press({ key: 'perm-write-Hualong|Hualong Worker 5' })
  // the file is the top's; the change waits beside it, with the one field
  expect(files.get(ROSTER)).toBe(before)
  const waiting = pendingChanges(files)
  expect(waiting.length).toBe(1)
  expect(waiting[0]!.change.ops).toEqual([{ op: 'set', key: 'Hualong|Hualong Worker 5', patch: { allowWrite: true } }])
  expect(waiting[0]!.change.by.member).toBe('Hualong Worker 5')
  // every session reads the file with the change on it, and this panel shows it at once
  expect(row(saved(files), 'Hualong Worker 5').allowWrite).toBe(true)
  expect(JSON.stringify(await band.drawn())).toContain('[x] Allow writes')
  // the team top's refresh folds it in and lists it as applied, and says a right changed
  sid.id = ID1
  await refresh(band)
  expect(row(rawSaved(files), 'Hualong Worker 5').allowWrite).toBe(true)
  expect(pendingChanges(files)).toEqual([])
  expect(JSON.parse(files.get(`${TEAM}/changes/applied.json`)!).names).toEqual([waiting[0]!.name])
  expect(seen.toasts.some(t => t.includes('applied a change of rights') && t.includes('Hualong Worker 5: Allow writes on (from Hualong Worker 5)'))).toBe(true)
  // the stamp beside the roster
  expect(JSON.parse(files.get(`${TEAM}/meta.json`)!).schemaVersion).toBe(2)
})

test('change files from several sessions are applied by the top oldest first, field by field', async ($, on) => {
  const files = world(on)
  const sid = { id: ID1 }
  engine(on, sid)
  await adopt($, ids(HUALONG))
  const t = Date.now()
  const put = (at: number, tag: string, ops: any[]) => files.set(`${TEAM}/changes/${fileName(at, tag)}`, JSON.stringify(change(at, ops)))
  // written in this order, made in another
  put(t - 1000, 'cccc3333', [{ op: 'set', key: 'Hualong|Hualong Worker 5', patch: { short: 'last' } }])
  put(t - 3000, 'aaaa1111', [{ op: 'set', key: 'Hualong|Hualong Worker 5', patch: { short: 'first', allowAgent: true } }])
  put(t - 2000, 'bbbb2222', [{ op: 'set', key: 'Hualong|Hualong Worker 5', patch: { short: 'middle' } }, { op: 'set', key: 'Hualong|Hualong Workers', patch: { role: 'lead of the workers' } }])
  // one older than 7 days is never applied
  put(t - KEEP_MS - 60_000, 'dddd4444', [{ op: 'del', key: 'Hualong|Hualong Worker 5' }])
  const band = await mountBand($, 300)
  await refresh(band)
  const rows = rawSaved(files)
  expect([row(rows, 'Hualong Worker 5').short, row(rows, 'Hualong Worker 5').allowAgent]).toEqual(['last', true])
  expect(row(rows, 'Hualong Workers').role).toBe('lead of the workers')
  expect(JSON.parse(files.get(`${TEAM}/changes/applied.json`)!).names.length).toBe(3)
})

test('a team setting changed by a member waits as a change file; the top writes it into settings.json', async ($, on) => {
  const files = world(on)
  const sid = { id: ID3 }
  engine(on, sid)
  await adopt($, ids(HUALONG))
  const band = await mountBand($, 300)
  await band.press({ key: 'settings' })
  await band.press({ key: 'ts-auto-0' })
  expect(files.has(`${TEAM}/settings.json`)).toBe(false)
  expect(pendingChanges(files).map(c => [c.change.kind, (c.change as any).patch])).toEqual([['settings', { autoClose: false }]])
  // shown at once in this session
  expect(await band.find({ key: 'ts-auto-1' })).toBeDefined()
  sid.id = ID1
  await refresh(band)
  expect(JSON.parse(files.get(`${TEAM}/settings.json`)!).autoClose).toBe(false)
  expect(pendingChanges(files)).toEqual([])
})

test('a session whose mod is older than the roster\'s writer writes no team file, and says so once', async ($, on) => {
  const files = world(on, [], [], undefined, { version: '0.5.12' })
  const sid = { id: ID1 } // the team top itself
  const seen = engine(on, sid)
  await adopt($, ids(HUALONG))
  files.set(`${TEAM}/meta.json`, JSON.stringify({ schemaVersion: 3, writtenBy: '0.6.0', topMachine: '' }))
  const before = files.get(ROSTER)
  const band = await mountBand($, 300)
  await band.press({ key: 'settings' })
  await band.press({ key: 'perm-agent-Hualong|Hualong Worker 5' })
  await band.press({ key: 'perm-write-Hualong|Hualong Worker 5' })
  await refresh(band)
  expect(files.get(ROSTER)).toBe(before)
  expect(files.has(`${TEAM}/settings.json`)).toBe(false)
  // its changes wait for a current top
  expect(pendingChanges(files).length).toBe(2)
  const told = seen.toasts.filter(t => t.includes('team-orchestrator and /reload-plugins'))
  expect(told.length).toBe(1)
  expect(told[0]).toContain('0.6.0')
})

test('the queue: one file per message; the top delivers, retries, marks failed after three tries and tells the head, and prunes', async ($, on) => {
  const files = world(on)
  const sid = { id: ID1 }
  const seen = engine(on, sid, ID3)
  await adopt($, ids(HUALONG))
  const now = Date.now()
  const q = (at: number, tag: string, e: Partial<QEntry>) =>
    files.set(`${TEAM}/queue/${fileName(at, tag)}`, JSON.stringify({ message: 'hi', created: at, state: 'pending', tries: 0, ...e }))
  q(now - 5000, 'aaaa0001', { to: 'Hualong Workers', from: 'Hualong CEO', message: 'plan' })
  q(now - 4000, 'aaaa0002', { to: 'Hualong Worker 5', from: 'Hualong Workers', message: 'build' })
  q(now - 2 * DAY, 'aaaa0003', { to: 'Hualong Workers', from: 'Hualong CEO', state: 'delivered', updated: now - 2 * DAY })
  q(now - KEEP_MS - 60_000, 'aaaa0004', { to: 'Hualong Workers', from: 'Hualong CEO', message: 'ancient' })
  // the single queue.json of an older version moves in
  files.set(`${TEAM}/queue.json`, JSON.stringify([{ to: 'Hualong Workers', from: 'Hualong CEO', message: 'from the old file', at: now - 3000 }]))
  const band = await mountBand($, 300)
  await refresh(band)
  expect(JSON.parse(files.get(`${TEAM}/queue/${fileName(now - 5000, 'aaaa0001')}`)!).state).toBe('delivered')
  // by session id, never by name (#67): no SendMessage at all
  expect(seen.sends.some(x => JSON.stringify(x.to).includes(ID2) && x.text === '[queued message from Hualong CEO] plan')).toBe(true)
  expect(seen.sends.some(x => x.text === '[queued message from Hualong CEO] from the old file')).toBe(true)
  expect(seen.messages.length).toBe(0)
  expect(files.get(`${TEAM}/queue.json`)).toBe('[]')
  expect(JSON.parse(files.get(`${TEAM}/queue/${fileName(now - 4000, 'aaaa0002')}`)!)).toMatchObject({ state: 'pending', tries: 1 })
  // delivered two days ago: pruned; older than a week: never even read
  expect(JSON.parse(files.get(`${TEAM}/queue/pruned.json`)!).names).toEqual([fileName(now - 2 * DAY, 'aaaa0003')])
  expect(seen.sends.some(x => String(x.text).includes('ancient'))).toBe(false)
  await refresh(band)
  await refresh(band)
  const failed = JSON.parse(files.get(`${TEAM}/queue/${fileName(now - 4000, 'aaaa0002')}`)!)
  expect([failed.state, failed.tries]).toEqual(['failed', 3])
  // the sender's head (Hualong Workers reports to the CEO) is told, once
  const told = seen.sends.filter(s => String(s.text).startsWith('QUEUE (Team Orchestrator)'))
  expect(told.length).toBe(1)
  expect(JSON.stringify(told[0].to)).toContain(ID1)
  expect(told[0].text).toContain('build')
  // nothing is tried again
  await refresh(band)
  expect(seen.sends.filter(x => JSON.stringify(x.to).includes(ID3)).length).toBe(3)
})

test('status files live on the machine; an older version\'s file in the project is read once and moved', async ($, on) => {
  const files = world(on)
  const sid = { id: ID1 }
  engine(on, sid)
  // left by an older version, in the project
  files.set(`${TEAM}/status/Hualong_Workers.json`, JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state: 'working', heartbeat: Date.now() }))
  await adopt($, ids(HUALONG))
  const band = await mountBand($, 300)
  await refresh(band)
  expect(JSON.parse(files.get(`${STATUS}/Hualong_Workers.json`)!).state).toBe('working')
  // the old file is not read again
  files.set(`${TEAM}/status/Hualong_Workers.json`, JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state: 'asking', heartbeat: Date.now() }))
  await refresh(band)
  expect(JSON.parse(files.get(`${STATUS}/Hualong_Workers.json`)!).state).toBe('working')
  // the band's count of members asking stays empty
  expect(JSON.stringify(await band.drawn())).not.toContain('" asking "')
  // this session writes its own status on the machine, never in the project
  await $.turn.start({ turnId: 't1' } as any).catch(() => undefined)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  for (let i = 0; i < 20 && !files.has(`${STATUS}/Hualong_CEO.json`); i++) await band.drawn()
  expect(files.has(`${STATUS}/Hualong_CEO.json`)).toBe(true)
  expect(files.has(`${TEAM}/status/Hualong_CEO.json`)).toBe(false)
})

test('a member on another PC is shown "on" that PC and never reopened, closed or messaged from here; a fresh copy only on request', async ($, on) => {
  const files = world(on, [], [], undefined, { env: { COMPUTERNAME: 'PC-B' } })
  const sid = { id: ID1 }
  engine(on, sid)
  await adopt($, ids(HUALONG))
  // adopted here: every member's home is this PC
  expect(rawSaved(files).every((x: any) => x.machine === 'PC-B')).toBe(true)
  files.set(ROSTER, JSON.stringify(rawSaved(files).map((x: any) => (x.name === 'Hualong Worker 5' ? { ...x, machine: 'PC-A', state: 'closed' } : x))))
  // a status file of the same name on this PC says idle and clean long ago: it is not this member's, so nothing closes
  files.set(`${STATUS}/Hualong_Worker_5.json`, JSON.stringify({ name: 'Hualong Worker 5', sessionId: ID3, state: 'idle', heartbeat: Date.now(), turnEnd: 1, lastClean: 1 }))
  const band = await mountBand($, 300)
  await refresh(band)
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('on PC-A')
  const r: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Hualong Worker 5', message: 'build it' } as any)
  expect(String(r.result)).toContain('runs on PC-A')
  expect(String(r.result)).toContain('startHere: true')
  const orcaCalls = (verb: string) => files.calls.filter(a => a[1] === 'terminal' && a[2] === verb)
  expect(orcaCalls('create').length).toBe(0)
  expect(orcaCalls('close').length).toBe(0)
  // with Herman's yes, a fresh copy starts here (Orca answers nothing in this test, so it reports it could not)
  const fresh: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Hualong Worker 5', message: 'build it', startHere: true } as any)
  expect(orcaCalls('create').length + orcaCalls('list').length).toBeGreaterThan(0)
  expect(String(fresh.result)).toContain('fresh copy of Hualong Worker 5')
})

test('the top machine is another PC: the top here writes change files, says which PC holds the top, and takes over only with Herman\'s answer', async ($, on) => {
  const files = world(on, [], [], undefined, { env: { COMPUTERNAME: 'PC-B' } })
  const sid = { id: ID1 }
  const seen = engine(on, sid)
  await adopt($, ids(HUALONG))
  files.set(`${TEAM}/meta.json`, JSON.stringify({ schemaVersion: 2, writtenBy: '', topMachine: 'PC-A' }))
  const band = await mountBand($, 300)
  await refresh(band)
  expect(seen.toasts.filter(t => t.includes('the team top runs on PC-A')).length).toBe(1)
  const before = files.get(ROSTER)
  await band.press({ key: 'settings' })
  await band.press({ key: 'perm-write-Hualong|Hualong Worker 5' })
  expect(files.get(ROSTER)).toBe(before)
  expect(pendingChanges(files).length).toBe(1)
  // the model is told to ask Herman on its next prompt
  await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false } as any)
  expect(JSON.stringify(seen.contexts)).toContain('team_take_top')
  expect(JSON.stringify(seen.contexts)).toContain('AskUserQuestion')
  // not without his answer in this turn
  const early: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_take_top', take: true } as any)
  expect(String(early.deny)).toContain('Ask the user first')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  const ok: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_take_top', take: true } as any)
  expect(String(ok.result)).toContain('PC-B) now holds the team top')
  expect(JSON.parse(files.get(`${TEAM}/meta.json`)!).topMachine).toBe('PC-B')
  // this PC writes now: the change that waited is applied
  await refresh(band)
  expect(row(rawSaved(files), 'Hualong Worker 5').allowWrite).toBe(true)
  expect(pendingChanges(files)).toEqual([])
})

test('another session forging a change file is stopped: members may not write changes/ or meta.json', async ($, on) => {
  world(on)
  const sid = { id: ID3 }
  engine(on, sid)
  for (const tool of ['Write', 'Bash']) on('tool.call', { tool } as any, async () => ({ result: 'done' }) as any)
  await adopt($, ids(HUALONG))
  const w: any = await $.tool.call({ tool: 'Write', file_path: `${TEAM}/changes/0000000000001-abcd.json`, content: '{}' } as any)
  expect(String(w.deny)).toContain('may not change the team file')
  const b: any = await $.tool.call({ tool: 'Bash', command: 'echo {} > .claude/team-orchestrator/meta.json' } as any)
  expect(String(b.deny)).toContain('names a team file')
  const ok: any = await $.tool.call({ tool: 'Bash', command: 'cat .claude/team-orchestrator/changes/applied.json' } as any)
  expect(ok.deny).toBeUndefined()
})
