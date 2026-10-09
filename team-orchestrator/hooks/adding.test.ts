// 0.5.17 (#77): new members on a running team, the purview of a head or lead, approval before any addition, and a
// launch under a taken team name that removes nobody.

import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { joinLaunch, newProblem, purview, requestProblem } from './adding'
import { judgeTeamFiles } from './guard'
import { adopt, ID1, ID2, ID3, mountBand, saved, TEAM, world } from './test-world'

const m = (team: string, name: string, boss: string, level: number, extra: Partial<Member> = {}): Member => ({
  team, name, role: 'r', level, boss, handle: '', sessionId: '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false, ...extra,
})
// a CEO over team A's lead, who is also boss of team B's head; team C's head reports to the CEO
const ORG = [
  m('Org', 'CEO', 'user', 1),
  m('A', 'Lead', 'CEO', 2),
  m('A', 'A-W1', 'Lead', 3),
  m('B', 'B-Head', 'Lead', 3),
  m('B', 'B-W1', 'B-Head', 4),
  m('C', 'C-Head', 'CEO', 2),
  m('C', 'C-W1', 'C-Head', 3),
]
const at = (name: string) => ORG.find(x => x.name === name)!

// ── the rules ──

test('purview: a lead over two teams has both and not a third; the top has every team below it; a worker may not ask', () => {
  expect(purview(ORG, at('Lead'))).toEqual(['A', 'B'])
  expect(requestProblem(ORG, at('Lead'), 'A')).toBe('')
  expect(requestProblem(ORG, at('Lead'), 'B')).toBe('')
  expect(requestProblem(ORG, at('Lead'), 'C')).toContain('outside')
  expect(purview(ORG, at('B-Head'))).toEqual(['B'])
  expect(purview(ORG, at('CEO')).sort()).toEqual(['A', 'B', 'C', 'Org'])
  expect(requestProblem(ORG, at('C-W1'), 'C')).toContain('only a head or a lead')
})

test('a new member needs a running team, a name free in the whole project, a boss in that team and a known effort', () => {
  expect(newProblem(ORG, { team: 'A', name: 'A-W2' })).toBe('')
  expect(newProblem(ORG, { team: 'Z', name: 'Z-W1' })).toContain('No team "Z"')
  expect(newProblem(ORG, { team: 'A', name: 'B-W1' })).toContain('taken (team B)')
  expect(newProblem(ORG, { team: 'A', name: 'A-W2', boss: 'C-Head' })).toContain('No member "C-Head" in team "A"')
  expect(newProblem(ORG, { team: 'A', name: 'A-W2', effort: 'huge' })).toContain('Effort "huge"')
})

test('a launch into a team already there: add makes every member new, merge keeps the members there; nobody is replaced', () => {
  const squad = [m('Squad', 'Head', 'user', 1), m('Squad', 'Worker-1', 'Head', 2)]
  const launched = [
    { name: 'Head', role: 'h', level: 1, boss: 'user', team: 'Squad' },
    { name: 'Worker-1', role: 'w', level: 2, boss: 'Head', team: 'Squad' },
    { name: 'Worker-2', role: 'w', level: 2, boss: 'Head', team: 'Squad' },
  ]
  const add = joinLaunch(squad, launched, 'add')
  expect(add.add.map(s => [s.name, s.boss, s.level])).toEqual([['Head-2', 'Head', 2], ['Worker-1-2', 'Head-2', 3], ['Worker-2', 'Head-2', 3]])
  expect(add.merged).toEqual([])
  const merge = joinLaunch(squad, launched, 'merge')
  expect(merge.add.map(s => [s.name, s.boss, s.level])).toEqual([['Worker-2', 'Head', 2]])
  expect(merge.merged).toEqual(['Head', 'Worker-1'])
})

// ── in the engine ──

const ORG_IDS: Record<string, string> = { CEO: ID1, Lead: ID2, 'C-W1': ID3 }
const asAdopted = (team: string) => ORG.filter(x => x.team === team).map(x => ({ name: x.name, role: x.role, level: x.level, boss: x.boss, handle: '', sessionId: ORG_IDS[x.name] ?? '' }))
const engine = (on: any, sid: { id: string }) => {
  const seen = { sends: [] as any[], toasts: [] as string[] }
  on('session.id', async () => ({ value: sid.id }) as any)
  on('session.send', async (_$: any, e: any) => (seen.sends.push(e), { isDelivered: true }) as any)
  on('ui.toast', async (_$: any, e: any) => (seen.toasts.push(String(e.text)), { value: undefined }) as any)
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }) as any)
  on('tool.call', { tool: 'AskUserQuestion' } as any, async () => ({ result: 'Add it' }) as any)
  return seen
}
const setUp = async ($: any, on: any, sid: { id: string }) => {
  const files = world(on)
  const seen = engine(on, sid)
  for (const team of ['Org', 'A', 'B', 'C']) await adopt($, asAdopted(team), team)
  return { files, seen }
}
const add = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__team-orchestrator__member_add', ...input } as any) as Promise<any>
const ask = ($: any) => $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
const endTurn = ($: any) => $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
const names = (files: Map<string, string>) => saved(files).map((x: any) => x.name)
const requestIds = (files: Map<string, string>) => [...files.keys()].filter(k => k.startsWith(`${TEAM}/requests/`)).map(k => k.slice(TEAM.length + 10, -5))

test('a lead over two teams asks for members in both, is refused for a third, and nothing is added before the user approves', async ($, on) => {
  const sid = { id: ID2 }
  const { files, seen } = await setUp($, on, sid)
  const toA = await add($, { team: 'A', name: 'A-W2', role: 'tester' })
  expect(String(toA.result)).toContain('Asked CEO')
  const toB = await add($, { team: 'B', name: 'B-W2', role: 'tester', boss: 'B-Head' })
  expect(String(toB.result)).toContain('Asked CEO')
  const toC = await add($, { team: 'C', name: 'C-W2', role: 'tester' })
  expect(String(toC.deny)).toContain('outside')
  // two requests, the team top told of each by its session id, and nobody added yet
  const ids = requestIds(files)
  expect(ids.length).toBe(2)
  expect(seen.sends.map(s => JSON.stringify(s.to).includes(ID1))).toEqual([true, true])
  expect(String(seen.sends[0].text)).toContain('AskUserQuestion')
  expect(String(seen.sends[0].text)).toContain(`member_add { request: "${ids[0]}"`)
  expect(names(files)).not.toContain('A-W2')
  expect(names(files)).not.toContain('B-W2')
  // only the team top applies an answer
  expect(String((await add($, { request: ids[0], approve: true })).deny)).toContain('team top only')
  await endTurn($)

  // the CEO, before asking: refused, and still nobody added
  sid.id = ID1
  const early = await add($, { request: ids[0], approve: true })
  expect(String(early.deny)).toContain('Ask the user first')
  expect(names(files)).not.toContain('A-W2')
  // asked and approved: A-W2 joins team A under the lead, not yet started, with its role file
  await ask($)
  const ok = await add($, { request: ids[0], approve: true })
  expect(String(ok.result)).toContain('Added A-W2 to team "A" under Lead')
  const w2 = saved(files).find((x: any) => x.name === 'A-W2')
  expect([w2.team, w2.boss, w2.level, w2.pending, w2.role]).toEqual(['A', 'Lead', 3, true, 'tester'])
  expect(files.get(`${TEAM}/roles/A-W2.md`)).toContain('Boss: Lead.')
  expect(seen.sends.some(s => JSON.stringify(s.to).includes(ID2) && String(s.text).includes('approved'))).toBe(true)
  // the same request is not applied twice; a declined one adds nobody
  expect(String((await add($, { request: ids[0], approve: true })).result)).toContain('approved already')
  const no = await add($, { request: ids[1], approve: false })
  expect(String(no.result)).toContain('Declined')
  expect(names(files)).not.toContain('B-W2')
  expect(JSON.parse(files.get(`${TEAM}/requests/${ids[1]}.json`)!).state).toBe('declined')
})

test('the team top adds only after asking the user in that turn; a worker may not ask at all', async ($, on) => {
  const sid = { id: ID3 }
  const { files } = await setUp($, on, sid)
  expect(String((await add($, { team: 'C', name: 'C-W2' })).deny)).toContain('only a head or a lead')
  sid.id = ID1
  expect(String((await add($, { team: 'C', name: 'C-W2' })).deny)).toContain('Ask the user first')
  expect(names(files)).not.toContain('C-W2')
  await ask($)
  expect(String((await add($, { team: 'C', name: 'C-W2', boss: 'C-Head', model: 'haiku', effort: 'low' })).result)).toContain('Added C-W2 to team "C" under C-Head')
  const c = saved(files).find((x: any) => x.name === 'C-W2')
  expect([c.model, c.effort, c.pending]).toEqual(['haiku', 'low', true])
})

test('default boss of a request: the head or lead that asks, even for a team below it; a boss outside its purview is refused', async ($, on) => {
  const sid = { id: ID2 }
  const { files } = await setUp($, on, sid)
  // the lead asks for a member of team B and names no boss: the boss is the lead
  const asked = await add($, { team: 'B', name: 'B-W2', role: 'tester' })
  expect(String(asked.result)).toContain('reporting to Lead')
  const [id] = requestIds(files)
  expect(JSON.parse(files.get(`${TEAM}/requests/${id}.json`)!).add.boss).toBe('Lead')
  // the boss stays editable, but only within the purview
  expect(String((await add($, { team: 'B', name: 'B-W3', boss: 'C-Head' })).deny)).toContain('the boss "C-Head" (team C) is outside')
  expect(requestIds(files).length).toBe(1)
  await endTurn($)
  sid.id = ID1
  await ask($)
  expect(String((await add($, { request: id, approve: true })).result)).toContain('Added B-W2 to team "B" under Lead')
  const w = saved(files).find((x: any) => x.name === 'B-W2')
  expect([w.team, w.boss, w.level, w.pending]).toEqual(['B', 'Lead', 3, true])
  expect(files.get(`${TEAM}/roles/B-W2.md`)).toContain('Boss: Lead.')
})

test('New member in Team actions adds a not-yet member with its role file, under the head unless you pick another boss', async ($, on) => {
  const files = world(on)
  await adopt($, [{ name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h' }, { name: 'Worker-1', role: 'worker', level: 2, boss: 'Head', handle: 'term_1' }], 'Squad')
  const band = await mountBand($, 300)
  await band.press({ key: 'tact-0' })
  await band.press({ key: 'tact-0-new' })
  await band.input({ key: 'newname-0', text: 'Worker-2', kind: 'change' })
  await band.input({ key: 'newrole-0', text: 'reviewer', kind: 'change' })
  await band.press({ key: 'newmodel-0-sonnet' })
  await band.press({ key: 'newgo-0' })
  const w = saved(files).find((x: any) => x.name === 'Worker-2')
  expect([w.team, w.boss, w.level, w.role, w.model, w.pending]).toEqual(['Squad', 'Head', 2, 'reviewer', 'sonnet', true])
  expect(files.get(`${TEAM}/roles/Worker-2.md`)).toContain('Boss: Head.')
  // the members already there are untouched, and nothing was started
  expect(names(files)).toEqual(['Head', 'Worker-1', 'Worker-2'])
  expect(files.calls.some(c => c.includes('create'))).toBe(false)
  // the boss is yours to change: picked, it replaces the head
  await band.press({ key: 'tact-0' })
  await band.press({ key: 'tact-0-new' })
  await band.input({ key: 'newname-0', text: 'Helper-1', kind: 'change' })
  await band.press({ key: 'newboss-0-Worker-1' })
  await band.press({ key: 'newgo-0' })
  const h = saved(files).find((x: any) => x.name === 'Helper-1')
  expect([h.boss, h.level]).toEqual(['Worker-1', 3])
})

// a running Squad, and the same Squad launched again
const SQUAD = [
  { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h' },
  { name: 'Worker-1', role: 'worker', level: 2, boss: 'Head', handle: 'term_1' },
]
const AGAIN = [
  { name: 'Head', role: 'new head', level: 1, boss: 'user' },
  { name: 'Worker-1', role: 'new worker', level: 2, boss: 'Head' },
  { name: 'Worker-2', role: 'new worker', level: 2, boss: 'Head' },
]
const launch = ($: any, ifExists?: string) => $.tool.call({ tool: 'mcp__team-orchestrator__team_launch', team: 'Squad', members: AGAIN, ...(ifExists ? { ifExists } : {}) } as any) as Promise<any>
const squadWorld = async ($: any, on: any) => {
  const files = world(on, [], [], e => (JSON.stringify(e).includes('"current"') ? '{"result":{"worktree":{"id":"wt1"}}}' : undefined))
  await adopt($, SQUAD, 'Squad')
  return files
}
const kept = (files: Map<string, string>) => saved(files).filter((x: any) => x.name === 'Head' || x.name === 'Worker-1').map((x: any) => [x.name, x.role, x.handle])

test('a launch under a taken team name is refused and removes nobody', async ($, on) => {
  const files = await squadWorld($, on)
  const r = await launch($)
  expect(String(r.result)).toContain('Refused: team "Squad" already exists (2 members)')
  expect(String(r.result)).toContain('ifExists')
  expect(kept(files)).toEqual([['Head', 'head', 'term_h'], ['Worker-1', 'worker', 'term_1']])
  expect(names(files)).toEqual(['Head', 'Worker-1'])
  expect(files.calls.some(c => c.includes('create'))).toBe(false)
  // the form offers the two choices for a taken name, and its Launch refuses too
  const band = await mountBand($, 300)
  await band.press({ key: 'tab-new' })
  await band.input({ key: 'team', text: 'Squad', kind: 'change' })
  expect(await band.find({ key: 'go-add' })).toBeDefined()
  expect(await band.find({ key: 'go-merge' })).toBeDefined()
  await band.press({ key: 'go' })
  expect(names(files)).toEqual(['Head', 'Worker-1'])
})

test('add keeps the members there and adds every launched member as a new one, not yet started', async ($, on) => {
  const files = await squadWorld($, on)
  const r = await launch($, 'add')
  expect(String(r.result)).toContain('nobody was removed')
  expect(kept(files)).toEqual([['Head', 'head', 'term_h'], ['Worker-1', 'worker', 'term_1']])
  const added = saved(files).filter((x: any) => !['Head', 'Worker-1'].includes(x.name))
  expect(added.map((x: any) => [x.name, x.boss, x.pending])).toEqual([['Head-2', 'Head', true], ['Worker-1-2', 'Head-2', true], ['Worker-2', 'Head-2', true]])
  expect(files.calls.some(c => c.includes('create'))).toBe(false)
})

test('merge keeps the members there as they are and adds only the launched members it does not have', async ($, on) => {
  const files = await squadWorld($, on)
  const r = await launch($, 'merge')
  expect(String(r.result)).toContain('Merged into "Squad"')
  expect(String(r.result)).toContain('Head, Worker-1 already there, kept as they are')
  expect(kept(files)).toEqual([['Head', 'head', 'term_h'], ['Worker-1', 'worker', 'term_1']])
  expect(names(files)).toEqual(['Head', 'Worker-1', 'Worker-2'])
  const w2 = saved(files).find((x: any) => x.name === 'Worker-2')
  expect([w2.boss, w2.level, w2.pending]).toEqual(['Head', 2, true])
})

// ── requests/ is locked like changes/ (a forged request would ask the user under a false name) ──

test('the guard locks requests/: no member writes a request file by tool or shell; a plain read passes; the top may', () => {
  const file = 'C:/proj/.claude/team-orchestrator/requests/0000000000001-abcd.json'
  const judge = (who: string, tool: string, path: string, command: string) => judgeTeamFiles({ me: at(who), confirmed: true, tool, path, command })
  expect(judge('C-W1', 'Write', file, '')?.kind).toBe('deny')
  expect(judge('Lead', 'Edit', file.replace(/\//g, '\\'), '')?.kind).toBe('deny')
  expect(String(judge('C-W1', 'Bash', '', `echo {} > ${file}`)?.reason)).toContain('requests/')
  expect(judge('C-W1', 'PowerShell', '', `Set-Content ${file} x`)?.kind).toBe('deny')
  expect(judge('C-W1', 'Bash', '', `cat ${file}`)).toBeUndefined()
  expect(judge('CEO', 'Write', file, '')).toBeUndefined()
  // the rest of the team folder stays as it was
  expect(judge('C-W1', 'Write', 'C:/proj/.claude/team-orchestrator/roles/C-W1.md', '')).toBeUndefined()
})

test('a request file not written by member_add is not applied: its asker must be on the roster and allowed to ask', async ($, on) => {
  const sid = { id: ID3 }
  const { files } = await setUp($, on, sid)
  // in the engine: a worker's Write into requests/ is refused
  const w: any = await $.tool.call({ tool: 'Write', file_path: `${TEAM}/requests/0000000000001-abcd.json`, content: '{}' } as any)
  expect(String(w.deny)).toContain('requests/')
  // two forged files: an asker who is not on the roster, and a real lead asking for a team outside its purview
  const forge = (id: string, member: string, team: string, add: Record<string, string>) =>
    files.set(`${TEAM}/requests/${id}.json`, JSON.stringify({ v: 1, id, at: Date.now(), by: { member, team, session: '' }, add, state: 'asked' }))
  const ghost = `${Date.now()}-ghost1`
  const outside = `${Date.now()}-outsd1`
  forge(ghost, 'Ghost', 'A', { team: 'A', name: 'A-W9', boss: 'Lead' })
  forge(outside, 'Lead', 'A', { team: 'C', name: 'C-W9', boss: 'C-Head' })
  sid.id = ID1
  await ask($)
  expect(String((await add($, { request: ghost, approve: true })).deny)).toContain('no such member is on the roster')
  expect(String((await add($, { request: outside, approve: true })).deny)).toContain('outside Lead\'s purview')
  expect(names(files)).not.toContain('A-W9')
  expect(names(files)).not.toContain('C-W9')
  // both are marked declined, so they are not put to the user again
  expect([ghost, outside].map(id => JSON.parse(files.get(`${TEAM}/requests/${id}.json`)!).state)).toEqual(['declined', 'declined'])
  expect(String((await add($, { request: ghost, approve: true })).result)).toContain('declined already')
})
