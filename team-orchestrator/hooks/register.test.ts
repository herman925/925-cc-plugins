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
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/home' : undefined }) as any)
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
    if (a[1] === 'terminal' && a[2] === 'show' && tab) return out(JSON.stringify({ result: { terminal: { connected: true, tabId: tab.handle, leafId: 'l' } } }))
    if (a[1] === 'terminal' && a[2] === 'read' && tab) return out(JSON.stringify({ result: { terminal: { tail: [tab.screen ?? ''], status: 'running' } } }))
    return { value: no } as any
  })
  return files
}
const adopt = ($: any, members: any[]) => $.tool.call({ tool: 'mcp__team-orchestrator__team_adopt', team: 'Hualong', members } as any)
// what the roster file says, and the text the roster shows (notes, model, effort, context are live, not saved)
const saved = (files: Map<string, string>) => JSON.parse(files.get('C:/proj/.claude/team-orchestrator.json')!)
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
  await band.press({ key: 'rm-Hualong|W1' })
  expect(saved(files).map((m: any) => m.name)).toEqual(['Old-Head', 'Head'])
  await band.press({ key: 'rmteam-0' })
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

test('the effort value is coloured on a scale from low (cool) to max (hot), and Open is a button like Refresh', async ($, on) => {
  world(on, [{ handle: 'term_jj1', title: 'A', screen: 'Thinking: low' }, { handle: 'term_jj2', title: 'B', screen: 'Thinking: max' }], [])
  await adopt($, [
    { name: 'A', role: 'head', level: 1, boss: 'user', handle: 'term_jj1' },
    { name: 'B', role: 'worker', level: 2, boss: 'A', handle: 'term_jj2' },
  ])
  const band = await mountBand($)
  const tree = await band.drawn()
  expect(colours(tree, 'low')[0]).toBe('#6c8cff')
  expect(colours(tree, 'max')[0]).toBe('#ff4d4d')
  const open: any = await band.find({ key: 'go-Hualong|A' })
  const refresh: any = await band.find({ key: 'refresh' })
  expect(open.props.plain).toBeUndefined()
  expect(open.props.label).toBe('Open')
  expect(refresh.props.plain).toBeUndefined()
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
  expect(await band.find({ key: 'go-Hualong|A' })).toBeDefined()
  expect(cardWidths(await band.drawn())).toEqual([undefined, undefined])
})

test('settings hide the chart and columns, and stay after a refresh and a new drawing', async ($, on) => {
  await twoSmallTeams($, on)
  let band = await bandAt($, 120)
  await band.press({ key: 'tab-settings' })
  for (const key of ['layout-stacked', 'layout-columns', 'layout-dock', 'chart-1', 'chart-0', 'col-STATUS', 'col-OPEN']) expect(await band.find({ key })).toBeDefined()
  await band.press({ key: 'chart-0' })
  await band.press({ key: 'col-MODEL' })
  await band.press({ key: 'col-OPEN' })
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
  band = await bandAt($, 120)
  const s = JSON.stringify(await band.drawn())
  expect(s).not.toContain('LIVE ORG')
  expect(s).not.toContain('MODEL')
  expect(s).toContain('EFFORT')
  expect(await band.find({ key: 'go-Hualong|A' })).toBeUndefined()
  // and back on
  await band.press({ key: 'tab-settings' })
  await band.press({ key: 'col-MODEL' })
  await band.press({ key: 'tab-roster' })
  expect(JSON.stringify(await band.drawn())).toContain('MODEL')
})

test('side by side: cards share a row only where two fit; a narrow terminal stays stacked', async ($, on) => {
  await twoSmallTeams($, on)
  const band = await bandAt($, 120)
  await band.press({ key: 'tab-settings' })
  await band.press({ key: 'layout-columns' })
  await band.press({ key: 'tab-roster' })
  expect(cardWidths(await band.drawn())).toEqual([undefined, undefined])
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
  expect((await band.find({ key: 'layout-dock' }) as any).props.variant).toBe('primary')
  const pane = await $.ui.mount({
    plugin: 'team-orchestrator', surface: 'terminal', component: 'Pane', requestId: 'team-dock',
    props: { title: 'Team Orchestrator', isFocused: false, bodyColumns: 90, placement: 'inline' } as any,
  })
  expect(await pane.find({ key: 'tab-settings' })).toBeDefined()
  expect(JSON.stringify(await pane.drawn())).toContain('only in the fullscreen layout')
  await pane.press({ key: 'layout-stacked' })
  expect((await pane.find({ key: 'layout-stacked' }) as any).props.variant).toBe('primary')
})

// item 11: the Actions menu and member_move
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

test('moving a head whose reports stay behind is refused; ticking them too moves the whole branch', async ($, on) => {
  const files = await alphaBeta($, on)
  const out: any = await $.tool.call({ tool: 'mcp__team-orchestrator__member_move', team: 'Alpha', name: 'Head', toTeam: 'Beta' } as any)
  expect(JSON.stringify(out)).toContain('Refused: W1 reports to Head')
  expect(row(files, 'Head').team).toBe('Alpha')
  const band = await mountBand($)
  await band.press({ key: 'sel-Alpha|Head' })
  await band.press({ key: 'sel-Alpha|W1' })
  await band.select({ key: 'actions', value: 'move' })
  await band.select({ key: 'move-to', value: 'Beta' })
  await band.press({ key: 'move-go' })
  expect([row(files, 'Head').team, row(files, 'Head').boss, row(files, 'Head').level]).toEqual(['Beta', 'BHead', 2])
  expect([row(files, 'W1').team, row(files, 'W1').boss, row(files, 'W1').level]).toEqual(['Beta', 'Head', 3])
  // the ticks are cleared and the menu is back to rest
  expect((await band.find({ key: 'sel-Beta|W1' }) as any).props.label).toBe('[ ]')
  expect(await band.find({ key: 'move-go' })).toBeUndefined()
})

test('remove from the menu asks first: Cancel keeps the member, Confirm takes it off the roster', async ($, on) => {
  const files = await alphaBeta($, on)
  const band = await mountBand($)
  await band.press({ key: 'sel-Alpha|W1' })
  await band.select({ key: 'actions', value: 'remove' })
  expect(await band.find({ key: 'remove-confirm' })).toBeDefined()
  await band.select({ key: 'remove-confirm', value: 'cancel' })
  expect(await band.find({ key: 'remove-confirm' })).toBeUndefined()
  expect(row(files, 'W1')).toBeDefined()
  await band.select({ key: 'actions', value: 'remove' })
  await band.select({ key: 'remove-confirm', value: 'confirm' })
  expect(row(files, 'W1')).toBeUndefined()
  expect(files.calls.filter(a => a.includes('close') || a.includes('kill')).length).toBe(0)
})

test('change boss offers only members of the same team that are not the ticked ones or below them', async ($, on) => {
  const files = await alphaBeta($, on)
  const band = await mountBand($)
  await band.press({ key: 'sel-Beta|BW' })
  await band.select({ key: 'actions', value: 'boss' })
  const opts = ((await band.find({ key: 'boss-to' })) as any).props.options.map((o: any) => o.value)
  expect(opts).toEqual(['BHead'])
  await band.press({ key: 'sel-Beta|BW' })
  await band.press({ key: 'sel-Beta|BHead' })
  // the head and its report ticked: no one in the team is left to be their boss
  expect(await band.find({ key: 'boss-to' })).toBeUndefined()
  await band.press({ key: 'sel-Beta|BHead' })
  await band.press({ key: 'sel-Beta|BW' })
  await band.select({ key: 'boss-to', value: 'BHead' })
  expect([row(files, 'BW').boss, row(files, 'BW').level]).toEqual(['BHead', 2])
})

test('add member lists live tabs that are not on the roster, and adopts the picked one into a team', async ($, on) => {
  const files = await alphaBeta($, on, [
    { handle: 'term_a1', title: '✳ Head' },
    { handle: 'term_0e1', title: '✳ New Guy' },
  ])
  const band = await mountBand($)
  await band.select({ key: 'actions', value: 'add' })
  const tabs = ((await band.find({ key: 'add-tab' })) as any).props.options
  expect(tabs).toEqual([{ value: 'term_0e1', label: 'New Guy' }])
  await band.select({ key: 'add-team', value: 'Alpha' })
  await band.select({ key: 'add-boss', value: 'Head' })
  await band.input({ key: 'add-role', text: 'reviewer', kind: 'change' })
  await band.press({ key: 'add-go' })
  expect([row(files, 'New Guy').team, row(files, 'New Guy').boss, row(files, 'New Guy').level, row(files, 'New Guy').handle, row(files, 'New Guy').role]).toEqual(['Alpha', 'Head', 2, 'term_0e1', 'reviewer'])
})
