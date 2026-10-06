import { expect, test } from 'claude-code/testing'

import { chartLabelInfo, chartLabels, shorten } from './layout'
import { adopt, HUALONG, mountBand, saved, shown, world } from './test-world'

// The short names the person wants for the Hualong team (the table in the README). The team here is named "Hualong";
// the real teams are Hualong-HQ and Hualong-PC (see layout.test.ts).
const WANTED: Record<string, string> = {
  'Hualong CEO': 'CEO',
  'Hualong Workers': 'Workers',
  'Hualong Worker 5': 'W5',
  'Hualong PC Console Boss': 'Boss',
  'Hualong PC Worker A': 'WA',
  'Hualong PC Worker B': 'WB',
}
const hualong = (short: (n: string) => string | undefined = () => undefined) =>
  HUALONG.map(m => ({ team: 'Hualong', name: m.name, ...(short(m.name) !== undefined ? { short: short(m.name) } : {}) }))
const labelsOf = (list: { team: string; name: string; short?: string }[]) => {
  const info = chartLabelInfo(list)
  return list.map(m => info.get(`${m.team}|${m.name}`)!)
}

// ── the rule and the person's short names (no engine) ──

test('a short name the person gave is used exactly as typed, and is not marked automatic', () => {
  const got = labelsOf(hualong(n => WANTED[n]))
  expect(got.map(i => i.label)).toEqual(['CEO', 'Workers', 'W5', 'Boss', 'WA', 'WB'])
  for (const i of got) expect(i.auto).toBe(false)
  for (const i of got) expect(i.dup).toBe(false)
  // not trimmed into the rule's shape, not capitalised, not cut to two characters
  const odd = labelsOf([{ team: 'T', name: 'Head', short: ' r&d lead ' }, { team: 'T', name: 'W-1', short: 'x' }])
  expect(odd.map(i => i.label)).toEqual(['r&d lead', 'x'])
})

test('with no short names, one team named Hualong, the rule gives what it gave before, and says every label is automatic', () => {
  const got = labelsOf(hualong())
  expect(got.map(i => i.label)).toEqual(['CEO', 'Workers', 'W5', 'PC Boss', 'PC A', 'PC B'])
  for (const i of got) expect(i.auto).toBe(true)
  expect([...chartLabels(hualong()).values()]).toEqual(['CEO', 'Workers', 'W5', 'PC Boss', 'PC A', 'PC B'])
})

test('the person sets some and not others: the rest stay automatic and keep away from the names taken', () => {
  // the person called the CEO "Workers": the member the rule would call "Workers" has to look further
  const list = hualong(n => (n === 'Hualong CEO' ? 'Workers' : undefined))
  const got = labelsOf(list)
  expect(got[0]).toEqual({ label: 'Workers', auto: false, dup: false })
  expect(got[1]!.auto).toBe(true)
  expect(got[1]!.label.toLowerCase()).not.toBe('workers')
  const all = got.map(i => i.label.toLowerCase())
  expect(new Set(all).size).toBe(all.length)
  // taken names count whatever their case
  const cased = labelsOf(hualong(n => (n === 'Hualong CEO' ? 'wOrKeRs' : undefined)))
  expect(cased[1]!.label.toLowerCase()).not.toBe('workers')
})

test('the same short name on two members: both keep it and both are flagged, nothing is renamed', () => {
  const got = labelsOf(hualong(n => (n.startsWith('Hualong PC Worker') ? 'PCW' : n === 'Hualong CEO' ? 'CEO' : undefined)))
  expect(got[4]).toEqual({ label: 'PCW', auto: false, dup: true })
  expect(got[5]).toEqual({ label: 'PCW', auto: false, dup: true })
  expect(got[0]).toEqual({ label: 'CEO', auto: false, dup: false })
  // the others are still worked out, and avoid PCW
  expect(got[1]!.auto && got[2]!.auto && got[3]!.auto).toBe(true)
  // same name in another case is the same name
  const twice = labelsOf([{ team: 'T', name: 'A', short: 'Lead' }, { team: 'T', name: 'B', short: 'lead' }])
  expect(twice.map(i => i.dup)).toEqual([true, true])
  expect(twice.map(i => i.label)).toEqual(['Lead', 'lead'])
})

test('the rule steps round the short names already taken, also across teams', () => {
  // an automatic label that equals a name the person gave moves on until it is free
  const list = [
    { team: 'Alpha', name: 'Head' },
    { team: 'Alpha', name: 'Worker-1', short: 'W1' },
    { team: 'Alpha', name: 'Worker-2' },
    { team: 'Beta', name: 'Beta-Head', short: 'Head' },
  ]
  const got = labelsOf(list)
  // "Head" is the person's for Beta-Head, so Alpha's Head cannot be "Head" too
  expect(got[3]).toEqual({ label: 'Head', auto: false, dup: false })
  expect(got[0]!.label.toLowerCase()).not.toBe('head')
  expect(got[1]!.label).toBe('W1')
  // Worker-2 would be "W2": still free
  expect(got[2]!.label).toBe('W2')
  const all = got.map(i => i.label.toLowerCase())
  expect(new Set(all).size).toBe(all.length)
})

test('Herman\'s example: "HK University of Hong Kong president" is "HK president" only because a person said so, or by luck of the words', () => {
  const name = 'HK University of Hong Kong president'
  // given: used as typed
  expect(labelsOf([{ team: 'HK', name, short: 'HK president' }])[0]).toEqual({ label: 'HK president', auto: false, dup: false })
  // not given: the rule does not know what the words mean. Where "HK" is also the team's name it is dropped as shared
  // with the team and what is left gives "president"; in a team of another name the leading acronym and the last word give "HK president"
  expect(labelsOf([{ team: 'HK', name }])[0]).toEqual({ label: 'president', auto: true, dup: false })
  expect(labelsOf([{ team: 'Uni', name }])[0]).toEqual({ label: 'HK president', auto: true, dup: false })
})

test('a short name is cut with "…" only on request, and a short one is left alone', () => {
  expect(shorten('Head of research', 20)).toBe('Head of research')
  expect(shorten('Head of research', 10)).toBe('Head of r…')
  expect(shorten('Head of research', 10).length).toBe(10)
  expect(shorten('abc', 1)).toBe('…')
})

// ── the engine: tools, the file, the chart and the Team actions entry ──

const FLAG = 'mcp__team-orchestrator__'

test('team_adopt takes a short name, saves it, keeps it when the member is adopted again, and an empty one clears it', async ($, on) => {
  const files = world(on)
  await adopt($, [{ name: 'A-Head', role: 'head', level: 1, boss: 'user', short: 'Boss' }, { name: 'A-W1', role: 'worker', level: 2, boss: 'A-Head' }], 'A')
  expect(saved(files).map((m: any) => m.short)).toEqual(['Boss', undefined])
  // adopted again without the field: the name stays
  await adopt($, [{ name: 'A-Head', role: 'head', level: 1, boss: 'user' }, { name: 'A-W1', role: 'worker', level: 2, boss: 'A-Head', short: 'One' }], 'A')
  expect(saved(files).map((m: any) => m.short)).toEqual(['Boss', 'One'])
  // given empty: cleared
  await adopt($, [{ name: 'A-Head', role: 'head', level: 1, boss: 'user', short: '' }, { name: 'A-W1', role: 'worker', level: 2, boss: 'A-Head' }], 'A')
  expect(saved(files).map((m: any) => m.short ?? '')).toEqual(['', 'One'])
})

test('team_launch takes a short name per member and saves it', async ($, on) => {
  let n = 0
  const files = world(on, [], [], e => {
    const a = JSON.stringify(e)
    if (a.includes('"current"')) return '{"result":{"worktree":{"id":"wt1"}}}'
    if (a.includes('"create"')) return `{"result":{"terminal":{"handle":"term_${++n}"}}}`
    if (a.includes('"wait"')) return '{"result":{"satisfied": true}}'
    if (a.includes('"send"')) return '{}'
    return undefined
  })
  await $.tool.call({
    tool: `${FLAG}team_launch`,
    team: 'Sq',
    members: [{ name: 'Head', role: 'head', level: 1, boss: 'user', short: 'Lead' }, { name: 'Worker-1', role: 'worker', level: 2, boss: 'Head' }],
  } as any)
  expect(saved(files).map((m: any) => [m.name, m.short])).toEqual([['Head', 'Lead'], ['Worker-1', undefined]])
})

test('member_move keeps the short name', async ($, on) => {
  const files = world(on)
  await adopt($, [{ name: 'Head', role: 'head', level: 1, boss: 'user' }, { name: 'W1', role: 'worker', level: 2, boss: 'Head', short: 'Wonder' }], 'Alpha')
  await adopt($, [{ name: 'BHead', role: 'head', level: 1, boss: 'user', short: 'BH' }], 'Beta')
  await $.tool.call({ tool: `${FLAG}member_move`, team: 'Alpha', name: 'W1', toTeam: 'Beta' } as any)
  const w1 = saved(files).find((m: any) => m.name === 'W1')
  expect(w1.team).toBe('Beta')
  expect(w1.short).toBe('Wonder')
  expect(saved(files).find((m: any) => m.name === 'BHead').short).toBe('BH')
})

// the roster is drawn once with the whole chart as text, so the labels can be looked for in it
const teamActions = async (band: any, v: string) => {
  await band.press({ key: 'tact-0' })
  await band.press({ key: `tact-0-${v}` })
}

test('Set short name: tick one row, type, Save; an empty name clears; ticking none or two says so', async ($, on) => {
  const files = world(on)
  await adopt($, [{ name: 'Head', role: 'head', level: 1, boss: 'user' }, { name: 'Worker-1', role: 'worker', level: 2, boss: 'Head' }, { name: 'Worker-2', role: 'worker', level: 2, boss: 'Head' }], 'Sq')
  const band = await mountBand($)
  // none ticked
  await teamActions(band, 'short')
  expect(JSON.stringify(await band.drawn())).toContain('Tick at least one row first')
  expect(await band.find({ key: 'short-0' })).toBeUndefined()
  // two ticked
  await band.press({ key: 'sel-Sq|Worker-1' })
  await band.press({ key: 'sel-Sq|Worker-2' })
  await teamActions(band, 'short')
  expect(JSON.stringify(await band.drawn())).toContain('Tick exactly one row')
  // one ticked: the box opens with its Input
  await band.press({ key: 'sel-Sq|Worker-2' })
  await teamActions(band, 'short')
  expect(await band.find({ key: 'short-0' })).toBeDefined()
  expect(JSON.stringify(await band.drawn())).toContain('Short name for Worker-1')
  await band.input({ key: 'short-0', text: 'first hand', kind: 'change' })
  await band.press({ key: 'short-save-0' })
  expect(saved(files).find((m: any) => m.name === 'Worker-1').short).toBe('first hand')
  expect(await band.find({ key: 'short-0' })).toBeUndefined()
  expect(JSON.stringify(await band.drawn())).toContain('first hand')
  // Enter in the Input saves too, and an empty name clears
  await band.press({ key: 'sel-Sq|Worker-1' })
  await teamActions(band, 'short')
  // the box says what is shown now (JSX makes it several strings)
  expect(JSON.stringify(await band.drawn())).toMatch(/Shown now: ","first hand"/)
  await band.input({ key: 'short-0', text: '' })
  expect((saved(files).find((m: any) => m.name === 'Worker-1').short ?? '')).toBe('')
  expect(JSON.stringify(await band.drawn())).not.toContain('first hand')
})

test('the chart shows the short name as typed and dims the automatic ones', async ($, on) => {
  world(on)
  // no tabs: a member with a handle that Orca does not know is drawn dim as offline, so these have none
  await adopt($, HUALONG.map(m => ({ ...m, handle: '', ...(m.name === 'Hualong PC Console Boss' ? { short: 'Boss' } : {}) })))
  const s = await shown($, 100)
  expect(s).not.toContain('PC Boss')
  expect(s).not.toContain('dim = auto short name') // the explaining line was removed; the dim styling stays (checked below)
  // the automatic ones are drawn dim, the given one is not
  const band = await mountBand($, 100)
  const cells: { s: string; dim?: boolean }[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'Text' && typeof n.children?.[0] === 'string') cells.push({ s: n.children[0], dim: n.props?.dimColor })
    ;(n.children ?? []).forEach(walk)
  }
  walk(await band.drawn())
  const row = cells.find(c => c.s.includes('Boss') && !c.s.includes('PC'))
  expect(row).toBeDefined()
  expect(row!.dim).toBeFalsy()
  const auto = cells.find(c => c.s.includes('Workers') && !c.s.includes('Hualong') && c.s.length < 24)
  expect(auto).toBeDefined()
  expect(auto!.dim).toBe(true)
})

test('two members with one short name: the chart shows both with "!" and each row says so', async ($, on) => {
  world(on)
  await adopt($, HUALONG.map(m => ({ ...m, ...(m.name.startsWith('Hualong PC Worker') ? { short: 'PCW' } : {}) })))
  const s = await shown($, 120)
  // the "!" is its own coloured run (red), one for each of the two
  expect(s.split('"!"').length - 1).toBe(2)
  expect(s.split('short name used twice').length - 1).toBe(2)
  // the file keeps the name as typed on both
  const band = await mountBand($, 120)
  expect(await band.find({ type: 'Text', text: /short name used twice/ })).toBeDefined()
})

test('a long short name is cut with "…" when the chart would not fit, and shown whole when it does', async ($, on) => {
  world(on)
  const long = 'the person in charge of every release'
  await adopt($, [
    { name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', short: long },
    { name: 'Hualong Workers', role: 'w', level: 2, boss: 'Hualong CEO', short: 'Workers' },
    { name: 'Hualong Worker 5', role: 'w', level: 2, boss: 'Hualong CEO', short: 'W5' },
  ])
  expect(await shown($, 120)).toContain(long)
  const narrow = await shown($, 44)
  expect(narrow).not.toContain(long)
  expect(narrow).toContain('the person in…')
})

test('the explaining hints are gone: no LIVE ORG subtitle, no legend note, no second "selected" count in the bottom bar', async ($, on) => {
  world(on)
  await adopt($, HUALONG.map(m => ({ ...m, handle: '' })))
  const s = await shown($, 100)
  expect(s).toContain('LIVE ORG')
  expect(s).toContain('Clear selection') // the bottom bar itself is still there
  expect(s).not.toContain('dots follow each session')
  expect(s).not.toContain('the boss passing work down')
  expect(s).not.toContain('dim = auto short name')
  expect(s).not.toContain('opens that session')
  expect(s).not.toContain('add, move and remove people')
  // the team card keeps its own "N selected"; the bottom bar had a second one, so exactly one team => exactly one
  expect(s.match(/ selected/g)?.length).toBe(1)
})
