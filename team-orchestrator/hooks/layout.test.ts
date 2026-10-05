import { expect, test } from 'claude-code/testing'

import { CHECK, cell, chartLabels, columnPlan, headerLine } from './layout'

// the Hualong roster as it stands: long names, a tree three deep
const ROWS = [
  { prefix: '', name: 'Hualong CEO' },
  { prefix: '├─ ', name: 'Hualong Workers' },
  { prefix: '│  └─ ', name: 'Hualong Worker 5' },
  { prefix: '└─ ', name: 'Hualong PC Console Boss' },
  { prefix: '   ├─ ', name: 'Hualong PC Worker A' },
  { prefix: '   └─ ', name: 'Hualong PC Worker B' },
]
// a card's border and padding take 4 of the terminal's columns
const inner = (columns: number) => columns - 4
const LONG: Record<string, string> = {
  STATUS: '◐ working',
  CONTEXT: '[████████] 100%',
  MODEL: 'claude-opus-5-5[1m] extra',
  EFFORT: 'Extra high',
  BRIEF: '✓ noted',
}

for (const [columns, tier] of [[60, 'narrow'], [72, 'medium'], [90, 'wide'], [140, 'wide']] as const) {
  test(`at ${columns} columns: the ${tier} tier, within the width, headers over their cells, nothing wraps`, () => {
    const p = columnPlan(ROWS, inner(columns), [])
    expect(p.tier).toBe(tier)
    expect(p.total).toBeLessThanOrEqual(inner(columns))
    expect(p.total).toBe(CHECK + p.nameW + p.cols.reduce((a, c) => a + c.w, 0))
    // a row built from the longest values is exactly as wide as the header, cell for cell
    const head = headerLine(p)
    for (const r of ROWS) {
      const row = ' '.repeat(CHECK) + cell(r.prefix + r.name, p.nameW) + p.cols.map(c => cell(LONG[c.id] ?? '', c.w)).join('')
      expect(row.length).toBe(head.length)
      let at = CHECK + p.nameW
      for (const c of p.cols) {
        // every cell ends in a space, so two values never touch, and the header cell starts where the value does
        expect(row[at + c.w - 1]).toBe(' ')
        expect(head.slice(at, at + c.w).trimEnd()).toBe(c.head.slice(0, c.w - 1).trimEnd())
        at += c.w
      }
    }
  })
}

test('the tiers drop BRIEF as the width shrinks; the narrow tier is dot, percent, family, letter', () => {
  const ids = (columns: number) => columnPlan(ROWS, inner(columns), []).cols.map(c => c.id)
  expect(ids(140)).toEqual(['STATUS', 'CONTEXT', 'MODEL', 'EFFORT', 'BRIEF'])
  expect(ids(90)).toEqual(['STATUS', 'CONTEXT', 'MODEL', 'EFFORT', 'BRIEF'])
  expect(ids(72)).toEqual(['STATUS', 'CONTEXT', 'MODEL', 'EFFORT'])
  const narrow = columnPlan(ROWS, inner(60), [])
  expect(narrow.cols.map(c => c.w)).toEqual([2, 5, 7, 4])
  // the longest guide and name ("└─ Hualong PC Console Boss", 26) keep their whole length at 60, plus one space
  expect(narrow.nameW).toBe(27)
})

test('the settings toggles apply on top of the tier, and the room they free goes to the names', () => {
  const all = columnPlan(ROWS, inner(72), [])
  const less = columnPlan(ROWS, inner(72), ['MODEL', 'BRIEF'])
  expect(less.cols.map(c => c.id)).toEqual(['STATUS', 'CONTEXT', 'EFFORT'])
  // without the model and the brief the wide tier fits at 72
  expect(less.tier).toBe('wide')
  expect(less.total).toBeLessThanOrEqual(inner(72))
  expect(all.tier).toBe('medium')
})

test('a long name is cut with "…" and still leaves one space before the status', () => {
  const p = columnPlan([{ prefix: '├─ ', name: 'A very long session name that cannot fit at all here' }], inner(60), [])
  const name = cell('├─ A very long session name that cannot fit at all here', p.nameW)
  expect(name.length).toBe(p.nameW)
  expect(name.endsWith('… ')).toBe(true)
})

test('org chart labels: the team prefix goes, each label is unique and at least two characters', () => {
  const team = (name: string) => ({ team: 'Hualong', name })
  const list = ['Hualong CEO', 'Hualong Workers', 'Hualong Worker 5', 'Hualong PC Console Boss', 'Hualong PC Worker A', 'Hualong PC Worker B'].map(team)
  const labels = chartLabels(list)
  const got = list.map(m => labels.get(`${m.team}|${m.name}`))
  expect(got).toEqual(['CEO', 'Workers', 'W5', 'PC Boss', 'PC A', 'PC B'])
  expect(new Set(got).size).toBe(got.length)
  for (const l of got) expect(l!.length).toBeGreaterThanOrEqual(2)
})

test('org chart labels stay unique across teams that share member names', () => {
  const list = [
    { team: 'Alpha', name: 'Head' },
    { team: 'Alpha', name: 'Worker-1' },
    { team: 'Alpha', name: 'Worker-2' },
    { team: 'Beta', name: 'Beta-Head' },
    { team: 'Beta', name: 'Beta-Worker-1' },
    { team: 'Org', name: 'CEO' },
  ]
  const got = [...chartLabels(list).values()]
  expect(new Set(got).size).toBe(list.length)
  for (const l of got) expect(l.length).toBeGreaterThanOrEqual(2)
})

test('org chart labels for names the plugin makes and names people pick: short, unique, two characters at least', () => {
  const cases: [{ team: string; name: string }[], string[]][] = [
    [[{ team: 'Squad', name: 'Head' }, ...[1, 2, 3].map(i => ({ team: 'Squad', name: `Worker-${i}` }))], ['Head', 'W1', 'W2', 'W3']],
    [
      [
        { team: 'Org', name: 'CEO' },
        ...['Dev-Team', 'UI-Team'].flatMap(g => [{ team: g, name: `${g}-Head` }, { team: g, name: `${g}-Worker-1` }]),
      ],
      ['CEO', 'Dev Head', 'Dev W1', 'UI Head', 'UI W1'],
    ],
    [[{ team: 'T', name: 'Head' }, { team: 'T', name: 'Lead-1-1' }, { team: 'T', name: 'Lead-1-2' }, { team: 'T', name: 'Worker-1-1' }], ['Head', 'L1.1', 'L1.2', 'W1.1']],
    [[{ team: 'Shop', name: 'Shop Backend Lead' }, { team: 'Shop', name: 'Shop Frontend Lead' }, { team: 'Shop', name: 'Shop QA' }, { team: 'Shop', name: 'Alice' }], ['Backend', 'Frontend', 'QA', 'Alice']],
  ]
  for (const [list, want] of cases) {
    const labels = chartLabels(list)
    const got = list.map(m => labels.get(`${m.team}|${m.name}`)!)
    expect(got).toEqual(want)
    expect(new Set(got).size).toBe(got.length)
    for (const l of got) expect(l.length).toBeGreaterThanOrEqual(2)
  }
})
