import { expect, test } from 'claude-code/testing'

const mountBand = ($: any) =>
  $.ui.mount({
    plugin: 'team-orchestrator',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false },
  })

test('with no team, the band button opens the welcome screen with the three shapes', async $ => {
  const band = await mountBand($)
  expect(await band.find({ key: 'main' })).toBeDefined()
  expect(await band.find({ key: 'tab-new' })).toBeUndefined()
  await band.press({ key: 'main' })
  for (const key of ['tab-roster', 'tab-new', 'close', 'preset-Squad', 'preset-All-Purpose Team', 'preset-Tech Team', 'interview-empty']) {
    expect(await band.find({ key })).toBeDefined()
  }
  // the form is one tab away, not on this screen
  expect(await band.find({ key: 'go' })).toBeUndefined()
})

test('a shape on the welcome screen opens the form with that shape chosen', async $ => {
  const band = await mountBand($)
  await band.press({ key: 'main' })
  await band.press({ key: 'preset-Tech Team' })
  for (const key of ['team', 'fn', 'groups', 'struct-1', 'fan-4', 'preset-Squad', 'preset-All-Purpose Team', 'preset-Tech Team', 'go', 'interview']) {
    expect(await band.find({ key })).toBeDefined()
  }
  expect(await band.find({ key: 'interview-empty' })).toBeUndefined()
})

test('a model cell opens a list, and choosing from it closes the list', async $ => {
  const band = await mountBand($)
  await band.press({ key: 'main' })
  await band.press({ key: 'preset-Squad' })
  expect(await band.find({ key: 'groups' })).toBeUndefined()
  expect(await band.find({ key: 'levels-2' })).toBeDefined()
  expect(await band.find({ key: 'dd-m1' })).toBeDefined()
  expect(await band.find({ key: 'dd-e2' })).toBeDefined()
  expect(await band.find({ key: 'opt-m1-opus' })).toBeUndefined()
  await band.press({ key: 'dd-m1' })
  expect(await band.find({ key: 'opt-m1-opus' })).toBeDefined()
  await band.press({ key: 'opt-m1-opus' })
  expect(await band.find({ key: 'opt-m1-opus' })).toBeUndefined()
})

test('once a team exists the roster and bulk tools show and the welcome screen is gone', async ($, on) => {
  const files = new Map<string, string>()
  on('session.root', async () => ({ value: 'C:\proj' }) as any)
  on('fs.exists', async (_$, e: any) => ({ value: files.has(e.path) }) as any)
  on('fs.read', async (_$, e: any) => ({ value: files.get(e.path) }) as any)
  on('fs.write', async (_$, e: any) => (files.set(e.path, e.text), { value: undefined }) as any)
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'no orca in test' } }) as any)
  await $.tool.call({
    tool: 'mcp__team-orchestrator__team_adopt',
    team: 'Demo-Team',
    members: [
      { name: 'Demo-Head', role: 'head', level: 1, boss: 'user', handle: 'term_x' },
      { name: 'Demo-W1', role: 'worker', level: 2, boss: 'Demo-Head', handle: 'term_y' },
    ],
  } as any)
  // adopting a team already opens the roster, so the band is drawn open
  const band = await mountBand($)
  for (const key of ['refresh', 'none', 'selteam-0', 'selwork-0', 'brief-0']) {
    expect(await band.find({ key })).toBeDefined()
  }
  expect(await band.find({ key: 'preset-Squad' })).toBeUndefined()
})
