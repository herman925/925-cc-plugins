import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { NO_GRANTS } from './guard'
import { identify, judgeHeld, roleNote, topOf } from './identity'
import type { Facts } from './identity'
import { adopt, HUALONG, ID1, ID2, ID3, saved, world } from './test-world'

// ── the ladder of #57 (no engine) ──

const mk = (name: string, boss: string, handle: string, sessionId: string, level = 2): Member => ({
  team: 'T', name, address: name, role: 'r', level, boss, handle, sessionId,
  state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: true, noted: true,
})
const [A, B, C, D, NEW] = ['id-a', 'id-b', 'id-c', 'id-d', 'id-new']
// Head over X and Y; Z reports to X
const LIST: Member[] = [mk('Head', 'user', 'term_h', A, 1), mk('X', 'Head', 'term_x', B), mk('Z', 'X', 'term_z', C, 3), mk('Y', 'Head', 'term_y', D)]
const NONE = new Set<string>()
const who = (facts: Facts, opts: { local?: boolean; live?: string[]; list?: Member[] } = {}) =>
  identify({ list: opts.list ?? LIST, facts, local: opts.local ?? true, live: new Set(opts.live ?? []) })
const row = (list: Member[], name: string) => list.find(m => m.name === name)!

test('ladder: tab + id + name is the member, full rights, nothing changes', () => {
  const r = who({ tab: 'term_x', sessionId: B, name: 'X' })
  expect([r.level, r.row, r.member?.name, r.changed, r.reattached]).toEqual(['full', 'tab+id+name', 'X', false, false])
  expect(r.list).toBe(LIST)
})

test('ladder: tab + id with a new name (/rename) is full, and the roster follows and relabels: name, address, reports', () => {
  const r = who({ tab: 'term_x', sessionId: B, name: 'X2' })
  expect([r.level, r.row, r.member?.name, r.member?.address, r.renamedFrom]).toEqual(['full', 'tab+id', 'X2', 'X2', 'X'])
  expect(row(r.list, 'Z').boss).toBe('X2')
  expect(r.list.some(m => m.name === 'X')).toBe(false)
  // the members around it are untouched
  expect(row(r.list, 'Y')).toEqual(row(LIST, 'Y'))
})

test('ladder: a /rename to another member\'s name is not followed: it stays X and never gets Y\'s rights', () => {
  const r = who({ tab: 'term_x', sessionId: B, name: 'Y' })
  expect([r.level, r.member?.name, r.changed, r.renamedFrom]).toEqual(['full', 'X', false, undefined])
})

test('ladder: tab + name with a new id (/clear) is full, and the roster takes the new session id', () => {
  const r = who({ tab: 'term_x', sessionId: NEW, name: 'X' })
  expect([r.level, r.row, r.member?.sessionId, r.changed]).toEqual(['full', 'tab+name', NEW, true])
  expect(row(r.list, 'X').handle).toBe('term_x')
})

test('ladder: id + name in another tab is X when X\'s tab is gone (handle = this tab), held when X\'s tab is live', () => {
  const gone = who({ tab: 'term_q', sessionId: B, name: 'X' })
  expect([gone.level, gone.row, gone.member?.handle]).toEqual(['full', 'id+name', 'term_q'])
  const live = who({ tab: 'term_q', sessionId: B, name: 'X' }, { live: ['T|X'] })
  expect([live.level, live.row, live.member?.name, live.changed]).toEqual(['restricted', 'id+name', 'X', false])
  expect(live.why).toContain('second copy')
  // a member still recorded on the tab it moved into lets go of it
  const moved = who({ tab: 'term_y', sessionId: B, name: 'X' })
  expect([moved.member?.handle, row(moved.list, 'Y').handle]).toEqual(['term_y', ''])
})

test('ladder: tab only (a fresh claude in X\'s tab) is X re-attached: it takes the id, and the name when it has one', () => {
  const plain = who({ tab: 'term_x', sessionId: NEW, name: '' })
  expect([plain.level, plain.row, plain.reattached, plain.member?.name, plain.member?.sessionId]).toEqual(['full', 'tab', true, 'X', NEW])
  expect(roleNote(plain.member!)).toBe('You are X in team T. Your role file is .claude/team-orchestrator/roles/X.md; read it now.')
  const named = who({ tab: 'term_x', sessionId: NEW, name: 'Fresh' })
  expect([named.level, named.reattached, named.member?.name, named.member?.sessionId, named.renamedFrom]).toEqual(['full', true, 'Fresh', NEW, 'X'])
  expect(row(named.list, 'Z').boss).toBe('Fresh')
})

test('ladder: id only, or name only, is held (restricted) and changes nothing', () => {
  const id = who({ tab: 'term_q', sessionId: B, name: 'Other' })
  expect([id.level, id.row, id.member?.name, id.changed]).toEqual(['restricted', 'id', 'X', false])
  const name = who({ tab: 'term_q', sessionId: NEW, name: 'X' })
  expect([name.level, name.row, name.member?.name, name.changed]).toEqual(['restricted', 'name', 'X', false])
  // a head renamed to a worker's name in another tab is held, not handed the worker's rights
  expect(who({ tab: 'term_q', sessionId: NEW, name: 'Z' }).level).toBe('restricted')
})

test('ladder: nothing matches, or no roster at all: not on the team', () => {
  expect(who({ tab: 'term_q', sessionId: NEW, name: 'Stranger' }).level).toBe('none')
  expect(who({ tab: '', sessionId: NEW, name: '' }, { local: false }).level).toBe('none')
  expect(who({ tab: 'term_x', sessionId: B, name: 'X' }, { list: [] }).level).toBe('none')
})

test('ladder: the strongest row wins: X\'s conversation resumed in Y\'s tab is X, not Y', () => {
  const r = who({ tab: 'term_y', sessionId: B, name: 'X' }, { live: ['T|X'] })
  expect([r.level, r.member?.name]).toEqual(['restricted', 'X'])
})

test('no tab (outside Orca) is unknown: with registry proof id + name is full; without it, held', () => {
  const proof = who({ tab: '', sessionId: B, name: 'X' }, { local: true })
  expect([proof.level, proof.row, proof.changed]).toEqual(['full', 'tab+id+name', false])
  const away = who({ tab: '', sessionId: B, name: 'X' }, { local: false })
  expect([away.level, away.member?.name]).toEqual(['restricted', 'X'])
  expect(away.why).toContain('registry')
  // the proof does not count while X runs somewhere else
  expect(who({ tab: '', sessionId: B, name: 'X' }, { local: true, live: ['T|X'] }).level).toBe('restricted')
})

test('no tab with registry proof: the id alone is full (no name to follow); a name alone is full with the new id unless X is live', () => {
  const id = who({ tab: '', sessionId: B, name: '' }, { local: true })
  expect([id.level, id.row, id.changed]).toEqual(['full', 'tab+id', false])
  const name = who({ tab: '', sessionId: NEW, name: 'X' }, { local: true })
  expect([name.level, name.row, name.member?.sessionId]).toEqual(['full', 'tab+name', NEW])
  expect(who({ tab: '', sessionId: NEW, name: 'X' }, { local: true, live: ['T|X'] }).level).toBe('restricted')
  // without the proof both are held
  expect(who({ tab: '', sessionId: B, name: '' }, { local: false }).level).toBe('restricted')
  expect(who({ tab: '', sessionId: NEW, name: 'X' }, { local: false }).level).toBe('restricted')
  // the proof never stands alone: a session with nothing of X's is not X
  expect(who({ tab: '', sessionId: NEW, name: '' }, { local: true }).level).toBe('none')
})

test('a member recorded with no tab: the registry proof stands in for the tab; without it, the id + name row applies', () => {
  const list = LIST.map(m => (m.name === 'X' ? { ...m, handle: '' } : m))
  const proof = who({ tab: 'term_q', sessionId: NEW, name: 'X' }, { list })
  expect([proof.level, proof.row]).toEqual(['full', 'tab+name'])
  expect(who({ tab: 'term_q', sessionId: NEW, name: 'X' }, { list, local: false }).level).toBe('restricted')
  // id + name with no tab on record: X's tab is gone, so this tab becomes X's
  const moved = who({ tab: 'term_q', sessionId: B, name: 'X' }, { list, local: false })
  expect([moved.level, moved.row, moved.member?.handle]).toEqual(['full', 'id+name', 'term_q'])
})

test('two members that fit equally well: neither is granted', () => {
  const list = [...LIST, { ...mk('X', 'Head', '', ''), team: 'U' }]
  const r = who({ tab: '', sessionId: NEW, name: 'X' }, { list, local: true })
  expect(r.level).toBe('restricted')
})

test('judgeHeld: Write, Edit, NotebookEdit and Agent are refused, standing switches do not count, the one-turn word does', () => {
  const x = { ...row(LIST, 'X'), allowWrite: true, allowAgent: true }
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Agent']) {
    const v = judgeHeld({ me: x, why: 'only its name matches X', tool, grants: NO_GRANTS })
    expect(v?.kind).toBe('deny')
    expect((v as any).reason).toContain('on hold')
  }
  expect(judgeHeld({ me: x, why: '', tool: 'Write', grants: { agent: false, write: true } })?.kind).toBe('allow')
  expect(judgeHeld({ me: x, why: '', tool: 'Agent', grants: { agent: true, write: false } })?.kind).toBe('allow')
  expect(judgeHeld({ me: x, why: '', tool: 'Agent', grants: { agent: false, write: true } })?.kind).toBe('deny')
  expect(judgeHeld({ me: x, why: '', tool: 'Read', grants: NO_GRANTS })).toBeUndefined()
})

test('topOf walks up to the member that reports to the user', () => {
  expect(topOf(LIST, row(LIST, 'Z'))?.name).toBe('Head')
  expect(topOf(LIST, row(LIST, 'Head'))?.name).toBe('Head')
})

// ── in the engine ──

const ROSTER = 'C:/proj/.claude/team-orchestrator/roster.json'
const tabsOf = HUALONG.map(r => ({ handle: r.handle, title: r.name }))
const withIds = HUALONG.map(r => ({ ...r, sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : '' }))
const engine = (on: any, sid: { id: string }, extra: { sends?: any[]; toasts?: string[]; contexts?: (readonly string[] | undefined)[] } = {}) => {
  on('session.id', async () => ({ value: sid.id }) as any)
  on('session.send', async (_$: any, e: any) => (extra.sends?.push(e), { isDelivered: true }) as any)
  on('ui.toast', async (_$: any, e: any) => (extra.toasts?.push(String(e.text)), { value: undefined }) as any)
  for (const tool of ['Agent', 'Write', 'Edit', 'NotebookEdit']) on('tool.call', { tool } as any, async () => ({ result: 'done' }) as any)
  on('prompt.submit', async (_$: any, e: any) => (extra.contexts?.push(e.context), { text: e.text }) as any)
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }) as any)
}
const write = ($: any) => $.tool.call({ tool: 'Write', file_path: 'C:/proj/src/a.ts', content: 'x' } as any)
const agent = ($: any) => $.tool.call({ tool: 'Agent', description: 'look', prompt: 'look around' } as any)

test('a held session is denied Write and team_message, writes no status as X, and the top is told once', async ($, on) => {
  const sends: any[] = []
  const toasts: string[] = []
  const env = { ORCA_TERMINAL_HANDLE: 'term_new' }
  const sid = { id: ID3 }
  // a session in a new tab named like Hualong Workers, whose own tab is still open
  const files = world(on, [...tabsOf, { handle: 'term_new', title: 'Hualong Workers' }], [], undefined, {
    env,
    registry: [{ sessionId: ID1, name: 'Hualong CEO' }, { sessionId: ID2, name: 'Hualong Workers' }, { sessionId: ID3, name: 'Hualong Workers' }],
  })
  engine(on, sid, { sends, toasts })
  await adopt($, withIds)
  const w: any = await write($)
  expect(w.deny).toContain('on hold')
  expect(w.deny).toContain('Hualong Workers')
  expect((await agent($) as any).deny).toContain('on hold')
  const m: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Hualong Worker 5', message: 'hi' } as any)
  expect(m.deny).toContain('team_message is on hold')
  for (const tool of ['team_launch', 'team_adopt', 'member_move', 'member_remove', 'team_remove']) {
    const r: any = await $.tool.call({ tool: `mcp__team-orchestrator__${tool}`, team: 'Hualong', name: 'Hualong Worker 5', toTeam: 'X', members: [] } as any)
    expect(r.deny).toContain(`${tool} is on hold`)
  }
  // only the team top settles it
  const claim: any = await $.tool.call({ tool: 'mcp__team-orchestrator__member_claim', sessionId: ID3, decision: 'is' } as any)
  expect(claim.deny).toContain('team top only')
  // the claim is recorded, and the CEO (Workers' head and the team top) is told once, by session id
  const claims = JSON.parse(files.get('C:/proj/.claude/team-orchestrator/claims.json')!)
  expect(claims.map((c: any) => [c.sessionId, c.member, c.tab])).toEqual([[ID3, 'Hualong Workers', 'term_new']])
  expect(sends.length).toBe(1)
  expect(JSON.stringify(sends[0])).toContain('AskUserQuestion')
  expect(JSON.stringify(sends[0])).toContain('member_claim')
  // a roster change makes it look again, but nobody is told twice
  files.set(ROSTER, JSON.stringify(saved(files).map((x: any) => (x.name === 'Hualong Worker 5' ? { ...x, sessionId: ID2.replace('2', '9') } : x))))
  expect((await write($) as any).deny).toContain('on hold')
  expect(sends.length).toBe(1)
  // nothing is written under Workers' name by this session
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await write($)
  expect(files.has('C:/proj/.claude/team-orchestrator/status/Hualong_Workers.json')).toBe(false)
  // the person's one-turn word still works
  await $.prompt.submit({ text: 'go #allow-write', origin: { kind: 'composer' }, wait: false } as any)
  expect((await write($) as any).deny).toBeUndefined()

  // the CEO, in its own tab, answers for Herman: this is Hualong Workers
  sid.id = ID1
  env.ORCA_TERMINAL_HANDLE = 'term_c'
  const ok: any = await $.tool.call({ tool: 'mcp__team-orchestrator__member_claim', sessionId: ID3, decision: 'is', member: 'Hualong Workers' } as any)
  expect(String(ok.result)).toContain('is Hualong Workers')
  const wk = saved(files).find((x: any) => x.name === 'Hualong Workers')
  expect([wk.sessionId, wk.handle]).toEqual([ID3, 'term_new'])
  // back in the claimant: it is Workers now, judged as Workers (a boss: no subagents, no writes)
  sid.id = ID3
  env.ORCA_TERMINAL_HANDLE = 'term_new'
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as any)
  expect((await agent($) as any).deny).toContain('Hualong Workers has no subagent permission')
})

test('/clear in the same tab keeps the name and changes the id: the roster takes the new session id', async ($, on) => {
  const sid = { id: ID3 }
  const files = world(on, tabsOf, [], undefined, {
    env: { ORCA_TERMINAL_HANDLE: 'term_w' },
    registry: [{ sessionId: ID1, name: 'Hualong CEO' }, { sessionId: ID3, name: 'Hualong Workers' }],
  })
  engine(on, sid)
  await adopt($, withIds)
  expect(saved(files).find((x: any) => x.name === 'Hualong Workers').sessionId).toBe(ID3)
  // full rights as Workers: judged by its own rules, not held
  expect((await agent($) as any).deny).toContain('Blocked Agent: Hualong Workers has no subagent permission')
})

test('a fresh claude in a member\'s tab is re-attached and gets the role-file note on its next prompt, once', async ($, on) => {
  const sid = { id: ID3 }
  const contexts: (readonly string[] | undefined)[] = []
  const files = world(on, tabsOf, [], undefined, { env: { ORCA_TERMINAL_HANDLE: 'term_5' }, registry: [{ sessionId: ID3 }] })
  engine(on, sid, { contexts })
  await adopt($, withIds)
  expect(saved(files).find((x: any) => x.name === 'Hualong Worker 5').sessionId).toBe(ID3)
  await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false } as any)
  await $.prompt.submit({ text: 'again', origin: { kind: 'composer' }, wait: false } as any)
  expect(contexts[0]).toEqual(['You are Hualong Worker 5 in team Hualong. Your role file is .claude/team-orchestrator/roles/Hualong_Worker_5.md; read it now.'])
  expect(contexts[1] ?? []).toEqual([])
})

test('a /rename in the same tab relabels the member, its reports follow, and its role and status files move', async ($, on) => {
  const sid = { id: ID2 }
  const toasts: string[] = []
  const files = world(on, tabsOf, [], undefined, {
    env: { ORCA_TERMINAL_HANDLE: 'term_w' },
    registry: [{ sessionId: ID1, name: 'Hualong CEO' }, { sessionId: ID2, name: 'Hualong Crew' }],
  })
  files.set('C:/proj/.claude/team-orchestrator/status/Hualong_Workers.json', JSON.stringify({ name: 'Hualong Workers', sessionId: ID2, state: 'idle', heartbeat: 1 }))
  engine(on, sid, { toasts })
  await adopt($, withIds)
  const list = saved(files)
  expect(list.some((x: any) => x.name === 'Hualong Workers')).toBe(false)
  const crew = list.find((x: any) => x.name === 'Hualong Crew')
  expect([crew.address, crew.sessionId, crew.handle]).toEqual(['Hualong Crew', ID2, 'term_w'])
  expect(list.find((x: any) => x.name === 'Hualong Worker 5').boss).toBe('Hualong Crew')
  expect(files.has('C:/proj/.claude/team-orchestrator/roles/Hualong_Crew.md')).toBe(true)
  expect(JSON.parse(files.get('C:/proj/.claude/team-orchestrator/status/Hualong_Crew.json')!).name).toBe('Hualong Crew')
  expect(toasts.some(t => t.includes('Hualong Workers is now Hualong Crew'))).toBe(true)
})
