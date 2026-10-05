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

// item 4: the roster file never lands in git by accident
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const no = { exitCode: 1, stdout: '', stderr: 'no orca in test', isStdoutTruncated: false, isStderrTruncated: false }
// the engine hands fs hooks a native path; the map keys use forward slashes
const adoptIn = async ($: any, on: any, root: string, git: () => any, seed: [string, string][] = []) => {
  const files = new Map<string, string>(seed)
  const p = (e: any) => String(e.path).replace(/\\/g, '/')
  on('session.root', async () => ({ value: root }) as any)
  on('fs.exists', async (_$: any, e: any) => ({ value: files.has(p(e)) }) as any)
  on('fs.read', async (_$: any, e: any) => ({ value: files.get(p(e)) }) as any)
  on('fs.write', async (_$: any, e: any) => (files.set(p(e), e.text), { value: undefined }) as any)
  on('process.run', async (_$: any, e: any) => ({ value: e.argv[0] === 'git' ? git() : no }) as any)
  await $.tool.call({
    tool: 'mcp__team-orchestrator__team_adopt',
    team: 'Demo-Team',
    members: [{ name: 'Demo-Head', role: 'head', level: 1, boss: 'user', handle: 'term_x' }],
  } as any)
  return files
}

test('the first write lists the roster file in the repo info/exclude, after the lines already there', async ($, on) => {
  const files = await adoptIn($, on, 'C:/repo', () => ok('\nC:/repo/.git/info/exclude\n'), [['C:/repo/.git/info/exclude', '*.log']])
  expect(files.get('C:/repo/.git/info/exclude')).toBe('*.log\n.claude/team-orchestrator.json\n')
  expect(files.has('C:/repo/.claude/team-orchestrator.json')).toBe(true)
})

test('a line already in info/exclude is not added again', async ($, on) => {
  const files = await adoptIn($, on, 'C:/kept', () => ok('\nC:/kept/.git/info/exclude\n'), [['C:/kept/.git/info/exclude', '*.log\n/.claude/team-orchestrator.json']])
  expect(files.get('C:/kept/.git/info/exclude')).toBe('*.log\n/.claude/team-orchestrator.json')
})

test('a worktree in a subfolder writes the prefixed line to the exclude file git names (the common dir)', async ($, on) => {
  const files = await adoptIn($, on, 'C:/wt/sub', () => ok('sub/\nC:/main/.git/info/exclude\n'))
  expect(files.get('C:/main/.git/info/exclude')).toBe('sub/.claude/team-orchestrator.json\n')
})

test('outside a git repo nothing but the roster file is written', async ($, on) => {
  const files = await adoptIn($, on, 'C:/plain', () => ({ ...no, exitCode: 128, stderr: 'fatal: not a git repository' }))
  expect([...files.keys()]).toEqual(['C:/plain/.claude/team-orchestrator.json'])
})
