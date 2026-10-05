// A stand-in for the outside world (files, git, Orca, transcripts) that the new tests share. Not a test itself and
// not loaded by the plugin: only the *.test.ts files import it.

export const mountBand = ($: any, bodyColumns?: number) =>
  $.ui.mount({
    plugin: 'team-orchestrator',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: bodyColumns ? { hasSurvey: false, bodyColumns } : { hasSurvey: false },
  })

export const no = { exitCode: 1, stdout: '', stderr: 'no orca in test', isStdoutTruncated: false, isStderrTruncated: false }

export type Tab = { handle: string; title: string; worktreePath?: string; screen?: string }
export type Tr = { id: string; title?: string }
export const ID1 = '11111111-1111-4111-8111-111111111111'
export const ID2 = '22222222-2222-4222-8222-222222222222'
export const ID3 = '33333333-3333-4333-8333-333333333333'

/** files in memory (keys use forward slashes), Orca answering nothing, transcripts that carry only a title */
export const world = (on: any, tabs: Tab[] = [], trs: Tr[] = [], first?: (e: any) => string | undefined) => {
  const files = Object.assign(new Map<string, string>(), { calls: [] as string[][] })
  const p = (s: string) => s.replace(/\\/g, '/')
  const dir = 'C:/home/.claude/projects/proj'
  const tail = (t: Tr) => (t.title ? JSON.stringify({ type: 'custom-title', customTitle: t.title, sessionId: t.id }) : '')
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
    const mine = first?.(e)
    if (mine !== undefined) return out(mine)
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

export const adopt = ($: any, members: any[], team = 'Hualong') => $.tool.call({ tool: 'mcp__team-orchestrator__team_adopt', team, members } as any)
/** what the roster file says */
export const saved = (files: Map<string, string>) => JSON.parse(files.get('C:/proj/.claude/team-orchestrator.json')!)
/** the text the band shows */
export const shown = async ($: any, bodyColumns?: number) => JSON.stringify(await (await mountBand($, bodyColumns)).drawn())

/** the Hualong team of the issue: a CEO over Workers, a PC Console Boss, two PC workers and Worker 5 */
export const HUALONG = [
  { name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_c' },
  { name: 'Hualong Workers', role: 'workers', level: 2, boss: 'Hualong CEO', handle: 'term_w' },
  { name: 'Hualong Worker 5', role: 'worker', level: 3, boss: 'Hualong Workers', handle: 'term_5' },
  { name: 'Hualong PC Console Boss', role: 'boss', level: 2, boss: 'Hualong CEO', handle: 'term_b' },
  { name: 'Hualong PC Worker A', role: 'worker', level: 3, boss: 'Hualong PC Console Boss', handle: 'term_a' },
  { name: 'Hualong PC Worker B', role: 'worker', level: 3, boss: 'Hualong PC Console Boss', handle: 'term_bb' },
]
