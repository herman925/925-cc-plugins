import { expect, test } from 'claude-code/testing'
import { adopt, mountBand, world } from './test-world'

// A small marker beside each name jumps to that session's Orca tab: in the roster rows and in the org chart.
// Names and dots keep their colours (a Button cannot carry one), so the marker is its own cell.
test('pressing the marker on a roster row or on a chart node opens that member tab, and says so in its card', async ($, on) => {
  // Orca answers a switch with success (the stand-in world answers nothing it was not told about)
  const files = world(on, [{ handle: 'term_a1', title: '✳ Hualong Workers' }, { handle: 'term_a2', title: '◑ Hualong CEO' }], [], e => (e.argv.includes('switch') ? '{}' : undefined))
  await adopt($, [
    { name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_a2' },
    { name: 'Hualong Workers', role: 'worker', level: 2, boss: 'Hualong CEO', handle: 'term_a1' },
    { name: 'Hualong Orphan', role: 'worker', level: 2, boss: 'Hualong CEO', handle: '' },
  ])
  const band = await mountBand($, 120)
  const switched = () => files.calls.filter(a => a.includes('switch')).map(a => a[a.indexOf('--terminal') + 1])
  // the roster row marker
  await band.press({ key: 'go-Hualong|Hualong Workers' })
  expect(switched()).toEqual(['term_a1'])
  expect(JSON.stringify(await band.drawn())).toContain('Opened Hualong Workers.')
  // the org chart marker, a different key so one drawing never holds two of the same
  await band.press({ key: 'node-Hualong|Hualong CEO' })
  expect(switched()).toEqual(['term_a1', 'term_a2'])
  // a member with no tab: nothing is sent to Orca, the card says why
  await band.press({ key: 'go-Hualong|Hualong Orphan' })
  expect(JSON.stringify(await band.drawn())).toContain('Hualong Orphan has no Orca tab.')
  expect(switched().length).toBe(2)
})

test('the chart marker is a button of its own; the dot and the name stay coloured text', async ($, on) => {
  world(on, [{ handle: 'term_b1', title: '✳ Hualong CEO' }], [])
  await adopt($, [{ name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_b1' }])
  const band = await mountBand($, 120)
  expect(await band.find({ key: 'node-Hualong|Hualong CEO' })).toBeDefined()
  const tree = JSON.stringify(await band.drawn())
  // the node: its name is a level-coloured Text run, and the very next thing is the marker button (label: the arrow)
  expect(tree).toMatch(/"color":"#[0-9a-f]{6}"[^}]*\},"children":\[" CEO "\]\},\{"type":"Button","props":\{"key":"node-Hualong\|Hualong CEO","label":"↗"/i)
  expect(tree).not.toContain('"label":"Hualong CEO"')
})
