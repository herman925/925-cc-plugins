// A stand-in for the outside world (files, git, Orca, transcripts) that the new tests share. Not a test itself and
// not loaded by the plugin: only the *.test.ts files import it.

import { applyOps, rosterOps, timeOf } from './changes'

export const mountBand = ($: any, bodyColumns?: number) =>
  $.ui.mount({
    plugin: 'team-orchestrator',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: bodyColumns ? { hasSurvey: false, bodyColumns } : { hasSurvey: false },
  })

export const no = { exitCode: 1, stdout: '', stderr: 'no orca in test', isStdoutTruncated: false, isStderrTruncated: false }

export type Tab = { handle: string; title: string; worktreePath?: string; worktreeId?: string; executionHostId?: string; screen?: string }
export type Tr = { id: string; title?: string }
export const ID1 = '11111111-1111-4111-8111-111111111111'
export const ID2 = '22222222-2222-4222-8222-222222222222'
export const ID3 = '33333333-3333-4333-8333-333333333333'

/** one record of the machine's session registry (~/.claude/sessions/<pid>.json) */
export type RegEntry = { sessionId: string; cwd?: string; name?: string }
/** by default the three test sessions run on this machine, in the project folder, with no name of their own */
export const REG0: RegEntry[] = [{ sessionId: ID1 }, { sessionId: ID2 }, { sessionId: ID3 }]

/**
 * The key a path the engine hands an fs hook is kept under: forward slashes, and on macOS and Linux, where a test's
 * C:/... path is relative, without the working folder the engine put in front of it (<cwd>/C:/proj/... is C:/proj/...).
 */
export const keyOf = (path: string) => String(path).replace(/\\/g, '/').replace(/^\/.*?\/(?=[A-Za-z]:)/, '')

/**
 * files in memory (keys use forward slashes), Orca answering nothing, transcripts that carry only a title. opts.env
 * adds environment values (ORCA_TERMINAL_HANDLE, say) or replaces OS; opts.registry replaces the session registry; opts.dirs gives
 * folder listings by path (links included); opts.version is the version the mod's own manifest says; opts.refuse
 * makes a write fail with EACCES while it answers true.
 */
export const world = (
  on: any,
  tabs: Tab[] = [],
  trs: Tr[] = [],
  first?: (e: any) => string | undefined,
  opts: { env?: Record<string, string>; registry?: RegEntry[]; dirs?: Record<string, { name: string; kind: string; isLink: boolean }[]>; version?: string; refuse?: (path: string) => boolean; worktreePath?: string; worktrees?: Record<string, string>; sessionId?: string; cwd?: string; sessionName?: string } = {},
) => {
  const registry = opts.registry ?? REG0
  const regDir = 'C:/home/.claude/sessions'
  const files = Object.assign(new Map<string, string>(), { calls: [] as string[][] })
  const p = keyOf
  const dir = 'C:/home/.claude/projects/proj'
  const tail = (t: Tr) => (t.title ? JSON.stringify({ type: 'custom-title', customTitle: t.title, sessionId: t.id }) : '')
  const callerWorktreeId = opts.env?.ORCA_WORKTREE_ID ?? 'r1::C:/proj'
  // The caller's own session id. The engine lets the mod's hook read it, but a test's fs handler may not call it
  // (the host refuses it), so the fixture is told the id and puts it in the registry itself.
  const callerSessionId = opts.sessionId ?? ID1
  const callerHandle = async ($: any) => {
    if (opts.env && Object.prototype.hasOwnProperty.call(opts.env, 'ORCA_TERMINAL_HANDLE')) return opts.env.ORCA_TERMINAL_HANDLE
    const sid = callerSessionId
    const title = trs.find(t => t.id === sid)?.title
    const matched = title ? tabs.filter(t => String(t.title).replace(/^[^a-z0-9]+/i, '').trim() === title) : []
    if (matched.length === 1) return matched[0].handle
    return sid === ID1 ? 'term_c' : sid === ID2 ? 'term_w' : sid === ID3 ? 'term_5' : 'term_operator'
  }
  on('session.root', async () => ({ value: 'C:/proj' }) as any)
  on('session.cwd', async () => ({ value: opts.cwd ?? 'C:/proj' }) as any)
  on('env.get', async ($: any, e: any) => {
    if (opts.env && Object.prototype.hasOwnProperty.call(opts.env, e.name)) return { value: opts.env[e.name] } as any
    if (e.name === 'USERPROFILE') return { value: 'C:/home' } as any
    if (e.name === 'OS') return { value: 'Windows_NT' } as any
    if (e.name === 'ORCA_TERMINAL_HANDLE') return { value: await callerHandle($) } as any
    if (e.name === 'ORCA_WORKTREE_ID') return { value: callerWorktreeId } as any
    return { value: undefined } as any
  })
  registry.forEach((r, i) => files.set(`${regDir}/${100 + i}.json`, JSON.stringify({ pid: 100 + i, sessionId: r.sessionId, cwd: r.cwd ?? 'C:/proj', name: r.name ?? '', kind: 'interactive' })))
  on('fs.exists', async (_$: any, e: any) => ({ value: files.has(p(e.path)) }) as any)
  const manifest = (path: string) => (opts.version && path.endsWith('/.claude-plugin/plugin.json') ? JSON.stringify({ name: 'team-orchestrator', version: opts.version }) : undefined)
  on('fs.read', async ($: any, e: any) => {
    const path = p(e.path)
    // the caller's own registry record: the session's id, and the name it goes by (a name the roster does not know
    // would make the mod rename the member it matches, so it is empty unless a test says otherwise)
    if (path === `${regDir}/999.json`) return { value: JSON.stringify({ pid: 999, sessionId: callerSessionId, cwd: opts.cwd ?? 'C:/proj', name: opts.sessionName ?? '' }) } as any
    return { value: manifest(path) ?? files.get(path) } as any
  })
  on('fs.write', async (_$: any, e: any) => {
    if (opts.refuse?.(p(e.path))) return { deny: `$.fs.write(${e.path}) failed: EACCES` } as any
    return (files.set(p(e.path), e.text), { value: undefined }) as any
  })
  on('fs.list', async ($: any, e: any) => {
    const at = p(e.path)
    const fake = opts.dirs?.[at]
    if (fake) return { value: fake.map(x => ({ size: 0, mtimeMs: 0, ...x })) } as any
    if (at === 'C:/home/.claude/projects') return { value: [{ name: 'proj', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] } as any
    if (at === dir) return { value: trs.map((t, i) => ({ name: `${t.id}.jsonl`, kind: 'file', size: 9, mtimeMs: 1000 - i, isLink: false })) } as any
    if (at === regDir) {
      const names = [...files.keys()].filter(k => k.startsWith(`${regDir}/`)).map(k => k.slice(regDir.length + 1))
      const id = callerSessionId
      if (id && !registry.some(r => r.sessionId === id) && !names.includes('999.json')) names.push('999.json')
      return { value: names.map(name => ({ name, kind: 'file', size: 9, mtimeMs: 0, isLink: false })) } as any
    }
    // any other folder: what the files in memory hold directly under it (change files, queue entries)
    const kids = new Map<string, string>()
    for (const k of files.keys()) {
      if (!k.startsWith(`${at}/`)) continue
      const rest = k.slice(at.length + 1)
      const cut = rest.indexOf('/')
      kids.set(cut < 0 ? rest : rest.slice(0, cut), cut < 0 ? 'file' : 'dir')
    }
    return { value: [...kids].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) } as any
  })
  on('process.run', async (_$: any, e: any) => {
    const a: string[] = e.argv
    files.calls.push(a)
    const out = (stdout: string) => ({ value: { ...no, exitCode: 0, stdout } }) as any
    const mine = first?.(e)
    if (mine !== undefined) return out(mine)
    if (a[0] === 'powershell.exe')
      return out(String(e.init.env.TO_FILES).split('|').map(f => '\0' + tail(trs.find(t => p(f).endsWith(`${t.id}.jsonl`))!)).join(''))
    if (a[1] === 'worktree' && a[2] === 'show') {
      // the selector names the workspace: `id:<id>` for a worktree, the folder path for a folder context
      const selector = a[a.indexOf('--worktree') + 1] ?? ''
      const id = selector.startsWith('folder:') ? selector : selector.replace(/^id:/, '')
      const path = id.startsWith('folder:') ? id.slice('folder:'.length) : (opts.worktrees?.[id] ?? opts.worktreePath ?? 'C:/proj')
      // a repository-backed workspace names the repository it belongs to: that is what proves its kind
      const repoId = id.startsWith('folder:') ? '' : `repo-${id}`
      return out(JSON.stringify({ result: { worktree: { id, path, ...(repoId ? { repoId } : {}) } } }))
    }
    if (a[1] === 'repo' && a[2] === 'show') {
      const id = (a[a.indexOf('--repo') + 1] ?? '').replace(/^id:/, '')
      return out(JSON.stringify({ result: { repo: { id, kind: 'git' } } }))
    }
    const h = a[a.indexOf('--terminal') + 1]
    const tab = tabs.find(t => t.handle === h)
    if (a[1] === 'terminal' && a[2] === 'list') return out(JSON.stringify({ result: { terminals: tabs.map(t => ({ ...t, connected: true, tabId: t.handle, leafId: 'l' })) } }))
    if (a[1] === 'terminal' && a[2] === 'show' && tab) return out(JSON.stringify({ result: { terminal: { handle: tab.handle, title: tab.title, worktreePath: tab.worktreePath ?? 'C:/proj', worktreeId: tab.worktreeId ?? callerWorktreeId, executionHostId: tab.executionHostId ?? 'host-test', connected: true, tabId: tab.handle, leafId: 'l' } } }))
    if (a[1] === 'terminal' && a[2] === 'show' && await callerHandle(_$) === h) {
      const title = h === 'term_c' ? 'Hualong CEO' : h === 'term_w' ? 'Hualong Workers' : h === 'term_5' ? 'Hualong Worker 5' : 'Operator'
      return out(JSON.stringify({ result: { terminal: { handle: h, title, worktreePath: 'C:/proj', worktreeId: callerWorktreeId, executionHostId: 'host-test', connected: true, tabId: h, leafId: 'l' } } }))
    }
    if (a[1] === 'terminal' && a[2] === 'read' && tab) return out(JSON.stringify({ result: { terminal: { tail: [tab.screen ?? ''], status: 'running' } } }))
    return { value: no } as any
  })
  return files
}

/**
 * The id of the session the test speaks as. The engine lets the mod's hook read it, and the shared world puts it in
 * the registry, so a test that registers this answers the mod's preflight.
 */
export const sessionAs = (on: any, sid: string = ID1) => on('session.id', async () => ({ value: sid }) as any)

export const adopt = ($: any, members: any[], team = 'Hualong') => $.tool.call({ tool: 'mcp__team-orchestrator__team_adopt', team, members } as any)
export const TEAM = 'C:/proj/.claude/team-orchestrator'
/** where a member's status file is kept on this machine (0.5.12): the config folder, by project key */
export const STATUS = 'C:/home/.claude/team-orchestrator/C--proj/status'
/** the change files written and not yet applied, oldest first */
export const pendingChanges = (files: Map<string, string>) => {
  const applied = new Set<string>(files.has(`${TEAM}/changes/applied.json`) ? JSON.parse(files.get(`${TEAM}/changes/applied.json`)!).names : [])
  return [...files.keys()]
    .filter(k => k.startsWith(`${TEAM}/changes/`) && !Number.isNaN(timeOf(k.slice(TEAM.length + 9))))
    .map(k => k.slice(TEAM.length + 9))
    .filter(n => !applied.has(n))
    .sort()
    .map(name => ({ name, change: JSON.parse(files.get(`${TEAM}/changes/${name}`)!) }))
}
/** what the roster file says, as raw */
export const rawSaved = (files: Map<string, string>) => JSON.parse(files.get(`${TEAM}/roster.json`)!)
/** what the roster says, as every session reads it: the file plus the change files the team top has not applied yet */
export const saved = (files: Map<string, string>): any => applyOps(rawSaved(files), rosterOps(pendingChanges(files)))
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
