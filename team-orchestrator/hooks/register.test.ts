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
  for (const key of ['refresh', 'none', 'settings', 'tact-0']) {
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
  expect(files.get('C:/repo/.git/info/exclude')).toBe('*.log\n.claude/team-orchestrator/\n')
  expect(files.has('C:/repo/.claude/team-orchestrator/roster.json')).toBe(true)
})

test('a line already in info/exclude is not added again', async ($, on) => {
  const files = await adoptIn($, on, 'C:/kept', () => ok('\nC:/kept/.git/info/exclude\n'), [['C:/kept/.git/info/exclude', '*.log\n/.claude/team-orchestrator/']])
  expect(files.get('C:/kept/.git/info/exclude')).toBe('*.log\n/.claude/team-orchestrator/')
})

test('a worktree in a subfolder writes the prefixed line to the exclude file git names (the common dir)', async ($, on) => {
  const files = await adoptIn($, on, 'C:/wt/sub', () => ok('sub/\nC:/main/.git/info/exclude\n'))
  expect(files.get('C:/main/.git/info/exclude')).toBe('sub/.claude/team-orchestrator/\n')
})

test('outside a git repo nothing but the team folder is written (roster and role files; no exclude file)', async ($, on) => {
  const files = await adoptIn($, on, 'C:/plain', () => ({ ...no, exitCode: 128, stderr: 'fatal: not a git repository' }))
  expect([...files.keys()].every(k => k === 'C:/plain/.claude/team-orchestrator/roster.json' || k.startsWith('C:/plain/.claude/team-orchestrator/roles/'))).toBe(true)
  expect(files.has('C:/plain/.claude/team-orchestrator/roster.json')).toBe(true)
})

// items 1 and 2: handles and session ids found by name, stats from the transcript where the status line says nothing
type Tab = { handle: string; title: string; worktreePath?: string; screen?: string }
type Tr = { id: string; title?: string; model?: string; used?: number; effort?: string; cwd?: string }
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const world = (on: any, tabs: Tab[], trs: Tr[]) => {
  const files = Object.assign(new Map<string, string>(), { calls: [] as string[][] })
  const p = (s: string) => s.replace(/\\/g, '/')
  const dir = 'C:/home/.claude/projects/proj'
  const tail = (t: Tr) =>
    [
      t.model ? JSON.stringify({ type: 'assistant', effort: t.effort, cwd: t.cwd, message: { model: t.model, usage: { input_tokens: 1, cache_read_input_tokens: (t.used ?? 1) - 1, cache_creation_input_tokens: 0, output_tokens: 9 } } }) : '',
      t.title ? JSON.stringify({ type: 'custom-title', customTitle: t.title, sessionId: t.id }) : '',
    ].join('\n')
  on('session.root', async () => ({ value: 'C:/proj' }) as any)
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/home' : e.name === 'OS' ? 'Windows_NT' : undefined }) as any)
  on('fs.exists', async (_$: any, e: any) => ({ value: files.has(p(e.path)) }) as any)
  on('fs.read', async (_$: any, e: any) => ({ value: files.get(p(e.path)) }) as any)
  on('fs.write', async (_$: any, e: any) => (files.set(p(e.path), e.text), { value: undefined }) as any)
  on('fs.list', async (_$: any, e: any) => {
    const at = p(e.path)
    if (at === 'C:/home/.claude/projects') return { value: [{ name: 'proj', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] } as any
    if (at === dir) return { value: trs.map((t, i) => ({ name: `${t.id}.jsonl`, kind: 'file', size: 9, mtimeMs: 1000 - i, isLink: false })) } as any
    return { value: [] } as any
  })
  on('process.run', async (_$: any, e: any) => {
    const a: string[] = e.argv
    files.calls.push(a)
    const out = (stdout: string) => ({ value: { ...no, exitCode: 0, stdout } }) as any
    if (a[0] === 'powershell.exe')
      return out(String(e.init.env.TO_FILES).split('|').map(f => '\0' + tail(trs.find(t => p(f).endsWith(`${t.id}.jsonl`))!)).join(''))
    const h = a[a.indexOf('--terminal') + 1]
    const tab = tabs.find(t => t.handle === h)
    if (a[1] === 'terminal' && a[2] === 'list') return out(JSON.stringify({ result: { terminals: tabs.map(t => ({ ...t, connected: true, tabId: t.handle, leafId: 'l' })) } }))
    if (a[1] === 'terminal' && a[2] === 'show' && tab) return out(JSON.stringify({ result: { terminal: { title: tab.title, worktreePath: tab.worktreePath, connected: true, tabId: tab.handle, leafId: 'l' } } }))
    if (a[1] === 'terminal' && a[2] === 'read' && tab) return out(JSON.stringify({ result: { terminal: { tail: [tab.screen ?? ''], status: 'running' } } }))
    return { value: no } as any
  })
  return files
}
const adopt = ($: any, members: any[]) => $.tool.call({ tool: 'mcp__team-orchestrator__team_adopt', team: 'Hualong', members } as any)
// what the roster file says, and the text the roster shows (notes, model, effort, context are live, not saved)
const saved = (files: Map<string, string>) => JSON.parse(files.get('C:/proj/.claude/team-orchestrator/roster.json')!)
const shown = async ($: any) => JSON.stringify(await (await mountBand($)).drawn())
const W = { name: 'Hualong Workers', role: 'worker', level: 2, boss: 'Hualong CEO' }

test('adopt fills an empty handle from the tab title (glyph stripped) and an empty session id from the transcript title', async ($, on) => {
  const files = world(on, [{ handle: 'term_aa1', title: '✳ Hualong Workers' }], [{ id: ID2, title: 'Other' }, { id: ID1, title: 'Hualong Workers' }])
  await adopt($, [W])
  expect(saved(files)[0].handle).toBe('term_aa1')
  expect(saved(files)[0].sessionId).toBe(ID1)
  expect(await shown($)).not.toContain('no Orca tab')
  expect(await shown($)).not.toContain('no transcript')
})

test('adopt keeps a member it cannot find and says why on its row', async ($, on) => {
  const files = world(on, [{ handle: 'term_bb1', title: '◑ Someone Else' }], [{ id: ID1, title: 'Someone Else' }])
  const out: any = await adopt($, [W])
  expect(saved(files).map((m: any) => m.name)).toEqual(['Hualong Workers'])
  expect(await shown($)).toContain('no Orca tab, no transcript')
  expect(JSON.stringify(out)).toContain('Hualong Workers: no Orca tab, no transcript')
})

test('refresh replaces a dead handle with the one live tab of that name', async ($, on) => {
  const files = world(on, [{ handle: 'term_cc2', title: '✳ Hualong Workers' }], [{ id: ID1, title: 'Hualong Workers' }])
  await adopt($, [{ ...W, handle: 'term_cc1', sessionId: ID1 }])
  expect(saved(files)[0].handle).toBe('term_cc2')
  expect(await shown($)).not.toContain('no Orca tab')
})

test('several tabs of one name: the handle stays and the row says so', async ($, on) => {
  const files = world(on, [{ handle: 'term_dd2', title: '✳ Hualong Workers', worktreePath: 'C:/a' }, { handle: 'term_dd3', title: '◑ Hualong Workers', worktreePath: 'C:/b' }], [])
  await adopt($, [{ ...W, handle: 'term_dd1' }])
  expect(saved(files)[0].handle).toBe('term_dd1')
  expect(await shown($)).toContain('several tabs named Hualong Workers')
})

test('several tabs of one name: the one in the worktree the transcript last ran in wins', async ($, on) => {
  const files = world(
    on,
    [{ handle: 'term_ee2', title: '✳ Hualong Workers', worktreePath: 'C:/a' }, { handle: 'term_ee3', title: '◑ Hualong Workers', worktreePath: 'C:/b' }],
    [{ id: ID1, title: 'Hualong Workers', model: 'claude-opus-5', used: 1000, cwd: 'C:\\b\\sub' }],
  )
  await adopt($, [{ ...W, handle: 'term_ee1', sessionId: ID1 }])
  expect(saved(files)[0].handle).toBe('term_ee3')
})

// two teams on one machine can both have a "Head": a tab is only ever this member's if it sits in the member's worktree
test('the only tab of that name sits in another worktree: it is not adopted', async ($, on) => {
  const files = world(
    on,
    [{ handle: 'term_ab2', title: '◑ Hualong Workers', worktreePath: 'C:/other' }],
    [{ id: ID1, title: 'Hualong Workers', model: 'claude-opus-5', used: 1000, cwd: 'C:\\proj' }],
  )
  await adopt($, [{ ...W, handle: 'term_ab1', sessionId: ID1 }])
  expect(saved(files)[0].handle).toBe('term_ab1')
  expect(await shown($)).toContain('no Orca tab')
})

test('a live handle that points into another worktree is replaced by the tab in the member\'s own worktree', async ($, on) => {
  const files = world(
    on,
    [{ handle: 'term_ac1', title: '◑ Hualong Workers', worktreePath: 'C:/other' }, { handle: 'term_ac2', title: '✳ Hualong Workers', worktreePath: 'C:/proj' }],
    [{ id: ID1, title: 'Hualong Workers', model: 'claude-opus-5', used: 1000, cwd: 'C:\\proj\\sub' }],
  )
  await adopt($, [{ ...W, handle: 'term_ac1', sessionId: ID1 }])
  expect(saved(files)[0].handle).toBe('term_ac2')
})

test('a live handle in the member\'s own worktree is kept, even when another tab has the same name', async ($, on) => {
  const files = world(
    on,
    [{ handle: 'term_ad1', title: '✳ Hualong Workers', worktreePath: 'C:/proj' }, { handle: 'term_ad2', title: '◑ Hualong Workers', worktreePath: 'C:/other' }],
    [{ id: ID1, title: 'Hualong Workers', model: 'claude-opus-5', used: 1000, cwd: 'C:\\proj' }],
  )
  await adopt($, [{ ...W, handle: 'term_ad1', sessionId: ID1 }])
  expect(saved(files)[0].handle).toBe('term_ad1')
})

test('a session id found by name skips a newer transcript of the same name that last ran outside the project', async ($, on) => {
  const files = world(
    on,
    [{ handle: 'term_ae1', title: '✳ Hualong Workers', worktreePath: 'C:/proj' }],
    [
      { id: ID2, title: 'Hualong Workers', model: 'claude-opus-5', used: 1000, cwd: 'Z:\\other team' },
      { id: ID1, title: 'Hualong Workers', model: 'claude-opus-5', used: 1000, cwd: 'C:\\proj' },
    ],
  )
  await adopt($, [{ ...W, handle: 'term_ae1' }])
  expect(saved(files)[0].sessionId).toBe(ID1)
})

test('no tab of that name: the old handle stays and the row says so', async ($, on) => {
  const files = world(on, [], [{ id: ID1, title: 'Hualong Workers' }])
  await adopt($, [{ ...W, handle: 'term_ff1', sessionId: ID1 }])
  expect(saved(files)[0].handle).toBe('term_ff1')
  expect(await shown($)).toContain('no Orca tab')
})

test('the status line is read first', async ($, on) => {
  const screen = 'Model: Opus 5 v2.1.289 | Thinking: max | Context: ▓▓ (42%)'
  world(on, [{ handle: 'term_gg1', title: 'Hualong Workers', screen }], [{ id: ID1, title: 'Hualong Workers', model: 'claude-sonnet-5', used: 100000, effort: 'low' }])
  await adopt($, [{ ...W, handle: 'term_gg1', sessionId: ID1 }])
  const s = await shown($)
  for (const part of ['Opus 5', 'max', ' 42%']) expect(s).toContain(part)
  expect(s).not.toContain('sonnet')
})

test('with no status line the transcript gives model, effort and context; past 200k the window is 1M', async ($, on) => {
  world(
    on,
    [{ handle: 'term_hh1', title: 'Hualong Workers', screen: 'some other status line' }, { handle: 'term_hh2', title: 'Hualong CEO', screen: '' }],
    [
      { id: ID1, title: 'Hualong Workers', model: 'claude-opus-5', used: 50000, effort: 'high' },
      { id: ID2, title: 'Hualong CEO', model: 'claude-sonnet-5-5', used: 760000 },
    ],
  )
  await adopt($, [{ ...W, handle: 'term_hh1', sessionId: ID1 }, { name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_hh2', sessionId: ID2 }])
  const s = await shown($)
  for (const part of ['opus-5', 'high', ' 25%', 'sonnet-5-5', ' 76%']) expect(s).toContain(part)
  expect(s).not.toContain('status line not readable')
})

test('neither the status line nor a transcript: the row says the status line is not readable', async ($, on) => {
  world(on, [{ handle: 'term_ii1', title: 'Hualong Workers', screen: '' }], [{ id: ID1, title: 'Hualong Workers' }])
  await adopt($, [{ ...W, handle: 'term_ii1', sessionId: ID1 }])
  expect(await shown($)).toContain('status line not readable')
})

// item 3: removal edits the roster only
const twoTeams = async ($: any, on: any) => {
  const files = world(on, [], [])
  const calls = files.calls
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_adopt', team: 'Old', members: [{ name: 'Old-Head', role: 'head', level: 1, boss: 'user', handle: 'term_o1' }] } as any)
  await adopt($, [{ name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h1' }, { name: 'W1', role: 'worker', level: 2, boss: 'Head', handle: 'term_w1' }])
  return { files, calls }
}
const closes = (calls: string[][]) => calls.filter(a => a.includes('close') || a.includes('kill')).length

test('team_remove takes one team off the roster file and the roster, and closes nothing', async ($, on) => {
  const { files, calls } = await twoTeams($, on)
  const out: any = await $.tool.call({ tool: 'mcp__team-orchestrator__team_remove', team: 'Old' } as any)
  expect(JSON.stringify(out)).toContain('No terminal was closed')
  expect(saved(files).map((m: any) => m.team)).toEqual(['Hualong', 'Hualong'])
  expect(await shown($)).not.toContain('@Old')
  expect(closes(calls)).toBe(0)
})

test('member_remove takes one member off; the last team removed leaves an empty roster file', async ($, on) => {
  const { files, calls } = await twoTeams($, on)
  await $.tool.call({ tool: 'mcp__team-orchestrator__member_remove', team: 'Hualong', name: 'W1' } as any)
  expect(saved(files).map((m: any) => m.name)).toEqual(['Old-Head', 'Head'])
  const miss: any = await $.tool.call({ tool: 'mcp__team-orchestrator__member_remove', team: 'Hualong', name: 'Nobody' } as any)
  expect(JSON.stringify(miss)).toContain('No member')
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_remove', team: 'Old' } as any)
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_remove', team: 'Hualong' } as any)
  expect(saved(files)).toEqual([])
  expect(closes(calls)).toBe(0)
})

test('the roster rows and team cards remove too', async ($, on) => {
  const { files, calls } = await twoTeams($, on)
  const band = await mountBand($)
  await band.press({ key: 'sel-Hualong|W1' })
  await band.press({ key: 'tact-1' })
  await band.press({ key: 'tact-1-remove' })
  await band.press({ key: 'confirm-1' })
  expect(saved(files).map((m: any) => m.name)).toEqual(['Old-Head', 'Head'])
  await band.press({ key: 'tact-0' })
  await band.press({ key: 'tact-0-rmteam' })
  await band.press({ key: 'confirm-0' })
  expect(saved(files).map((m: any) => m.name)).toEqual(['Head'])
  expect(closes(calls)).toBe(0)
})

// items 8-10: the Open button, a colour per level, a colour per effort
// every Text in the drawn tree whose own text starts with `start`, with its colour
const colours = (tree: any, start: string): string[] => {
  const out: string[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    const own = (n.children ?? []).filter((c: any) => typeof c === 'string').join('')
    if (n.type === 'Text' && own.startsWith(start)) out.push(n.props?.color)
    ;(n.children ?? []).forEach(walk)
  }
  walk(tree)
  return out
}

test('names take one colour per level in the table and the chart, the same in every team; deeper levels share the last', async ($, on) => {
  world(on, [], [])
  await adopt($, [
    { name: 'L1', role: 'head', level: 1, boss: 'user' },
    { name: 'L2', role: 'lead', level: 2, boss: 'L1' },
    { name: 'L3', role: 'worker', level: 3, boss: 'L2' },
    { name: 'L5', role: 'worker', level: 5, boss: 'L3' },
  ])
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_adopt', team: 'Other', members: [{ name: 'O2', role: 'x', level: 2, boss: 'user' }] } as any)
  const tree = await (await mountBand($)).drawn()
  const table = (name: string) => colours(tree, name)[0]
  expect([table('L1'), table('L2'), table('L3'), table('L5')]).toEqual(['#ff79c6', '#bd93f9', '#8be9fd', '#a0a8b8'])
  expect(table('O2')).toBe('#bd93f9')
  // the chart draws " L2" after the status glyph, in the same colour
  expect(colours(tree, ' L2')).toContain('#bd93f9')
  for (const c of ['#ff79c6', '#bd93f9', '#8be9fd', '#a0a8b8']) expect(['green', 'yellow']).not.toContain(c)
})

test('the effort value is coloured on a scale from low (cool) to max (hot); a row has only its tick box and the jump marker, Open is in Team actions', async ($, on) => {
  const files = world(on, [{ handle: 'term_jj1', title: 'A', screen: 'Thinking: low' }, { handle: 'term_jj2', title: 'B', screen: 'Thinking: max' }], [])
  await adopt($, [
    { name: 'A', role: 'head', level: 1, boss: 'user', handle: 'term_jj1' },
    { name: 'B', role: 'worker', level: 2, boss: 'A', handle: 'term_jj2' },
  ])
  const band = await mountBand($)
  const tree = await band.drawn()
  expect(colours(tree, 'low')[0]).toBe('#6c8cff')
  expect(colours(tree, 'max')[0]).toBe('#ff4d4d')
  // the only button on a row besides its tick box is the small jump marker (the name and dot stay coloured text)
  expect(await band.find({ key: 'go-Hualong|A' })).toBeDefined()
  expect(await band.find({ key: 'rm-Hualong|A' })).toBeUndefined()
  await band.press({ key: 'sel-Hualong|A' })
  await band.press({ key: 'tact-0' })
  await band.press({ key: 'tact-0-open' })
  expect(files.calls.some(a => a.includes('switch') && a.includes('term_jj1'))).toBe(true)
})

// items 6 and 7: settings (layout, org chart, columns) that stay across a refresh and a fresh drawing
const twoSmallTeams = async ($: any, on: any) => {
  world(on, [{ handle: 'term_kk1', title: 'A' }], [])
  // the kit seats no pane: answer as a surface that placed it
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('ui.close', async () => ({ value: undefined }) as any)
  await adopt($, [{ name: 'A', role: 'head', level: 1, boss: 'user', handle: 'term_kk1' }])
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_adopt', team: 'Other', members: [{ name: 'B', role: 'head', level: 1, boss: 'user' }] } as any)
}
const bandAt = ($: any, bodyColumns: number) =>
  $.ui.mount({ plugin: 'team-orchestrator', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns } as any })
// the team cards: Boxes drawn with a round cyan border holding a "╔═ TEAM @" line
const cardWidths = (tree: any): (number | undefined)[] => {
  const out: (number | undefined)[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'Box' && JSON.stringify(n.children ?? []).includes('╔═ TEAM @')) {
      const inner = (n.children ?? []).some((c: any) => c?.type === 'Box' && JSON.stringify(c).includes('╔═ TEAM @'))
      if (!inner) out.push(n.props?.width)
    }
    ;(n.children ?? []).forEach(walk)
  }
  walk(tree)
  return out
}

test('defaults keep the old look: chart shown, every column, cards stacked', async ($, on) => {
  await twoSmallTeams($, on)
  const band = await bandAt($, 300)
  const s = JSON.stringify(await band.drawn())
  expect(s).toContain('LIVE ORG')
  for (const c of ['STATUS', 'CONTEXT', 'MODEL', 'EFFORT', 'BRIEF']) expect(s).toContain(c)
  expect(cardWidths(await band.drawn())).toEqual([300, 300])
})

test('settings hide the chart and columns, and stay after a refresh and a new drawing', async ($, on) => {
  await twoSmallTeams($, on)
  let band = await bandAt($, 120)
  await band.press({ key: 'tab-settings' })
  for (const key of ['layout-stacked', 'layout-columns', 'layout-dock', 'chart-1', 'chart-0', 'col-STATUS', 'col-BRIEF']) expect(await band.find({ key })).toBeDefined()
  await band.press({ key: 'chart-0' })
  await band.press({ key: 'col-MODEL' })
  await band.press({ key: 'col-BRIEF' })
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
  band = await bandAt($, 120)
  const s = JSON.stringify(await band.drawn())
  expect(s).not.toContain('LIVE ORG')
  expect(s).not.toContain('MODEL')
  expect(s).toContain('EFFORT')
  expect(s).not.toContain('BRIEF')
  // and back on
  await band.press({ key: 'tab-settings' })
  await band.press({ key: 'col-MODEL' })
  await band.press({ key: 'tab-roster' })
  expect(JSON.stringify(await band.drawn())).toContain('MODEL')
})

test('side by side: two cards share a row at the narrower tiers, and a very narrow terminal stays stacked', async ($, on) => {
  await twoSmallTeams($, on)
  const band = await bandAt($, 120)
  await band.press({ key: 'tab-settings' })
  await band.press({ key: 'layout-columns' })
  await band.press({ key: 'tab-roster' })
  expect(cardWidths(await band.drawn())).toEqual([60, 60])
  const narrow = await bandAt($, 60)
  expect(cardWidths(await narrow.drawn())).toEqual([60, 60])
  const wide = await bandAt($, 300)
  const widths = cardWidths(await wide.drawn())
  expect(widths.length).toBe(2)
  for (const w of widths) expect(w).toBe(150)
})

test('dock right puts the panel in the dock pane, which says when it cannot sit beside the transcript', async ($, on) => {
  await twoSmallTeams($, on)
  const band = await bandAt($, 120)
  await band.press({ key: 'tab-settings' })
  await band.press({ key: 'layout-dock' })
  expect(JSON.stringify(await band.find({ key: 'layout-dock' })).includes('#ff5440')).toBe(true)
  const pane = await $.ui.mount({
    plugin: 'team-orchestrator', surface: 'terminal', component: 'Pane', requestId: 'team-dock',
    props: { title: 'Team Orchestrator', isFocused: false, bodyColumns: 90, placement: 'inline' } as any,
  })
  expect(await pane.find({ key: 'tab-settings' })).toBeDefined()
  expect(JSON.stringify(await pane.drawn())).toContain('only in the fullscreen layout')
  await pane.press({ key: 'layout-stacked' })
  expect(JSON.stringify(await pane.find({ key: 'layout-stacked' })).includes('#ff5440')).toBe(true)
})

// item 11: the Team actions menus and member_move
const alphaBeta = async ($: any, on: any, tabs: Tab[] = []) => {
  const files = world(on, tabs, [])
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('ui.close', async () => ({ value: undefined }) as any)
  const team = (name: string, members: any[]) => $.tool.call({ tool: 'mcp__team-orchestrator__team_adopt', team: name, members } as any)
  await team('Alpha', [
    { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_a1' },
    { name: 'W1', role: 'worker', level: 2, boss: 'Head', handle: 'term_a2' },
  ])
  await team('Beta', [
    { name: 'BHead', role: 'head', level: 1, boss: 'user', handle: 'term_b1' },
    { name: 'BW', role: 'worker', level: 2, boss: 'BHead', handle: 'term_b2' },
  ])
  return files
}
const row = (files: Map<string, string>, name: string) => saved(files).find((m: any) => m.name === name)

test('member_move moves one member under the target head, or a named boss, and sets the level from the boss', async ($, on) => {
  const files = await alphaBeta($, on)
  const out: any = await $.tool.call({ tool: 'mcp__team-orchestrator__member_move', team: 'Beta', name: 'BW', toTeam: 'Alpha' } as any)
  expect(JSON.stringify(out)).toContain('Moved BW to team')
  expect([row(files, 'BW').team, row(files, 'BW').boss, row(files, 'BW').level]).toEqual(['Alpha', 'Head', 2])
  await $.tool.call({ tool: 'mcp__team-orchestrator__member_move', team: 'Alpha', name: 'BW', toTeam: 'Beta', boss: 'BHead' } as any)
  await $.tool.call({ tool: 'mcp__team-orchestrator__member_move', team: 'Beta', name: 'BW', toTeam: 'Alpha', boss: 'W1' } as any)
  expect([row(files, 'BW').team, row(files, 'BW').boss, row(files, 'BW').level]).toEqual(['Alpha', 'W1', 3])
  expect(files.calls.filter(a => a.includes('close') || a.includes('kill')).length).toBe(0)
})

// open a team card's "Team actions" list (a Button, so a click opens it) and press one entry
const teamAct = async (band: any, ti: number, v: string) => {
  await band.press({ key: `tact-${ti}` })
  expect(await band.find({ key: `tact-${ti}-${v}` })).toBeDefined()
  await band.press({ key: `tact-${ti}-${v}` })
  // the list closes once an entry is picked
  expect(await band.find({ key: `tact-${ti}-${v}` })).toBeUndefined()
}

test('each team card has one Team actions menu that opens and closes by press, and Settings sits beside Refresh', async ($, on) => {
  await alphaBeta($, on)
  const band = await mountBand($)
  for (const key of ['tact-0', 'tact-1', 'refresh', 'settings']) expect(await band.find({ key })).toBeDefined()
  for (const key of ['selteam-0', 'rmteam-0', 'actions']) expect(await band.find({ key })).toBeUndefined()
  await band.press({ key: 'tact-0' })
  for (const v of ['selall', 'selwork', 'add', 'movehere', 'remove', 'boss', 'brief', 'briefsel', 'bulk', 'open', 'rmteam']) expect(await band.find({ key: `tact-0-${v}` })).toBeDefined()
  // the entries come in four groups, each headed by its glyph and name
  { const d = JSON.stringify(await band.drawn()); for (const h of ['☐ SELECT', '⇄ PEOPLE', '✎ SESSIONS', '✕ REMOVE']) expect(d).toContain(h) }
  expect(await band.find({ key: 'tact-1-add' })).toBeUndefined()
  await band.press({ key: 'tact-0' })
  expect(await band.find({ key: 'tact-0-add' })).toBeUndefined()
  await teamAct(band, 1, 'selwork')
  expect((await band.find({ key: 'sel-Beta|BW' }) as any).props.label).toBe('[x]')
  expect((await band.find({ key: 'sel-Beta|BHead' }) as any).props.label).toBe('[ ]')
  await band.press({ key: 'settings' })
  expect(await band.find({ key: 'layout-columns' })).toBeDefined()
})

test('move selected here: a head whose reports stay behind is refused; ticking them too moves the whole branch', async ($, on) => {
  const files = await alphaBeta($, on)
  const out: any = await $.tool.call({ tool: 'mcp__team-orchestrator__member_move', team: 'Alpha', name: 'Head', toTeam: 'Beta' } as any)
  expect(JSON.stringify(out)).toContain('Refused: W1 reports to Head')
  const band = await mountBand($)
  await band.press({ key: 'sel-Alpha|Head' })
  await teamAct(band, 1, 'movehere')
  expect(JSON.stringify(await band.drawn())).toContain('Refused: W1 reports to Head')
  expect(row(files, 'Head').team).toBe('Alpha')
  await band.press({ key: 'sel-Alpha|W1' })
  await teamAct(band, 1, 'movehere')
  expect([row(files, 'Head').team, row(files, 'Head').boss, row(files, 'Head').level]).toEqual(['Beta', 'BHead', 2])
  expect([row(files, 'W1').team, row(files, 'W1').boss, row(files, 'W1').level]).toEqual(['Beta', 'Head', 3])
  // the ticks are cleared
  expect((await band.find({ key: 'sel-Beta|W1' }) as any).props.label).toBe('[ ]')
})

test('remove selected and remove team ask first: Cancel keeps, Confirm takes them off the roster', async ($, on) => {
  const files = await alphaBeta($, on)
  const band = await mountBand($)
  await band.press({ key: 'sel-Alpha|W1' })
  await teamAct(band, 0, 'remove')
  expect(await band.find({ key: 'confirm-0' })).toBeDefined()
  await band.press({ key: 'cancel-0' })
  expect(await band.find({ key: 'confirm-0' })).toBeUndefined()
  expect(row(files, 'W1')).toBeDefined()
  await teamAct(band, 0, 'remove')
  await band.press({ key: 'confirm-0' })
  expect(row(files, 'W1')).toBeUndefined()
  await teamAct(band, 1, 'rmteam')
  expect(row(files, 'BW')).toBeDefined()
  await band.press({ key: 'confirm-1' })
  expect(saved(files).map((m: any) => m.name)).toEqual(['Head'])
  expect(files.calls.filter(a => a.includes('close') || a.includes('kill')).length).toBe(0)
})

test('change boss offers only members of the same team that are not the ticked ones or below them', async ($, on) => {
  const files = await alphaBeta($, on)
  const band = await mountBand($)
  await band.press({ key: 'sel-Beta|BW' })
  await teamAct(band, 1, 'boss')
  expect(await band.find({ key: 'boss-1-BHead' })).toBeDefined()
  expect(await band.find({ key: 'boss-1-BW' })).toBeUndefined()
  // the head and its report ticked: no one in the team is left to be their boss
  await band.press({ key: 'sel-Beta|BHead' })
  expect(await band.find({ key: 'boss-1-BHead' })).toBeUndefined()
  await band.press({ key: 'sel-Beta|BHead' })
  await band.press({ key: 'boss-1-BHead' })
  expect([row(files, 'BW').boss, row(files, 'BW').level]).toEqual(['BHead', 2])
})

test('add member lists live tabs that are not on the roster, and adopts the picked one into that team', async ($, on) => {
  const files = await alphaBeta($, on, [
    { handle: 'term_a1', title: '✳ Head' },
    { handle: 'term_0e1', title: '✳ New Guy' },
  ])
  const band = await mountBand($)
  await teamAct(band, 0, 'add')
  expect(await band.find({ key: 'addtab-0-term_0e1' })).toBeDefined()
  expect(await band.find({ key: 'addtab-0-term_a1' })).toBeUndefined()
  // the boss defaults to the team's head
  expect(JSON.stringify(await band.find({ key: 'addboss-0-Head' })).includes('#ff5440')).toBe(true)
  await band.press({ key: 'addboss-0-W1' })
  await band.input({ key: 'addrole-0', text: 'reviewer', kind: 'change' })
  await band.press({ key: 'addgo-0' })
  expect([row(files, 'New Guy').team, row(files, 'New Guy').boss, row(files, 'New Guy').level, row(files, 'New Guy').handle, row(files, 'New Guy').role]).toEqual(['Alpha', 'W1', 3, 'term_0e1', 'reviewer'])
})

test('an action that needs ticked rows says so instead of opening', async ($, on) => {
  await alphaBeta($, on)
  const band = await mountBand($)
  await teamAct(band, 0, 'bulk')
  expect(JSON.stringify(await band.drawn())).toContain('Tick at least one row first.')
  expect(await band.find({ key: 'apply' })).toBeUndefined()
  await band.press({ key: 'sel-Alpha|W1' })
  await teamAct(band, 0, 'bulk')
  expect(await band.find({ key: 'apply' })).toBeDefined()
})

// 0.4.1: the roster at 60 columns (the docked pane Herman uses): no row is wider than the card, the chart tells members apart
test('at 60 columns every row fits inside its card and the org chart shows unique labels', async ($, on) => {
  world(on, [], [])
  await adopt($, [
    { name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user' },
    { name: 'Hualong Workers', role: 'head', level: 2, boss: 'Hualong CEO' },
    { name: 'Hualong Worker 5', role: 'worker', level: 3, boss: 'Hualong Workers' },
    { name: 'Hualong PC Console Boss', role: 'head', level: 2, boss: 'Hualong CEO' },
    { name: 'Hualong PC Worker A', role: 'worker', level: 3, boss: 'Hualong PC Console Boss' },
    { name: 'Hualong PC Worker B', role: 'worker', level: 3, boss: 'Hualong PC Console Boss' },
  ])
  const tree: any = await (await bandAt($, 60)).drawn()
  const text = (n: any): string =>
    typeof n === 'string' ? n : n?.type === 'Button' ? String(n.props?.label ?? '') : (n?.children ?? []).map(text).join('')
  const rowsOf: string[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    const kids = n.children ?? []
    if (n.type === 'Box' && kids[0]?.type === 'Button' && String(kids[0].props?.key ?? '').startsWith('sel-')) rowsOf.push(text(n))
    kids.forEach(walk)
  }
  walk(tree)
  expect(rowsOf.length).toBe(6)
  for (const r of rowsOf) expect(r.length).toBeLessThanOrEqual(56)
  const s = JSON.stringify(tree)
  for (const label of ['CEO', 'Workers', 'W5', 'PC Boss', 'PC A', 'PC B']) expect(s).toContain(` ${label}`)
  // the card's top and bottom lines are as wide as the card's inside
  expect(s).toContain(`"${'═'.repeat(54)}"`)
})

// Two mods draw in the band above the prompt: both must show, ours on top.
test('with another AbovePrompt handler registered, both bands render, the Team Orchestrator line on top', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return h(Box, null, h(Text, null, 'OTHER MOD BAND'))
  })
  const band = await mountBand($)
  expect(await band.find({ key: 'main' })).toBeDefined()
  const other = await band.find({ type: 'Text', text: 'OTHER MOD BAND' })
  expect(other).toBeDefined()
  const all = JSON.stringify(await band.drawn())
  expect(all.indexOf('Team Orchestrator')).toBeLessThan(all.indexOf('OTHER MOD BAND'))
})

test('a failing neighbour does not hide the Team Orchestrator band', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, (() => {
    throw new Error('boom')
  }) as any)
  const band = await mountBand($)
  expect(await band.find({ key: 'main' })).toBeDefined()
})

test('the old single roster file moves into the folder once, keeping a backup and leaving a pointer', async ($, on) => {
  const files = world(on, [{ handle: 'term_c', title: 'Hualong CEO' }], [])
  files.set('C:/proj/.claude/team-orchestrator.json', JSON.stringify([{ team: 'Hualong', name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_c', sessionId: '' }]))
  await adopt($, [{ name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_c' }])
  expect(files.has('C:/proj/.claude/team-orchestrator/roster.json.bak')).toBe(true)
  expect(JSON.parse(files.get('C:/proj/.claude/team-orchestrator.json')!).movedTo).toBe('.claude/team-orchestrator/roster.json')
  expect(saved(files)[0].statusFile).toBe('status/Hualong_CEO.json')
})

test('a close sent to a stale handle does not mark a live member closed, and a message never starts a second copy', async ($, on) => {
  // the member's recorded handle is stale; its live tab (new handle, same name) is found and must not be duplicated
  const files = world(on, [{ handle: 'term_ab9', title: '✳ Hualong Workers', worktreePath: 'C:/proj' }], [{ id: ID1, title: 'Hualong Workers' }])
  await adopt($, [{ ...W, handle: 'term_dead1', sessionId: ID1 }])
  // status files are kept on the machine (0.5.12), not in the project
  files.set('C:/home/.claude/team-orchestrator/C--proj/status/Hualong_Workers.json', JSON.stringify({ name: 'Hualong Workers', sessionId: ID1, state: 'closed', heartbeat: Date.now() }))
  await $.tool.call({ tool: 'SendMessage', to: 'Hualong Workers', message: 'hello' } as any).catch(() => undefined)
  const creates = files.calls.filter(a => a[1] === 'terminal' && a[2] === 'create')
  expect(creates.length).toBe(0)
  expect(JSON.parse(files.get('C:/home/.claude/team-orchestrator/C--proj/status/Hualong_Workers.json')!).state).toBe('idle')
})

// #61: a bulk rename restarts an idle member with --resume; with model and effort left on "keep" it comes back on
// the member's own saved model and effort, not the CLI defaults
test('a bulk rename restart keeps the member\'s saved model and effort when they are left on keep', async ($, on) => {
  const files = world(on, [{ handle: 'term_h', title: 'Head' }, { handle: 'term_w1', title: 'W1' }], [])
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('ui.close', async () => ({ value: undefined }) as any)
  await $.tool.call({
    tool: 'mcp__team-orchestrator__team_adopt',
    team: 'Alpha',
    members: [
      { name: 'Head', role: 'head', level: 1, boss: 'user', handle: 'term_h' },
      { name: 'W1', role: 'worker', level: 2, boss: 'Head', handle: 'term_w1', sessionId: ID1 },
    ],
  } as any)
  files.set('C:/proj/.claude/team-orchestrator/roster.json', JSON.stringify(saved(files).map((m: any) => (m.name === 'W1' ? { ...m, model: 'sonnet', effort: 'high' } : m))))
  const band = await mountBand($)
  await band.press({ key: 'refresh' })
  await band.press({ key: 'sel-Alpha|W1' })
  await teamAct(band, 0, 'bulk')
  await band.input({ key: 'bbase', text: 'W9', kind: 'change' })
  await band.press({ key: 'apply' })
  const create = () => files.calls.find(a => a[1] === 'terminal' && a[2] === 'create' && a.includes('W9'))
  for (let i = 0; i < 50 && !create(); i++) await band.drawn()
  const cmd = String(create()?.[create()!.indexOf('--command') + 1] ?? '')
  expect(cmd).toContain(`--resume ${ID1}`)
  expect(cmd).toContain('--name W9')
  expect(cmd).toContain('--model sonnet')
  expect(cmd).toContain('--effort high')
})

test('dock right packs cards like side by side; stacked keeps one full-width card per row', async ($, on) => {
  await twoSmallTeams($, on)
  const band = await bandAt($, 120)
  await band.press({ key: 'tab-roster' })
  expect(cardWidths(await band.drawn())).toEqual([120, 120])
  await band.press({ key: 'tab-settings' })
  await band.press({ key: 'layout-dock' })
  const pane = await $.ui.mount({
    plugin: 'team-orchestrator', surface: 'terminal', component: 'Pane', requestId: 'team-dock',
    props: { title: 'Team Orchestrator', isFocused: false, bodyColumns: 120, placement: 'side' } as any,
  })
  await pane.press({ key: 'tab-roster' })
  expect(cardWidths(await pane.drawn())).toEqual([60, 60])
})
