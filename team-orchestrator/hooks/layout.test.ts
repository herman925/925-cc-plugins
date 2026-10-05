import { expect, test } from 'claude-code/testing'

import { BUTTONS, CHECK, cell, chartLabels, columnPlan, headerLine } from './layout'

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

for (const [columns, tier] of [[60, 'narrow'], [90, 'medium'], [140, 'wide']] as const) {
  test(`at ${columns} columns: the ${tier} tier, within the width, headers over their cells, nothing wraps`, () => {
    const p = columnPlan(ROWS, inner(columns), [])
    expect(p.tier).toBe(tier)
    expect(p.total).toBeLessThanOrEqual(inner(columns))
    expect(p.total).toBe(CHECK + p.nameW + p.cols.reduce((a, c) => a + c.w, 0) + (p.buttons ? BUTTONS : 0))
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

test('the tiers drop BRIEF and the buttons as the width shrinks; the narrow tier is dot, percent, family, letter', () => {
  const ids = (columns: number) => columnPlan(ROWS, inner(columns), []).cols.map(c => c.id)
  expect(ids(140)).toEqual(['STATUS', 'CONTEXT', 'MODEL', 'EFFORT', 'BRIEF'])
  expect(ids(90)).toEqual(['STATUS', 'CONTEXT', 'MODEL', 'EFFORT'])
  expect(columnPlan(ROWS, inner(90), []).buttons).toBe(true)
  const narrow = columnPlan(ROWS, inner(60), [])
  expect(narrow.buttons).toBe(false)
  expect(narrow.cols.map(c => c.w)).toEqual([2, 5, 7, 4])
  // the longest guide and name ("└─ Hualong PC Console Boss", 26) keep their whole length at 60, plus one space
  expect(narrow.nameW).toBe(27)
})

test('the settings toggles apply on top of the tier, and the room they free goes to the names', () => {
  const all = columnPlan(ROWS, inner(90), [])
  const less = columnPlan(ROWS, inner(90), ['MODEL', 'OPEN'])
  expect(less.cols.map(c => c.id)).not.toContain('MODEL')
  expect(less.buttons).toBe(false)
  // without the model and the buttons the wide tier fits at 90
  expect(less.tier).toBe('wide')
  expect(less.total).toBeLessThanOrEqual(inner(90))
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
