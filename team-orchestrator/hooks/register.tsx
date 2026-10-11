import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Act, Bulk, Form, Member, Settings, Spawn, View } from '../types'
import { headOf, joinLaunch, newMember, newProblem, purview, requestProblem } from './adding'
import type { NewSpec } from './adding'
import { AGENT_TOOL, grantChanges, type GrantMap, grantMap, grantsFrom, judge, judgeTeamFiles, namesTeamFile, NO_GRANTS, pathOf, recordAfterWrite, SHELL_TOOLS, WRITE_TOOLS } from './guard'
import type { Grants } from './guard'
import { isCleanConfirmation, onReceive, onSend, senderOf, shouldPoll } from './housekeeping'
import { freshName, headWarning, holdNote, holdTool, identify, judgeHeld, nameTaken, relabel, roleNote, topAsk, topOf } from './identity'
import type { Claim, Level } from './identity'
import type { Sleep, Status, TeamSettings } from './status'
import { countFromPs, linkFree, livenessOf, parseWinProcs, psProc, scratchDeletePlan, winProcScript } from './platform'
import type { Liveness, Proc } from './platform'
import { mergeRole, orgOf, pointer, roleText, WELCOME } from './roles'
import type { EnvModels } from './status'
import { admit, awakeAge, chunk, cliOf, COUNT_EVERY_MS, heartbeatStale, isManaged, locationOf, MIN, modelArg, needsTabCheck, nextCheckInterval, noteTick, pathInWorktreeId, roleFile, shownModel, shownState, STALE_MS, startsAtCreate, statusFile, TEAM_SETTINGS0, taskLine, toClose, windowFor, worktreeHolds } from './status'
import { afterTry, appliedAfter, applyOps, applySettings, diffOps, fileName, fromOldQueue, isAway, KEEP_MS, META0, metaAfter, olderThan, pendingNames, project, projectKey, projectTop, queueAction, rightsChanges, rosterOps, sameMachine, STRUCT, timeOf, topElsewhere } from './changes'
import type { Change, Meta, QEntry, QReason } from './changes'
import { CHECK as CHECK_W, cell, chartLabelInfo, columnPlan, EFFORT_SHORT, family, fit, headerLine, shorten, sideBySide } from './layout'

// Orca's CLI is orca.exe on Windows and orca on macOS and Linux. The command is the plugin option "orcaCommand" (/config);
// empty, the mod picks it from the platform, checks it starts, and writes it into the option once (see session.start).
// PowerShell (transcript tails, leftover counts) is Windows only; macOS and Linux use tail and ps.
const os = { windows: undefined as boolean | undefined }
async function isWindows($: any): Promise<boolean> {
  if (os.windows === undefined) os.windows = String((await $.env.get('OS').catch(() => undefined)) ?? '') === 'Windows_NT'
  return os.windows
}
const cfg = { orcaCommand: '', version: '', versionRead: false }
// the version shown in the panel, read once per load from this plugin's own manifest, so it always matches what is installed
async function readVersion($: any) {
  if (cfg.versionRead) return
  cfg.versionRead = true
  try {
    cfg.version = String(JSON.parse(String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))).version ?? '')
  } catch {
    cfg.version = ''
  }
}
const ORCA_KEY = 'team-orchestrator.orcaCommand'
const orcaBin = async ($: any) => cfg.orcaCommand || ((await isWindows($)) ? 'orca.exe' : 'orca')
/** '' when the command starts and answers --version, else why not, in a sentence. */
async function orcaProblem($: any, command: string): Promise<string> {
  const r = await $.process.run([command, '--version'], { timeoutMs: 20000 }).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
  return r.exitCode === 0 ? '' : `"${command} --version" did not run (${String(r.stderr || r.stdout || `exit ${r.exitCode}`).trim().slice(0, 160)}).`
}
const TOOL = 'mcp__team-orchestrator__team_launch'
const ADOPT = 'mcp__team-orchestrator__team_adopt'
const REMOVE_TEAM = 'mcp__team-orchestrator__team_remove'
const REMOVE_MEMBER = 'mcp__team-orchestrator__member_remove'
const MOVE = 'mcp__team-orchestrator__member_move'
const MESSAGE = 'mcp__team-orchestrator__team_message'
const CLAIM = 'mcp__team-orchestrator__member_claim'
const TAKE = 'mcp__team-orchestrator__team_take_top'
const ADD = 'mcp__team-orchestrator__member_add'
const MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable']
const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max']

const INTERVIEW =
  'Interview me with AskUserQuestion to design a team of Claude Code sessions: ask about the team name, function, whether a CEO sits above several teams (and their names), how many levels, how many workers per head, model and effort per level, and any role specifics. Then call the mcp__team-orchestrator__team_launch tool with members ordered boss-first (boss "user" for the top member). Give every member a team; a CEO gets its own team name. Launching briefs every member automatically.'

// The quick starts. Each fills the form, which stays editable, and Launch then briefs every session.
// `sketch` uses the glyphs of the roster and the preview: ■ CEO, ● head, ◇ lead, ○ worker.
const PRESETS = [
  {
    label: 'Squad', sketch: '●┬○○○', hint: 'head + 3 workers',
    form: { team: 'Squad', ceo: '0', levels: '2', fan: '3', groups: '' },
  },
  {
    label: 'All-Purpose Team', sketch: '■┬●●', hint: 'CEO + 2 heads, 4 workers each',
    form: { team: 'All-Purpose-Team', ceo: '1', levels: '3', fan: '4', groups: 'Team 1, Team 2' },
  },
  {
    label: 'Tech Team', sketch: '■┬●●●●', hint: 'CEO + 4 heads, 4 workers each',
    form: { team: 'Tech-Team', ceo: '1', levels: '3', fan: '4', groups: 'Dev Team, UI Team, Test Team, Security Team' },
  },
]
const sameShape = (f: Form, p: (typeof PRESETS)[number]) =>
  f.ceo === p.form.ceo && f.fan === p.form.fan && (f.ceo === '1' ? f.groups === p.form.groups : f.levels === p.form.levels)

// How a stored value reads on screen, and the colour it is drawn in. The stored values stay as `claude --model` takes them.
const LABEL: Record<string, string> = {
  default: 'Default', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable',
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max',
}
const SHADE: Record<string, string> = {
  default: 'gray', opus: 'magenta', sonnet: 'cyan', haiku: 'green', fable: 'yellow',
  // effort: one graded scale, low cool to max hot, in the form and the roster alike
  low: '#6c8cff', medium: '#4ec9b0', high: '#e5c07b', xhigh: '#ff8c42', max: '#ff4d4d',
}
const nice = (v: string) => LABEL[v] ?? v
// One colour per level for names in the roster and the org chart, the same in every team. None is the green or
// yellow of the context bar; each reads on a dark background. Deeper levels share the last.
const LEVEL_SHADE = ['#ff79c6', '#bd93f9', '#8be9fd', '#a0a8b8']
const levelShade = (level: number) => LEVEL_SHADE[Math.min(Math.max(level, 1), LEVEL_SHADE.length) - 1] as string
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// When the person last changed a form field. A redraw while they type could drop a keystroke, so the form
// animates only after 1.5 s of quiet.
let typedAt = 0

const FORM0: Form = {
  team: 'team',
  fn: '',
  levels: '2',
  fan: '3',
  ceo: '0',
  groups: '',
  m1: 'default',
  e1: 'default',
  m2: 'default',
  e2: 'default',
  m3: 'default',
  e3: 'default',
}
const form = atom({ plugin: 'team-orchestrator', key: 'form' } as const, FORM0)
// State kept across a hot reload may predate a field, so defaults go under whatever was stored.
const readForm = async ($: any): Promise<Form> => ({ ...FORM0, ...(await read($, form)) })
const members = atom({ plugin: 'team-orchestrator', key: 'members' } as const, [] as Member[])
const view = atom({ plugin: 'team-orchestrator', key: 'view' } as const, 'closed' as View)
const teamName = atom({ plugin: 'team-orchestrator', key: 'teamName' } as const, '')
const note = atom({ plugin: 'team-orchestrator', key: 'note' } as const, '')
// frame counter for the animations; only advanced while something animated is on screen (see session.start)
const frame = atom({ plugin: 'team-orchestrator', key: 'frame' } as const, 0)
// which model/effort dropdown is open in the form ('' none, 'm2' = level 2's model, 'e1' = level 1's effort)
const menu = atom({ plugin: 'team-orchestrator', key: 'menu' } as const, '')
// The roster's look. Plugin state: it outlives a reload and a refresh, not a new session. Defaults are the old look.
const SETTINGS0: Settings = { layout: 'stacked', chart: true, hide: [] }
const settings = atom({ plugin: 'team-orchestrator', key: 'settings' } as const, SETTINGS0)
const readSettings = async ($: any): Promise<Settings> => ({ ...SETTINGS0, ...(await read($, settings)) })
const COLS = ['STATUS', 'CONTEXT', 'MODEL', 'EFFORT', 'BRIEF'] as const
// a card's border and padding, around the cells columnPlan lays out
const FRAME = 4
// Team cards per row: side by side only where two fit, so a narrow terminal keeps the stacked look.
// side by side and dock right: as many cards as fit at the narrower tiers (each card then picks the widest tier its
// width allows); stacked keeps one full-width card per row
const cardsPerRow = (s: Settings, cols: number, _cardW: number, cards: number) =>
  s.layout === 'columns' || s.layout === 'dock' ? sideBySide(cols, cards, FRAME) : 1
const ACT0: Act = { menu: '', kind: 'none', to: '', key: '', draft: '', boss: '', handle: '', role: '', tabs: [], msg: '', name: '', model: 'default', effort: 'default' }
const act = atom({ plugin: 'team-orchestrator', key: 'act' } as const, ACT0)
const readAct = async ($: any): Promise<Act> => ({ ...ACT0, ...(await read($, act)) })
// the side pane the panel moves to under the dock layout (the panes of earlier versions had other ids)
const DOCK = 'team-dock'
const SPAWN0: Spawn = { names: [], batch: 0, of: 0 }
const spawn = atom({ plugin: 'team-orchestrator', key: 'spawn' } as const, SPAWN0)
const bulk = atom({ plugin: 'team-orchestrator', key: 'bulk' } as const, {
  prefix: '',
  base: '',
  numbering: 'none',
  model: 'keep',
  effort: 'keep',
  msg: '',
} as Bulk)

type Spec = { name: string; role: string; level: number; boss: string; team?: string; model?: string; effort?: string; short?: string }

const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40)

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r % 4) + 8).toString(16)
  })

const levelName = (l: number, f: Form) =>
  f.ceo === '1' ? (['CEO', 'Heads', 'Workers'][l - 1] ?? 'Workers') : l === 1 ? 'Head' : l === Number(f.levels) ? 'Workers' : 'Leads'

const groupsOf = (f: Form): string[] => f.groups.split(',').map(g => clean(g.trim())).filter(Boolean)

// One team: a head, then `fan` reports per manager down `levels` tiers (1 = head only, 3 = head/leads/workers).
// With a CEO: the CEO, one head per named team, and `fan` workers under each head.
const plan = (f: Form): Spec[] => {
  const lv = (l: number) => ({
    model: (f as any)[`m${l}`] as string,
    effort: (f as any)[`e${l}`] as string,
  })
  const goal = f.fn || 'unspecified'
  const fan = Number(f.fan)
  if (f.ceo === '1') {
    const org = clean(f.team) || 'Org'
    const ceo: Spec = {
      name: 'CEO', team: org, level: 1, boss: 'user',
      role: `CEO: owns the goal "${goal}", splits it between the team heads, reviews, reports to the user`, ...lv(1),
    }
    const out: Spec[] = [ceo]
    for (const g of groupsOf(f)) {
      const head: Spec = {
        name: `${g}-Head`, team: g, level: 2, boss: ceo.name,
        role: `Head of team ${g}: takes goals from the CEO, splits them among its workers, reviews, reports to the CEO`, ...lv(2),
      }
      out.push(head)
      for (let i = 1; i <= fan; i++) {
        out.push({
          name: `${g}-Worker-${i}`, team: g, level: 3, boss: head.name,
          role: `Worker: executes tasks from ${head.name} and reports back`, ...lv(3),
        })
      }
    }
    return out
  }
  const levels = Number(f.levels)
  const team = clean(f.team) || 'team'
  const head: Spec = {
    name: 'Head', team, level: 1, boss: 'user',
    role: `Team head: owns the goal "${goal}", splits it, delegates, reviews, reports to the user`, ...lv(1),
  }
  const out: Spec[] = [head]
  let tier: Spec[] = [head]
  for (let l = 2; l <= levels; l++) {
    const next: Spec[] = []
    tier.forEach((b, bi) => {
      for (let i = 1; i <= fan; i++) {
        const isLast = l === levels
        const n = levels === 2 ? `${i}` : `${bi + 1}-${i}`
        next.push({
          name: isLast ? `Worker-${n}` : `Lead-${levels === 2 ? i : `${bi + 1}-${i}`}`,
          team,
          role: isLast
            ? `Worker: executes tasks from ${b.name} and reports back`
            : `Lead: splits work from ${b.name} among its own reports and reviews them`,
          level: l,
          boss: b.name,
          ...lv(l),
        })
      }
    })
    out.push(...next)
    tier = next
  }
  return out
}

// ASCII org chart: depth-first from the head, with guide lines.
const treeLines = (list: { name: string; boss: string }[]): { name: string; prefix: string }[] => {
  const kids = new Map<string, string[]>()
  for (const m of list) kids.set(m.boss, [...(kids.get(m.boss) ?? []), m.name])
  const out: { name: string; prefix: string }[] = []
  const walk = (name: string, guide: string, isLast: boolean, isRoot: boolean) => {
    out.push({ name, prefix: isRoot ? '' : guide + (isLast ? '└─ ' : '├─ ') })
    const c = kids.get(name) ?? []
    c.forEach((k, i) => walk(k, isRoot ? '' : guide + (isLast ? '   ' : '│  '), i === c.length - 1, false))
  }
  const names = new Set(list.map(m => m.name))
  list.filter(m => !names.has(m.boss)).forEach(m => walk(m.name, '', true, true))
  return out
}

// state -> [glyph, label, color]
const look = (s: string): [string, string, string] =>
  s === 'working' ? ['◐', 'working', 'yellow']
  : s === 'idle' ? ['●', 'idle', 'green']
  : s === 'asking' ? ['◆', 'asking', 'magenta']
  : s === 'starting' ? ['◌', 'starting', 'cyan']
  : s === 'offline' ? ['○', 'offline', 'gray']
  : s === 'failed' ? ['✗', 'failed', 'red']
  : s === 'closed' ? ['–', 'closed', 'gray']
  : s === 'unstarted' ? ['·', 'not yet', 'gray']
  : s === 'queued' ? ['○', 'queued', 'gray']
  : s === 'away' ? ['◌', 'away', 'gray']
  : s === 'unmanaged' ? ['◇', 'external', 'gray']
  : ['?', s.slice(0, 8), 'magenta']

// `cells` wide bar and the percent on one line; 0 cells is the percent alone
const bar = (pct: number, cells = 8): [string, string] => {
  const frame = (inner: string) => (cells > 0 ? `[${inner}] ` : '')
  if (pct < 0) return [`${frame('·'.repeat(cells))}  --`, 'gray']
  const f = Math.min(cells, Math.round((pct * cells) / 100))
  return [`${frame(`${'█'.repeat(f)}${'░'.repeat(cells - f)}`)}${String(pct).padStart(3)}%`, pct < 50 ? 'green' : pct < 80 ? 'yellow' : 'red']
}

const handleOf = (json: string): string => json.match(/term_[0-9a-f-]+/)?.[0] ?? ''

async function orca($: any, ...args: string[]) {
  const r = await $.process.run([await orcaBin($), ...args, '--json'], { timeoutMs: 120000 }).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
  return r.exitCode === 0
    ? { ok: true, out: r.stdout as string }
    : { ok: false, out: String(r.stderr || r.stdout) }
}

// The ANTHROPIC_DEFAULT_*_MODEL values of this configuration, read before each start command is built (see modelArg).
let envModels: EnvModels = {}
async function readEnvModels($: any): Promise<EnvModels> {
  const get = (p: Promise<string | undefined>) => p.then(v => v?.trim() || undefined).catch(() => undefined)
  const [opus, sonnet, haiku, fable] = await Promise.all([
    get($.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL')),
    get($.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL')),
    get($.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL')),
    get($.env.get('ANTHROPIC_DEFAULT_FABLE_MODEL')),
  ])
  return Object.fromEntries(Object.entries({ opus, sonnet, haiku, fable }).filter(([, v]) => v)) as EnvModels
}

const flags = (model?: string, effort?: string) => {
  const m = modelArg(model ?? '', envModels)
  // "[1m]" is a pattern to zsh: a name carrying it goes in double quotes (cmd.exe and bash take those too)
  return `${m ? ` --model ${/[[\]]/.test(m) ? `"${m}"` : m}` : ''}${effort && effort !== 'default' && effort !== 'keep' ? ` --effort ${effort}` : ''}`
}


// State kept across a hot reload may predate the team field: such members belong to the one team the old version knew.
const readMembers = async ($: any): Promise<Member[]> => {
  const fallback = (await read($, teamName)) || 'team'
  return (await read($, members)).map(m => ({ ...m, team: m.team || fallback }))
}

// Every session runs its own copy of this mod, so the teams live in one folder per project, inside the project:
// <project root>/.claude/team-orchestrator/. roster.json holds the structure (teams, bosses, roles) and, for each
// member, the status file it writes (statusFile); settings.json holds the team-wide worker settings; meta.json the schema
// stamp; changes/ the changes other sessions made, waiting for the team top; queue/ the messages waiting for room.
// Another project has its own folder. Live status is kept on each machine, outside the project (see readStatus).
const rootOf = async ($: any) => String(await $.session.root()).replace(/[\/]+$/, '')
const teamDir = async ($: any) => `${await rootOf($)}/.claude/team-orchestrator`
const teamFile = async ($: any) => `${await teamDir($)}/roster.json`
// the single file of versions before 0.5.0, migrated into the folder on first read
const oldTeamFile = async ($: any) => `${await rootOf($)}/.claude/team-orchestrator.json`

// An Orca workspace as Orca knows it now: whether it still exists, and its folder ('' when Orca gives none).
async function worktreeInfo($: any, id: string): Promise<{ exists: boolean; path: string }> {
  const r = await orca($, 'worktree', 'show', '--worktree', `id:${id}`)
  if (!r.ok) return { exists: false, path: '' }
  try {
    return { exists: true, path: String(JSON.parse(r.out).result?.worktree?.path ?? '') || pathInWorktreeId(id) }
  } catch {
    return { exists: true, path: pathInWorktreeId(id) }
  }
}

// The Orca workspace (worktree id) this session runs in (#68). The tab's own ORCA_WORKTREE_ID counts only while that
// workspace's folder contains the project root: after a /cd or a moved project it names the old one. Otherwise
// `orca worktree current`, run in the session's own folder, answers.
async function currentWorktree($: any): Promise<string> {
  // Orca names the workspace of the tab this session runs in; asking Orca by folder picks the wrong one when two
  // workspaces share a folder
  const own = String((await $.env.get('ORCA_WORKTREE_ID').catch(() => undefined)) ?? '').trim()
  if (own) {
    const root = await rootOf($)
    const inId = pathInWorktreeId(own)
    if (worktreeHolds(inId !== '' ? inId : (await worktreeInfo($, own)).path, root)) return own
  }
  const cur = await orca($, 'worktree', 'current')
  return cur.ok ? (cur.out.match(/"worktree":\s*\{\s*"id":\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? '').replace(/\\\\/g, '\\') : ''
}

// The workspace a member starts in (#68): its saved one while Orca still has it and it holds the project root; else the
// one this session finds, which the caller records on the member (from a session that is not the team top, through a
// change file, like every roster change). '' when neither is known.
async function memberWorktree($: any, m: Member): Promise<string> {
  if (m.worktree) {
    const i = await worktreeInfo($, m.worktree)
    if (i.exists && worktreeHolds(i.path, await rootOf($))) return m.worktree
  }
  return (await currentWorktree($)) || m.worktree || ''
}

// Before 0.5.0 the roster was one file, .claude/team-orchestrator.json. Its content moves into the folder once (a copy
// stays as roster.json.bak) and the old file is left as a pointer, so an old copy of the mod no longer reads it as a roster.
async function migrate($: any) {
  const [from, to] = [await oldTeamFile($), await teamFile($)]
  if ((await $.fs.exists(to)) || !(await $.fs.exists(from))) return
  const text = String(await $.fs.read(from))
  try {
    if (!Array.isArray(JSON.parse(text))) return
  } catch {
    return
  }
  await $.fs.write(to, text)
  await $.fs.write(`${await teamDir($)}/roster.json.bak`, text)
  await $.fs.write(from, JSON.stringify({ movedTo: '.claude/team-orchestrator/roster.json' }))
}

// The file sits inside the repo, so the first write of each load lists it in the repo's info/exclude: git then
// never offers it to a commit. git answers for a worktree (.git is a file there) and a subfolder; outside a repo it fails.
const excluded = new Set<string>()
async function exclude($: any) {
  const root = String(await $.session.root())
  if (excluded.has(root)) return
  excluded.add(root)
  const r = await $.process.run(['git', '-C', root, 'rev-parse', '--show-prefix', '--path-format=absolute', '--git-path', 'info/exclude']).catch(() => undefined)
  if (r?.exitCode !== 0) return
  const [prefix, path] = String(r.stdout).split(/\r?\n/)
  if (!path) return
  const line = `${prefix ?? ''}.claude/team-orchestrator/`
  const before = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
  if (before.split(/\r?\n/).some(l => l.trim().replace(/^\//, '') === line)) return
  await $.fs.write(path, `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${line}\n`)
}

// ── One writer (0.5.12, #59) and machines (#64), see changes.ts ──────────────────────────────────────────────
// Only the team top's session, on the top's machine, writes roster.json and settings.json. Every other session writes
// a change file (changes/<ms>-<rand>.json) with the fields it changed, and applies the change to its own view at once;
// every session reads the roster as the file plus the change files not yet applied, so all of them see the same team.
// The top folds the change files into the file on its next refresh (30 s at most) and lists them in changes/applied.json
// (the mod cannot delete a file). Until a team has a running top on this machine, a session that is not on the roster
// (the person's own) writes in its place; the first write of a new team is always direct.

// This machine's name, for each member's home machine and the top machine; '' when the platform gives none.
async function machineOf($: any): Promise<string> {
  const none = () => undefined
  return String((await $.env.get('COMPUTERNAME').catch(none)) || (await $.env.get('HOSTNAME').catch(none)) || '').trim()
}

const changesDir = async ($: any) => `${await teamDir($)}/changes`
const metaFile = async ($: any) => `${await teamDir($)}/meta.json`
const rand = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')

async function readJson($: any, path: string): Promise<any> {
  if (!(await $.fs.exists(path).catch(() => false))) return undefined
  try {
    return JSON.parse(String(await $.fs.read(path)))
  } catch {
    return undefined
  }
}

async function readMeta($: any): Promise<Meta> {
  const m = await readJson($, await metaFile($))
  return m && typeof m === 'object' && !Array.isArray(m) ? { ...META0, ...m } : META0
}

// A change file never changes once written, so each is read once per load.
const changeMemo = new Map<string, Change>()
type Pending = { name: string; change: Change }
async function readApplied($: any): Promise<string[]> {
  const v = await readJson($, `${await changesDir($)}/applied.json`)
  return Array.isArray(v?.names) ? v.names.filter((n: unknown): n is string => typeof n === 'string') : []
}

/** The change files not yet applied, oldest first. */
async function pendingChanges($: any): Promise<Pending[]> {
  const dir = await changesDir($)
  const now = Date.now()
  const names = ((await $.fs.list(dir).catch(() => [])) as any[])
    .filter(f => f.kind === 'file')
    .map(f => String(f.name))
    .filter(n => now - timeOf(n) <= KEEP_MS)
  if (names.length === 0) return []
  const out: Pending[] = []
  for (const n of pendingNames(names, new Set(await readApplied($)), now)) {
    let c = changeMemo.get(n)
    if (!c) {
      const v = await readJson($, `${dir}/${n}`)
      // one being written (or synced) right now is read next time
      if (!v || (v.kind !== 'roster' && v.kind !== 'settings')) continue
      c = v as Change
      changeMemo.set(n, c)
    }
    out.push({ name: n, change: c })
  }
  return out
}

async function markApplied($: any, names: string[]) {
  if (names.length === 0) return
  await $.fs.write(`${await changesDir($)}/applied.json`, JSON.stringify({ names: appliedAfter(await readApplied($), names, Date.now()) }, null, 1))
}

// The roster as this session last read it (the file plus the pending changes), and which change files that read
// included: a non-writer's change file holds only what differs from this base, field by field.
const seenRoster = { base: undefined as Partial<Member>[] | undefined, overlay: new Set<string>() }

/** The roster file's rows with the pending change files applied; undefined when there is no roster file. */
async function effective($: any): Promise<{ rows: Partial<Member>[]; applied: string[] } | undefined> {
  const file = await teamFile($)
  if (!(await $.fs.exists(file))) return undefined
  let saved: unknown
  try {
    saved = JSON.parse(String(await $.fs.read(file)))
  } catch {
    return undefined
  }
  if (!Array.isArray(saved)) return undefined
  const roster = (await pendingChanges($)).filter(c => c.change.kind === 'roster')
  return { rows: roster.length > 0 ? applyOps(saved as Partial<Member>[], rosterOps(roster)) : (saved as Partial<Member>[]), applied: roster.map(c => c.name) }
}

/**
 * Who writes the team files from this session:
 *  - top: the confirmed team top on the top's machine; standin: a session not on the roster while no top runs on this
 *    machine; boot: there is no roster file yet. These three write the files.
 *  - member: any other session; old: this mod is older than the one that last wrote the roster; away: the top machine
 *    is another PC. These write change files.
 */
type Role = 'top' | 'standin' | 'boot' | 'member' | 'old' | 'away'
type Writer = { role: Role; meta: Meta; here: string; me: string }
const writes = (r: Writer) => r.role === 'top' || r.role === 'standin' || r.role === 'boot'
// what this session has been told (once each); reset at each load
const told = { old: false, away: '', asked: false, declined: false }
// an AskUserQuestion was answered in the turn that is running: team_take_top needs the user's answer first
const turnAsk = { answered: false }

async function writerRole($: any, who?: Who): Promise<Writer> {
  await readVersion($)
  const meta = await readMeta($)
  const here = await machineOf($)
  const base = { meta, here, me: who?.me?.name ?? '' }
  if (olderThan(cfg.version, meta.writtenBy)) {
    if (!told.old) {
      told.old = true
      await $.ui.toast(
        `Team Orchestrator: this team's files were written by team-orchestrator ${meta.writtenBy}, newer than this session's ${cfg.version}. ` +
          'Update team-orchestrator and /reload-plugins. Until then this session writes no team file; its roster changes wait for the team top.',
      )
    }
    return { ...base, role: 'old' }
  }
  if (!(await $.fs.exists(await teamFile($)))) return { ...base, role: 'boot' }
  const list = await readMembers($)
  const w = who ?? (await identity($, list))
  const me = w.me?.name ?? ''
  const top = projectTop(list)
  const elsewhere = topElsewhere(meta, here)
  if (w.level === 'full' && w.me && top && keyOf(w.me) === keyOf(top)) {
    if (!elsewhere) return { ...base, me, role: 'top' }
    await topAway($, meta, here, true)
    return { ...base, me, role: 'away' }
  }
  if (w.level === 'none') {
    if (elsewhere) {
      await topAway($, meta, here, false)
      return { ...base, me, role: 'away' }
    }
    if (!(await topLive($, list, here))) return { ...base, me, role: 'standin' }
  }
  return { ...base, me, role: 'member' }
}

// The team top is running: its status on this machine is fresh, or this machine's registry lists its session. A top
// whose home is another PC counts as running: this PC does not stand in for it.
async function topLive($: any, list: Member[], here: string): Promise<boolean> {
  const top = projectTop(list)
  if (!top) return false
  if (isAway(top, here)) return true
  const s = await readStatus($, top.name)
  if (s && s.state !== 'closed' && Date.now() - s.heartbeat < STALE_MS) return true
  return !!top.sessionId && (await registry($)).some(r => r.sessionId === top.sessionId)
}

const takeAsk = (there: string, here: string) =>
  `TEAM ORCHESTRATOR, act now: the team top is recorded on ${there}, not on this PC (${here}). Until that changes this session ` +
  'writes no team file, closes no idle worker and delivers no queued message. Ask the user AT ONCE with AskUserQuestion whether this PC ' +
  `takes over as the team top, with two options: (1) "Take over on ${here}": the roster records this PC as the top's, and ${there} becomes read-only; ` +
  `(2) "Keep ${there}". Then apply the answer with team_take_top { take: true | false }.`

// The top machine is another PC: said once per session, and a top session's model is asked to check with the user.
async function topAway($: any, meta: Meta, here: string, isTop: boolean) {
  if (told.away !== meta.topMachine) {
    told.away = meta.topMachine
    await $.ui.toast(
      `Team Orchestrator: the team top runs on ${meta.topMachine}, not this PC (${here}). Here the team files are read-only: ` +
        `changes wait in changes/ for ${meta.topMachine}, and auto-close and the queue run there.` +
        (isTop ? ' You are asked whether this PC takes over.' : ' team_take_top moves the top here, once you say yes.'),
    )
  }
  if (isTop && !told.asked && !told.declined) {
    told.asked = true
    addNote(String(await $.session.id().catch(() => '')), takeAsk(meta.topMachine, here))
  }
}

// One writer at a time inside this session (a refresh and a Settings press may overlap).
const lock = { chain: Promise.resolve() as Promise<unknown> }
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.chain.then(fn, fn)
  lock.chain = run.catch(() => undefined)
  return run
}

const FRESH = { state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false }
const rowText = (list: Partial<Member>[]) =>
  JSON.stringify(list.map(m => Object.fromEntries(STRUCT.map(k => [k, k === 'statusFile' ? statusFile(String(m.name ?? '')) : (m as any)[k]]))), null, 1)

// Persist this session's roster: written by the writer, else as a change file. Role files follow either way.
// `who` is given by identity itself, which must not wait for its own answer.
async function share($: any, who?: Who) {
  await migrate($)
  const r = await writerRole($, who)
  await serial(() => (writes(r) ? writeRoster($, r) : writeChange($, r)))
  if (r.role !== 'old') await writeRoles($, await readMembers($))
}

// The writer: change files that arrived since this session last read the roster are applied on top of its own view,
// in time order, field by field; then the file is written and every pending change is listed as applied.
async function writeRoster($: any, r: Writer) {
  const pending = await pendingChanges($)
  const roster = pending.filter(c => c.change.kind === 'roster')
  const fresh = roster.filter(c => !seenRoster.overlay.has(c.name))
  let list = await readMembers($)
  if (fresh.length > 0) {
    list = applyOps(list, rosterOps(fresh)).map(m => ({ ...FRESH, ...m }) as Member)
    await update($, members, () => list)
  }
  const text = rowText(list)
  const file = await teamFile($)
  const before = (await $.fs.exists(file)) ? String(await $.fs.read(file)) : ''
  if (before !== text) {
    await exclude($)
    const prev = await readGrantRecord($, file)
    await $.fs.write(file, text)
    await writeGrantRecord($, file, recordAfterWrite(prev, grantMap(rowsOf(before)), grantMap(list)))
  }
  // the stamp: the newest mod version that wrote, and the top's machine (moved only by team_take_top once set)
  if (r.role === 'top') {
    const next = metaAfter(r.meta, cfg.version, r.here)
    const was = { schemaVersion: r.meta.schemaVersion, writtenBy: r.meta.writtenBy, topMachine: r.meta.topMachine }
    if (JSON.stringify(next) !== JSON.stringify(was) || !(await $.fs.exists(await metaFile($)))) await $.fs.write(await metaFile($), JSON.stringify(next, null, 1))
  }
  const settingsChanges = pending.filter(c => c.change.kind === 'settings')
  if (settingsChanges.length > 0) await writeSettingsFile($, applySettings(await readSettingsFile($), settingsChanges))
  await markApplied($, pending.map(c => c.name))
  const rights = rightsChanges(roster)
  if (rights.length > 0) await $.ui.toast(`Team Orchestrator: applied a change of rights made in another session: ${rights.join('; ')}.`)
  seenRoster.base = list.map(project)
  seenRoster.overlay = new Set()
}

async function writeChangeFile($: any, r: Writer, body: { kind: 'roster'; ops: any[] } | { kind: 'settings'; patch: Partial<TeamSettings> }) {
  const at = Date.now()
  const name = fileName(at, rand())
  const sid = String(await $.session.id().catch(() => ''))
  const c = { v: 1, ...body, at, by: { session: sid, member: r.me, machine: r.here, version: cfg.version } } as Change
  await $.fs.write(`${await changesDir($)}/${name}`, JSON.stringify(c, null, 1))
  changeMemo.set(name, c)
  // this session's view has it already: as the writer later, it does not apply it again over newer edits
  seenRoster.overlay.add(name)
}

// Everyone else: what this session changed since it last read the roster, as one change file. Its own view keeps the
// change (it was made there first), and the next read shows the same, since every read applies pending change files.
async function writeChange($: any, r: Writer) {
  const list = await readMembers($)
  const base = seenRoster.base ?? (await effective($))?.rows ?? []
  const ops = diffOps(base, list)
  if (ops.length === 0) return
  await writeChangeFile($, r, { kind: 'roster', ops })
  seenRoster.base = list.map(project)
}

// ── Grants changed outside the mod (#58) ──
// What the mod last wrote for each member's Allow writes and Allow subagents, per roster file: in $.store, which every
// session of this machine shares, with this session's own copy as the fallback. The team top's refresh compares the
// file with it (checkGrants). Reported only, never reverted.
const grantMemo = new Map<string, GrantMap>()
const grantKey = (file: string) => `grants:${file.replace(/\\/g, '/').toLowerCase()}`
async function readGrantRecord($: any, file: string): Promise<GrantMap | undefined> {
  const v = await $.store.get(grantKey(file)).catch(() => undefined)
  return v && typeof v === 'object' ? (v as GrantMap) : grantMemo.get(grantKey(file))
}
async function writeGrantRecord($: any, file: string, g: GrantMap) {
  grantMemo.set(grantKey(file), g)
  await $.store.set(grantKey(file), g).catch(() => undefined)
}
const rowsOf = (text: string): Partial<Member>[] => {
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// A difference is reported once it shows on two refreshes in a row (a write by another session's mod, caught between
// its file and its record, is gone by the next one), and each difference once.
const tamper = { last: '', told: new Set<string>() }
const TAMPER_NOTE = 'roster.json changed outside the mod'
async function checkGrants($: any) {
  const file = await teamFile($)
  if (!(await $.fs.exists(file))) return
  const now = grantMap(rowsOf(String(await $.fs.read(file))))
  const rec = await readGrantRecord($, file)
  if (!rec) return void (await writeGrantRecord($, file, now))
  const diff = grantChanges(rec, now)
  const sig = JSON.stringify(diff)
  const twice = sig === tamper.last
  tamper.last = sig
  if (diff.length === 0 || !twice || tamper.told.has(sig)) return
  tamper.told.add(sig)
  const say = diff.map(d => `${d.name}: ${d.changes.join(', ')}`).join('; ')
  await $.ui.toast(`Team Orchestrator: ${TAMPER_NOTE} (${say}). Nothing was reverted; check Settings → Allow writes / Allow subagents.`)
  await update($, members, old =>
    old.map(m => {
      const d = diff.find(x => x.key === keyOf(m))
      if (!d) return m
      const kept = m.note.split(', ').filter(p => p !== '' && !p.startsWith(TAMPER_NOTE))
      return { ...m, note: [...kept, `${TAMPER_NOTE}: ${d.changes.join(', ')}`].join(', ') }
    }),
  )
}

// Each member's role file (roles.ts): the generated part follows the roster, the person's notes below the marker stay.
// A file is read and written only when its generated part changed since this session last wrote or checked it.
const roleSeen = new Map<string, string>()
async function writeRoles($: any, list: Member[]) {
  const dir = await teamDir($)
  for (const m of list) {
    const generated = roleText(m, orgOf(list, m.team))
    const path = `${dir}/${roleFile(m.name)}`
    if (roleSeen.get(path) === generated) continue
    const before = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : undefined
    const after = mergeRole(before, generated)
    if (after !== before) await $.fs.write(path, after)
    roleSeen.set(path, generated)
  }
}

// The command that starts a member: its role pointer in the system prompt, and an optional first prompt. A shell types
// it (cmd.exe on Windows, bash or zsh elsewhere), so the texts go in double quotes and carry nothing a shell would
// expand (pointer() and WELCOME see to that). The name is quoted too: unquoted, "Mod Builder 2" splits into --name Mod
// and a first prompt "Builder".
const startCmd = (m: Member, list: Member[], sessionId: string, resume: boolean, name = m.name, model = m.model, effort = m.effort, first = '') =>
  `claude ${resume ? `--resume ${sessionId}` : `--session-id ${sessionId}`} --name "${name}"${flags(model, effort)}` +
  ` --append-system-prompt "${pointer({ ...m, name }, list)}"${first ? ` "${first}"` : ''}`

// The roster as every session sees it: the file plus the change files not yet applied (see share).
async function pull($: any) {
  await migrate($)
  const eff = await effective($)
  // an empty list is a real state (the last team was removed), not a missing file
  if (!eff) return
  const saved = eff.rows
  seenRoster.base = saved.map(project)
  seenRoster.overlay = new Set(eff.applied)
  const fresh = { state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '' }
  await update($, members, old =>
    saved.map(m => {
      const o = old.find(x => x.name === m.name && (x.team || m.team) === m.team)
      // a member that never started shows so in every session, whatever state this one last saw
      return { ...fresh, ...(o ?? {}), ...m, sel: o?.sel ?? false, ...(m.pending ? { state: 'unstarted' } : {}) } as Member
    }),
  )
}

// The one-time briefing: structure, reporting line and communication rules, sent once per session.
const briefText = (m: Member, list: Member[], team: string): string => {
  const kids = list.filter(x => x.boss === m.name)
  const isManager = kids.length > 0
  const peers = list.filter(x => x.name !== m.name && list.some(k => k.boss === x.name))
  const addr = (x: Member) => `"${x.address || x.name}"`
  const roster = list.map(x => `${x.address || x.name} (${x.level === 1 ? 'head' : list.some(k => k.boss === x.name) ? 'lead' : 'worker'}, reports to ${x.boss})`).join('; ')
  const rules = isManager
    ? `YOUR JOB: you ORCHESTRATE. You decide, plan and instruct only; you do NOT execute tasks yourself, you delegate execution to your direct reports and review what they send back. ` +
      `Your direct reports: ${kids.map(addr).join(', ')}. ` +
      (m.boss === 'user' ? 'You report to the user. ' : `Your boss: ${m.boss}. `) +
      `COMMUNICATION: you may message your boss, your direct reports, and any other head or lead in any department` +
      (peers.length ? ` (${peers.map(addr).join(', ')})` : '') +
      `. Do not bypass a lead to instruct someone else's worker. ` +
      `Message your direct reports with the team_message tool (mcp__team-orchestrator__team_message, { to: "<name>", message: "..." }), not SendMessage: a report may not have started yet or may have been closed while idle, and team_message starts it, briefs it and then delivers.`
    : `YOUR JOB: you EXECUTE the tasks your direct boss gives you and report results back. Your direct boss (one level up): ${m.boss}. ` +
      `COMMUNICATION: talk ONLY to your direct boss. Do NOT message your boss's boss, other leads, or other workers. ` +
      `Worker-to-worker contact is forbidden unless your boss explicitly names that worker to you in a message.`
  return (
    `TEAM BRIEFING (one-time, from the Team Orchestrator). You are ${m.name} in team "${m.team}". Role: ${m.role}. ${rules} ` +
    `Team structure: ${roster}. ` +
    `TEAM FILES: the team lives in .claude/team-orchestrator/ in the project. roster.json is the structure (teams, bosses, roles) and settings.json the team's worker settings; only the team top's session writes them, and a change made in any other session waits in changes/ until the top applies it. Never edit roster.json, settings.json, meta.json or changes/ by hand. Each member's live status (state, task, model, context, last "clean") is written by the Team Orchestrator for its own session, on its own PC under ~/.claude/team-orchestrator/; never edit another member's status file. ` +
    `To message a teammate use the SendMessage tool (Claude Code's native agent messaging), e.g. SendMessage({ to: "<their name>", message: "..." }), where the name is the quoted name shown above or in the structure list. If SendMessage says the name is ambiguous or unknown and the person is on the team, use team_message with the plain name instead (it addresses that member's own session by its id: never a same-named session of another project, never a Remote Control copy). Do NOT use orca terminal send or the terminal for messages to teammates. ` +
    `Now reply with exactly "Noted" plus one short line restating your role and reporting line, then wait for instructions.`
  )
}

async function briefTeam($: any, team: string, only?: Set<string>) {
  const all: Member[] = await readMembers($)
  const mine = all.filter(m => m.team === team)
  // the briefing lists the team and every boss above it, so a head learns who its CEO is
  const list = orgOf(all, team)
  const sent = new Set<string>()
  // a member on another PC has its tab there: its handle means nothing here
  const here = await machineOf($)
  await Promise.all(
    mine
      .filter(m => m.handle && !isAway(m, here) && isManaged(m) && (!only || only.has(keyOf(m))))
      .map(async m => {
        const r = await orca($, 'terminal', 'send', '--terminal', m.handle, '--text', briefText(m, list, team), '--enter')
        if (r.ok) sent.add(m.name)
      }),
  )
  await update($, members, old => old.map(m => ((m.team || 'team') === team && sent.has(m.name) ? { ...m, briefed: true, noted: false } : m)))
  await share($)
}

// ── Transcripts: <config dir>/projects/<project>/<session id>.jsonl ──────────────────────────────────────────
// Only these things are taken from a transcript: its last customTitle, its last requestedModel, and the last assistant
// message's model, usage (as a context percent), effort and cwd. Nothing else is kept or shown: a transcript can hold
// secrets.
type Transcript = { id: string; path: string; mtimeMs: number }
/** requested: the last model asked for, as typed ('' unknown); used: the tokens the last answer was given over */
type Stats = { model: string; requested: string; used: number; ctx: number; effort: string; cwd: string }

// Every transcript, newest first.
async function transcripts($: any): Promise<Transcript[]> {
  const none = () => undefined
  const home = (await $.env.get('USERPROFILE').catch(none)) || (await $.env.get('HOME').catch(none))
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(none)) || (home ? `${home}/.claude` : '')
  if (!dir) return []
  const root = `${dir}/projects`
  const projects = ((await $.fs.list(root).catch(() => [])) as any[]).filter(p => p.kind === 'dir')
  const lists = await Promise.all(projects.map(async p => ((await $.fs.list(`${root}/${p.name}`).catch(() => [])) as any[]).map(f => ({ ...f, dir: `${root}/${p.name}` }))))
  return lists
    .flat()
    .filter(f => f.kind === 'file' && /^[0-9a-f-]{36}\.jsonl$/.test(f.name))
    .map(f => ({ id: f.name.slice(0, 36), path: `${f.dir}/${f.name}`, mtimeMs: f.mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// The last TAIL bytes of each file, '' for one it cannot read: one PowerShell per 15 files, since stdout holds
// 4 MiB, and $.fs.read takes a whole file (at most 4 MiB) where a transcript can be far larger.
const TAIL = 256 * 1024
const TAIL_PS =
  "$o=[Console]::OpenStandardOutput(); foreach($p in $env:TO_FILES -split '\\|'){ $o.WriteByte(0); try { $f=[IO.File]::Open($p,'Open','Read','ReadWrite'); try { $k=[Math]::Min([long]$env:TO_BYTES,$f.Length); [void]$f.Seek(-$k,'End'); $b=New-Object byte[] $k; $o.Write($b,0,$f.Read($b,0,$k)) } finally { $f.Close() } } catch {} }; $o.Flush()"
// the same on macOS and Linux: tail -c per file, each preceded by a NUL
const TAIL_SH = 'for p in "$@"; do printf "\\0"; tail -c "$TO_BYTES" "$p" 2>/dev/null; done'
async function tails($: any, files: string[]): Promise<string[]> {
  const out: string[] = []
  const win = await isWindows($)
  for (let i = 0; i < files.length; i += 15) {
    const part = files.slice(i, i + 15)
    const cmd = win ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', TAIL_PS] : ['sh', '-c', TAIL_SH, 'sh', ...part]
    const r = await $.process
      .run(cmd, { env: { TO_FILES: part.join('|'), TO_BYTES: String(TAIL) }, timeoutMs: 60000 })
      .catch(() => undefined)
    const got = r?.exitCode === 0 ? String(r.stdout).split('\0').slice(1) : []
    out.push(...part.map((_, j) => got[j] ?? ''))
  }
  return out
}

const lastTitle = (text: string): string | undefined => {
  const hit = [...text.matchAll(/"customTitle":("(?:[^"\\]|\\.)*")/g)].pop()
  try {
    return hit ? String(JSON.parse(hit[1] as string)) : undefined
  } catch {
    return undefined
  }
}

// The model the member asked for (#63): the last requestedModel of its own loop, as typed ([1m] and a gateway's name
// kept, /model switches followed); message.model drops [1m] and may be a gateway's own id. '' when the tail has none.
const lastRequested = (text: string): string => {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i] as string
    if (!l.includes('"requestedModel"')) continue
    try {
      const d = JSON.parse(l)
      if (!d?.isSidechain && typeof d?.requestedModel === 'string' && d.requestedModel.trim() !== '') return d.requestedModel.trim()
    } catch {
      // a line cut by the tail
    }
  }
  return ''
}

// The model is the one asked for (else the one that answered), kept as typed. The context percent counts against
// windowFor's guess (200k unless [1m] or past 200k); the roster uses the member's own reported window when it has one.
const lastStats = (text: string): Stats | undefined => {
  const lines = text.split('\n')
  const requested = lastRequested(text)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i] as string
    if (!l.includes('"type":"assistant"')) continue
    let d: any
    try {
      d = JSON.parse(l)
    } catch {
      continue
    }
    const u = d?.message?.usage
    const model = String(d?.message?.model ?? '')
    if (d?.type !== 'assistant' || d.isSidechain || !u || model === '' || model === '<synthetic>') continue
    const used = Number(u.input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0)
    return {
      model: requested || model,
      requested,
      used,
      ctx: Math.round((used * 100) / windowFor(requested || model, used)),
      effort: typeof d.effort === 'string' ? d.effort : '',
      cwd: typeof d.cwd === 'string' ? d.cwd : '',
    }
  }
  return undefined
}

// What each transcript's tail said, kept until the file changes, so a refresh reads only the files that moved.
const seen = new Map<string, { mtimeMs: number; title?: string; stats?: Stats }>()
async function peek($: any, files: Transcript[]) {
  const stale = files.filter(f => seen.get(f.path)?.mtimeMs !== f.mtimeMs)
  const texts = await tails($, stale.map(f => f.path))
  stale.forEach((f, i) => seen.set(f.path, { mtimeMs: f.mtimeMs, title: lastTitle(texts[i] ?? ''), stats: lastStats(texts[i] ?? '') }))
  return files.map(f => seen.get(f.path)!)
}

// Session id per name: the newest transcript of THIS project whose last customTitle is that name. A transcript that
// last ran outside the project folder is another team's, even when it carries the same title.
async function sessionsNamed($: any, all: Transcript[], names: string[], root: string): Promise<Map<string, string>> {
  const want = new Set(names)
  const found = new Map<string, string>()
  for (let i = 0; i < all.length && found.size < want.size; i += 15) {
    const part = all.slice(i, i + 15)
    ;(await peek($, part)).forEach((s, j) => {
      const cwd = s.stats?.cwd ?? ''
      if (cwd !== '' && !under(cwd, root)) return
      if (s.title !== undefined && want.has(s.title) && !found.has(s.title)) found.set(s.title, (part[j] as Transcript).id)
    })
  }
  return found
}

async function statsOf($: any, all: Transcript[], ids: string[]): Promise<Map<string, Stats | undefined>> {
  const files = all.filter(t => ids.includes(t.id))
  const got = await peek($, files)
  return new Map(files.map((f, i) => [f.id, got[i]?.stats]))
}

// The model a member last asked for in its own transcript, as typed ([1m] kept); '' when there is none (#63).
async function requestedModel($: any, m: Member): Promise<string> {
  if (!m.sessionId) return ''
  const st = (await statsOf($, await transcripts($), [m.sessionId]).catch(() => undefined))?.get(m.sessionId)
  return st?.requested ?? ''
}

// ── Who this session is (identity.ts) ──
// The tab, the session id and the name are matched against the roster by identify(); the answer is worked out once
// per refresh and kept while the session id and the roster's identity fields stay the same, so a tool call does not
// read the registry or a transcript.
type Reg = { sessionId: string; cwd: string; name: string; pid: number }
// The machine's session registry: <config dir>/sessions/<pid>.json, one per live local session. Only the id, the
// folder, the name and the process id are taken; the .key files beside them are never read. ok: some registry folder
// could be listed, so an empty answer means "no session", not "unreadable" (the crash check of 0.5.16 needs the difference).
async function readRegistry($: any): Promise<{ ok: boolean; list: Reg[] }> {
  const out: Reg[] = []
  let ok = false
  for (const dir of [...new Set(await claudeDirs($))]) {
    const at = `${dir}/sessions`
    let listed: any[]
    try {
      listed = (await $.fs.list(at)) as any[]
      ok = true
    } catch {
      continue
    }
    const files = listed.filter(f => f.kind === 'file' && /^\d+\.json$/.test(String(f.name)))
    for (const f of files) {
      try {
        const o = JSON.parse(String(await $.fs.read(`${at}/${f.name}`)))
        const pid = Number.isInteger(o?.pid) && o.pid > 0 ? (o.pid as number) : Number(String(f.name).replace(/\.json$/, ''))
        if (typeof o?.sessionId === 'string') out.push({ sessionId: o.sessionId, cwd: String(o.cwd ?? ''), name: typeof o.name === 'string' ? o.name : '', pid })
      } catch {
        // a record being rewritten: skip it this time
      }
    }
  }
  return { ok, list: out }
}
const registry = async ($: any): Promise<Reg[]> => (await readRegistry($)).list

type Who = { me?: Member; level: Level; why: string }
const NOBODY: Who = { level: 'none', why: '' }
const sigOf = (list: Member[]) => list.map(m => [m.team, m.name, m.address ?? '', m.handle, m.sessionId, m.boss, m.machine ?? ''].join('|')).join('\n')
const self = {
  cur: undefined as undefined | { id: string; sig: string; key: string; level: Level; why: string },
  busy: undefined as undefined | Promise<Who>,
}
// the one-time note this session's next prompt carries: the role-file pointer after a re-attach, or the hold notice
// (or the question about taking over the team top); several notes for one session ride together
let pendingNote: { id: string; text: string } | undefined
const addNote = (id: string, text: string) => {
  pendingNote = pendingNote && pendingNote.id === id ? (pendingNote.text.includes(text) ? pendingNote : { id, text: `${pendingNote.text}\n\n${text}` }) : { id, text }
}

async function identity($: any, list0?: Member[]): Promise<Who> {
  const list = list0 ?? (await readMembers($))
  if (list.length === 0) return NOBODY
  const id = String(await $.session.id().catch(() => ''))
  const c = self.cur
  if (c && c.id === id && c.sig === sigOf(list)) {
    if (c.level === 'none') return NOBODY
    const me = list.find(m => keyOf(m) === c.key)
    if (me) return { me, level: c.level, why: c.why }
  }
  if (!self.busy) self.busy = identifyNow($, list, id).finally(() => void (self.busy = undefined))
  return self.busy
}

async function identifyNow($: any, list: Member[], id: string): Promise<Who> {
  const none = () => undefined
  const tab = String((await $.env.get('ORCA_TERMINAL_HANDLE').catch(none)) ?? '').trim()
  const here = await machineOf($)
  const root = await rootOf($)
  const reg = id ? await registry($) : []
  const mine = reg.filter(r => r.sessionId === id)
  const local = mine.some(r => under(r.cwd, root))
  let name = mine.find(r => r.name !== '')?.name ?? ''
  if (name === '' && id !== '') {
    const own = (await transcripts($)).filter(t => t.id === id)
    if (own.length > 0) name = (await peek($, own))[0]?.title ?? ''
  }
  // of the members this session might be, the ones running elsewhere: another live session holds their id, or their
  // own tab is open (Orca is asked only about those members, and only when this tab does not settle it)
  const others = new Set(reg.filter(r => r.sessionId !== id).map(r => r.sessionId))
  const live = new Set<string>()
  for (const m of list) {
    // a member from another PC: its tab and its registry are that PC's, never asked about here
    if (isAway(m, here)) continue
    if (!((id !== '' && m.sessionId === id) || (name !== '' && namesOf(m).includes(name)))) continue
    if (m.sessionId && m.sessionId !== id && others.has(m.sessionId)) live.add(keyOf(m))
    else if (m.handle && m.handle !== tab && (await showTab($, m.handle))) live.add(keyOf(m))
  }
  const r = identify({ list, facts: { tab, sessionId: id, name }, local, live, here })
  const me = r.member
  if (r.changed && me) {
    if (r.renamedFrom) await moveFiles($, r.renamedFrom, me.name)
    await update($, members, () => r.list)
    await share($, { me, level: r.level, why: r.why })
    if (r.renamedFrom) await $.ui.toast(`Team Orchestrator: ${r.renamedFrom} is now ${me.name} (renamed).`)
  }
  if (r.reattached && me) addNote(id, roleNote(me))
  if (r.level === 'restricted' && me) await holdOnce($, me, r.why, { sessionId: id, tab, name, machine: here })
  self.cur = { id, sig: sigOf(r.list), key: me ? keyOf(me) : '', level: r.level, why: r.why }
  return { me, level: r.level, why: r.why }
}

// A relabelled member's files follow its new name: the role file (the person's notes in it kept) and the status file.
// The old files are left as pointers to the new ones.
async function moveFiles($: any, from: string, to: string) {
  const dir = await teamDir($)
  const [ro, rn] = [`${dir}/${roleFile(from)}`, `${dir}/${roleFile(to)}`]
  if (ro !== rn && (await $.fs.exists(ro))) {
    if (!(await $.fs.exists(rn))) await $.fs.write(rn, String(await $.fs.read(ro)))
    await $.fs.write(ro, `# ${from} was renamed\n\n${from} is now ${to}. Its role file is .claude/team-orchestrator/${roleFile(to)}.\n`)
    roleSeen.delete(ro)
  }
  const s = await readStatus($, from)
  if (s && statusFile(from) !== statusFile(to)) {
    await $.fs.write(await statusPath($, to), JSON.stringify({ ...s, name: to }, null, 1))
    await $.fs.write(await statusPath($, from), JSON.stringify({ name: from, movedTo: statusFile(to) }, null, 1))
  }
}

// Held sessions waiting for the user's decision, one per session id: <team folder>/claims.json.
const claimsFile = async ($: any) => `${await teamDir($)}/claims.json`
async function readClaims($: any): Promise<Claim[]> {
  const p = await claimsFile($)
  if (!(await $.fs.exists(p))) return []
  try {
    const c = JSON.parse(String(await $.fs.read(p)))
    return Array.isArray(c) ? c : []
  } catch {
    return []
  }
}
const writeClaims = async ($: any, c: Claim[]) => $.fs.write(await claimsFile($), JSON.stringify(c, null, 1))

// Once per session id: record the claim, warn the member's head, and tell the team top to ask the user at once.
async function holdOnce($: any, x: Member, why: string, f: { sessionId: string; tab: string; name: string; machine: string }) {
  const claims = await readClaims($)
  if (claims.some(c => c.sessionId === f.sessionId)) return
  const c: Claim = { sessionId: f.sessionId, member: x.name, team: x.team, tab: f.tab, name: f.name, why, at: Date.now(), ...(f.machine ? { machine: f.machine } : {}) }
  await writeClaims($, [...claims, c])
  addNote(f.sessionId, holdNote(x, why))
  const list = await readMembers($)
  const head = x.boss === 'user' ? undefined : (list.find(m => m.team === x.team && m.name === x.boss) ?? list.find(m => m.name === x.boss))
  const top = topOf(list, x)
  const say = async (to: Member | undefined, text: string) => {
    if (!to?.sessionId) return false
    const r: any = await $.session.send({ to: { sessionId: to.sessionId }, text }).catch(() => undefined)
    return !!r?.isDelivered
  }
  const told: string[] = []
  const ask = topAsk(c, x.boss === 'user' ? x.name : x.boss)
  if (head && top && keyOf(head) === keyOf(top)) {
    if (await say(top, `${headWarning(c)}\n\n${ask}`)) told.push(top.name)
  } else {
    if (head && (await say(head, headWarning(c)))) told.push(head.name)
    if (top && (await say(top, ask))) told.push(top.name)
  }
  await $.ui.toast(
    `Team Orchestrator: this session is on hold; it looks like ${x.name} but is not confirmed. ` +
      (told.length > 0 ? `Told ${told.join(' and ')}.` : 'Nobody on the team could be told: tell the team top yourself.'),
  )
}

// The team top applies the user's answer to a held session (member_claim).
async function settleClaim($: any, input: { sessionId?: string; decision?: string; member?: string }): Promise<string> {
  const claims = await readClaims($)
  const c = claims.find(x => x.sessionId === String(input.sessionId ?? '').trim())
  if (!c) return `No session ${String(input.sessionId ?? '')} is waiting for an identity decision.`
  const decision = String(input.decision ?? '')
  if (decision !== 'is' && decision !== 'new' && decision !== 'reject') return 'decision must be "is", "new" or "reject".'
  const list = await readMembers($)
  const wanted = String(input.member ?? '').trim() || c.member
  const x = list.find(m => m.team === c.team && (m.name === wanted || m.address === wanted)) ?? list.find(m => m.name === wanted || m.address === wanted)
  if (!x && decision !== 'reject') return `No member "${wanted}" on the roster.`
  const tell = (text: string) => $.session.send({ to: { sessionId: c.sessionId }, text }).catch(() => undefined)
  // whoever held the session's id or tab lets go of it
  const letGo = (m: Member) => ({ ...m, ...(m.sessionId === c.sessionId ? { sessionId: '' } : {}), ...(c.tab && m.handle === c.tab ? { handle: '' } : {}) })
  let out = `Rejected: session ${c.sessionId} stays on hold and off the team.`
  if (decision === 'reject' || !x) {
    await tell('TEAM ORCHESTRATOR: the user did not take this session onto the team. It stays on hold: no writes, no subagents, no team tools.')
  } else if (decision === 'is') {
    let next = list.map(m => (m === x ? { ...m, sessionId: c.sessionId, ...(c.tab ? { handle: c.tab } : {}), ...(c.machine ? { machine: c.machine } : {}) } : letGo(m)))
    let name = x.name
    if (c.name && !namesOf(x).includes(c.name) && !nameTaken(list, c.name, x)) {
      next = relabel(next, keyOf(x), c.name)
      await moveFiles($, x.name, c.name)
      name = c.name
    }
    await update($, members, () => next)
    out = `Session ${c.sessionId} is ${name} of team ${x.team}: the roster took its id${c.tab ? ', tab' : ''} and name.`
    await tell(`TEAM ORCHESTRATOR: the user confirmed it. ${roleNote({ ...x, name })}`)
  } else {
    const boss = x.boss === 'user' ? x : (list.find(m => m.team === x.team && m.name === x.boss) ?? x)
    const name = freshName(list, c.name, x.name)
    const added: Member = {
      team: x.team, name, address: name, role: 'worker', level: boss.level + 1, boss: boss.name, handle: c.tab, sessionId: c.sessionId,
      state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false, statusFile: statusFile(name), location: 'local',
      ...(c.machine ? { machine: c.machine } : {}),
    }
    await update($, members, () => [...list.map(letGo), added])
    out = `Added ${name} to team ${x.team} as a worker under ${boss.name}, with its own role file.`
    await tell(`TEAM ORCHESTRATOR: the user added this session to the team as a new member. ${roleNote(added)}${name !== c.name ? ` Run /rename ${name} so teammates reach you by that name.` : ''}`)
  }
  await writeClaims($, claims.map(x => (x.sessionId === c.sessionId ? { ...x, decision: decision as Claim['decision'] } : x)))
  await share($)
  self.cur = undefined
  return out
}

// A team tool asked by a held session: refused with a sentence that says why.
async function onHold($: any, tool: string): Promise<any> {
  await pull($)
  const w = await identity($)
  return w.level === 'restricted' && w.me ? { deny: holdTool(tool, w.me, w.why) } : undefined
}

// The person's own Claude config folders: where a memory folder lives (<dir>/projects/<project>/memory/).
async function claudeDirs($: any): Promise<string[]> {
  const none = () => undefined
  const home = (await $.env.get('USERPROFILE').catch(none)) || (await $.env.get('HOME').catch(none))
  const custom = await $.env.get('CLAUDE_CONFIG_DIR').catch(none)
  return [custom, home ? `${home}/.claude` : ''].filter((x): x is string => !!x)
}

// Whether this session is the one that polls Orca for the roster (see refresh).
// A held session never polls: it does no roster work until the user decides.
async function pollsOrca($: any, list: Member[]): Promise<boolean> {
  const w = await identity($, list)
  return w.level !== 'restricted' && shouldPoll(w.level === 'full' ? w.me : undefined)
}

// This session's roster entry and the roster, or undefined when the session is not a member.
async function rosterSelf($: any): Promise<{ me: Member; list: Member[] } | undefined> {
  await pull($)
  const list = await readMembers($)
  if (list.length === 0) return undefined
  // only a session confirmed as the member: a held one writes no status and gets no notes under its name
  const w = await identity($, list)
  return w.level === 'full' && w.me ? { me: w.me, list } : undefined
}

// ── Member status files (see status.ts) ────────────────────────────────────────────────────────────────────
// From 0.5.12 (#64) status files live on the machine, never in the project folder (which may be synced between PCs):
// <claude config dir>/team-orchestrator/<project key>/status/<name>.json. That removes most of the team's file traffic
// from a synced folder, and every sync-lag and clock-skew error with it.
async function configDir($: any): Promise<string> {
  const none = () => undefined
  const home = (await $.env.get('USERPROFILE').catch(none)) || (await $.env.get('HOME').catch(none))
  return String((await $.env.get('CLAUDE_CONFIG_DIR').catch(none)) || (home ? `${home}/.claude` : '')).replace(/[\\/]+$/, '')
}
async function machineDir($: any): Promise<string> {
  const dir = await configDir($)
  return dir ? `${dir}/team-orchestrator/${projectKey(await rootOf($))}` : await teamDir($)
}
const statusPath = async ($: any, name: string) => `${await machineDir($)}/${statusFile(name)}`

// A status file of an older version, in the project folder, is read once per member and session and copied here.
const statusMigrated = new Set<string>()
async function readStatus($: any, name: string): Promise<Status | undefined> {
  const p = await statusPath($, name)
  if (await $.fs.exists(p)) {
    try {
      return JSON.parse(String(await $.fs.read(p))) as Status
    } catch {
      return undefined
    }
  }
  if (statusMigrated.has(p)) return undefined
  statusMigrated.add(p)
  const old = `${await teamDir($)}/${statusFile(name)}`
  if (old === p || !(await $.fs.exists(old))) return undefined
  try {
    const s = JSON.parse(String(await $.fs.read(old)))
    if (!s || typeof s !== 'object' || typeof s.heartbeat !== 'number') return undefined
    await $.fs.write(p, JSON.stringify(s, null, 1))
    return s as Status
  } catch {
    return undefined
  }
}

// Members of this machine only: a member from another PC writes its status there.
async function readStatuses($: any, list0: Member[]): Promise<Map<string, Status>> {
  const here = await machineOf($)
  const list = list0.filter(m => !isAway(m, here))
  const got = await Promise.all(list.map(async m => [m.name, await readStatus($, m.name)] as const))
  return new Map(got.filter((x): x is readonly [string, Status] => !!x[1]))
}

// A member writes only its own file. The one exception: the team top marks a worker it closed as "closed".
async function writeStatusOf($: any, m: Member, patch: Partial<Status>) {
  const now = Date.now()
  const old = (await readStatus($, m.name)) ?? { name: m.name, sessionId: m.sessionId, state: 'idle', heartbeat: now }
  await $.fs.write(await statusPath($, m.name), JSON.stringify({ ...old, ...patch, name: m.name }, null, 1))
}

// Every caller fires it without waiting, so it never throws: a missed heartbeat is written by the next one.
async function writeMine($: any, patch: Partial<Status>) {
  try {
    const who = await rosterSelf($)
    if (!who) return
    const sessionId = String(await $.session.id().catch(() => '')) || who.me.sessionId
    // a session that is writing is running: a "closed" left in its file is stale
    const old = await readStatus($, who.me.name)
    const revive = old?.state === 'closed' && patch.state === undefined ? { state: 'idle' } : {}
    await writeStatusOf($, who.me, { ...revive, ...patch, sessionId, heartbeat: Date.now() })
  } catch {
    // the session is closing, or the team folder is not writable just now
  }
}

// Count this session's own leftover shells and runtimes, found under the claude process whose command line carries the
// session id (PowerShell on Windows, ps elsewhere). At most once per five minutes; -1 when the session cannot be found.
const counted = { at: 0 }
async function countLeftovers($: any, sessionId: string): Promise<number | undefined> {
  if (!sessionId || Date.now() - counted.at < COUNT_EVERY_MS) return undefined
  counted.at = Date.now()
  if (!(await isWindows($))) {
    const r = await $.process.run(['ps', '-eo', 'pid=,ppid=,args='], { timeoutMs: 20000 }).catch(() => undefined)
    return r?.exitCode === 0 ? countFromPs(String(r.stdout), sessionId) : -1
  }
  const ps =
    `$all=Get-CimInstance Win32_Process; $me=$all|?{$_.Name -eq 'claude.exe' -and [string]$_.CommandLine -match '${sessionId}'}|select -First 1; ` +
    `if(-not $me){'-1';exit}; $ids=@{}; $all|%{$ids[[int]$_.ProcessId]=$_}; $n=0; ` +
    `foreach($p in $all){ if($p.Name -notmatch '^(bash|sh|node|python.*|conhost)\\.exe$'){continue}; $x=$p; ` +
    `for($i=0;$i -lt 8;$i++){ $q=$ids[[int]$x.ParentProcessId]; if(-not $q){break}; if($q.ProcessId -eq $me.ProcessId){$n++;break}; $x=$q } }; $n`
  const r = await $.process.run(['powershell.exe', '-NoProfile', '-Command', ps], { timeoutMs: 20000 }).catch(() => undefined)
  const n = Number(String(r?.stdout ?? '').trim())
  return Number.isFinite(n) ? n : -1
}

// ── Team settings (worker auto-close), shared by every session in .claude/team-orchestrator/settings.json ──
// Like the roster, the file has one writer (the team top); a change made in any other session waits as a change file,
// and every session reads the file with those changes applied.
const teamSettingsFile = async ($: any) => `${await teamDir($)}/settings.json`
async function readSettingsFile($: any): Promise<TeamSettings> {
  const p = await teamSettingsFile($)
  if (!(await $.fs.exists(p))) return TEAM_SETTINGS0
  try {
    return { ...TEAM_SETTINGS0, ...JSON.parse(String(await $.fs.read(p))) }
  } catch {
    return TEAM_SETTINGS0
  }
}
const writeSettingsFile = async ($: any, s: TeamSettings) => $.fs.write(await teamSettingsFile($), JSON.stringify(s, null, 1))
async function readTeamSettings($: any): Promise<TeamSettings> {
  const file = await readSettingsFile($)
  const changes = (await pendingChanges($)).filter(c => c.change.kind === 'settings')
  return changes.length > 0 ? applySettings(file, changes) : file
}
async function writeTeamSettings($: any, patch: Partial<TeamSettings>) {
  const r = await writerRole($)
  await serial(async () => {
    if (!writes(r)) return writeChangeFile($, r, { kind: 'settings', patch })
    const changes = (await pendingChanges($)).filter(c => c.change.kind === 'settings')
    await writeSettingsFile($, { ...applySettings(await readSettingsFile($), changes), ...patch })
    await markApplied($, changes.map(c => c.name))
  })
}

// ── Closing and reopening workers ────────────────────────────────────────────────────────────────────────────
// The member's live Orca tab: its recorded handle if that tab still exists, else the one live tab with its name (a
// relaunch gives a member a new tab, so a recorded handle can be stale). '' when there is none, or more than one.
async function liveHandleOf($: any, m: Member): Promise<string> {
  // a member from another PC has no tab here, whatever this PC's tabs are called; one of another CLI is never polled
  if (isAway(m, await machineOf($)) || !isManaged(m)) return ''
  if (m.handle && (await showTab($, m.handle))) return m.handle
  // only tabs in this project's folder: another project may have a member of the same name
  const root = await rootOf($)
  const hits = (await liveTabs($)).filter(t => namesOf(m).includes(bare(String(t.title ?? ''))) && (!t.worktreePath || under(root, String(t.worktreePath))))
  return hits.length === 1 ? handleOf(String(hits[0].handle)) : ''
}

// Close a member's tab and only then mark it closed: a close sent to a stale handle must not leave a live session
// marked "closed" (a later message would then start a second copy of the same conversation).
async function closeMember($: any, m: Member): Promise<boolean> {
  // a member of another CLI is never closed by the mod (#69)
  if (!isManaged(m)) return false
  const handle = await liveHandleOf($, m)
  if (!handle) return false
  await orca($, 'terminal', 'close', '--terminal', handle)
  if (await showTab($, handle)) return false
  await writeStatusOf($, m, { state: 'closed' })
  await update($, members, old => old.map(x => (x.name === m.name ? { ...x, state: 'closed', handle: '' } : x)))
  await share($)
  return true
}

// Reopen a closed member in a new Orca tab: claude --resume keeps its context; fresh starts a new session. Either way it
// starts with its role pointer (roles.ts), so a fresh session needs no typed briefing. Its home is this machine from now.
async function reopen($: any, m: Member, t: TeamSettings): Promise<boolean> {
  // a member of another CLI is not managed (#69): never started from here
  if (!isManaged(m)) return false
  const resume = t.reopen === 'resume' && !!m.sessionId
  const sessionId = resume ? m.sessionId : uuid()
  // back in the member's own workspace (recorded at launch), never Orca's "active" one, which is whatever the person
  // is looking at; one that is gone or no longer holds the project (#68), or a member launched before it was recorded,
  // goes to this session's workspace, and the roster records it
  const wt = await memberWorktree($, m)
  if (!wt) return false
  // the model it last asked for, as typed (#63), else the roster's (which holds what it ran once it has run)
  const model = await requestedModel($, m) || m.model
  envModels = await readEnvModels($)
  const r = await orca($, 'terminal', 'create', '--worktree', `id:${wt}`, '--title', m.name, '--command', startCmd(m, await readMembers($), sessionId, resume, m.name, model))
  const handle = r.ok ? handleOf(r.out) : ''
  if (!handle) return false
  const w = await orca($, 'terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '90000')
  const ready = w.ok && /"satisfied":\s*true/.test(w.out)
  const here = await machineOf($)
  const back = {
    ...m, handle, sessionId, worktree: wt, model, location: 'local' as const, state: ready ? 'idle' : 'starting', briefed: true, pending: false,
    ...(here ? { machine: here } : {}),
  }
  await update($, members, old => old.map(x => (x.name === m.name ? back : x)))
  // its "clean" from before the close no longer counts: kept, the idle round would close it again at once
  await writeStatusOf($, back, { state: 'idle', sessionId, heartbeat: Date.now(), lastClean: 0 })
  await share($)
  return ready
}

// ── The queue (0.5.12, #59): one file per message, queue/<ms>-<rand>.json, see changes.ts ──
// The sender writes an entry; only the team top's round changes it (sending, delivered, failed) and prunes it. The mod
// cannot delete a file, so a pruned entry is listed in queue/pruned.json; one older than 7 days is ignored by its name.
const queueDir = async ($: any) => `${await teamDir($)}/queue`
type QFile = { name: string; q: QEntry }
async function readPruned($: any): Promise<string[]> {
  const v = await readJson($, `${await queueDir($)}/pruned.json`)
  return Array.isArray(v?.names) ? v.names.filter((n: unknown): n is string => typeof n === 'string') : []
}
async function readQueue($: any): Promise<QFile[]> {
  const dir = await queueDir($)
  const now = Date.now()
  const names = ((await $.fs.list(dir).catch(() => [])) as any[])
    .filter(f => f.kind === 'file')
    .map(f => String(f.name))
    .filter(n => now - timeOf(n) <= KEEP_MS)
    .sort()
  if (names.length === 0) return []
  const pruned = new Set(await readPruned($))
  const out: QFile[] = []
  for (const n of names) {
    if (pruned.has(n)) continue
    const q = await readJson($, `${dir}/${n}`)
    if (q && typeof q.to === 'string' && typeof q.message === 'string') out.push({ name: n, q: q as QEntry })
  }
  return out
}
const writeQ = async ($: any, f: QFile) => $.fs.write(`${await queueDir($)}/${f.name}`, JSON.stringify(f.q, null, 1))
async function enqueue($: any, to: string, from: string, message: string, reason?: QReason): Promise<QFile> {
  const created = Date.now()
  const f: QFile = { name: fileName(created, rand()), q: { to, from, message, created, state: 'pending', tries: 0, ...(reason ? { reason } : {}) } }
  await writeQ($, f)
  return f
}
async function markPruned($: any, names: string[]) {
  if (names.length === 0) return
  await $.fs.write(`${await queueDir($)}/pruned.json`, JSON.stringify({ names: appliedAfter(await readPruned($), names, Date.now()) }, null, 1))
}
// The single queue.json of earlier versions: its messages move into queue/ once, and the file is left empty.
async function migrateQueue($: any) {
  const old = `${await teamDir($)}/queue.json`
  const entries = fromOldQueue(await readJson($, old), Date.now())
  if (entries.length === 0) return
  for (const q of entries) await writeQ($, { name: fileName(q.created, rand()), q })
  await $.fs.write(old, '[]')
}

// A queued message that failed for good: the sender's head is told (the sender itself when it is the top); when nobody
// can be told, the person sees a toast.
async function tellSenderHead($: any, q: QEntry) {
  const list = await readMembers($)
  const sender = list.find(m => m.name === q.from || m.address === q.from)
  const head = !sender ? undefined : sender.boss === 'user' ? sender : (list.find(m => m.team === sender.team && m.name === sender.boss) ?? list.find(m => m.name === sender.boss))
  const text =
    `QUEUE (Team Orchestrator): the message from ${q.from} to ${q.to} was not delivered after ${q.tries} ${q.tries === 1 ? 'try' : 'tries'}` +
    `${q.error ? ` (${q.error})` : ''}. It is marked failed in .claude/team-orchestrator/queue/. The message: "${q.message.slice(0, 300)}"`
  const r: any = head?.sessionId ? await $.session.send({ to: { sessionId: head.sessionId }, text }).catch(() => undefined) : undefined
  if (!r?.isDelivered)
    await $.ui.toast(`Team Orchestrator: a queued message for ${q.to} failed${q.error ? ` (${q.error})` : ''}; ${head ? `${head.name} could not be told` : 'its sender has no head on the roster'}.`)
}

// Make room for, and reopen, a closed member; undefined when it must wait in the queue.
async function admitAndReopen($: any, target: Member, list0: Member[], t: TeamSettings): Promise<boolean | undefined> {
  // a member of another CLI is never reopened (#69)
  if (!isManaged(target)) return false
  // still running after all (its tab is live): never start a second copy of the same conversation
  const live = await liveHandleOf($, target)
  if (live) {
    await update($, members, old => old.map(x => (x.name === target.name ? { ...x, handle: live, state: 'idle' } : x)))
    await writeStatusOf($, target, { state: 'idle' })
    await share($)
    return true
  }
  // only this machine's members count toward its cap, and only they may be closed to make room
  const here = await machineOf($)
  const list = list0.filter(m => !isAway(m, here))
  const statuses = await readStatuses($, list)
  const a = admit(list, statuses, t, Date.now(), sleeps())
  if (a.kind === 'queue') return undefined
  if (a.kind === 'evict') {
    const out = list.find(x => x.name === a.name)
    if (out) await closeMember($, out)
  }
  return reopen($, target, t)
}

// "unstarted": on the roster since Create but never launched; it starts, fresh and briefed, on its first message
const isClosed = (m: Member, s: Status | undefined) => !!m.pending || m.state === 'closed' || m.state === 'unstarted' || s?.state === 'closed'

// The messenger role that carries messages between devices is not built yet (#72).
const NO_MESSENGER = 'Messages to a member on another device go through the messenger role, which is not built yet (#72).'

// What a message to a member on another PC gets back: its conversation is there, so only a fresh copy can start here.
const awayAnswer = (m: Member, here: string) =>
  `${m.name} runs on ${m.machine}, not on this PC${here ? ` (${here})` : ''}. ${NO_MESSENGER} Its conversation lives in that PC's ~/.claude, so it cannot be ` +
  `resumed or messaged from here. Ask the user whether to start a fresh copy of ${m.name} on this PC. If the user says yes, call team_message ` +
  'again with the same message and startHere: true: the copy starts fresh from its role file, and this PC becomes its home.'

// What a message to a member of another CLI gets back (#69): the mod does not manage it.
const unmanagedAnswer = (m: Member) =>
  `${m.name} is a ${m.cli} session, not a Claude Code one: the Team Orchestrator does not manage it, so it does not message, start or close it. ` +
  'Ask the user to pass the message on in its own tab.'

// Send a message to a member that is running (#67). A local member is addressed by its session id, which reaches only
// that session on this machine: never a same-named member of another project, never a Remote Control copy. A member on
// another device, or of another CLI, is not messaged from here.
async function sendNow($: any, target: Member, message: string): Promise<{ ok: boolean; text: string }> {
  const here = await machineOf($)
  const where = locationOf(target, here)
  if (where === 'other-cli') return { ok: false, text: unmanagedAnswer(target) }
  if (where === 'remote') return { ok: false, text: isAway(target, here) ? awayAnswer(target, here) : `${target.name} is on another device. ${NO_MESSENGER}` }
  if (!target.sessionId)
    return { ok: false, text: `Not sent to ${target.name}: the roster has no session id for it yet, so it cannot be addressed safely. The next refresh finds it from its transcript; try again then.` }
  // a failed send resolves with a reason; a refused one (the caller's own id, say) may reject instead
  const r: any = await $.session.send({ to: { sessionId: target.sessionId }, text: message }).catch((err: unknown) => ({ isDelivered: false, reason: String(err) }))
  return r?.isDelivered
    ? { ok: true, text: `Sent to ${target.name}.` }
    : { ok: false, text: `Not sent to ${target.name}: ${String(r?.reason ?? 'no answer from its session').slice(0, 200)}` }
}

// ── Is a silent member's session still running? (0.5.16, #71 and #65) ──
// Asked only when a message is about to go to a local member silent for over 90 s of awake time (deliver, and the
// queue's delivery), never on a timer. Proof that it is dead needs all three of #65: its home is this PC, this PC's
// session registry (~/.claude/sessions/<pid>.json) names no live process for its session id, and no process it names
// still carries that id. Anything short of proof is "unsure", and an unsure member is never reopened.
async function crashCheck($: any, m: Member, st?: Status): Promise<Liveness> {
  const unsure = (why: string): Liveness => ({ kind: 'unsure', why })
  const here = await machineOf($)
  if (!here) return unsure('this PC does not know its own name, so it cannot be proved to be its home')
  if (!m.machine || !sameMachine(m.machine, here)) return unsure(`its home is not recorded as this PC (${here})`)
  // the roster's id and the one its status file last wrote (a /clear changes it): proof must hold for both
  const ids = [...new Set([m.sessionId, st?.sessionId ?? ''].filter(Boolean))]
  if (ids.length === 0) return unsure('the roster has no session id for it')
  const own = String(await $.session.id().catch(() => ''))
  const reg = await readRegistry($)
  // a registry that does not list this very session cannot vouch for any other
  if (!reg.ok || own === '' || !reg.list.some(r => r.sessionId === own)) return unsure("this PC's session registry could not be read")
  for (const id of ids) {
    const pids = [...new Set(reg.list.filter(r => r.sessionId === id).map(r => r.pid))]
    if (pids.some(p => !Number.isInteger(p) || p <= 0)) return unsure('its registry entry names no process id')
    if (pids.length === 0) continue
    const procs = await processes($, pids)
    if (!procs) return unsure('the process check did not answer')
    const v = livenessOf(id, pids, procs)
    if (v.kind !== 'dead') return v
  }
  return { kind: 'dead' }
}

// The given process ids, looked up by id alone: one Get-CimInstance query on Windows, `ps -o args= -p` elsewhere.
// undefined when any lookup fails.
async function processes($: any, pids: number[]): Promise<Map<number, Proc> | undefined> {
  if (await isWindows($)) {
    const r = await $.process.run(['powershell.exe', '-NoProfile', '-Command', winProcScript(pids)], { timeoutMs: 20000 }).catch(() => undefined)
    return r?.exitCode === 0 ? parseWinProcs(String(r.stdout ?? ''), pids) : undefined
  }
  const out = new Map<number, Proc>()
  for (const pid of pids) {
    const p = psProc(await $.process.run(['ps', '-o', 'args=', '-p', String(pid)], { timeoutMs: 10000 }).catch(() => undefined))
    if (!p) return undefined
    out.set(pid, p)
  }
  return out
}

// A member proved dead (#65), whether it crashed or its tab was closed by hand: marked closed the way auto-close marks
// it (status file, roster), so the usual reopen-on-message path applies. A leftover tab of its own is closed first;
// false when that tab will not close (then nothing is marked).
async function markDead($: any, m: Member): Promise<boolean> {
  if (await liveHandleOf($, m)) return closeMember($, m)
  await writeStatusOf($, m, { state: 'closed' })
  await update($, members, old => old.map(x => (x.name === m.name ? { ...x, state: 'closed', handle: '' } : x)))
  await share($)
  return true
}

const HOUR = 60 * MIN
// the members this session told the top about, and when (one note per member per hour)
const hungTold = new Map<string, number>()
// the members whose tab was found gone while a message waited for them, and when they were last checked
const goneChecked = new Map<string, number>()

// The team top hears once per member per hour that a member looks hung (its process runs, its status is silent), so
// it can ask the user. A queue entry records the note, so another session does not repeat it within the hour.
async function tellTopHung($: any, m: Member, st: Status): Promise<boolean> {
  const now = Date.now()
  if (now - (hungTold.get(m.name) ?? 0) < HOUR) return false
  if ((await readQueue($)).some(f => f.q.to === m.name && !!f.q.told && now - f.q.told < HOUR)) return false
  hungTold.set(m.name, now)
  const list = await readMembers($)
  const top = topOf(list, m) ?? projectTop(list)
  const mins = Math.max(1, Math.round(awakeAge(st.heartbeat, now, sleeps()) / MIN))
  const text =
    `HUNG MEMBER (Team Orchestrator): ${m.name} has written no status for ${mins} min, yet its Claude process is still running, so it was not reopened. ` +
    'Messages to it wait in the queue and are delivered when it answers, or when its tab is closed (it is then reopened with its conversation). ' +
    `Ask the user whether to look at ${m.name}'s tab (it may be stuck) or close it.`
  const own = String(await $.session.id().catch(() => ''))
  const local = !!top && locationOf(top, await machineOf($)) === 'local'
  const r: any = top?.sessionId && top.sessionId !== own && local ? await $.session.send({ to: { sessionId: top.sessionId }, text }).catch(() => undefined) : undefined
  if (!r?.isDelivered) await $.ui.toast(`Team Orchestrator: ${m.name} looks hung (no status for ${mins} min, its process still runs). Messages to it are queued.`)
  return true
}

// A message for a member that is silent but not proved dead: queued (state pending, reason hung or unsure), never a
// reopen. The answer goes back to the sender.
async function hold($: any, target: Member, message: string, v: Liveness, st: Status): Promise<string> {
  const me = await rosterSelf($)
  const f = await enqueue($, target.name, me?.me.name ?? 'someone', message, v.kind === 'alive' ? 'hung' : 'unsure')
  if (v.kind === 'alive') {
    if (await tellTopHung($, target, st)) await writeQ($, { name: f.name, q: { ...f.q, told: Date.now() } })
    return `${target.name} looks hung; message queued, it will be delivered when it answers or when its tab is closed.`
  }
  const mins = Math.max(1, Math.round(awakeAge(st.heartbeat, Date.now(), sleeps()) / MIN))
  return (
    `${target.name} has written no status for ${mins} min, and whether its session still runs could not be proved (${v.kind === 'unsure' ? v.why : 'no answer'}). ` +
    'It was not reopened, so no second copy of its conversation starts. Your message is queued and is delivered when it answers.'
  )
}

// A member whose message waits because it looked hung or unsure, and whose Orca tab the tab check now finds gone
// (closed by hand): checked once (at most every 5 minutes) and, proved dead, marked closed; the next round reopens it
// and delivers (#65). This runs only on that event, after the tab check the refresh makes anyway: no process polling.
async function closeTheGone($: any, gone: Member[], statuses: Map<string, Status>) {
  if (gone.length === 0) return
  const waiting = new Set((await readQueue($)).filter(f => f.q.state === 'pending' && !!f.q.reason).map(f => f.q.to))
  const here = await machineOf($)
  for (const m of gone) {
    if (!waiting.has(m.name) && !(m.address && waiting.has(m.address))) continue
    if (isAway(m, here) || !isManaged(m) || isClosed(m, statuses.get(m.name))) continue
    if (Date.now() - (goneChecked.get(keyOf(m)) ?? 0) < 5 * MIN) continue
    goneChecked.set(keyOf(m), Date.now())
    if ((await crashCheck($, m, statuses.get(m.name))).kind === 'dead' && (await markDead($, m)))
      await $.ui.toast(`Team Orchestrator: ${m.name}'s tab is gone and its session has stopped; it is marked closed and reopens for its queued message.`)
  }
}

// Send a message to a member, starting or reopening it first. A string result goes back to the sender.
async function deliver($: any, target: Member, message: string, startHere = false): Promise<string> {
  const here = await machineOf($)
  let said = ''
  if (!isManaged(target)) return unmanagedAnswer(target)
  if (target.location === 'remote' && !isAway(target, here)) return `${target.name} is on another device. ${NO_MESSENGER}`
  if (isAway(target, here)) {
    if (!startHere) return awayAnswer(target, here)
    const t = await readTeamSettings($)
    await $.ui.toast(`Starting a fresh copy of ${target.name} on this PC…`)
    // its Orca workspace id is the other PC's: the copy starts in this session's workspace
    const ok = await reopen($, { ...target, worktree: '' }, { ...t, reopen: 'fresh' })
    if (!ok) return `A fresh copy of ${target.name} could not be started here. Ask the person to open its tab.`
  } else {
    const st = await readStatus($, target.name)
    let closed = isClosed(target, st)
    let resume = false
    // open, but silent for over 90 s of awake time: is its session still running? (0.5.16, #71 and #65) Only proof that
    // it is dead reopens it; a live process (hung) or any doubt keeps the message in the queue instead.
    if (!closed && st && heartbeatStale(st, Date.now(), sleeps())) {
      const v = await crashCheck($, target, st)
      if (v.kind !== 'dead') return hold($, target, message, v, st)
      if (!(await markDead($, target))) return hold($, target, message, { kind: 'unsure', why: 'its old Orca tab could not be closed' }, st)
      closed = true
      resume = true
      said = `${target.name}'s session had stopped (no process holds it any more), so it was marked closed and reopened with its conversation. `
    }
    if (closed) {
      const t0 = await readTeamSettings($)
      // a member proved dead keeps its conversation (#65): --resume whatever the team's reopen setting says
      const t: TeamSettings = resume ? { ...t0, reopen: 'resume' } : t0
      await $.ui.toast(`${target.state === 'unstarted' ? 'Starting' : 'Reopening'} ${target.name}${resume ? ' (its session had stopped)' : ''}…`)
      const ok = await admitAndReopen($, target, await readMembers($), t)
      if (ok === undefined) {
        const me = await rosterSelf($)
        const ahead = (await readQueue($)).filter(f => f.q.state === 'pending' || f.q.state === 'sending').length
        await enqueue($, target.name, me?.me.name ?? 'someone', message)
        return `${said}${target.name} is closed and the session cap (${t.maxOpen}) is full with every worker busy. Your message is queued (position ${ahead + 1}) and is delivered as soon as a worker frees up.`
      }
      if (!ok) return `${said}${target.name} could not be started. Ask the person to open its tab.`
    }
  }
  // a reopen may have changed its session id (fresh) and its home (a fresh copy here): send to the member as it is now
  const now = (await readMembers($)).find(m => m.team === target.team && m.name === target.name) ?? target
  return said + (await sendNow($, now, message)).text
}

// The team top's round: close workers idle past the set minutes, then work the queue: deliver what has room, mark
// what failed three times (and tell the sender's head), and prune what is done (a day) or old (7 days).
async function monitor($: any, list: Member[], statuses: Map<string, Status>, now: number) {
  const here = await machineOf($)
  const t = await readTeamSettings($)
  for (const m of toClose(list.filter(x => !isAway(x, here) && isManaged(x)), statuses, t, now, sleeps())) await closeMember($, m)
  await migrateQueue($)
  const queue = await readQueue($)
  const prune: string[] = []
  for (const f of queue) {
    const act = queueAction(f.q, Date.now())
    if (act === 'prune') prune.push(f.name)
    if (act !== 'try') continue
    const all = await readMembers($)
    const target = all.find(x => x.name === f.q.to || x.address === f.q.to)
    // nobody to deliver to here: failed at once (a member from another PC is never messaged from this one)
    const where = target ? locationOf(target, here) : 'local'
    const gone = !target
      ? `no member ${f.q.to} on the roster`
      : where === 'other-cli'
        ? `${target.name} is a ${target.cli} session, not managed`
        : where === 'remote'
          ? `${target.name} is on ${target.machine || 'another device'}; the messenger route (#72) is not built yet`
          : ''
    if (gone || !target) {
      const failed: QEntry = { ...f.q, state: 'failed', updated: Date.now(), error: gone }
      await writeQ($, { name: f.name, q: failed })
      await tellSenderHead($, failed)
      continue
    }
    const st = await readStatus($, target.name)
    let closed = isClosed(target, st)
    const quiet = !closed && !!st && heartbeatStale(st, Date.now(), sleeps())
    // held for a hung or unsure member: it waits until the member answers (a fresh heartbeat) or is proved dead and
    // closed (its tab gone, see closeTheGone); the round runs no process check for it (#65: no polling)
    if (f.q.reason && quiet) continue
    // a member proved dead keeps its conversation: --resume (#65)
    let resume = !!f.q.reason
    if (quiet && st) {
      // a member gone quiet since the message was queued: the send-time crash check (#71)
      const v = await crashCheck($, target, st)
      const dead = v.kind === 'dead' && (await markDead($, target))
      if (!dead) {
        const held: QEntry = { ...f.q, state: 'pending', reason: v.kind === 'alive' ? 'hung' : 'unsure', updated: Date.now(), ...(v.kind === 'unsure' ? { error: v.why } : {}) }
        if (v.kind === 'alive' && (await tellTopHung($, target, st))) held.told = Date.now()
        await writeQ($, { name: f.name, q: held })
        continue
      }
      closed = true
      resume = true
    }
    await writeQ($, { name: f.name, q: { ...f.q, state: 'sending', updated: Date.now() } })
    const open = !closed || (await admitAndReopen($, target, all, resume ? { ...t, reopen: 'resume' } : t))
    let next: QEntry
    if (open === undefined) next = afterTry(f.q, undefined, Date.now())
    else if (!open) next = afterTry(f.q, false, Date.now(), `${target.name} could not be started`)
    else {
      // as the roster has it now: a fresh reopen gave it a new session id
      const cur = (await readMembers($)).find(m => m.team === target.team && m.name === target.name) ?? target
      const s = await sendNow($, cur, `[queued message from ${f.q.from}] ${f.q.message}`)
      next = afterTry(f.q, s.ok, Date.now(), s.ok ? '' : s.text.slice(0, 160))
    }
    await writeQ($, { name: f.name, q: next })
    if (next.state === 'failed') await tellSenderHead($, next)
  }
  await markPruned($, prune)
}

// The sleep windows of this session's clock (0.5.16, #71): each 30 s tick notes its time, and a tick more than three
// minutes late adds the gap (see noteTick in status.ts). Kept in memory for a day; a reload starts afresh.
const REFRESH_MS = 30000
const clockLog = { last: 0, sleeps: [] as Sleep[] }
const sleeps = (): readonly Sleep[] => clockLog.sleeps
function tick(now = Date.now()) {
  clockLog.sleeps = noteTick(clockLog.last, now, REFRESH_MS, clockLog.sleeps)
  clockLog.last = now
}

// The gentle tab check (see refresh): its own interval, doubled while Orca is slow.
const tabCheck = { every: 2 * MIN, next: 0 }

// The allow lines already toasted in this session (see guard).
const toasted = new Set<string>()

// What the person allowed for the turn that is running: set by the person's own prompt, cleared when the turn ends.
let turn: Grants = NO_GRANTS

// One call of the Agent, Write, Edit or NotebookEdit tool by a roster member: refused, or let through (with a line
// in the toast when a grant made the difference). A session that is not on the roster is let through untouched.
// A helper's call (a subagent's or a workflow agent's, carrying agentId) runs in this same session, so it is judged
// as this session's member, by the grants standing right now: a helper has exactly what its spawner has (#73).
// Bash and PowerShell are judged only against the team files (#58).
async function guard($: any, e: any, tool: string): Promise<string | undefined> {
  const shell = (SHELL_TOOLS as readonly string[]).includes(tool)
  const command = shell ? String(e.command ?? '') : ''
  if (shell && !namesTeamFile(command)) return undefined
  await pull($)
  const list = await readMembers($)
  if (list.length === 0) return undefined
  const w = await identity($, list)
  if (w.level === 'none' || !w.me) return undefined
  // the team files first: no grant opens them, only being the team top
  const v =
    judgeTeamFiles({ me: w.me, confirmed: w.level === 'full', tool, path: pathOf(e), command }) ??
    // a held session gets the strictest guard: only the person's one-turn word lets a write or a subagent through
    (w.level === 'restricted'
      ? judgeHeld({ me: w.me, why: w.why, tool, grants: turn })
      : judge({ me: w.me, list, tool, path: pathOf(e), grants: turn, claudeDirs: await claudeDirs($), subagentType: String(e.subagent_type ?? '') }))
  if (!v) return undefined
  // a block toasts every time; an allow toasts once per session and reason, not on every write
  if (v.kind === 'deny' || !toasted.has(v.line)) {
    if (v.kind === 'allow') toasted.add(v.line)
    await $.ui.toast(v.line)
  }
  return v.kind === 'deny' ? v.reason : undefined
}

// ── Orca tabs ──────────────────────────────────────────────────────────────────────────────────────────────
// A tab's title is the session name behind a status glyph: "✳ Hualong Workers", "◑ Hualong CEO".
const bare = (title: string) => title.replace(/^[^\p{L}\p{N}\s]+\s+/u, '').trim()
const namesOf = (m: Member) => [...new Set([m.address, m.name].filter((x): x is string => !!x))]

async function liveTabs($: any): Promise<any[]> {
  const r = await orca($, 'terminal', 'list')
  try {
    return (JSON.parse(r.out).result.terminals as any[]).filter(t => t.connected !== false)
  } catch {
    return []
  }
}

async function showTab($: any, handle: string): Promise<any> {
  const show = await orca($, 'terminal', 'show', '--terminal', handle)
  if (!show.ok) return undefined
  try {
    const t = JSON.parse(show.out).result.terminal
    return t.connected === false ? undefined : t
  } catch {
    return undefined
  }
}

// What pressing a member's marker does: switch Orca to that member's tab (the same call as "Open selected").
async function goTo($: any, m: Member): Promise<string> {
  if (!m.handle) return `${m.name} has no Orca tab.`
  const r = await orca($, 'terminal', 'switch', '--terminal', m.handle)
  return r.ok ? `Opened ${m.name}.` : `Could not open ${m.name}: its Orca tab is gone. Refresh looks for it again.`
}

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const under = (cwd: string, wt: string) => wt !== '' && `${slash(cwd)}/`.startsWith(`${slash(wt)}/`)

// The notes refresh writes; any other note (a launch error, "not ready") stays.
const DERIVED = /^(no Orca tab|no transcript|several tabs named .*|status line not readable)$/
const withNotes = (old: string, add: string[]) => [...old.split(', ').filter(p => p !== '' && !DERIVED.test(p)), ...add].join(', ')

// Reads state, context, model and effort of every member: Orca's agent state plus the tab's status line, the
// transcript where the status line says nothing. A handle that is empty or dead is found again by tab title (a
// restarted session gets a new one); an empty session id by the transcript's customTitle.
async function refresh($: any) {
  await pull($)
  if ((await readMembers($)).length === 0) return
  // who this session is, worked out afresh once per refresh (tool calls reuse the answer); it may update the roster
  self.cur = undefined
  const who = await identity($)
  const role = await writerRole($, who)
  const writer = role.role === 'top' || role.role === 'standin'
  // the writer folds the other sessions' change files into the team files: at most one refresh (30 s) after they came
  if (writer && (await pendingChanges($)).length > 0) await share($, who)
  // the team top checks that every member's rights in the roster file are the ones the mod wrote
  if (role.role === 'top') await checkGrants($).catch(() => undefined)
  const list: Member[] = await readMembers($)
  const here = role.here
  // a member whose home is another PC: never asked about here, shown as "on <that PC>"
  const away = (m: Member) => isAway(m, here)
  // and one adopted from another CLI (#69): never polled, read or reopened
  const skip = (m: Member) => away(m) || !isManaged(m)
  // Live status comes from each member's own status file, not from its screen: merge those into the roster's columns.
  const now = Date.now()
  const statuses = await readStatuses($, list)
  await update($, members, old =>
    old.map(m => {
      if (away(m)) return { ...m, state: 'away' }
      if (!isManaged(m)) return { ...m, state: 'unmanaged' }
      const s = statuses.get(m.name)
      return s ? { ...m, state: shownState(s, now, sleeps()) ?? m.state, model: s.model || m.model, effort: s.effort || m.effort, ctx: s.ctx ?? m.ctx } : m
    }),
  )
  // Only one session polls Orca: the team's top member (boss "user"), or a session not on the roster (the person's
  // own). Every other member just pulls the roster file that session shares. Fourteen sessions each reading fourteen
  // terminals every refresh queued ~200 orca calls at once and made Orca's own typing and scrolling lag.
  if (!(await pollsOrca($, list))) return
  // the top machine is another PC: its team-top actions (auto-close, the queue, the tab check) run there
  if (role.role === 'away') return
  // auto-close and the queue: the writer only, so a message is never delivered twice
  if (writes(role)) await monitor($, list, statuses, now)
  // Orca is asked only when it must be: a member lacks its tab, session id or status file, or the gentle tab check is
  // due (some open member silent for over two minutes, at most once per interval, the interval doubling while Orca is slow).
  // a closed or not-yet-started member has no tab on purpose: it is not missing
  const missing = list.some(m => !skip(m) && !isClosed(m, statuses.get(m.name)) && (!m.handle || !m.sessionId || !statuses.has(m.name)))
  if (!missing && !(now >= tabCheck.next && needsTabCheck([...statuses.values()], now, sleeps()))) return
  const started = Date.now()
  const ps = await orca($, 'worktree', 'ps')
  const agents: any[] = []
  try {
    for (const w of JSON.parse(ps.out).result.worktrees) agents.push(...(w.agents ?? []))
  } catch {
    // keep whatever we had
  }
  // one Orca call at a time, never a burst
  const shown: any[] = []
  for (const m of list) shown.push(m.handle && !skip(m) && !isClosed(m, statuses.get(m.name)) ? await showTab($, m.handle) : undefined)
  tabCheck.every = nextCheckInterval(tabCheck.every, (Date.now() - started) / Math.max(1, list.length + 1))
  tabCheck.next = Date.now() + tabCheck.every
  const all = await transcripts($)
  const root = String(await $.session.root())
  // Where a member's session runs: the folder its transcript last ran in, else the project's own folder. A tab in
  // another worktree is never this member's, whatever its title says (two teams may both have a "Head").
  const ran = await statsOf($, all, list.filter(m => !skip(m)).map(m => m.sessionId).filter(Boolean))
  const whereOf = (sessionId: string) => ran.get(sessionId)?.cwd || root
  const fits = (tab: any, where: string) => {
    const wt = String(tab?.worktreePath ?? '')
    return wt === '' || under(where, wt)
  }
  // one list of tabs and one transcript scan per refresh, not one per member
  const tabs = shown.some((t, i) => !skip(list[i] as Member) && (!t || !fits(t, whereOf((list[i] as Member).sessionId)))) ? await liveTabs($) : []
  const nameless = list.filter(m => !skip(m) && !m.sessionId)
  const ids = nameless.length > 0 ? await sessionsNamed($, all, nameless.flatMap(namesOf), root) : new Map<string, string>()
  const firstPass = await Promise.all(
    list.map(async (m0, i) => {
      const notes: string[] = []
      // a member from another PC keeps what the roster says; its tab and transcript are on that PC
      if (away(m0)) return { m: { ...m0, state: 'away' }, line: { model: m0.model, effort: m0.effort, ctx: String(m0.ctx) }, live: false, notes }
      // a member of another CLI is not managed (#69): its tab is never read or polled, the roster keeps what it says
      if (!isManaged(m0)) return { m: { ...m0, state: 'unmanaged' }, line: { model: m0.model, effort: m0.effort, ctx: String(m0.ctx) }, live: false, notes }
      const sessionId = m0.sessionId || namesOf(m0).map(n => ids.get(n)).find(Boolean) || ''
      let m: Member = { ...m0, sessionId }
      const where = whereOf(sessionId)
      let t = shown[i]
      if (t && !fits(t, where)) t = undefined // a live handle that points into another worktree is not this member's
      if (!t) {
        const hits = tabs.filter(x => namesOf(m).includes(bare(String(x.title ?? ''))))
        const near = hits.filter(x => fits(x, where))
        const pick = near.length === 1 ? near[0] : undefined
        if (pick) {
          t = pick
          m = { ...m, handle: handleOf(String(pick.handle)) }
        } else notes.push(hits.length > 1 ? `several tabs named ${m.address || m.name}` : 'no Orca tab')
      }
      if (!sessionId) notes.push('no transcript')
      let screen = ''
      let exited = false
      // a member with a status file reports itself; only a member without one has its screen read
      const s = statuses.get(m.name)
      if (t && !s) {
        const rd = await orca($, 'terminal', 'read', '--terminal', m.handle)
        try {
          const rt = JSON.parse(rd.out).result.terminal
          screen = (rt.tail ?? []).join('\n')
          exited = rt.status === 'exited'
        } catch {
          // no screen
        }
      }
      const a = t ? agents.find(x => x.paneKey === `${t.tabId}:${t.leafId}`) : undefined
      const raw = String(a?.state ?? '')
      const fromOrca = /work|run/.test(raw) ? 'working' : /block|wait|ask|input|permission|question/.test(raw) ? 'asking' : raw === '' ? m.state : 'idle'
      const state = (!t && m.handle && !isClosed(m, s)) || exited ? 'offline' : s ? (shownState(s, now, sleeps()) ?? m.state) : fromOrca
      const line = s
        ? { model: s.model || undefined, effort: s.effort || undefined, ctx: s.ctx === undefined ? undefined : String(s.ctx) }
        : {
            model: screen.match(/Model:\s*(.+?)\s+v\d[\d.]*\s*\|/)?.[1],
            effort: screen.match(/Thinking:\s*(\w+)/)?.[1],
            ctx: screen.match(/Context:[^\n]*?\((\d+)%\)/)?.[1],
          }
      const noted = m.noted || (m.briefed && (s ? true : /●\s*Noted/.test(screen)))
      return { m: { ...m, state, noted }, line, live: !!t && !exited, notes }
    }),
  )
  // the transcript, in one read, for every member whose status line lacks the model or the context
  const lacking = firstPass.filter(r => r.m.sessionId && (r.line.model === undefined || r.line.ctx === undefined)).map(r => r.m.sessionId)
  const stats = lacking.length > 0 ? await statsOf($, all, lacking) : new Map<string, Stats | undefined>()
  const next = firstPass.map(({ m, line, live, notes }) => {
    const tr = line.model === undefined || line.ctx === undefined ? stats.get(m.sessionId) : undefined
    if (live && line.model === undefined && line.ctx === undefined && !tr) notes.push('status line not readable')
    // the member's own reported window, when its status file has one, in place of the guess (#63)
    const window = statuses.get(m.name)?.window
    const trCtx = tr ? (window ? Math.round((tr.used * 100) / windowFor(tr.model, tr.used, window)) : tr.ctx) : undefined
    return {
      ...m,
      model: line.model ?? tr?.model ?? m.model,
      effort: line.effort ?? (tr?.effort || m.effort),
      ctx: Number(line.ctx ?? trCtx ?? m.ctx),
      note: withNotes(m.note, notes),
    }
  })
  await update($, members, old => next.map(n => ({ ...n, sel: old.find(o => o.name === n.name && (o.team || n.team) === n.team)?.sel ?? n.sel })))
  await share($)
  // a member whose message waits (hung or unsure) and whose tab is now gone: proved dead, it is closed (#65)
  if (writes(role)) await closeTheGone($, firstPass.filter(r => !r.live).map(r => r.m), statuses)
}

// Take a team, or one member of it, off the roster. Only the roster changes: no terminal is closed.
async function remove($: any, team: string, name?: string): Promise<string> {
  await pull($)
  const all = await readMembers($)
  const t = all.some(m => m.team === team) ? team : clean(team)
  const gone = all.filter(m => m.team === t && (name === undefined || m.name === name))
  if (gone.length === 0) return name === undefined ? `No team "${team}" on the roster.` : `No member "${name}" in team "${team}".`
  await update($, members, () => all.filter(m => !gone.includes(m)))
  await share($)
  return `Removed ${name === undefined ? `team "${t}" (${gone.length} member${gone.length === 1 ? '' : 's'})` : `"${name}" from team "${t}"`} from the roster. No terminal was closed.`
}

const keyOf = (m: Member) => `${m.team}|${m.name}`

// Levels follow the reporting line: a member whose boss is in its team sits one below that boss. Members whose
// boss is elsewhere (the user, a CEO in another team) keep their level.
const relevel = (list: Member[], team: string): Member[] => {
  const out = list.map(m => ({ ...m }))
  const mine = out.filter(m => m.team === team)
  const byName = new Map(mine.map(m => [m.name, m]))
  const seen = new Set<string>()
  const walk = (m: Member) => {
    if (seen.has(m.name)) return
    seen.add(m.name)
    for (const k of mine.filter(x => x.boss === m.name)) (k.level = m.level + 1), walk(k)
  }
  mine.filter(m => !byName.has(m.boss)).forEach(walk)
  return out
}

// Move members (by team|name) to another team, under `boss` or that team's head ('user' in a new team). A moved
// member's reports that stay behind would lose their boss, so the move is refused; tick them too and they move along.
async function move($: any, keys: Set<string>, toTeam: string, boss?: string): Promise<string> {
  await pull($)
  const all = await readMembers($)
  const to = clean(toTeam)
  if (to === '') return 'Name the team to move to.'
  const moving = all.filter(m => keys.has(keyOf(m)) && m.team !== to)
  if (moving.length === 0) return 'Nothing to move: tick members of another team.'
  const left = all.filter(r => !keys.has(keyOf(r)) && moving.some(m => m.team === r.team && m.name === r.boss))
  if (left.length > 0)
    return `Refused: ${left.map(r => `${r.name} reports to ${r.boss}`).join(', ')}. Tick them too to move them along, or change their boss first.`
  const target = all.filter(m => m.team === to)
  const clash = moving.filter(m => target.some(x => x.name === m.name))
  if (clash.length > 0) return `Refused: team "${to}" already has ${clash.map(m => m.name).join(', ')}.`
  const head = boss ? target.find(m => m.name === boss) : target.find(m => !target.some(x => x.name === m.boss))
  if (boss && !head) return `No member "${boss}" in team "${to}".`
  const names = new Set(moving.map(m => `${m.team}|${m.name}`))
  const next = all.map(m =>
    !keys.has(keyOf(m)) || m.team === to
      ? m
      : names.has(`${m.team}|${m.boss}`)
        ? { ...m, team: to, sel: false }
        : { ...m, team: to, boss: head?.name ?? 'user', level: (head?.level ?? 0) + 1, sel: false },
  )
  await update($, members, () => relevel(next, to).map(m => ({ ...m, sel: false })))
  await share($)
  return `Moved ${moving.map(m => m.name).join(', ')} to team "${to}" under ${head?.name ?? 'user'}. No terminal was touched.`
}

// The short name of one member (team|name): used as typed in the org chart; empty clears it. Ticks clear.
async function setShort($: any, key: string, value: string): Promise<string> {
  await pull($)
  const all = await readMembers($)
  const who = all.find(m => keyOf(m) === key)
  if (!who) return 'That member is not on the roster any more.'
  const short = value.trim().slice(0, 40)
  await update($, members, () => all.map(m => ({ ...m, sel: false, ...(keyOf(m) === key ? { short } : {}) })))
  await share($)
  return short === '' ? `Cleared the short name of ${who.name}: the chart works one out.` : `${who.name} is "${short}" in the org chart.`
}

// New boss for ticked members of one team. Not one of them, nor anyone below them (that would be a loop).
const bossChoices = (list: Member[], keys: Set<string>): Member[] => {
  const ticked = list.filter(m => keys.has(keyOf(m)))
  const team = ticked[0]?.team
  if (!team || ticked.some(m => m.team !== team)) return []
  const below = new Set(ticked.map(m => m.name))
  for (let grew = true; grew; ) {
    grew = false
    for (const m of list) if (m.team === team && below.has(m.boss) && !below.has(m.name)) (below.add(m.name), (grew = true))
  }
  return list.filter(m => m.team === team && !below.has(m.name))
}

async function changeBoss($: any, keys: Set<string>, boss: string): Promise<string> {
  const all = await readMembers($)
  const b = bossChoices(all, keys).find(m => m.name === boss)
  if (!b) return `"${boss}" cannot be the boss of the ticked members (tick members of one team; not one of them or below them).`
  const next = all.map(m => (keys.has(keyOf(m)) ? { ...m, boss: b.name, level: b.level + 1 } : m))
  await update($, members, () => relevel(next, b.team).map(m => ({ ...m, sel: false })))
  await share($)
  return `${all.filter(m => keys.has(keyOf(m))).map(m => m.name).join(', ')} now report to ${b.name}.`
}

// Adopt one running tab into a team: its title (glyph stripped) is the name; refresh then finds its session id.
async function addMember($: any, handle: string, title: string, team: string, boss: string, role: string): Promise<string> {
  const all = await readMembers($)
  const name = bare(title)
  if (name === '' || all.some(m => m.team === team && m.name === name)) return `Team "${team}" already has "${name}".`
  const b = all.find(m => m.team === team && m.name === boss)
  const here = await machineOf($)
  const added: Member = {
    team, name, address: name, role: role || 'member', level: b ? b.level + 1 : 1, boss: b ? b.name : 'user', handle, sessionId: '',
    state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false, ...(here ? { machine: here } : {}),
  }
  await update($, members, () => [...all.map(m => ({ ...m, sel: false })), added])
  await share($)
  await refresh($)
  return `Added ${name} to team "${team}" under ${added.boss}.`
}

// ── New members on a running team (0.5.17, #77), see adding.ts ──
// A New member is saved not yet, with its role file, and starts fresh and briefed on its boss's first team_message.
// You add one from the panel or from your own session (not on the roster). A head or lead only asks, within its
// purview: the request is saved in requests/, the team top is told to ask you with AskUserQuestion, and it applies your
// answer with member_add { request, approve }. The top itself adds only after asking you in the same turn.
async function addNew($: any, s: NewSpec): Promise<string> {
  await pull($)
  const all = await readMembers($)
  const problem = newProblem(all, s)
  if (problem) return problem
  const wt = await currentWorktree($).catch(() => '')
  const here = await machineOf($)
  const m = newMember(all, s)
  const added: Member = { ...m, statusFile: statusFile(m.name), ...(wt ? { worktree: wt } : {}), ...(here ? { machine: here } : {}) }
  await update($, members, () => [...all.map(x => ({ ...x, sel: false })), added])
  await share($)
  return (
    `Added ${added.name} to team "${added.team}" under ${added.boss}, saved as not yet with its role file. ` +
    `It starts fresh and briefed on ${added.boss === 'user' ? 'its first message' : `${added.boss}'s first team_message`}.`
  )
}

type AddRequest = {
  v: 1
  id: string
  at: number
  by: { member: string; team: string; session: string }
  add: NewSpec
  state: 'asked' | 'approved' | 'declined'
  decidedAt?: number
}
const requestsDir = async ($: any) => `${await teamDir($)}/requests`
async function readRequest($: any, id: string): Promise<AddRequest | undefined> {
  if (!/^\d{13}-[a-z0-9]{4,16}$/.test(id)) return undefined
  const v = await readJson($, `${await requestsDir($)}/${id}.json`)
  return v && typeof v.add === 'object' && typeof v.state === 'string' ? (v as AddRequest) : undefined
}
const writeRequest = async ($: any, r: AddRequest) => $.fs.write(`${await requestsDir($)}/${r.id}.json`, JSON.stringify(r, null, 1))

const specLine = (s: NewSpec, list: Member[]) => {
  const boss = s.boss || headOf(list, s.team)?.name || 'user'
  const extra = [s.model && s.model !== 'default' ? `model ${s.model}` : '', s.effort && s.effort !== 'default' ? `effort ${s.effort}` : ''].filter(Boolean)
  return `${s.name} (${s.role || 'worker'}), reporting to ${boss}${extra.length ? `, ${extra.join(', ')}` : ''}`
}
const askText = (r: AddRequest, list: Member[]) =>
  `MEMBER REQUEST (Team Orchestrator): ${r.by.member} asks to add a new member to team ${r.add.team}: ${specLine(r.add, list)}. ` +
  'Nothing is added until the user approves. Ask the user AT ONCE with AskUserQuestion whether to add it, with two options: ' +
  `(1) "Add ${r.add.name}"; (2) "Do not add". Then apply the answer with member_add { request: "${r.id}", approve: true | false }.`

// member_add: a request from a head or lead, the top's own add, your own add, or the top applying your answer.
async function memberAdd($: any, input: any): Promise<any> {
  await pull($)
  const list = await readMembers($)
  const w = await identity($, list)
  const id = String(input.request ?? '').trim()
  if (id) return decideRequest($, list, w, id, input.approve === true)
  const raw = String(input.team ?? '').trim()
  const team = list.some(m => m.team === raw) ? raw : clean(raw)
  const me = w.level === 'full' ? w.me : undefined
  // a head or lead asking: the boss is the one who asks unless it names another; you (not on the roster): the team's head
  const boss = String(input.boss ?? '').trim() || (me ? me.name : '')
  const spec: NewSpec = {
    team, name: String(input.name ?? '').trim(), role: String(input.role ?? '').trim(), boss, model: String(input.model ?? '').trim(), effort: String(input.effort ?? '').trim(),
    ...(me ? { by: me.name } : {}),
  }
  // your own session, not on the roster: you may always add
  if (!me) return { result: await addNew($, spec) }
  const refused = requestProblem(list, me, team, boss)
  if (refused) return { deny: refused }
  const problem = newProblem(list, spec)
  if (problem) return { result: problem }
  // the team top asks you itself, in this turn, and then adds
  if (me.boss === 'user') {
    if (!turnAsk.answered)
      return { deny: `Ask the user first with AskUserQuestion in this turn whether to add ${specLine(spec, list)} to team ${team}; then call member_add again. Nothing is added without the user's approval.` }
    return { result: await addNew($, spec) }
  }
  // a head or lead below the top: a request, which the top puts to you
  const sid = String(await $.session.id().catch(() => ''))
  const r: AddRequest = { v: 1, id: fileName(Date.now(), rand()).replace(/\.json$/, ''), at: Date.now(), by: { member: me.name, team: me.team, session: sid }, add: spec, state: 'asked' }
  await writeRequest($, r)
  const top = topOf(list, me)
  const reach = !!top?.sessionId && top.sessionId !== sid && !isAway(top, await machineOf($))
  const sent: any = reach ? await $.session.send({ to: { sessionId: top!.sessionId }, text: askText(r, list) }).catch(() => undefined) : undefined
  if (sent?.isDelivered)
    return { result: `Asked ${top!.name} to put request ${r.id} to the user: ${specLine(spec, list)} in team ${team}. Nothing is added until the user approves; you hear back when it is decided.` }
  await $.ui.toast(`Team Orchestrator: ${me.name} asks to add ${spec.name} to team ${team}, and the team top could not be told. Tell the top to apply request ${r.id} with member_add once you approve.`)
  return {
    result:
      `Request ${r.id} is saved, but the team top${top ? ` (${top.name})` : ''} could not be told. Tell your boss: the top applies it with ` +
      `member_add { request: "${r.id}", approve } once the user approves. Nothing is added until then.`,
  }
}

// The team top applies your answer to a request; only an answer you gave in this turn adds anyone.
async function decideRequest($: any, list: Member[], w: Who, id: string, approve: boolean): Promise<any> {
  const me = w.me
  if (w.level !== 'full' || !me || me.boss !== 'user')
    return { deny: 'member_add with a request is for the team top only (the confirmed member that reports to the user): it applies the user\'s answer.' }
  const r = await readRequest($, id)
  if (!r) return { result: `No member request ${id}.` }
  if (r.state !== 'asked') return { result: `Request ${id} was ${r.state} already.` }
  if (!purview(list, me).includes(r.add.team)) return { deny: `Request ${id} is for team "${r.add.team}", outside ${me.name}'s purview.` }
  // the one who asked must still be on the roster and still allowed to ask for this team and this boss (a request
  // file is written only by member_add, and the guard locks requests/, but the file is checked again here)
  const by = list.find(m => m.team === r.by?.team && m.name === r.by?.member) ?? list.find(m => m.name === r.by?.member)
  const still = by
    ? requestProblem(list, by, r.add.team, String(r.add.boss ?? ''))
    : `it names ${r.by?.member || 'nobody'} as the one who asked, and no such member is on the roster`
  if (still) {
    await writeRequest($, { ...r, state: 'declined', decidedAt: Date.now() })
    return { deny: `Request ${id} was not applied and is marked declined: ${still}` }
  }
  const tell = (text: string) => (r.by.session ? $.session.send({ to: { sessionId: r.by.session }, text }).catch(() => undefined) : undefined)
  if (!approve) {
    await writeRequest($, { ...r, state: 'declined', decidedAt: Date.now() })
    await tell(`TEAM ORCHESTRATOR: the user did not approve adding ${r.add.name} to team ${r.add.team}. Nothing was added.`)
    return { result: `Declined request ${id}: nothing was added. ${r.by.member} is told.` }
  }
  if (!turnAsk.answered) return { deny: 'Ask the user first with AskUserQuestion in this turn; member_add applies the answer.' }
  const problem = newProblem(list, r.add)
  if (problem) return { result: `Request ${id} cannot be applied: ${problem}` }
  const out = await addNew($, r.add)
  await writeRequest($, { ...r, state: 'approved', decidedAt: Date.now() })
  await tell(`TEAM ORCHESTRATOR: the user approved it. ${out}`)
  return { result: out }
}

// Save members, leaving everyone else on the roster alone: a member already there (same team and name) is updated in
// place, and nobody is dropped (#77: a launch under a taken team name used to replace that team).
async function put($: any, mine: Member[]) {
  const all = await readMembers($)
  const fresh = new Map(mine.map(m => [keyOf(m), m]))
  const kept = all.map(m => fresh.get(keyOf(m)) ?? m)
  const known = new Set(all.map(keyOf))
  await update($, members, () => [...kept, ...mine.filter(m => !known.has(keyOf(m)))])
  await share($)
}

// Adopt says which running sessions a team is: its members become exactly these, the other teams stay as they are.
async function replaceTeam($: any, team: string, mine: Member[]) {
  const all = await readMembers($)
  await update($, members, () => [...all.filter(m => m.team !== team), ...mine])
  await share($)
}

// What a launch under a team name already on the roster gets back: nothing launched, nobody removed, two choices.
const takenAnswer = (teams: string[], list: Member[]) =>
  `Refused: ${teams.map(t => `team "${t}" already exists (${list.filter(m => m.team === t).length} members)`).join(', ')}. ` +
  'Launching under a taken name would replace it, so nothing was launched and nobody was removed. Ask the user which they want, ' +
  'then call team_launch again with ifExists: "add" (every launched member joins as a new member, saved as not yet and started ' +
  'on its boss\'s first team_message; a taken name gets a number) or "merge" (the launched team merges into the one there: a ' +
  'launched member named like a member there is that member, kept as it is, and the rest join under their bosses). Or pick another team name.'

async function launch($: any, team: string, input: Spec[], ifExists?: 'add' | 'merge'): Promise<string> {
  const all0 = await readMembers($)
  const launching = new Set(input.map(s => clean(s.team || team)))
  // a launch never replaces a team on the roster (#77): refused, unless the caller chose to add or merge
  const there = [...launching].filter(t => all0.some(m => m.team === t))
  if (there.length > 0 && ifExists !== 'add' && ifExists !== 'merge') return takenAnswer(there, all0)
  let specs: (Spec & { team: string })[]
  let merged: string[] = []
  if (there.length > 0) {
    const joined = joinLaunch(all0, input.map(s => ({ ...s, team: clean(s.team || team) })), ifExists!)
    specs = joined.add
    merged = joined.merged
  } else {
    // A name is how SendMessage finds a session, so it must be unique across every team of the project.
    // A name already used by another team (two squads both have a "Head") gets its team in front.
    const taken = new Set(all0.filter(m => !launching.has(m.team)).map(m => m.name))
    const renamed = new Map<string, string>()
    const named = input.map(s => {
      const t = clean(s.team || team)
      const base = clean(s.name)
      const name = taken.has(base) ? clean(`${t}-${base}`) : base
      taken.add(name)
      renamed.set(s.name, name)
      return { ...s, name, team: t }
    })
    specs = named.map(s => ({ ...s, boss: s.boss === 'user' ? 'user' : (renamed.get(s.boss) ?? clean(s.boss)) }))
  }
  if (specs.length === 0) return `Nothing to add: every launched member is already in ${there.map(t => `"${t}"`).join(', ')}. Nobody was removed.`
  const wt = await currentWorktree($)
  if (!wt) return 'Cannot find the Orca worktree of this session.'
  const teamsMade = [...new Set(specs.map(s => s.team))]
  // every member starts on this machine
  const here = await machineOf($)
  // the whole roster is written first; nobody is launched yet
  const made: Member[] = specs.map(s => ({
    team: s.team, name: s.name, address: s.name, role: s.role, level: s.level, boss: s.boss, handle: '', sessionId: '', worktree: wt,
    ...(here ? { machine: here } : {}), location: 'local',
    state: 'unstarted', ctx: -1,
    model: s.model && s.model !== 'default' ? s.model : '', effort: s.effort && s.effort !== 'default' ? s.effort : '',
    sel: false, note: '', briefed: false, noted: false, statusFile: statusFile(s.name), pending: true,
    ...(s.short?.trim() ? { short: s.short.trim() } : {}),
  }))
  await put($, made)
  // then the top and the team heads (or everyone), a few at a time: each batch is started, waited for, briefed, and
  // given 5 s before the next one, so a big team does not start a dozen claude processes at once
  const t = await readTeamSettings($)
  // added to a team already there: saved as not yet, each starts on its boss's first message, like a New member
  const startable = ifExists === 'add' ? made.filter(m => !there.includes(m.team)) : made
  const now = t.launch === 'all' ? startable : startable.filter(m => startsAtCreate(m, made))
  const batches = chunk(now, t.batch)
  for (const m of now) (m.state = 'queued'), (m.pending = false)
  await put($, made)
  envModels = await readEnvModels($)
  for (const [i, group] of batches.entries()) {
    await update($, spawn, () => ({ names: now.map(m => m.name), batch: i + 1, of: batches.length }))
    for (const m of group) {
      m.sessionId = uuid()
      const r = await orca(
        $,
        'terminal', 'create', '--worktree', `id:${wt}`, '--title', m.name,
        '--command', startCmd(m, made, m.sessionId, false, m.name, m.model, m.effort, WELCOME),
      )
      m.handle = r.ok ? handleOf(r.out) : ''
      m.state = m.handle ? 'starting' : 'failed'
      m.note = m.handle ? '' : r.out.slice(0, 80)
      if (!m.handle) m.sessionId = ''
      await put($, made)
    }
    await Promise.all(
      group
        .filter(m => m.handle)
        .map(async m => {
          // it starts with its role pointer and the welcome as its first prompt: ready means it has read its role
          const w = await orca($, 'terminal', 'wait', '--terminal', m.handle, '--for', 'tui-idle', '--timeout-ms', '120000')
          const ready = w.ok && /"satisfied":\s*true/.test(w.out)
          m.state = ready ? 'working' : 'starting'
          m.note = ready ? '' : 'slow to start'
          m.briefed = true
        }),
    )
    await put($, made)
    if (i < batches.length - 1) await $.clock.sleep(5000)
  }
  await update($, spawn, () => SPAWN0)
  await refresh($)
  const later = made.length - now.length
  const failed = now.filter(m => m.state === 'failed').length
  const into =
    there.length === 0
      ? ''
      : `${ifExists === 'merge' ? 'Merged into' : 'Added to'} ${there.map(x => `"${x}"`).join(', ')}: ${made.filter(m => there.includes(m.team)).map(m => m.name).join(', ')}` +
        `${merged.length ? ` (${merged.join(', ')} already there, kept as they are)` : ''}; nobody was removed. `
  return (
    into +
    `${teamsMade.every(x => there.includes(x)) ? 'Saved' : 'Created'} ${teamsMade.length === 1 ? `"${teamsMade[0]}"` : `${teamsMade.length} teams (${teamsMade.join(', ')})`}: ` +
    `started and briefed ${now.length - failed} of ${now.length}${failed ? ` (${failed} failed)` : ''}` +
    (later ? `; ${later} more start on their first message.` : '.')
  )
}

// One name from three independent parts: prefix + (base or the current name) + optional running number.
// State kept across a hot reload may predate a field, so defaults go under whatever was stored.
const BULK0: Bulk = { prefix: '', base: '', numbering: 'none', model: 'keep', effort: 'keep', msg: '' }
const readBulk = async ($: any): Promise<Bulk> => ({ ...BULK0, ...(await read($, bulk)) })

const nameFor = (b: Bulk, current: string, i: number) => {
  const num = b.numbering === 'none' ? '' : `-${b.numbering === '01' ? String(i).padStart(2, '0') : i}`
  return clean(`${b.prefix}${b.base.trim() || current}${num}`)
}

// Bulk rename / model / effort on the ticked rows. A running claude cannot be changed from outside,
// so an idle session with a known id is restarted with --resume; the rest get a label-only rename.
async function applyBulk($: any) {
  const list: Member[] = await readMembers($)
  const b: Bulk = await readBulk($)
  const key = (m: Member) => `${m.team}|${m.name}`
  const picked = list.filter(m => m.sel)
  if (picked.length === 0) return void (await update($, bulk, o => ({ ...o, msg: 'Tick at least one row.' })))
  const renames = new Map<string, string>()
  const report: string[] = []
  let n = 0
  const done = new Map<string, Partial<Member>>()
  for (const m of picked) {
    n += 1
    const newName = nameFor(b, m.name, n)
    const wantModel = b.model !== 'keep' && !m.model.toLowerCase().includes(b.model)
    const wantEffort = b.effort !== 'keep' && b.effort !== m.effort
    if (newName === m.name && !wantModel && !wantEffort) continue
    // a member of another CLI is not managed (#69): its tab is neither restarted nor renamed
    if (!isManaged(m)) {
      report.push(`${m.team}/${m.name}: skipped (not managed, ${m.cli})`)
      continue
    }
    const canRestart = m.sessionId !== '' && m.handle !== '' && m.state === 'idle'
    if (canRestart) {
      envModels = await readEnvModels($)
      // kept on "keep": the model it last asked for (#63), else the roster's; its workspace checked first (#68)
      const model = wantModel ? b.model : (await requestedModel($, m)) || m.model
      const wt = await memberWorktree($, m)
      await orca($, 'terminal', 'close', '--terminal', m.handle)
      const r = await orca(
        $,
        'terminal', 'create', '--worktree', wt ? `id:${wt}` : 'active', '--title', newName,
        '--command', startCmd(m, list, m.sessionId, true, newName, model, wantEffort ? b.effort : m.effort),
      )
      const handle = r.ok ? handleOf(r.out) : ''
      done.set(key(m), {
        name: newName, handle, state: handle ? 'starting' : 'failed', note: handle ? '' : r.out.slice(0, 60),
        model, effort: wantEffort ? b.effort : m.effort, sel: false, ...(wt ? { worktree: wt } : {}),
      })
      if (newName !== m.name) renames.set(key(m), newName)
      report.push(`${m.team}/${m.name}: restarted`)
    } else {
      const why = m.sessionId === '' ? 'adopted (no session id)' : m.state !== 'idle' ? `${m.state}` : 'no tab'
      if (newName !== m.name) {
        if (m.handle) await orca($, 'terminal', 'rename', '--terminal', m.handle, '--title', newName)
        done.set(key(m), { name: newName, sel: false })
        renames.set(key(m), newName)
        report.push(`${m.team}/${m.name}: label only (${why})`)
      } else report.push(`${m.team}/${m.name}: skipped (${why})`)
    }
  }
  await update($, members, () =>
    list.map(m => {
      const d = done.get(key(m))
      const out = { ...m, ...(d ?? {}) }
      return { ...out, boss: renames.get(`${m.team}|${m.boss}`) ?? m.boss }
    }),
  )
  await share($)
  await update($, bulk, o => ({ ...o, msg: report.join(' | ') || 'Nothing to change.' }))
}

// At start: an empty Orca command is filled in once from the platform (written to the plugin option, which reloads the
// mod with it); a set one is checked. A set one that fails here while the platform's default works (settings synced
// from another platform carry orca.exe to a Mac) is switched to the default, with a toast (#70); any other failure is
// only shown.
async function orcaSetup($: any) {
  const guess = (await isWindows($)) ? 'orca.exe' : 'orca'
  if (cfg.orcaCommand) {
    const problem = await orcaProblem($, cfg.orcaCommand)
    if (!problem) return
    const was = cfg.orcaCommand
    if (was !== guess && !(await orcaProblem($, guess))) {
      const saved = await $.config.set({ key: ORCA_KEY, value: guess }).then((r: any) => r?.deny === undefined, () => false)
      cfg.orcaCommand = guess
      return void (await $.ui.toast(
        saved
          ? `Team Orchestrator: "Orca command" was ${was}, which does not run here; switched it to ${guess}, this platform's default.`
          : `Team Orchestrator: "Orca command" ${was} does not run here; using ${guess} for this session (it could not be saved, fix it in /config).`,
      ))
    }
    await $.ui.toast(`Team Orchestrator: ${problem} Fix "Orca command" in /config.`)
    return
  }
  const problem = await orcaProblem($, guess)
  if (problem) return void (await $.ui.toast(`Team Orchestrator: Orca not found. ${problem} Set "Orca command" in /config.`))
  await $.config.set({ key: ORCA_KEY, value: guess }).catch(() => undefined)
}

// A team tool never crashes: an error comes back as a sentence the model can act on. (A hook that throws is skipped,
// and the engine then reports that no hook answered the tool, which reads like missing code.)
const safely = async (fn: () => Promise<any>): Promise<any> => {
    try {
      return await fn()
    } catch (err) {
      return { result: `Team Orchestrator could not finish this: ${String(err).slice(0, 300)}. If Orca was not found, set "Orca command" in /config to Orca's command-line tool.` }
    }
  }

export const register: Register = (on, options) => {
  cfg.orcaCommand = String((options as any)?.orcaCommand ?? '').trim()
  // what one load knew about the roster and has said: a fresh load starts over (the version too, read again)
  cfg.versionRead = false
  seenRoster.base = undefined
  seenRoster.overlay = new Set()
  Object.assign(told, { old: false, away: '', asked: false, declined: false })
  turnAsk.answered = false
  statusMigrated.clear()
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: 'Open the Team Orchestrator form' })
    await $.tool.register({
      name: 'team_launch',
      description:
        'Launch a team of Claude Code sessions as Orca tabs in the current worktree. members is ordered boss-first; boss is a member name or "user". model/effort optional per member (opus, sonnet, haiku, fable / low, medium, high, xhigh, max). ' +
        'A team name already on the roster is never replaced: the launch is refused until the user picks ifExists "add" (every launched member joins that team as a new member, started on its boss\'s first team_message) or "merge" (the launched team merges into it by name; members already there are kept as they are).',
      inputSchema: {
        type: 'object',
        properties: {
          team: { type: 'string' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
                level: { type: 'number' },
                boss: { type: 'string' },
                team: { type: 'string' },
                model: { type: 'string' },
                effort: { type: 'string' },
                short: { type: 'string', description: 'optional short name for the org chart, used as typed; empty: the chart works one out' },
              },
              required: ['name', 'role', 'level', 'boss'],
            },
          },
          ifExists: { type: 'string', enum: ['add', 'merge'], description: 'only after the user chose it, for a team name already on the roster' },
        },
        required: ['team', 'members'],
      },
    })
    await $.tool.register({
      name: 'team_adopt',
      description:
        'Put ALREADY RUNNING sessions into the roster without launching anything. members ordered boss-first; handle is the Orca terminal handle (may be empty: it is then found by tab title); address is the session name SendMessage uses (default: name); sessionId optional (empty: found from the transcript whose title is the name; needed for restart-based rename/model/effort); boss is a member name or "user".',
      inputSchema: {
        type: 'object',
        properties: {
          team: { type: 'string' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
                level: { type: 'number' },
                boss: { type: 'string' },
                handle: { type: 'string' },
                address: { type: 'string' },
                sessionId: { type: 'string' },
                short: { type: 'string', description: 'optional short name for the org chart, used as typed; empty: the chart works one out' },
              },
              required: ['name', 'role', 'level', 'boss'],
            },
          },
        },
        required: ['members'],
      },
    })
    await $.tool.register({
      name: 'team_message',
      description:
        'Send a message to a teammate on the roster, starting it first when it has not started yet or was closed (it is then briefed before the message arrives). Use this, not SendMessage, for messages to your direct reports. to is the member name. startHere: only after the user said yes, for a member whose home is another PC: start a fresh copy of it on this PC.',
      inputSchema: {
        type: 'object',
        properties: { to: { type: 'string' }, message: { type: 'string' }, summary: { type: 'string' }, startHere: { type: 'boolean' } },
        required: ['to', 'message'],
      },
    })
    await $.tool.register({
      name: 'team_take_top',
      description:
        'Apply the user\'s answer about moving the team top to this PC, after asking with AskUserQuestion in this turn. take true: the roster records this PC as the team top\'s machine, and the PC that had it becomes read-only for the team files; take false: nothing changes and the user is not asked again in this session.',
      inputSchema: { type: 'object', properties: { take: { type: 'boolean' } }, required: ['take'] },
    })
    await $.tool.register({
      name: 'team_remove',
      description: 'Take a whole team off the roster (memory and the roster file). Closes no terminal and stops no session.',
      inputSchema: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] },
    })
    await $.tool.register({
      name: 'member_remove',
      description: 'Take one member of a team off the roster (memory and the roster file). Closes no terminal and stops no session.',
      inputSchema: { type: 'object', properties: { team: { type: 'string' }, name: { type: 'string' } }, required: ['team', 'name'] },
    })
    await $.tool.register({
      name: 'member_move',
      description:
        'Move one member to another team (a new team name makes one), under boss or else that team\'s head; level becomes the boss level + 1. Refused while others report to the member. Closes no terminal.',
      inputSchema: {
        type: 'object',
        properties: { team: { type: 'string' }, name: { type: 'string' }, toTeam: { type: 'string' }, boss: { type: 'string' } },
        required: ['team', 'name', 'toTeam'],
      },
    })
    await $.tool.register({
      name: 'member_add',
      description:
        'Add a new member to a running team: saved as not yet, with its role file, and started fresh and briefed on its boss\'s first team_message. ' +
        'From a head or lead this is a REQUEST, only for its own team and the teams below it: the team top asks the user, and nothing is added until the user approves. ' +
        'boss: a member of that team, or you (empty: you; a boss outside your purview is refused). model and effort optional (opus, sonnet, haiku, fable / low, medium, high, xhigh, max). ' +
        'Team top only: after asking the user with AskUserQuestion in this turn, apply the answer to a request with { request, approve }.',
      inputSchema: {
        type: 'object',
        properties: {
          team: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string' },
          boss: { type: 'string' },
          model: { type: 'string' },
          effort: { type: 'string' },
          request: { type: 'string', description: 'team top only: the request id it was told about' },
          approve: { type: 'boolean', description: 'team top only, with request: the user\'s answer' },
        },
      },
    })
    await $.tool.register({
      name: 'member_claim',
      description:
        'Team top only: apply the user\'s answer about a session on hold that looks like a team member. decision "is": the roster takes its id, tab and name as that member; "new": it joins as a worker under that member\'s boss, with its own role file; "reject": it stays on hold, off the team. sessionId is the held session\'s id; member is the member it looks like.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          decision: { type: 'string', enum: ['is', 'new', 'reject'] },
          member: { type: 'string' },
        },
        required: ['sessionId', 'decision'],
      },
    })
    // the side panes of earlier versions: the UI now lives above the prompt
    for (const id of ['team-form', 'team-roster']) await $.ui.close({ id })
    // the dock layout reopens its pane; unasked, the engine seats it only on a wide terminal, else the band draws
    if ((await readSettings($)).layout === 'dock') void $.ui.open({ id: DOCK, title: 'Team Orchestrator' })
    await pull($)
    const kept = await readMembers($)
    if (kept.length > 0) await update($, members, () => kept)
    void orcaSetup($)
    void readVersion($)
    $.clock.every(REFRESH_MS, () => {
      tick()
      void refresh($)
    })
    // this session's own status: alive now, and a heartbeat every minute (a silent member shows offline after 5 min)
    void writeMine($, { state: 'idle' })
    $.clock.every(60000, () => void writeMine($, {}))
    // ~3 frames a second, and only where something animates: the band or welcome screen with no team,
    // the form and the roster's org chart once typing has paused, and the spinner while a launch runs.
    $.clock.every(300, () =>
      void (async () => {
        const [m, v, n] = [await read($, members), await read($, view), await read($, note)]
        const busy = n.startsWith('⏳') || (await read($, spawn)).names.length > 0
        const quiet = Date.now() - typedAt > 1500
        if ((m.length === 0 && (v !== 'new' || quiet)) || ((v === 'new' || v === 'roster') && quiet) || busy) await update($, frame, x => x + 1)
      })(),
    )
    return next(e)
  })

  on('tool.call', { tool: ADOPT }, async ($, e) => safely(async () => {
    const held = await onHold($, 'team_adopt')
    if (held) return held
    const input = e as unknown as { team?: string; members: (Spec & { handle?: string; sessionId?: string })[] }
    // a short name is kept from an earlier adopt unless this call gives one (an empty one clears it)
    const given = (m: { short?: string }) => (typeof m.short === 'string' ? { short: m.short.trim() } : {})
    const team = clean(input.team || '') || 'team'
    // the tabs adopted run on this machine
    const here = await machineOf($)
    // which CLI each tab runs (#69), from Orca's terminal list: by handle, else the one tab of that name in this project
    const root = await rootOf($)
    const tabs = await liveTabs($)
    const tabOf = (m: { name: string; handle?: string; address?: string }) => {
      const h = String(m.handle ?? '').trim()
      if (h) return tabs.find(t => String(t.handle ?? '') === h || handleOf(String(t.handle ?? '')) === h)
      const hits = tabs.filter(t => [m.address, m.name].includes(bare(String(t.title ?? ''))) && (!t.worktreePath || under(root, String(t.worktreePath))))
      return hits.length === 1 ? hits[0] : undefined
    }
    const adopted: Member[] = input.members.map(m => {
      const cli = cliOf(tabOf(m as any))
      return {
        team, name: m.name, address: (m as any).address || m.name, role: m.role, level: m.level, boss: m.boss, handle: m.handle ?? '',
        sessionId: m.sessionId ?? '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false, ...given(m),
        ...(here ? { machine: here } : {}),
        ...(cli ? { cli } : {}),
        location: cli && cli !== 'claude' ? 'other-cli' : 'local',
      }
    })
    // keep what is already known about a session that is adopted again (briefing, model, effort, id)
    const known = (await readMembers($)).filter(m => m.team === team)
    await replaceTeam($, team, adopted.map(a => ({ ...(known.find(k => k.name === a.name) ?? {}), ...a, briefed: known.find(k => k.name === a.name)?.briefed ?? false, noted: known.find(k => k.name === a.name)?.noted ?? false, sessionId: a.sessionId || known.find(k => k.name === a.name)?.sessionId || '' })))
    await update($, view, () => 'roster')
    // refresh finds an empty or dead handle by tab title and an empty session id by transcript title
    await refresh($)
    const notes = (await readMembers($)).filter(m => m.team === team && m.note !== '').map(m => `${m.name}: ${m.note}`)
    const external = adopted.filter(a => !isManaged(a)).map(a => `${a.name} (${a.cli})`)
    return {
      result:
        `Roster now shows ${adopted.length} adopted sessions.${notes.length ? ` Notes: ${notes.join('; ')}.` : ''}` +
        (external.length ? ` Not managed, as they run another CLI (never reopened, closed, briefed or messaged by the Team Orchestrator): ${external.join(', ')}.` : ''),
    } as any
  }))

  on('tool.call', { tool: REMOVE_TEAM }, async ($, e) => safely(async () => {
    const held = await onHold($, 'team_remove')
    if (held) return held
    const input = e as unknown as { team: string }
    return { result: await remove($, input.team) } as any
  }))

  on('tool.call', { tool: REMOVE_MEMBER }, async ($, e) => safely(async () => {
    const held = await onHold($, 'member_remove')
    if (held) return held
    const input = e as unknown as { team: string; name: string }
    return { result: await remove($, input.team, input.name) } as any
  }))

  on('tool.call', { tool: MOVE }, async ($, e) => safely(async () => {
    const held = await onHold($, 'member_move')
    if (held) return held
    const input = e as unknown as { team: string; name: string; toTeam: string; boss?: string }
    return { result: await move($, new Set([`${input.team}|${input.name}`]), input.toTeam, input.boss || undefined) } as any
  }))

  // a roster member may not use subagents, and a member with reports may not write files itself, unless allowed;
  // only the team top changes the team files, by tool or by shell
  for (const tool of [AGENT_TOOL, ...WRITE_TOOLS, ...SHELL_TOOLS])
    on('tool.call', { tool } as any, async ($, e, next) => {
      const deny = await guard($, e, tool)
      return deny !== undefined ? ({ deny } as any) : next(e)
    })

  // housekeeping by role: a worker that reports to its boss is told to clean up after itself; a head that hears
  // from one of its reports is told to check on that worker's leftovers (see housekeeping.ts)
  on('tool.call', { tool: 'SendMessage' } as any, async ($, e, next) => {
    const to = String((e as any).to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
    const message = typeof (e as any).message === 'string' ? (e as any).message : ''
    // a message for a worker that auto-close shut down (or that never started): start it first, or queue it. This runs
    // only when the name resolved (SendMessage checks names before any hook); team_message covers the other cases.
    const list0 = to ? await readMembers($) : []
    const target = list0.find(m => m.name === to || m.address === to)
    // a member from another PC, or of another CLI, is never reopened from here: SendMessage answers for it as it can
    if (target && message && isManaged(target) && !isAway(target, await machineOf($)) && isClosed(target, await readStatus($, target.name))) {
      return { result: await deliver($, target, message) } as any
    }
    const r: any = await next(e)
    if (r?.deny !== undefined) return r
    const who = await rosterSelf($)
    const note = who && onSend(who.me, who.list, String((e as any).to ?? ''), await isWindows($))
    if (note && isCleanConfirmation(message)) void writeMine($, { lastClean: Date.now() })
    return note ? { ...r, context: [...(r.context ?? []), note] } : r
  })
  // the turn ends: what the person allowed for it goes with it, and this member's status file records the turn
  on('turn.complete', async ($, e, next) => {
    if ((e as any).agentId !== undefined) return next(e)
    turn = NO_GRANTS
    turnAsk.answered = false
    const r = await next(e)
    void (async () => {
      const who = await rosterSelf($)
      if (!who) return
      const id = String(await $.session.id().catch(() => '')) || who.me.sessionId
      const st = id ? (await statsOf($, await transcripts($), [id])).get(id) : undefined
      const leftover = await countLeftovers($, id)
      // the session's own window and fill, as its status line has them (#63): no guessing from the model's name
      const usage: any = await $.session.usage().catch(() => undefined)
      const window = Number(usage?.context?.window)
      const live = Number.isFinite(window) && window > 0
      const pct = Number(usage?.context?.percent)
      const ctx = live && Number.isFinite(pct) ? Math.round(pct) : st ? (live ? Math.round((st.used * 100) / window) : st.ctx) : undefined
      await writeMine($, {
        state: 'idle',
        turnEnd: Date.now(),
        ...(st?.model ? { model: st.model } : {}),
        ...(st?.effort ? { effort: st.effort } : {}),
        ...(live ? { window } : {}),
        ...(ctx !== undefined && Number.isFinite(ctx) ? { ctx } : {}),
        ...(leftover !== undefined ? { leftover, countedAt: Date.now() } : {}),
      })
    })()
    return r
  })

  on('turn.start', async ($, e, next) => {
    void writeMine($, { state: 'working', turnStart: Date.now() })
    return next(e)
  })

  // asking the person a question shows as "asking"; a Session Panel step becomes this member's task line
  on('tool.call', async ($, e, next) => {
    const tool = String((e as any).tool ?? '')
    if (tool === 'AskUserQuestion') {
      void writeMine($, { state: 'asking' })
      const r: any = await next(e)
      // the user answered a question in this turn: what team_take_top needs before it moves the team top
      if (r && r.deny === undefined && !r.isError) turnAsk.answered = true
      void writeMine($, { state: 'working' })
      return r
    }
    if (/plan_steps$/.test(tool)) {
      const first = ((e as any).steps ?? [])[0]
      if (first) void writeMine($, { task: taskLine(String(first)) })
    } else if (/report_progress$/.test(tool) && Number((e as any).percent) < 100 && (e as any).task) {
      void writeMine($, { task: taskLine(String((e as any).task)) })
    }
    return next(e)
  })

  // SendMessage checks names before any hook runs, so it cannot start a teammate that is not running: its own
  // description says so where the model reads it, and on a team, team_message is listed in front, not behind ToolSearch.
  on('tool.describe', { tool: 'SendMessage' } as any, async ($, e, next) => {
    const r: any = await next(e)
    return {
      ...r,
      description:
        `${r.description}\n\nTeam Orchestrator teams: a teammate that is not running yet, or was closed while idle, is unknown to SendMessage (or shares its name with a Remote Control copy). ` +
        'Message your own reports with the team_message tool instead; it starts the teammate and then delivers.',
    }
  })
  on('tool.describe', { tool: MESSAGE } as any, async ($, e, next) => {
    const r: any = await next(e)
    return (await rosterSelf($)) ? { ...r, isDeferred: false } : r
  })

  on('tool.call', { tool: MESSAGE }, async ($, e) => safely(async () => {
    const held = await onHold($, 'team_message')
    if (held) return held
    const input = e as unknown as { to: string; message: string; summary?: string; startHere?: boolean }
    const to = String(input.to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
    const target = (await readMembers($)).find(m => m.name === to || m.address === to)
    if (!target) return { result: `No member named ${to} on the roster. Use SendMessage for sessions outside the team.` } as any
    return { result: await deliver($, target, String(input.message ?? ''), input.startHere === true) } as any
  }))

  // the user's answer about moving the team top to this PC (#64): only the team top's session or the user's own (not on the
  // roster), and only after an AskUserQuestion answered in this same turn
  on('tool.call', { tool: TAKE } as any, async ($, e) => safely(async () => {
    await pull($)
    const list = await readMembers($)
    const w = await identity($, list)
    const top = projectTop(list)
    const isTop = w.level === 'full' && !!w.me && !!top && keyOf(w.me) === keyOf(top)
    if (!isTop && w.level !== 'none')
      return { deny: 'team_take_top is for the team top\'s own session, or the user\'s own session that is not on the roster.' } as any
    const meta = await readMeta($)
    const here = await machineOf($)
    if (!(e as any).take) {
      told.declined = true
      return { result: `Kept ${meta.topMachine || 'the recorded PC'} as the team top's machine. This session stays read-only for the team files and is not asked again.` } as any
    }
    if (!turnAsk.answered) return { deny: 'Ask the user first with AskUserQuestion in this turn; team_take_top applies the answer.' } as any
    if (!here) return { result: 'This PC gives no computer name (COMPUTERNAME or HOSTNAME), so it cannot be recorded as the team top\'s machine.' } as any
    const was = meta.topMachine
    await serial(async () => $.fs.write(await metaFile($), JSON.stringify({ ...metaAfter(meta, cfg.version, here), topMachine: here }, null, 1)))
    told.away = ''
    told.asked = false
    await $.ui.toast(`Team Orchestrator: this PC (${here}) now holds the team top.${was && was !== here ? ` ${was} is read-only for the team files from now on.` : ''}`)
    await share($)
    return {
      result:
        `This PC (${here}) now holds the team top: it writes the team files, closes idle workers and works the queue.` +
        (was && was !== here ? ` Sessions on ${was} write change files from now on, applied here.` : ''),
    } as any
  }))
  on('tool.describe', { tool: TAKE } as any, async ($, e, next) => {
    const r: any = await next(e)
    return told.asked && !told.declined ? { ...r, isDeferred: false } : r
  })

  // the team top settles a held session with the user's answer; nobody else may
  on('tool.call', { tool: CLAIM } as any, async ($, e) => safely(async () => {
    await pull($)
    const w = await identity($)
    if (w.level !== 'full' || !w.me || w.me.boss !== 'user')
      return { deny: 'member_claim is for the team top only (the confirmed member that reports to the user). Ask the team top to apply the user\'s answer.' } as any
    return { result: await settleClaim($, e as any) } as any
  }))
  on('tool.describe', { tool: CLAIM } as any, async ($, e, next) => {
    const r: any = await next(e)
    const who = await rosterSelf($)
    return who && who.me.boss === 'user' ? { ...r, isDeferred: false } : r
  })

  on('tool.call', { tool: TOOL }, async ($, e) => safely(async () => {
    const held = await onHold($, 'team_launch')
    if (held) return held
    const input = e as unknown as { team: string; members: Spec[]; ifExists?: 'add' | 'merge' }
    await update($, view, () => 'roster')
    return { result: await launch($, input.team, input.members, input.ifExists) } as any
  }))

  // a new member: your own add, a head's or lead's request within its purview, or the top applying your answer (#77)
  on('tool.call', { tool: ADD } as any, async ($, e) => safely(async () => {
    const held = await onHold($, 'member_add')
    if (held) return held
    return (await memberAdd($, e as any)) as any
  }))
  on('tool.describe', { tool: ADD } as any, async ($, e, next) => {
    const r: any = await next(e)
    const who = await rosterSelf($)
    return who && (who.me.boss === 'user' || who.list.some(k => k.boss === who.me.name)) ? { ...r, isDeferred: false } : r
  })

  // routine clean-up never waits for the person: a delete of the member's own scratch is approved here (platform.ts).
  // Only an "ask" is lifted to "allow"; a deny from a rule or the organization stands.
  for (const tool of ['Bash', 'PowerShell'])
    on('tool.check', { tool } as any, async ($, e, next) => {
      const r: any = await next(e)
      if (r?.decision !== 'ask') return r
      const command = String((e as any).input?.command ?? '')
      const t = await readTeamSettings($)
      const who = await rosterSelf($)
      if (!t.autoScratch || !who || !command) return r
      const none = () => undefined
      const temps = [await $.env.get('TEMP').catch(none), await $.env.get('TMP').catch(none), await $.env.get('TMPDIR').catch(none), '/tmp'].map(x => String(x ?? ''))
      const root = await rootOf($)
      const plan = scratchDeletePlan(command, {
        cwd: String(await $.session.cwd().catch(() => root)),
        sessionId: String(await $.session.id().catch(() => '')) || who.me.sessionId,
        head: who.list.some(m => m !== who.me && m.boss === who.me.name),
        temps,
        projectScratch: t.scratchDir.trim() ? `${root}/${t.scratchDir.trim().replace(/^[\\/]+/, '')}` : '',
      })
      // the words allow it; the disk must too: no link from the allowed root down to the target, nor inside a folder
      // a recursive delete empties (a link there would carry the delete into real files). Else the engine's ask stands.
      if (!plan || !(await linkFree(plan, p => $.fs.list(p)))) return r
      return { ...r, decision: 'allow', reason: 'Team Orchestrator: scratch clean-up of this member\'s own temporary files' }
    })

  // the Orca command option: a value that does not start is refused, with the reason shown in /config
  on('config.set', { key: ORCA_KEY } as any, async ($, e, next) => {
    const value = String((e as any).value ?? '').trim()
    if (value) {
      const problem = await orcaProblem($, value)
      if (problem) return { deny: `${problem} Give the full path to Orca's command-line tool, or leave it empty to detect it.` } as any
    }
    return next(e)
  })

  on('command.run', { command: 'team' }, async ($, e) => {
    const list = await readMembers($)
    const teams = [...new Set(list.map(m => m.team))]
    const m = e.args.trim().match(/^name\s+(\S+)(?:\s+(\S+))?/i)
    if (m) {
      const from = m[2] ? clean(m[1] as string) : teams.length === 1 ? (teams[0] as string) : ''
      const to = clean((m[2] ?? m[1]) as string)
      if (from === '' || !teams.includes(from)) return { text: `Usage: /team name <old> <new>. Teams: ${teams.join(', ') || 'none'}` }
      await update($, members, () => list.map(x => (x.team === from ? { ...x, team: to } : x)))
      await share($)
      return { text: `Team ${from} is now ${to}. Address it with @${to}.` }
    }
    await update($, view, () => 'roster') // with no team the roster tab is the welcome screen
    return { text: 'Team Orchestrator opened above the prompt. Rename a team with /team name <old> <new>.' }
  })

  // "@<team> message": hand the message to the team's head and keep this session out of it.
  on('prompt.submit', async ($, e, next) => {
    // #allow-subagent and #allow-write count only in what the person typed at the prompt (origin "composer"): a
    // message from another session, a tool result or a plugin's prompt carrying the words allows nothing. A later
    // prompt of the person's replaces the grants, so one without the words takes them back.
    const g = grantsFrom(e.origin, e.text)
    if (g) turn = g
    // a one-time note for this session (re-attached to its member: the role-file pointer; or on hold) rides along
    // with its next prompt
    await identity($)
    const sid = String(await $.session.id().catch(() => ''))
    const once = pendingNote && pendingNote.id === sid ? pendingNote.text : undefined
    if (once) pendingNote = undefined
    const withOnce = (x: typeof e) => (once ? { ...x, context: [...(x.context ?? []), once] } : x)
    // the person's own Enter is stamped origin.kind 'composer'; a plugin's prompt counts only when it submits as the person (asUser)
    const o: any = e.origin
    // a report from another session: its head is told to check on that worker's leftovers (housekeeping.ts)
    if (o?.kind === 'peer' || o?.kind === 'peer-send-message') {
      const who = await rosterSelf($)
      const note = who && onReceive(who.me, who.list, e.text, await isWindows($))
      // an order from this member's own boss becomes its task line (when Session Panel gives none)
      const from = senderOf(e.text)
      const boss = who && who.list.find(m => m.name === who.me.boss)
      if (boss && from && [boss.name, boss.address].includes(from)) {
        const body = (e.text.match(/<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/)?.[1] ?? e.text).trim()
        void writeMine($, { task: taskLine(body) })
      }
      return next(withOnce(note ? { ...e, context: [...(e.context ?? []), note] } : e))
    }
    if (o !== undefined && o.kind !== 'composer' && !o.asUser) return next(withOnce(e))
    const list = await readMembers($)
    for (const team of new Set(list.map(m => m.team))) {
      const mention = new RegExp(`(^|\\s)@${team}(?=\\s|$)`, 'i')
      if (!mention.test(e.text)) continue
      const head = list.find(m => m.team === team && !list.some(x => x.team === team && x.name === m.boss) && m.handle !== '')
      if (!head) return next(e)
      const rest = e.text.replace(mention, ' ').trim()
      const body = `[user -> team @${team}] ${rest}`
      // a head of another CLI is not messaged (#69); the prompt goes nowhere, with the reason
      if (!isManaged(head)) {
        if (once) pendingNote = { id: sid, text: once }
        return { drop: unmanagedAnswer(head) }
      }
      let ok = false
      let why = ''
      try {
        // a head on this machine with a known session id is addressed by that id (#67): never a same-named session of
        // another project; without an id, SendMessage by name is all there is
        if (head.sessionId && locationOf(head, await machineOf($)) === 'local') {
          const r: any = await $.session.send({ to: { sessionId: head.sessionId }, text: body })
          ok = !!r?.isDelivered
          why = String(r?.reason ?? '')
        } else {
          const r: any = await $.tool.call({ tool: 'SendMessage', to: head.address || head.name, message: body, summary: `message for team @${team}` } as any)
          ok = !r?.isError
          why = String(r?.text ?? '')
        }
      } catch (err) {
        why = String(err)
      }
      if (!ok) {
        const t = await orca($, 'terminal', 'send', '--terminal', head.handle, '--text', body, '--enter')
        ok = t.ok
        why = `${why} | terminal fallback: ${t.out.slice(0, 80)}`
      }
      // this prompt goes nowhere in this session: the note waits for the next one
      if (once) pendingNote = { id: sid, text: once }
      return { drop: ok ? `Sent to team @${team}: ${head.name} will pick it up.` : `Could not reach ${head.name}: ${why.slice(0, 160)}` }
    }
    return next(withOnce(e))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // Another mod's band (below us in the chain) stays on screen, under ours. If it fails, ours still draws.
    let rest: Awaited<ReturnType<typeof next>> | undefined
    try {
      rest = await next(e)
    } catch {
      rest = undefined
    }
    const list = await readMembers($)
    const v = await read($, view)
    const teams = [...new Set(list.map(m => m.team))]
    const idle = list.filter(m => m.state === 'idle').length
    const work = list.filter(m => m.state === 'working').length
    const ask = list.filter(m => m.state === 'asking').length
    const open = v !== 'closed'
    const t: number = await read($, frame)
    const lit = t % 6 < 3 ? t % 6 : -1
    const go = (to: View) => update($, view, () => to)
    await readVersion($)
    // a filled title pill like Session Panel's (a Button takes no background), with the open/close button beside it
    const plainLook = String((await $.env.get('NO_COLOR').catch(() => undefined)) ?? '') !== ''
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold inverse={plainLook} backgroundColor={plainLook ? undefined : 'cyan'} color={plainLook ? undefined : 'black'}>
            {` ◆ Team Orchestrator${cfg.version ? ` v${cfg.version}` : ''} `}
          </Text>
          <Text> </Text>
          <Button key="main" label={open ? '▾' : '▸'} hotkey="t" variant="primary" onPress={() => void (async () => go(open ? 'closed' : 'roster'))()} />
          <Text dimColor> │ </Text>
          {list.length === 0 ? (
            <Text>
              <Text color="yellow" bold>●</Text>
              <Text color="cyan">┬</Text>
              {[0, 1, 2].map(i => (
                <Text color={i === lit ? 'green' : undefined} bold={i === lit} dimColor={i !== lit}>
                  {i === lit ? '●' : '○'}
                </Text>
              ))}
              <Text dimColor> no team yet · press t to spawn a head + workers as Orca tabs</Text>
            </Text>
          ) : (
            <Text>
              <Text color="green">● {idle} idle </Text>
              <Text color="yellow">◐ {work} working </Text>
              {ask > 0 && <Text color="magenta">◆ {ask} asking </Text>}
            </Text>
          )}
          {teams.length > 0 && <Text dimColor> │ {teams.map(t => '@' + t).join(' ')}</Text>}
        </Box>
        {open && !(await docked($)) && (await panel($, ui, v, Number((e.props as any).bodyColumns) || 100))}
        {rest}
      </Box>
    )
  })

  // the dock layout: the same panel in a pane, which the fullscreen layout seats beside the transcript
  on('ui.render', { component: 'Pane', requestId: DOCK }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const v = await read($, view)
    return (
      <Box flexDirection="column">
        {e.props.placement === 'inline' && <Text dimColor>Docks beside the transcript only in the fullscreen layout, from 110 columns; here it sits above the prompt.</Text>}
        {await panel($, ui, v === 'closed' ? 'roster' : v, e.props.bodyColumns || 100)}
      </Box>
    )
  })

  // the person closed the pane: the panel goes back above the prompt
  on('ui.close', { id: DOCK }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, settings, s => ({ ...SETTINGS0, ...s, layout: 'stacked' }))
    return next(e)
  })
}

// True while the dock pane is seated; otherwise (layout not dock, or the pane waits on a narrow terminal) the band draws.
async function docked($: any) {
  if ((await readSettings($)).layout !== 'dock') return false
  const panes: any[] = await $.ui.panes().catch(() => [])
  return panes.some(p => p.id === DOCK && p.isPlaced)
}

async function panel($: any, ui: any, v: View, cols: number) {
  const { Box, Text, Button } = ui
  const go = (to: View) => update($, view, () => to)
  await readVersion($)
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            ◆ TEAM ORCHESTRATOR
          </Text>
          <Text dimColor>{cfg.version ? ` v${cfg.version}` : ''}{'  '}</Text>
          <Button key="tab-roster" label="Roster" onPress={() => void go('roster')} />
          <Button key="tab-new" label="New team" onPress={() => void go('new')} />
          <Button key="tab-settings" label="Settings" onPress={() => void go('settings')} />
        </Box>
        <Button key="close" label="x Close" role="dismiss" onPress={() => void go('closed')} />
      </Box>
      {(await read($, spawn)).names.length > 0
        ? await spawnView($, ui)
        : v === 'new' ? await formView($, ui) : v === 'settings' ? await settingsView($, ui) : await rosterView($, ui, cols)}
    </Box>
  )
}

// While Create starts sessions, this takes the panel: each member being started and where it is, batch by batch.
const SPAWN_LOOK: Record<string, [string, string, string]> = {
  queued: ['○', 'gray', 'waiting for its batch'],
  starting: ['◐', 'yellow', 'starting'],
  working: ['●', 'green', 'ready and briefed'],
  failed: ['✕', 'red', 'failed'],
}
async function spawnView($: any, ui: any) {
  const { Box, Text } = ui
  const sp: Spawn = await read($, spawn)
  const list: Member[] = await readMembers($)
  const t: number = await read($, frame)
  const spin = SPIN[t % SPIN.length] as string
  const rows = sp.names.map(n => list.find(m => m.name === n)).filter((m): m is Member => !!m)
  const teams = new Set(rows.map(m => m.team))
  const later = list.filter(m => teams.has(m.team) && m.state === 'unstarted').length
  return (
    <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text color="yellow">
        ┤ STARTING THE TEAM · batch {sp.batch} of {sp.of} ├
      </Text>
      {rows.map(m => {
        const [glyph, color, what] = SPAWN_LOOK[m.state] ?? ['●', 'green', m.state]
        return (
          <Text>
            <Text color={color}>{m.state === 'starting' ? spin : glyph} </Text>
            <Text color={levelShade(m.level)}>{fit(m.name, 28).padEnd(29)}</Text>
            <Text dimColor>{what}{m.note ? ` (${m.note})` : ''}</Text>
          </Text>
        )
      })}
      {later > 0 && <Text dimColor>{later} more start the first time their boss messages them.</Text>}
    </Box>
  )
}

async function settingsView($: any, ui: any) {
  const { Box, Text, Button, Input } = ui
  const s = await readSettings($)
  const list: Member[] = await readMembers($)
  // a standing permission of one member, kept in the roster file like the rest of its structure
  const flip = async (key: string, field: 'allowAgent' | 'allowWrite') => {
    await pull($)
    await update($, members, old => old.map(m => (keyOf(m) === key ? { ...m, [field]: !m[field] } : m)))
    await share($)
  }
  const set = (patch: Partial<Settings>) => update($, settings, old => ({ ...SETTINGS0, ...old, ...patch }))
  // team-wide worker settings live in a file every session reads; a change redraws through the frame counter
  const ts = await readTeamSettings($)
  const workers = list.filter(m => !list.some(x => x !== m && x.boss === m.name))
  const setTeam = async (patch: Partial<TeamSettings>) => {
    await writeTeamSettings($, patch)
    await update($, frame, x => x + 1)
  }
  const layout = async (to: string) => {
    await set({ layout: to as Settings['layout'] })
    if (to === 'dock') await $.ui.open({ id: DOCK, title: 'Team Orchestrator' })
    else await $.ui.close({ id: DOCK })
  }
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
      <Text color="cyan">┤ SETTINGS ├</Text>
      <Box>
        <Text bold>{'Layout'.padEnd(13)}</Text>
        {Seg(ui, 'layout', [['stacked', 'Stacked'], ['columns', 'Side by side'], ['dock', 'Dock right']], s.layout, v => void layout(v))}
      </Box>
      <Text dimColor>{' '.repeat(13)}Side by side: team cards in columns where two fit. Dock right: a pane beside the transcript in the fullscreen layout (from 110 columns); on the main screen the pane sits above the prompt.</Text>
      <Box>
        <Text bold>{'Org chart'.padEnd(13)}</Text>
        {Seg(ui, 'chart', [['1', 'Show'], ['0', 'Hide']], s.chart ? '1' : '0', v => void set({ chart: v === '1' }))}
      </Box>
      <Box>
        <Text bold>{'Columns'.padEnd(13)}</Text>
        <Box flexWrap="wrap" columnGap={1}>
          {COLS.map(c => (
            <Button
              key={`col-${c}`}
              label={`${s.hide.includes(c) ? '[ ]' : '[x]'} ${c}`}
              plain
              onPress={() => void set({ hide: s.hide.includes(c) ? s.hide.filter(x => x !== c) : [...s.hide, c] })}
            />
          ))}
        </Box>
      </Box>
      <Text dimColor>{' '.repeat(13)}NAME always shows.</Text>
      <Text bold>Workers</Text>
      <Text dimColor>
        Shared by the whole team (.claude/team-orchestrator/settings.json). A worker that said "clean" and stayed idle for the set minutes is closed; a message to it reopens it. Anyone with reports is never closed.
      </Text>
      <Box>
        <Text bold>{'Auto-close'.padEnd(13)}</Text>
        {Seg(ui, 'ts-auto', [['1', 'On'], ['0', 'Off']], ts.autoClose ? '1' : '0', v => void setTeam({ autoClose: v === '1' }))}
      </Box>
      <Box>
        <Text bold>{'Idle minutes'.padEnd(13)}</Text>
        {Seg(ui, 'ts-idle', [['5', '5'], ['10', '10'], ['20', '20'], ['30', '30'], ['60', '60']], String(ts.idleMinutes), v => void setTeam({ idleMinutes: Number(v) }))}
      </Box>
      <Box>
        <Text bold>{'Reopen as'.padEnd(13)}</Text>
        {Seg(ui, 'ts-reopen', [['resume', 'Resume (keep context)'], ['fresh', 'Fresh (briefed again)']], ts.reopen, v => void setTeam({ reopen: v as TeamSettings['reopen'] }))}
      </Box>
      <Box>
        <Text bold>{'Max open'.padEnd(13)}</Text>
        {Seg(ui, 'ts-max', [['0', 'No cap'], ['6', '6'], ['8', '8'], ['10', '10'], ['12', '12']], String(ts.maxOpen), v => void setTeam({ maxOpen: Number(v) }))}
      </Box>
      <Box>
        <Text bold>{'Launch'.padEnd(13)}</Text>
        {Seg(ui, 'ts-launch', [['demand', 'On demand'], ['all', 'All at Create']], ts.launch, v => void setTeam({ launch: v as TeamSettings['launch'] }))}
      </Box>
      <Box>
        <Text bold>{'Batch size'.padEnd(13)}</Text>
        {Seg(ui, 'ts-batch', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6']], String(ts.batch), v => void setTeam({ batch: Number(v) }))}
      </Box>
      <Text dimColor>
        {' '.repeat(13)}On demand: Create starts only the top and the team heads; leads and workers start, fresh and briefed, the first time their boss messages them. Either way sessions start a batch at a time, 5 s apart.
      </Text>
      <Box>
        <Text bold>{'Scratch'.padEnd(13)}</Text>
        {Seg(ui, 'ts-scratch', [['1', 'Auto-approve clean-up'], ['0', 'Ask each time']], ts.autoScratch ? '1' : '0', v => void setTeam({ autoScratch: v === '1' }))}
      </Box>
      <Box>
        <Text bold>{'Scratch dir'.padEnd(13)}</Text>
        <Input key="ts-scratchdir" value={ts.scratchDir} placeholder=".claude/scratch" onInput={(v: string) => void setTeam({ scratchDir: v })} onSubmit={() => {}} />
      </Box>
      <Text dimColor>
        {' '.repeat(13)}Workers may delete inside their own session's temporary folder without asking; heads and leads may also clean the system temp folder and this project folder. Any other delete still asks.
      </Text>
      {workers.length > 0 && (
        <Box>
          <Text bold>{'Never close'.padEnd(13)}</Text>
          <Box flexWrap="wrap" columnGap={1}>
            {workers.map(m => (
              <Button
                key={`ts-exempt-${keyOf(m)}`}
                label={`${ts.exempt.includes(m.name) ? '[x]' : '[ ]'} ${fit(m.name, 22)}`}
                plain
                onPress={() => void setTeam({ exempt: ts.exempt.includes(m.name) ? ts.exempt.filter(x => x !== m.name) : [...ts.exempt, m.name] })}
              />
            ))}
          </Box>
        </Box>
      )}
      {list.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Permissions</Text>
          <Text dimColor>
            A roster member may not use subagents (Agent); a member with reports may not Write or Edit (its own memory folder is open). Both are off until you switch them on here, or for one turn by typing #allow-subagent or #allow-write in your own message.
          </Text>
          {list.map(m => (
            <Box>
              <Text color={levelShade(m.level)}>{fit(m.name, 24).padEnd(25)}</Text>
              <Button key={`perm-agent-${keyOf(m)}`} label={`${m.allowAgent ? '[x]' : '[ ]'} Allow subagents`} plain onPress={() => void flip(keyOf(m), 'allowAgent')} />
              <Text> </Text>
              <Button key={`perm-write-${keyOf(m)}`} label={`${m.allowWrite ? '[x]' : '[ ]'} Allow writes`} plain onPress={() => void flip(keyOf(m), 'allowWrite')} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// Always-visible, clickable choices: a Select pops a list that cannot be clicked or collapsed here.
function Choice(ui: any, id: string, options: string[], value: string, pick: (v: string) => void) {
  const { Box, Button } = ui
  return (
    <Box flexWrap="wrap" columnGap={1}>
      {options.map(o => (
        <Button
          key={`${id}-${o}`}
          label={o === value ? `(*) ${o}` : `( ) ${o}`}
          plain
          variant={o === value ? 'primary' : undefined}
          onPress={() => pick(o)}
        />
      ))}
    </Box>
  )
}

// The screen shown while there is no team: what a team is, drawn in the same glyphs the roster uses, and a
// one-press way into the form. The sketch is animated: a signal runs head -> line -> workers. Everything here only
// moves the form and the view; nothing launches.
function emptyState($: any, ui: any, t: number) {
  const { Box, Text, Button } = ui
  const pick = (p: (typeof PRESETS)[number]) =>
    void (async () => {
      await update($, form, old => ({ ...old, ...p.form }))
      await update($, view, () => 'new')
    })()
  const f = t % 6
  const lit = f >= 2 && f <= 4 ? f - 2 : -1
  // head, line and workers share three columns (2, 7, 12) so the dots sit under each other
  const w = (i: number) => (
    <Text color={i === lit ? 'green' : undefined} bold={i === lit} dimColor={i !== lit}>
      {i === lit ? '●' : '○'}
    </Text>
  )
  return (
    <Box borderStyle="double" borderColor="cyan" paddingX={2} flexDirection="column">
      <Text bold color="cyan">◆ NO TEAM YET</Text>
      <Text dimColor>A team is a set of Claude Code sessions, one Orca tab each, that report up a chain.</Text>
      <Text> </Text>
      <Text>
        <Text color="yellow" bold={f === 0}>{'       ●'}</Text>
        <Text bold>{'          Head'}</Text>
        <Text dimColor>{'     you talk to it; it plans, delegates and reviews'}</Text>
      </Text>
      <Text color={f >= 1 ? 'cyan' : undefined} dimColor={f < 1}>{'  ┌────┼────┐'}</Text>
      <Text>
        {'  '}
        {w(0)}
        {'    '}
        {w(1)}
        {'    '}
        {w(2)}
        <Text bold>{'      Workers'}</Text>
        <Text dimColor>{'  run the tasks and report to their boss'}</Text>
      </Text>
      <Text> </Text>
      <Text color="cyan">┤ Quick start ├</Text>
      <Box flexDirection="column">
        {PRESETS.map(p => (
          <Box>
            <Button key={`preset-${p.label}`} label={p.label.padEnd(18)} variant="primary" onPress={() => pick(p)} />
            <Text color="cyan">{` ${p.sketch.padEnd(8)}`}</Text>
            <Text dimColor>{p.hint}</Text>
          </Box>
        ))}
        <Box>
          <Button key="interview-empty" label={'Interview me instead'.padEnd(18)} onPress={() => void $.prompt.submit({ text: INTERVIEW })} />
          <Text dimColor>{'  Claude asks you questions, then builds the team'}</Text>
        </Box>
      </Box>
    </Box>
  )
}

// ── The live org chart ───────────────────────────────────────────────────────────────────────────────
// The same sketch as the welcome screen, drawn from the real members: each dot is that session's status,
// and a signal runs down every line from a boss to its reports. A report that is offline or failed gets
// no signal; one that is working keeps turning; one that is asking blinks for attention.

type TNode = { m: Member; kids: TNode[]; w: number; x: number; depth: number }
type Cell = { c: string; k?: string; b?: boolean; d?: boolean; h?: string }

const treeOf = (list: Member[]): TNode[] => {
  const names = new Set(list.map(m => m.name))
  const under = new Map<string, Member[]>()
  for (const m of list) under.set(m.boss, [...(under.get(m.boss) ?? []), m])
  const seen = new Set<string>()
  const mk = (m: Member, depth: number): TNode => {
    seen.add(m.name)
    return { m, depth, w: 0, x: 0, kids: (under.get(m.name) ?? []).filter(k => !seen.has(k.name)).map(k => mk(k, depth + 1)) }
  }
  return list.filter(m => !names.has(m.boss)).map(m => mk(m, 0))
}

// The jump marker after a node's name in the org chart (a space, then the arrow). A Button cannot carry a colour, so it
// is a separate cell: the dot and the name keep theirs.
const MARK = ' \u2197'

const statusGlyph = (state: string, t: number, blink: boolean): [string, string] =>
  state === 'working' ? [['◐', '◓', '◑', '◒'][t % 4] as string, 'yellow']
  : state === 'asking' ? [t % 2 === 0 ? '◆' : '◇', 'magenta']
  : state === 'starting' ? [['◜', '◝', '◞', '◟'][t % 4] as string, 'cyan']
  : state === 'offline' || state === 'away' ? [state === 'away' ? '◌' : '○', 'gray']
  : state === 'unmanaged' ? ['◇', 'gray']
  : state === 'failed' ? ['✗', 'red']
  : state === 'closed' || state === 'unstarted' || state === 'queued' ? [state === 'closed' ? '–' : '·', 'gray']
  : [blink ? '◉' : '●', 'green']

// level d sends during frames [6d, 6d+4]; its reports blink on arrival, frames [6d+4, 6d+6]
const sendAt = (d: number, f: number) => (f >= d * 6 && f < d * 6 + 5 ? (f - d * 6) / 4 : -1)
const arriveAt = (d: number, f: number) => f >= d * 6 + 4 && f <= d * 6 + 6

// The grid of cells for one frame. Pure: the same members and frame always give the same drawing.
function chartGrid(list: Member[], t: number, cols: number): Cell[][] {
  const roots = treeOf(list)
  const info = chartLabelInfo(list)
  const all: TNode[] = []
  const collect = (n: TNode) => (all.push(n), n.kids.forEach(collect))
  roots.forEach(collect)
  if (all.length === 0) return []
  // one pass per tier of bosses, then a rest, so a squad repeats faster than a three-tier org
  const f = t % (Math.max(...all.map(n => n.depth)) * 6 + 6)
  // A short name the person gave is shown as typed and cut with "…" only when the chart would not fit otherwise
  // (the automatic labels are short already). A short name used twice shows twice, each with "!". Where even the
  // cut ones do not fit, dots alone (a letter each told no one apart).
  let cap = Infinity
  const tagOf = (mode: string, m: Member) => {
    if (mode !== 'name') return ''
    const i = info.get(`${m.team}|${m.name}`)
    return i ? (i.auto ? i.label : shorten(i.label, cap)) + (i.dup ? '!' : '') : m.name
  }
  const widthOf = (mode: string) => {
    const gap = mode === 'dot' ? 1 : 2
    // each node as wide as its own label, so one long name does not widen every other
    const cell = (n: TNode) => 1 + (tagOf(mode, n.m) ? 1 + tagOf(mode, n.m).length + MARK.length : 0) + 2
    const lay = (n: TNode): number =>
      (n.w = n.kids.length === 0 ? cell(n) : Math.max(cell(n), n.kids.map(lay).reduce((a, b) => a + b, 0) + gap * (n.kids.length - 1)))
    const total = roots.map(lay).reduce((a, b) => a + b, 0) + gap * (roots.length - 1)
    return { gap, total }
  }
  let mode = 'dot'
  for (const c of [Infinity, 14, 10, 6]) {
    cap = c
    if (widthOf('name').total <= Math.max(20, cols - 6)) {
      mode = 'name'
      break
    }
  }
  const { gap } = widthOf(mode)
  const place = (n: TNode, left: number) => {
    if (n.kids.length === 0) return void (n.x = left + (n.w >> 1))
    const span = n.kids.reduce((a, k) => a + k.w, 0) + gap * (n.kids.length - 1)
    let at = left + ((n.w - span) >> 1)
    for (const k of n.kids) (place(k, at), (at += k.w + gap))
    n.x = ((n.kids[0] as TNode).x + (n.kids[n.kids.length - 1] as TNode).x) >> 1
  }
  let at = 0
  for (const r of roots) (place(r, at), (at += r.w + gap))
  const width = Math.max(1, at - gap)
  const depth = Math.max(...all.map(n => n.depth))
  const grid: Cell[][] = Array.from({ length: depth * 2 + 1 }, () => Array.from({ length: width + 2 }, () => ({ c: ' ' }) as Cell))
  const setCell = (r: number, x: number, cell: Cell) => {
    const row = grid[r]
    if (row && x >= 0 && x < row.length) row[x] = cell
  }
  const dead = (m: Member) => m.state === 'offline' || m.state === 'failed' || m.state === 'away' || m.state === 'unmanaged'

  const draw = (n: TNode) => {
    const row = n.depth * 2
    const parentSends = n.depth > 0 && arriveAt(n.depth - 1, f) && !dead(n.m)
    const [g, gc] = statusGlyph(n.m.state, t, parentSends)
    const tag = tagOf(mode, n.m)
    const text = tag ? `${g} ${tag}${MARK}` : g
    const inf = info.get(`${n.m.team}|${n.m.name}`)
    const start = n.x - (text.length >> 1)
    const sending = n.kids.length > 0 && f >= n.depth * 6 && f <= n.depth * 6 + 1
    ;[...text].forEach((ch, i) =>
      setCell(
        row,
        start + i,
        i === 0
          ? { c: ch, k: gc, b: parentSends || sending || n.m.state === 'working' }
          : inf?.dup && tag !== '' && i === text.length - 1 - MARK.length
            ? { c: ch, k: 'red', b: true }
            : tag !== '' && i >= text.length - MARK.length + 1
              ? { c: ch, h: keyOf(n.m) }
              : { c: ch, k: levelShade(n.m.level), b: n.depth === 0, d: dead(n.m) || inf?.auto === true },
      ),
    )
    if (n.kids.length === 0) return
    const cr = row + 1
    const first = (n.kids[0] as TNode).x
    const last = (n.kids[n.kids.length - 1] as TNode).x
    const line = (x: number, c: string) => setCell(cr, x, { c, d: true })
    if (n.kids.length === 1) line(n.x, '│')
    else {
      for (let x = first; x <= last; x++) line(x, '─')
      n.kids.forEach((k, i) => line(k.x, i === 0 ? '┌' : i === n.kids.length - 1 ? '┐' : '┬'))
      line(n.x, n.kids.some(k => k.x === n.x) ? '┼' : '┴')
    }
    // the signal: from the boss's column along the line to each live report's column
    const p = sendAt(n.depth, f)
    if (p >= 0) {
      for (const k of n.kids) {
        if (dead(k.m)) continue
        const D = Math.abs(k.x - n.x)
        const front = Math.round(p * D)
        const dir = k.x >= n.x ? 1 : -1
        for (let d = 0; d <= front; d++) {
          const x = n.x + dir * d
          const cell = grid[cr]?.[x]
          if (cell) setCell(cr, x, { c: cell.c, k: d === front ? 'yellow' : 'cyan', b: true })
        }
      }
    }
    n.kids.forEach(draw)
  }
  roots.forEach(draw)
  return grid
}

function orgChart(ui: any, list: Member[], t: number, cols: number, go?: (key: string) => void) {
  const { Box, Text, Button } = ui
  const grid = chartGrid(list, t, cols)
  if (grid.length === 0) return <Text dimColor>No chart: every member reports to a member that is not on the roster.</Text>
  const segs = (r: Cell[]) => {
    const out: { s: string; k?: string; b?: boolean; d?: boolean; h?: string }[] = []
    for (const c of r) {
      const last = out[out.length - 1]
      if (last && last.k === c.k && last.b === c.b && last.d === c.d && last.h === c.h) last.s += c.c
      else out.push({ s: c.c, k: c.k, b: c.b, d: c.d, h: c.h })
    }
    return out
  }
  return (
    <Box flexDirection="column">
      {grid.map(r => (
        <Box>
          {segs(r).map(s =>
            s.h && go ? (
              <Button key={`node-${s.h}`} label={s.s} plain onPress={() => go(s.h as string)} />
            ) : (
              <Text color={s.k} bold={s.b} dimColor={s.d}>
                {s.s}
              </Text>
            ),
          )}
        </Box>
      ))}
      <Text>
        <Text color="green">● idle  </Text>
        <Text color="yellow">◐ working  </Text>
        <Text color="magenta">◆ asking  </Text>
        <Text color="cyan">◜ starting  </Text>
        <Text color="gray">○ offline  </Text>
        <Text color="red">✗ failed</Text>
      </Text>
    </Box>
  )
}

// The colour of the chosen option in every row of options (Show / Hide, layout, levels...). A Button cannot carry a
// colour, so the chosen one is drawn as coloured text in the same "[ label ]" shape; the rest stay pressable buttons.
const CHOSEN = '#ff5440'

// A row of buttons where the chosen one is drawn in CHOSEN and the rest are not.
function Seg(ui: any, id: string, items: [string, string][], value: string, pick: (v: string) => void) {
  const { Box, Button, Text } = ui
  return (
    <Box flexWrap="wrap" columnGap={1}>
      {items.map(([v, label]) =>
        v === value ? (
          <Box key={`${id}-${v}`}>
            <Text color={CHOSEN} bold>{`[ ${label} ]`}</Text>
          </Box>
        ) : (
          <Button key={`${id}-${v}`} label={label} onPress={() => pick(v)} />
        ),
      )}
    </Box>
  )
}

// A text field that looks like one: a rounded box with the label beside it.
function Field(ui: any, label: string, hint: string, input: any) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{label.padEnd(13)}</Text>
        <Box borderStyle="round" borderColor="cyan" paddingX={1} width={48}>
          {input}
        </Box>
      </Box>
      <Text dimColor>
        {' '.repeat(13)}
        {hint}
      </Text>
    </Box>
  )
}

async function formView($: any, ui: any) {
  const { Box, Text, Input, Button } = ui
  const f: Form = await readForm($)
  const n: string = await read($, note)
  const t: number = await read($, frame)
  const open: string = await read($, menu)
  const set = (patch: Partial<Form>) => {
    typedAt = Date.now()
    return update($, form, old => ({ ...old, ...patch }))
  }
  const org = f.ceo === '1'
  const levels = org ? 3 : Number(f.levels)
  const specs = plan(f)
  const total = specs.length
  const roster = await readMembers($)
  const taken = [...new Set(specs.map(s => clean(s.team || f.team)))].filter(x => roster.some(m => m.team === x))
  const go = (ifExists?: 'add' | 'merge') =>
    void (async () => {
      await update($, note, () => '⏳ Launching...')
      await update($, view, () => 'roster')
      const msg = await launch($, f.team, plan(f), ifExists)
      await update($, note, () => `✔ ${msg}`)
    })()
  const lvRows = Array.from({ length: levels }, (_, i) => i + 1)
  const specOf = new Map(specs.map(s => [s.name, s]))
  const heads = org ? specs.filter(s => s.level === 2).length : 0
  const leads = org ? 0 : specs.filter(s => s.level > 1 && s.level < levels).length
  const workers = levels > 1 ? specs.filter(s => s.level === levels).length : 0
  const glyphOf = (l: number): [string, string | undefined] =>
    org ? (l === 1 ? ['■', 'magenta'] : l === 2 ? ['●', 'yellow'] : ['○', undefined]) : l === 1 ? ['●', 'yellow'] : l === levels ? ['○', undefined] : ['◇', 'cyan']
  const toggle = (k: string) => void update($, menu, old => (old === k ? '' : k))

  // the model / effort table: fixed column widths so every border lines up
  const W = [16, 20, 20]
  const rule = (l: string, m: string, r: string) => l + W.map(w => '─'.repeat(w + 2)).join(m) + r
  const bar = <Text color="cyan">│ </Text>
  const mid = <Text color="cyan"> │ </Text>
  const dd = (key: string, value: string) => (
    <Box>
      <Text color={SHADE[value] ?? 'gray'}>● </Text>
      <Button key={`dd-${key}`} plain label={nice(value).padEnd(16) + ' ▾'} onPress={() => toggle(key)} />
    </Box>
  )
  const cell = (l: number) => {
    const [g, gc] = glyphOf(l)
    const count = specs.filter(s => s.level === l).length
    return (
      <Box>
        {bar}
        <Text color={gc}>{g} </Text>
        <Text bold>{`${levelName(l, f)} ×${count}`.padEnd(14)}</Text>
        {mid}
        {dd(`m${l}`, (f as any)[`m${l}`])}
        {mid}
        {dd(`e${l}`, (f as any)[`e${l}`])}
        <Text color="cyan"> │</Text>
      </Box>
    )
  }
  const menuBox = () => {
    if (open === '') return null
    const isModel = open[0] === 'm'
    const l = Number(open.slice(1))
    const opts = isModel ? MODELS : EFFORTS
    const cur = (f as any)[open] as string
    return (
      <Box marginLeft={isModel ? 21 : 44} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text dimColor>
          {levelName(l, f)} · {isModel ? 'model' : 'effort'}
        </Text>
        {opts.map(o => (
          <Box>
            <Text color={SHADE[o] ?? 'gray'}>● </Text>
            <Button
              key={`opt-${open}-${o}`}
              plain
              label={nice(o).padEnd(14) + (o === cur ? ' ✓' : '  ')}
              onPress={() =>
                void (async () => {
                  await set({ [open]: o } as Partial<Form>)
                  await update($, menu, () => '')
                })()
              }
            />
          </Box>
        ))}
      </Box>
    )
  }

  const rows = treeLines(specs)
  const lit = Math.floor(t / 2) % Math.max(1, rows.length)
  const idle = Date.now() - typedAt > 1500
  const spin = SPIN[t % SPIN.length]
  const pulse = idle ? (t % 4 < 2 ? '◆' : '◇') : '◆'
  return (
    <Box flexDirection="column">
      <Box borderStyle="double" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">{pulse} NEW TEAM</Text>
        <Text dimColor>{'   ① Setup  →  ② Models  →  ③ Preview  →  ▶ Launch'}</Text>
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Text color="cyan">┤ ① SETUP ├</Text>
        {Field(
          ui,
          'Team name',
          'Also how you address it: @name',
          <Input
            key="team"
            value={f.team}
            placeholder="Team name"
            onInput={(v: string) => void set({ team: v.replace(/[^A-Za-z0-9_-]/g, '') || 'team' })}
            onSubmit={() => {}}
          />,
        )}
        {Field(
          ui,
          'Function',
          'What the team is for, in a sentence. The head reads it as its goal.',
          <Input key="fn" value={f.fn} placeholder="What the team is for" onInput={(v: string) => void set({ fn: v })} onSubmit={() => {}} />,
        )}
        <Box>
          <Text bold>{'Quick start'.padEnd(13)}</Text>
          <Box flexWrap="wrap" columnGap={1}>
            {PRESETS.map(p => (
              <Button
                key={`preset-${p.label}`}
                label={p.label}
                variant={sameShape(f, p) ? 'primary' : undefined}
                onPress={() => void set(p.form)}
              />
            ))}
          </Box>
        </Box>
        <Box>
          <Text bold>{'Structure'.padEnd(13)}</Text>
          {Seg(ui, 'struct', [['0', 'One team'], ['1', 'CEO over several teams']], f.ceo, v => void set({ ceo: v, levels: v === '1' ? '3' : '2' }))}
        </Box>
        {org ? (
          Field(
            ui,
            'Teams',
            'Names separated by commas. Each team gets a head and its own workers.',
            <Input key="groups" value={f.groups} placeholder="Team 1, Team 2" onInput={(v: string) => void set({ groups: v })} onSubmit={() => {}} />,
          )
        ) : (
          <Box>
            <Text bold>{'Levels'.padEnd(13)}</Text>
            {Seg(ui, 'levels', [['1', '1 · Head only'], ['2', '2 · Head + workers'], ['3', '3 · Head + leads + workers']], f.levels, v => void set({ levels: v }))}
          </Box>
        )}
        <Box>
          <Text bold>{(org ? 'Workers each' : 'Reports each').padEnd(13)}</Text>
          {Seg(ui, 'fan', [['1', ' 1 '], ['2', ' 2 '], ['3', ' 3 '], ['4', ' 4 '], ['5', ' 5 ']], f.fan, v => void set({ fan: v }))}
        </Box>
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Text color="cyan">┤ ② MODEL AND EFFORT PER LEVEL ├</Text>
        <Text color="cyan">{rule('┌', '┬', '┐')}</Text>
        <Text color="cyan">
          {'│ '}
          <Text bold>{'LEVEL'.padEnd(W[0] ?? 0)}</Text>
          {' │ '}
          <Text bold>{'MODEL'.padEnd(W[1] ?? 0)}</Text>
          {' │ '}
          <Text bold>{'EFFORT'.padEnd(W[2] ?? 0)}</Text>
          {' │'}
        </Text>
        <Text color="cyan">{rule('├', '┼', '┤')}</Text>
        {lvRows.map(l => cell(l))}
        <Text color="cyan">{rule('└', '┴', '┘')}</Text>
        {menuBox()}
        <Text dimColor>Press a cell to open its list. Default leaves the choice to Claude.</Text>
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Text color="cyan">┤ ③ PREVIEW: {org ? 'CEO ' : ''}@{f.team} ├</Text>
        <Text dimColor>
          {total} session{total === 1 ? '' : 's'}: {org ? `1 CEO, ${heads} head${heads === 1 ? '' : 's'}` : '1 head'}
          {leads > 0 ? `, ${leads} lead${leads === 1 ? '' : 's'}` : ''}
          {workers > 0 ? `, ${workers} worker${workers === 1 ? '' : 's'}` : ''}
        </Text>
        {rows.map((l, i) => {
          const lv = specOf.get(l.name)?.level ?? 1
          const [glyph, color] = glyphOf(lv)
          const on = idle && i === lit
          return (
            <Text>
              <Text color="cyan">{on ? '▸ ' : '  '}</Text>
              <Text dimColor>{l.prefix}</Text>
              <Text color={on ? 'green' : color} bold={on}>
                {glyph} {l.name}
              </Text>
              {org && lv === 2 ? <Text dimColor>{'  @' + (specOf.get(l.name)?.team ?? '')}</Text> : null}
            </Text>
          )
        })}
        {total > 8 && <Text color="red">⚠ {total} sessions is a lot: check your usage.</Text>}
      </Box>

      <Box columnGap={1}>
        <Button
          key="go"
          label={`▶ Launch @${f.team} (${total})`}
          variant="primary"
          onPress={() => {
            // a team name already on the roster is never replaced (#77): you pick add or merge below
            if (taken.length > 0)
              return void update($, note, () => `✗ @${taken.join(', @')} is on the roster already. Launching would replace it, so nothing was launched. Add the new members to it, or merge this team into it.`)
            go()
          }}
        />
        <Button key="interview" label="Interview me instead" onPress={() => void $.prompt.submit({ text: INTERVIEW })} />
      </Box>
      {taken.length > 0 && (
        <Box flexDirection="column">
          <Text color="yellow">⚠ @{taken.join(', @')} is on the roster already. Launch never replaces a team; nobody is removed either way:</Text>
          <Box columnGap={1}>
            <Button key="go-add" label={`Add the new members to @${taken[0]}`} onPress={() => go('add')} />
            <Button key="go-merge" label={`Merge into @${taken[0]}`} onPress={() => go('merge')} />
          </Box>
          <Text dimColor>Add: every member here joins as a new member, started on its boss's first message. Merge: a member named like one there is that member, kept as it is; the rest join.</Text>
        </Box>
      )}
      {n !== '' && <Text color="green">{n.startsWith('⏳') ? `${spin}${n.slice(1)}` : n}</Text>}
    </Box>
  )
}

// Each team card's menu. Buttons, not a Select: the terminal's Select takes keys only (arrows, Enter) once
// focused, and a click does nothing on it; a Button takes a click, so the menu opens like the model lists.
// Grouped by what the entries do; each group's glyph marks its entries. "selected" = the ticked rows.
const TEAM_MENU: { glyph: string; title: string; color: string; items: [string, string][] }[] = [
  { glyph: '☐', title: 'Select', color: 'cyan', items: [['selall', 'All'], ['selwork', 'Workers']] },
  {
    glyph: '⇄', title: 'People', color: '#bd93f9',
    items: [['new', 'New member…'], ['add', 'Add member…'], ['movehere', 'Move selected here'], ['boss', 'Change boss…']],
  },
  {
    glyph: '✎', title: 'Sessions', color: '#e5c07b',
    items: [['open', 'Open selected'], ['bulk', 'Rename / model / effort…'], ['short', 'Set short name…'], ['brief', 'Brief team'], ['briefsel', 'Brief selected']],
  },
  { glyph: '✕', title: 'Remove', color: '#ff4d4d', items: [['remove', 'Selected…'], ['rmteam', 'Whole team…']] },
]

async function rosterView($: any, ui: any, cols: number) {
  const { Box, Text, Input, Button } = ui
  const list: Member[] = await readMembers($)
  const b: Bulk = await readBulk($)
  const teams = [...new Set(list.map(m => m.team))]
  const picked = list.filter(m => m.sel).length
  const maxLevel = (team: string) => Math.max(1, ...list.filter(m => m.team === team).map(m => m.level))
  const tick = (pred: (m: Member) => boolean) => update($, members, () => list.map(m => ({ ...m, sel: pred(m) })))
  const toggle = (k: string) => update($, members, () => list.map(m => (keyOf(m) === k ? { ...m, sel: !m.sel } : m)))
  const t: number = await read($, frame)
  const setBulk = (patch: Partial<Bulk>) => {
    typedAt = Date.now()
    return update($, bulk, () => ({ ...b, ...patch }))
  }
  const renameTeam = async (from: string, to: string) => {
    await update($, members, () => list.map(m => (m.team === from ? { ...m, team: to } : m)))
    await share($)
  }
  const s = await readSettings($)
  const labelInfo = chartLabelInfo(list)
  // a member whose home is another PC is drawn dimmed, with that PC's name (#64)
  const here = await machineOf($)
  const away = (m: Member) => isAway(m, here)
  // a derived note: never stored, so it goes the moment the second short name changes
  const noteOf = (m: Member) =>
    [away(m) ? `on ${m.machine}` : '', isManaged(m) ? '' : `not managed (${m.cli})`, m.note, labelInfo.get(keyOf(m))?.dup ? 'short name used twice' : ''].filter(x => x !== '').join(', ')
  // a card's widest wish is its wide plan with whole names; side by side fits as many of those as the width holds
  const widest = Math.max(1, ...teams.map(team => columnPlan(treeLines(list.filter(m => m.team === team)), 1000, s.hide).total + FRAME))
  const perRow = cardsPerRow(s, cols, widest, teams.length)
  const cardW = Math.floor(cols / perRow)
  // a team menu's action: what it works on is the ticked rows; done, the ticks clear (a refused one keeps them)
  const a = await readAct($)
  const setAct = (patch: Partial<Act>) => update($, act, old => ({ ...ACT0, ...old, ...patch }))
  const ticked = new Set(list.filter(m => m.sel).map(keyOf))
  const bosses = bossChoices(list, ticked)
  const finish = async (team: string, work: Promise<string>) => {
    const msg = await work
    const kept = (await readMembers($)).some(m => m.sel)
    await setAct(kept ? { msg, to: team, menu: '' } : { ...ACT0, msg, to: team })
  }
  const pick = async (team: string, kind: string) => {
    const head = list.find(m => m.team === team && !list.some(x => x.team === team && x.name === m.boss))
    const needsTicks = ['movehere', 'remove', 'boss', 'briefsel', 'bulk', 'open', 'short'].includes(kind)
    if (needsTicks && picked === 0) return void (await setAct({ ...ACT0, to: team, msg: 'Tick at least one row first.' }))
    if (kind === 'short') {
      // one row at a time: the short name belongs to one member
      const one = list.filter(m => m.sel)
      if (one.length !== 1 || one[0]!.team !== team) return void (await setAct({ ...ACT0, to: team, msg: 'Tick exactly one row of this team first.' }))
      return void (await setAct({ ...ACT0, kind, to: team, key: keyOf(one[0]!), draft: one[0]!.short ?? '' }))
    }
    if (kind === 'selall') return void (await tick(m => m.sel || m.team === team), await setAct(ACT0))
    if (kind === 'selwork')
      return void (await tick(m => m.sel || (m.team === team && m.level === maxLevel(team) && maxLevel(team) > 1)), await setAct(ACT0))
    if (kind === 'movehere') return void (await finish(team, move($, ticked, team)))
    if (kind === 'open') {
      const m = list.find(x => x.sel && x.handle !== '')
      if (m) await orca($, 'terminal', 'switch', '--terminal', m.handle)
      return void (await setAct({ ...ACT0, to: team, msg: m ? `Opened ${m.name}.` : 'No ticked row has an Orca tab.' }))
    }
    if (kind === 'brief') return void (await finish(team, briefTeam($, team).then(() => `Briefed team @${team}.`)))
    if (kind === 'briefsel') {
      for (const x of new Set(list.filter(m => m.sel).map(m => m.team))) await briefTeam($, x, ticked)
      await update($, members, old => old.map(m => ({ ...m, sel: false })))
      return void (await setAct({ ...ACT0, to: team, msg: `Briefed ${ticked.size} again.` }))
    }
    if (kind === 'add') {
      const tabs = (await liveTabs($))
        .map(x => ({ handle: handleOf(String(x.handle)), title: bare(String(x.title ?? '')) }))
        .filter(x => x.handle !== '' && !list.some(m => m.handle === x.handle))
      return void (await setAct({ ...ACT0, kind, to: team, tabs, handle: tabs[0]?.handle ?? '', boss: head?.name ?? 'user' }))
    }
    // a New member (#77): you add it here, no approval needed; the boss is the team's head unless you pick another
    if (kind === 'new') return void (await setAct({ ...ACT0, kind, to: team, boss: head?.name ?? '' }))
    await setAct({ ...ACT0, kind, to: team })
  }
  const bulkBox = (
    <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text color="yellow">┤ Rename / model / effort: {picked} selected ├</Text>
      <Input
        key="bprefix"
        label="▸ Prefix      "
        value={b.prefix}
        placeholder="optional, put before the name, e.g. qa-"
        onInput={(v: string) => void setBulk({ prefix: v })}
        onSubmit={() => {}}
      />
      <Input
        key="bbase"
        label="▸ Base name   "
        value={b.base}
        placeholder="optional, replaces the current name, e.g. worker"
        onInput={(v: string) => void setBulk({ base: v })}
        onSubmit={() => {}}
      />
      <Text>▸ Numbering</Text>
      {Choice(ui, 'bnum', ['none', '1', '01'], b.numbering, v => void setBulk({ numbering: v }))}
      <Text dimColor>
        Preview: {list.filter(m => m.sel).slice(0, 3).map((m, i) => nameFor(b, m.name, i + 1)).join(', ')}
        {picked > 3 ? ', ...' : ''}
      </Text>
      <Text>▸ Model</Text>
      {Choice(ui, 'bmodel', ['keep', ...MODELS.slice(1)], b.model, v => void setBulk({ model: v }))}
      <Text>▸ Effort</Text>
      {Choice(ui, 'beffort', ['keep', ...EFFORTS.slice(1)], b.effort, v => void setBulk({ effort: v }))}
      <Text dimColor>Idle sessions with a known id restart with --resume (history kept). Busy or adopted ones: label only.</Text>
      <Box>
        <Button key="apply" label="Apply to selected" variant="primary" onPress={() => void applyBulk($)} />
        <Button key="bulk-close" label="Close" onPress={() => void setAct(ACT0)} />
      </Box>
      {b.msg !== '' && <Text color="green">{b.msg}</Text>}
    </Box>
  )
  // the open action of one team card, drawn inside that card
  const actionBox = (team: string, ti: number) => {
    if (a.to !== team) return null
    const cancel = <Button key={`cancel-${ti}`} label="Cancel" onPress={() => void setAct(ACT0)} />
    const box = (title: string, body: any) => (
      <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
        <Text color="yellow">┤ {title} ├</Text>
        {body}
      </Box>
    )
    if (a.kind === 'remove' || a.kind === 'rmteam')
      return box(
        a.kind === 'remove' ? `Remove ${picked} selected from the roster?` : `Remove team @${team} from the roster?`,
        <Box flexDirection="column">
          <Text dimColor>Only the roster changes: no terminal is closed.</Text>
          <Box>
            <Button
              key={`confirm-${ti}`}
              label="Confirm"
              variant="primary"
              onPress={() =>
                void (async () => {
                  if (a.kind === 'rmteam') return finish(team, remove($, team))
                  const out: string[] = []
                  for (const m of list.filter(x => x.sel)) out.push(await remove($, m.team, m.name))
                  await finish(team, Promise.resolve(out.join(' ')))
                })()
              }
            />
            {cancel}
          </Box>
        </Box>,
      )
    if (a.kind === 'boss')
      return box(
        'New boss for the selected',
        bosses.length === 0 ? (
          <Box flexDirection="column">
            <Text>Tick members of one team; the new boss is another member of that team, not below them.</Text>
            {cancel}
          </Box>
        ) : (
          <Box flexDirection="column">
            {Seg(ui, `boss-${ti}`, bosses.map(m => [m.name, m.name] as [string, string]), '', v => void finish(team, changeBoss($, ticked, v)))}
            {cancel}
          </Box>
        ),
      )
    if (a.kind === 'add')
      return box(
        `Add a running session to @${team}`,
        a.tabs.length === 0 ? (
          <Box flexDirection="column">
            <Text>Every live Orca tab is on the roster already.</Text>
            {cancel}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold>Tab</Text>
            {Seg(ui, `addtab-${ti}`, a.tabs.map(x => [x.handle, x.title] as [string, string]), a.handle, v => void setAct({ handle: v }))}
            <Text bold>Boss</Text>
            {Seg(ui, `addboss-${ti}`, [['user', 'user'], ...list.filter(m => m.team === team).map(m => [m.name, m.name] as [string, string])], a.boss, v => void setAct({ boss: v }))}
            <Input
              key={`addrole-${ti}`}
              label="▸ Role "
              value={a.role}
              placeholder="what it does"
              onInput={(v: string) => {
                typedAt = Date.now()
                void setAct({ role: v })
              }}
              onSubmit={() => {}}
            />
            <Box>
              <Button
                key={`addgo-${ti}`}
                label="Add"
                variant="primary"
                onPress={() => {
                  const tab = a.tabs.find(x => x.handle === a.handle) ?? a.tabs[0]!
                  void finish(team, addMember($, tab.handle, tab.title, team, a.boss || 'user', a.role))
                }}
              />
              {cancel}
            </Box>
            <Text dimColor>A brand-new session is added with New member…, not from here.</Text>
          </Box>
        ),
      )
    if (a.kind === 'new') {
      const typed = (patch: Partial<Act>) => {
        typedAt = Date.now()
        void setAct(patch)
      }
      const add = () => void finish(team, addNew($, { team, name: a.name, role: a.role, boss: a.boss, model: a.model, effort: a.effort }))
      return box(
        `New member of @${team}`,
        <Box flexDirection="column">
          <Input key={`newname-${ti}`} label="▸ Name " value={a.name} placeholder="unique in the project, e.g. Worker-4" onInput={(v: string) => typed({ name: v })} onSubmit={() => {}} />
          <Input key={`newrole-${ti}`} label="▸ Role " value={a.role} placeholder="what it does" onInput={(v: string) => typed({ role: v })} onSubmit={() => {}} />
          <Text bold>Boss</Text>
          {Seg(ui, `newboss-${ti}`, list.filter(m => m.team === team).map(m => [m.name, m.name] as [string, string]), a.boss, v => void setAct({ boss: v }))}
          <Text bold>Model</Text>
          {Seg(ui, `newmodel-${ti}`, MODELS.map(o => [o, nice(o)] as [string, string]), a.model, v => void setAct({ model: v }))}
          <Text bold>Effort</Text>
          {Seg(ui, `neweffort-${ti}`, EFFORTS.map(o => [o, nice(o)] as [string, string]), a.effort, v => void setAct({ effort: v }))}
          <Box>
            <Button key={`newgo-${ti}`} label="Add" variant="primary" onPress={add} />
            {cancel}
          </Box>
          <Text dimColor>Saved as not yet, with its role file. It starts fresh and briefed on its boss's first team_message.</Text>
        </Box>,
      )
    }
    if (a.kind === 'short') {
      const who = list.find(m => keyOf(m) === a.key)
      if (!who) return box('Short name', <Box flexDirection="column"><Text>That row is gone.</Text>{cancel}</Box>)
      const now = chartLabelInfo(list).get(a.key)
      const save = (v?: unknown) => void finish(team, setShort($, a.key, typeof v === 'string' ? v : a.draft))
      return box(
        `Short name for ${who.name}`,
        <Box flexDirection="column">
          <Text dimColor>Shown now: {now?.label ?? '-'}{now?.auto ? ' (automatic)' : ''}. An empty name clears yours; the automatic one is used.</Text>
          <Input
            key={`short-${ti}`}
            label="▸ Short name "
            value={a.draft}
            placeholder="shown in the org chart exactly as typed"
            onInput={(v: string) => {
              typedAt = Date.now()
              void setAct({ draft: v })
            }}
            onSubmit={save}
          />
          <Box>
            <Button key={`short-save-${ti}`} label="Save" variant="primary" onPress={() => save()} />
            {cancel}
          </Box>
        </Box>,
      )
    }
    if (a.kind === 'bulk') return bulkBox
    return a.msg !== '' ? <Text color="green">{a.msg}</Text> : null
  }
  return (
    <Box flexDirection="column">
      {list.length === 0 && emptyState($, ui, t)}
      {list.length > 0 && s.chart && (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold color="cyan">◆ LIVE ORG</Text>
          {orgChart(ui, list, t, cols, k => {
            const m = list.find(x => keyOf(x) === k)
            if (m) void goTo($, m).then(msg => setAct({ ...ACT0, to: m.team, msg }))
          })}
        </Box>
      )}
      <Box {...(perRow > 1 ? { flexDirection: 'row', flexWrap: 'wrap' } : { flexDirection: 'column' })}>
      {teams.map((team, ti) => {
        const mine = list.filter(m => m.team === team)
        const rows = treeLines(mine)
        const byName = new Map(mine.map(m => [m.name, m]))
        const unbriefed = mine.filter(m => m.handle && !m.briefed).length
        const head = mine.find(m => !mine.some(x => x.name === m.boss))
        // the cells inside this card, laid out for its real width on every draw
        const inner = cardW - FRAME
        const p = columnPlan(rows, inner, s.hide)
        const top = `╔═ TEAM @${team} ═ ${mine.length} member${mine.length === 1 ? '' : 's'}, head ${head?.name ?? '-'} `
        return (
          <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width={cardW}>
            <Text bold color="cyan">
              {fit(top, inner - 1).padEnd(inner - 1, '═')}╗
            </Text>
            <Input
              key={`tname-${ti}`}
              label="▸ Team name "
              value={team}
              placeholder="type to rename this team (also its @mention)"
              onInput={(v: string) => {
                typedAt = Date.now()
                const to = clean(v)
                if (to !== '' && to !== team) void renameTeam(team, to)
              }}
              onSubmit={() => {}}
            />
            <Text dimColor>{headerLine(p)}</Text>
            {rows.map(r => {
              const m = byName.get(r.name)!
              const [glyph, label, color] = look(m.state)
              const [ctxText, ctxColor] = bar(m.ctx, p.tier === 'wide' ? 8 : p.tier === 'medium' ? 4 : 0)
              const [bt, bc] = m.noted ? ['✓ noted', 'green'] : m.briefed ? ['… sent', 'yellow'] : ['- none', 'gray']
              const effort = m.effort.toLowerCase()
              const value: Record<string, [string, string | undefined]> = {
                STATUS: [p.tier === 'narrow' ? glyph : `${glyph} ${label}`, color],
                CONTEXT: [ctxText.trim(), ctxColor],
                MODEL: [(p.tier === 'wide' ? shownModel(m.model) : family(shownModel(m.model))) || '-', undefined],
                EFFORT: [(p.tier === 'narrow' ? EFFORT_SHORT[effort] : m.effort) || '-', SHADE[effort]],
                BRIEF: [bt, bc],
              }
              // the note goes after the row when it fits whole, else on a line of its own, cut to the card: never wrapped
              const room = inner - p.total
              const rowNote = noteOf(m)
              return (
                <Box flexDirection="column">
                  <Box>
                    <Button key={`sel-${keyOf(m)}`} label={m.sel ? '[x]' : '[ ]'} plain onPress={() => void toggle(keyOf(m))} />
                    <Text> </Text>
                    <Button
                      key={`go-${keyOf(m)}`}
                      label={MARK.trim()}
                      plain
                      onPress={() => void goTo($, m).then(msg => setAct({ ...ACT0, to: team, msg }))}
                    />
                    <Text> </Text>
                    <Text dimColor>{fit(r.prefix, p.nameW - 1)}</Text>
                    <Text color={levelShade(m.level)} dimColor={away(m)}>{cell(r.name, p.nameW - Math.min(r.prefix.length, p.nameW - 1))}</Text>
                    {p.cols.map(c => (
                      <Text color={value[c.id]?.[1]} dimColor={away(m)}>{cell(value[c.id]?.[0] ?? '', c.w)}</Text>
                    ))}
                    {rowNote !== '' && room > rowNote.length && <Text dimColor> {rowNote}</Text>}
                  </Box>
                  {rowNote !== '' && room <= rowNote.length && <Text dimColor>{' '.repeat(CHECK_W)}{fit(rowNote, inner - CHECK_W)}</Text>}
                </Box>
              )
            })}
            <Box>
              <Button
                key={`tact-${ti}`}
                label={a.menu === team ? 'Team actions ▲' : 'Team actions ▼'}
                variant="primary"
                onPress={() => void setAct({ ...ACT0, menu: a.menu === team ? '' : team })}
              />
              <Text dimColor> {picked} selected</Text>
            </Box>
            {a.menu === team && (
              <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="row" flexWrap="wrap" columnGap={3}>
                {TEAM_MENU.map(g => (
                  <Box flexDirection="column">
                    <Text bold color={g.color}>{`${g.glyph} ${g.title.toUpperCase()}`}</Text>
                    {g.items.map(([v, label]) => (
                      <Box>
                        <Text color={g.color}>{'  '}{g.glyph} </Text>
                        <Button
                          key={`tact-${ti}-${v}`}
                          plain
                          label={v === 'brief' && unbriefed > 0 ? `Brief team (${unbriefed} not yet)` : label}
                          onPress={() => void pick(team, v)}
                        />
                      </Box>
                    ))}
                  </Box>
                ))}
              </Box>
            )}
            {actionBox(team, ti)}
            <Text dimColor>╚{'═'.repeat(Math.max(0, inner - 2))}╝</Text>
          </Box>
        )
      })}
      </Box>
      <Box>
        <Button key="refresh" label="Refresh" onPress={() => void refresh($)} />
        <Button key="none" label="Clear selection" onPress={() => void tick(() => false)} />
        <Button key="settings" label="Settings" onPress={() => void update($, view, () => 'settings')} />
      </Box>
    </Box>
  )
}
