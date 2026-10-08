import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Act, Bulk, Form, Member, Settings, View } from '../types'
import { AGENT_TOOL, grantsFrom, judge, NO_GRANTS, pathOf, WRITE_TOOLS } from './guard'
import type { Grants } from './guard'
import { onReceive, onSend, shouldPoll } from './housekeeping'
import { CHECK as CHECK_W, cell, chartLabelInfo, columnPlan, EFFORT_SHORT, family, fit, headerLine, shorten } from './layout'

const ORCA = 'orca.exe'
const TOOL = 'mcp__team-orchestrator__team_launch'
const ADOPT = 'mcp__team-orchestrator__team_adopt'
const REMOVE_TEAM = 'mcp__team-orchestrator__team_remove'
const REMOVE_MEMBER = 'mcp__team-orchestrator__member_remove'
const MOVE = 'mcp__team-orchestrator__member_move'
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
const cardsPerRow = (s: Settings, cols: number, cardW: number, cards: number) =>
  s.layout === 'columns' ? Math.max(1, Math.min(cards, Math.floor(cols / cardW))) : 1
const ACT0: Act = { menu: '', kind: 'none', to: '', key: '', draft: '', boss: '', handle: '', role: '', tabs: [], msg: '' }
const act = atom({ plugin: 'team-orchestrator', key: 'act' } as const, ACT0)
const readAct = async ($: any): Promise<Act> => ({ ...ACT0, ...(await read($, act)) })
// the side pane the panel moves to under the dock layout (the panes of earlier versions had other ids)
const DOCK = 'team-dock'
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
  const r = await $.process.run([ORCA, ...args, '--json'], { timeoutMs: 120000 })
  return r.exitCode === 0
    ? { ok: true, out: r.stdout as string }
    : { ok: false, out: String(r.stderr || r.stdout) }
}

const flags = (model?: string, effort?: string) =>
  `${model && model !== 'default' && model !== 'keep' ? ` --model ${model}` : ''}${effort && effort !== 'default' && effort !== 'keep' ? ` --effort ${effort}` : ''}`


// State kept across a hot reload may predate the team field: such members belong to the one team the old version knew.
const readMembers = async ($: any): Promise<Member[]> => {
  const fallback = (await read($, teamName)) || 'team'
  return (await read($, members)).map(m => ({ ...m, team: m.team || fallback }))
}

// Every session runs its own copy of this mod, so the teams live in one file per project, inside the project:
// <project root>/.claude/team-orchestrator.json. Only the structure is saved (not live status), and only
// when it changed, so the file stays quiet. Another project has its own file and never sees these teams.
const teamFile = async ($: any) => `${String(await $.session.root()).replace(/[\/]+$/, '')}/.claude/team-orchestrator.json`

const STRUCT = ['team', 'name', 'address', 'role', 'level', 'boss', 'handle', 'sessionId', 'short', 'allowAgent', 'allowWrite', 'briefed', 'noted'] as const

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
  const line = `${prefix ?? ''}.claude/team-orchestrator.json`
  const before = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
  if (before.split(/\r?\n/).some(l => l.trim().replace(/^\//, '') === line)) return
  await $.fs.write(path, `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${line}\n`)
}

async function share($: any) {
  const list = await readMembers($)
  const text = JSON.stringify(
    list.map(m => Object.fromEntries(STRUCT.map(k => [k, (m as any)[k]]))),
    null,
    1,
  )
  const file = await teamFile($)
  const before = (await $.fs.exists(file)) ? String(await $.fs.read(file)) : ''
  if (before !== text) {
    await exclude($)
    await $.fs.write(file, text)
  }
}

async function pull($: any) {
  const file = await teamFile($)
  if (!(await $.fs.exists(file))) return
  let saved: Partial<Member>[] = []
  try {
    saved = JSON.parse(String(await $.fs.read(file)))
  } catch {
    return
  }
  // an empty list is a real state (the last team was removed), not a missing file
  if (!Array.isArray(saved)) return
  const fresh = { state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '' }
  await update($, members, old =>
    saved.map(m => {
      const o = old.find(x => x.name === m.name && (x.team || m.team) === m.team)
      return { ...fresh, ...(o ?? {}), ...m, sel: o?.sel ?? false } as Member
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
      `. Do not bypass a lead to instruct someone else's worker.`
    : `YOUR JOB: you EXECUTE the tasks your direct boss gives you and report results back. Your direct boss (one level up): ${m.boss}. ` +
      `COMMUNICATION: talk ONLY to your direct boss. Do NOT message your boss's boss, other leads, or other workers. ` +
      `Worker-to-worker contact is forbidden unless your boss explicitly names that worker to you in a message.`
  return (
    `TEAM BRIEFING (one-time, from the Team Orchestrator). You are ${m.name} in team "${m.team}". Role: ${m.role}. ${rules} ` +
    `Team structure: ${roster}. ` +
    `To message a teammate use the SendMessage tool (Claude Code's native agent messaging), e.g. SendMessage({ to: "<their name>", message: "..." }), where the name is the quoted name shown above or in the structure list. If SendMessage says the name is ambiguous, run ListAgents and retry with the exact "name [ref]" shown there. Do NOT use orca terminal send or the terminal for messages to teammates. ` +
    `Now reply with exactly "Noted" plus one short line restating your role and reporting line, then wait for instructions.`
  )
}

async function briefTeam($: any, team: string, only?: Set<string>) {
  const all: Member[] = await readMembers($)
  const mine = all.filter(m => m.team === team)
  // the briefing lists the team and every boss above it, so a head learns who its CEO is
  const org = new Set(mine.map(m => m.name))
  for (let grew = true; grew; ) {
    grew = false
    for (const m of all) if (org.has(m.name)) for (const b of all) if (b.name === m.boss && !org.has(b.name)) (org.add(b.name), (grew = true))
  }
  const list = all.filter(m => org.has(m.name))
  const sent = new Set<string>()
  await Promise.all(
    mine
      .filter(m => m.handle && (!only || only.has(keyOf(m))))
      .map(async m => {
        const r = await orca($, 'terminal', 'send', '--terminal', m.handle, '--text', briefText(m, list, team), '--enter')
        if (r.ok) sent.add(m.name)
      }),
  )
  await update($, members, old => old.map(m => ((m.team || 'team') === team && sent.has(m.name) ? { ...m, briefed: true, noted: false } : m)))
  await share($)
}

// ── Transcripts: <config dir>/projects/<project>/<session id>.jsonl ──────────────────────────────────────────
// Only three things are taken from a transcript: its last customTitle, and the last assistant message's model,
// usage (as a context percent), effort and cwd. Nothing else is kept or shown: a transcript can hold secrets.
type Transcript = { id: string; path: string; mtimeMs: number }
type Stats = { model: string; ctx: number; effort: string; cwd: string }

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
async function tails($: any, files: string[]): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < files.length; i += 15) {
    const part = files.slice(i, i + 15)
    const r = await $.process
      .run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', TAIL_PS], { env: { TO_FILES: part.join('|'), TO_BYTES: String(TAIL) }, timeoutMs: 60000 })
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

// The window is 200k unless the id says [1m]; a session already past 200k must be on the 1M window.
const lastStats = (text: string): Stats | undefined => {
  const lines = text.split('\n')
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
    const window = /\[1m\]$/.test(model) || used > 200000 ? 1000000 : 200000
    return {
      model: model.replace(/^claude-/, ''),
      ctx: Math.round((used * 100) / window),
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

// ── Who this session is ──
// The roster member this session is: the one whose session id matches, else the one whose name is the title this
// session's transcript carries. A session that is neither is not on the roster and is never judged. The answer for a
// session that is not found is kept for half a minute, so an unrelated session in the same project does not make
// every tool call read its transcript.
const found = new Map<string, { at: number; key: string }>()
async function whoAmI($: any, list: Member[]): Promise<Member | undefined> {
  const id = String(await $.session.id().catch(() => ''))
  if (id === '') return undefined
  const byId = list.find(m => m.sessionId === id)
  if (byId) return byId
  const kept = found.get(id)
  if (kept && Date.now() - kept.at < 30000) return list.find(m => keyOf(m) === kept.key)
  let me: Member | undefined
  const own = (await transcripts($)).filter(t => t.id === id)
  if (own.length > 0) {
    const title = (await peek($, own))[0]?.title
    if (title) me = list.find(m => namesOf(m).includes(title))
  }
  found.set(id, { at: Date.now(), key: me ? keyOf(me) : '' })
  return me
}

// The person's own Claude config folders: where a memory folder lives (<dir>/projects/<project>/memory/).
async function claudeDirs($: any): Promise<string[]> {
  const none = () => undefined
  const home = (await $.env.get('USERPROFILE').catch(none)) || (await $.env.get('HOME').catch(none))
  const custom = await $.env.get('CLAUDE_CONFIG_DIR').catch(none)
  return [custom, home ? `${home}/.claude` : ''].filter((x): x is string => !!x)
}

// Whether this session is the one that polls Orca for the roster (see refresh).
async function pollsOrca($: any, list: Member[]): Promise<boolean> {
  const me = await whoAmI($, list)
  return shouldPoll(me)
}

// This session's roster entry and the roster, or undefined when the session is not a member.
async function rosterSelf($: any): Promise<{ me: Member; list: Member[] } | undefined> {
  await pull($)
  const list = await readMembers($)
  if (list.length === 0) return undefined
  const me = await whoAmI($, list)
  return me ? { me, list } : undefined
}

// What the person allowed for the turn that is running: set by the person's own prompt, cleared when the turn ends.
let turn: Grants = NO_GRANTS

// One call of the Agent, Write, Edit or NotebookEdit tool by a roster member: refused, or let through (with a line
// in the toast when a grant made the difference). A session that is not on the roster is let through untouched.
async function guard($: any, e: any, tool: string): Promise<string | undefined> {
  await pull($)
  const list = await readMembers($)
  if (list.length === 0) return undefined
  const me = await whoAmI($, list)
  if (!me) return undefined
  const v = judge({ me, list, tool, path: pathOf(e), grants: turn, claudeDirs: await claudeDirs($) })
  if (!v) return undefined
  await $.ui.toast(v.line)
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
  const list: Member[] = await readMembers($)
  if (list.length === 0) return
  // Only one session polls Orca: the team's top member (boss "user"), or a session not on the roster (the person's
  // own). Every other member just pulls the roster file that session shares. Fourteen sessions each reading fourteen
  // terminals every refresh queued ~200 orca calls at once and made Orca's own typing and scrolling lag.
  if (!(await pollsOrca($, list))) return
  const ps = await orca($, 'worktree', 'ps')
  const agents: any[] = []
  try {
    for (const w of JSON.parse(ps.out).result.worktrees) agents.push(...(w.agents ?? []))
  } catch {
    // keep whatever we had
  }
  const shown = await Promise.all(list.map(m => (m.handle ? showTab($, m.handle) : undefined)))
  const all = await transcripts($)
  const root = String(await $.session.root())
  // Where a member's session runs: the folder its transcript last ran in, else the project's own folder. A tab in
  // another worktree is never this member's, whatever its title says (two teams may both have a "Head").
  const ran = await statsOf($, all, list.map(m => m.sessionId).filter(Boolean))
  const whereOf = (sessionId: string) => ran.get(sessionId)?.cwd || root
  const fits = (tab: any, where: string) => {
    const wt = String(tab?.worktreePath ?? '')
    return wt === '' || under(where, wt)
  }
  // one list of tabs and one transcript scan per refresh, not one per member
  const tabs = shown.some((t, i) => !t || !fits(t, whereOf((list[i] as Member).sessionId))) ? await liveTabs($) : []
  const ids = list.some(m => !m.sessionId) ? await sessionsNamed($, all, list.filter(m => !m.sessionId).flatMap(namesOf), root) : new Map<string, string>()
  const firstPass = await Promise.all(
    list.map(async (m0, i) => {
      const notes: string[] = []
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
      if (t) {
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
      const state = (!t && m.handle) || exited ? 'offline' : /work|run/.test(raw) ? 'working' : /block|wait|ask|input|permission|question/.test(raw) ? 'asking' : raw === '' ? m.state : 'idle'
      const line = {
        model: screen.match(/Model:\s*(.+?)\s+v\d[\d.]*\s*\|/)?.[1],
        effort: screen.match(/Thinking:\s*(\w+)/)?.[1],
        ctx: screen.match(/Context:[^\n]*?\((\d+)%\)/)?.[1],
      }
      const noted = m.noted || (m.briefed && /●\s*Noted/.test(screen))
      return { m: { ...m, state, noted }, line, live: !!t && !exited, notes }
    }),
  )
  // the transcript, in one read, for every member whose status line lacks the model or the context
  const lacking = firstPass.filter(r => r.m.sessionId && (r.line.model === undefined || r.line.ctx === undefined)).map(r => r.m.sessionId)
  const stats = lacking.length > 0 ? await statsOf($, all, lacking) : new Map<string, Stats | undefined>()
  const next = firstPass.map(({ m, line, live, notes }) => {
    const tr = line.model === undefined || line.ctx === undefined ? stats.get(m.sessionId) : undefined
    if (live && line.model === undefined && line.ctx === undefined && !tr) notes.push('status line not readable')
    return {
      ...m,
      model: line.model ?? tr?.model ?? m.model,
      effort: line.effort ?? (tr?.effort || m.effort),
      ctx: Number(line.ctx ?? tr?.ctx ?? m.ctx),
      note: withNotes(m.note, notes),
    }
  })
  await update($, members, old => next.map(n => ({ ...n, sel: old.find(o => o.name === n.name && (o.team || n.team) === n.team)?.sel ?? n.sel })))
  await share($)
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
  const added: Member = {
    team, name, address: name, role: role || 'member', level: b ? b.level + 1 : 1, boss: b ? b.name : 'user', handle, sessionId: '',
    state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false,
  }
  await update($, members, () => [...all.map(m => ({ ...m, sel: false })), added])
  await share($)
  await refresh($)
  return `Added ${name} to team "${team}" under ${added.boss}.`
}

// Replace one team's members, leaving the other teams of the project alone.
async function put($: any, team: string | string[], mine: Member[]) {
  const all = await readMembers($)
  const gone = new Set(Array.isArray(team) ? team : [team])
  await update($, members, () => [...all.filter(m => !gone.has(m.team)), ...mine])
  await share($)
}

async function launch($: any, team: string, input: Spec[]): Promise<string> {
  // A name is how SendMessage finds a session, so it must be unique across every team of the project.
  // A name already used by another team (two squads both have a "Head") gets its team in front.
  const launching = new Set(input.map(s => clean(s.team || team)))
  const taken = new Set((await readMembers($)).filter(m => !launching.has(m.team)).map(m => m.name))
  const renamed = new Map<string, string>()
  const named = input.map(s => {
    const t = clean(s.team || team)
    const base = clean(s.name)
    const name = taken.has(base) ? clean(`${t}-${base}`) : base
    taken.add(name)
    renamed.set(s.name, name)
    return { ...s, name, team: t }
  })
  const specs = named.map(s => ({ ...s, boss: s.boss === 'user' ? 'user' : (renamed.get(s.boss) ?? clean(s.boss)) }))
  const cur = await orca($, 'worktree', 'current')
  const wt = (cur.out.match(/"worktree":\s*\{\s*"id":\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? '').replace(/\\\\/g, '\\')
  if (!cur.ok || !wt) return `Cannot find the Orca worktree: ${cur.out.slice(0, 200)}`
  const made: Member[] = []
  const teamsMade = [...new Set(specs.map(s => s.team))]
  for (const s of specs) {
    const sessionId = uuid()
    const r = await orca(
      $,
      'terminal', 'create', '--worktree', `id:${wt}`, '--title', s.name,
      '--command', `claude --name ${s.name} --session-id ${sessionId}${flags(s.model, s.effort)}`,
    )
    const handle = r.ok ? handleOf(r.out) : ''
    made.push({
      team: s.team, name: s.name, address: s.name, role: s.role, level: s.level, boss: s.boss, handle, sessionId,
      state: handle ? 'starting' : 'failed', ctx: -1,
      model: s.model && s.model !== 'default' ? s.model : '', effort: s.effort && s.effort !== 'default' ? s.effort : '',
      sel: false, note: handle ? '' : r.out.slice(0, 80), briefed: false, noted: false,
      ...(s.short?.trim() ? { short: s.short.trim() } : {}),
    })
    await put($, teamsMade, made)
  }
  await Promise.all(
    made
      .filter(m => m.handle)
      .map(async m => {
        const w = await orca($, 'terminal', 'wait', '--terminal', m.handle, '--for', 'tui-idle', '--timeout-ms', '90000')
        if (!w.ok || !/"satisfied":\s*true/.test(w.out)) {
          m.state = 'failed'
          m.note = 'not ready'
          return
        }
        const s = await orca($, 'terminal', 'send', '--terminal', m.handle, '--text', briefText(m, made, team), '--enter')
        m.state = s.ok ? 'working' : 'failed'
        m.briefed = s.ok
      }),
  )
  await put($, teamsMade, made)
  await refresh($)
  return `Launched ${made.length} sessions in ${teamsMade.length === 1 ? `"${teamsMade[0]}"` : `${teamsMade.length} teams (${teamsMade.join(', ')})`}, all briefed.`
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
    const canRestart = m.sessionId !== '' && m.handle !== '' && m.state === 'idle'
    if (canRestart) {
      await orca($, 'terminal', 'close', '--terminal', m.handle)
      const r = await orca(
        $,
        'terminal', 'create', '--worktree', 'active', '--title', newName,
        '--command', `claude --resume ${m.sessionId} --name ${newName}${flags(wantModel ? b.model : '', wantEffort ? b.effort : '')}`,
      )
      const handle = r.ok ? handleOf(r.out) : ''
      done.set(key(m), {
        name: newName, handle, state: handle ? 'starting' : 'failed', note: handle ? '' : r.out.slice(0, 60),
        model: wantModel ? b.model : m.model, effort: wantEffort ? b.effort : m.effort, sel: false,
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: 'Open the Team Orchestrator form' })
    await $.tool.register({
      name: 'team_launch',
      description:
        'Launch a team of Claude Code sessions as Orca tabs in the current worktree. members is ordered boss-first; boss is a member name or "user". model/effort optional per member (opus, sonnet, haiku, fable / low, medium, high, xhigh, max).',
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
    // the side panes of earlier versions: the UI now lives above the prompt
    for (const id of ['team-form', 'team-roster']) await $.ui.close({ id })
    // the dock layout reopens its pane; unasked, the engine seats it only on a wide terminal, else the band draws
    if ((await readSettings($)).layout === 'dock') void $.ui.open({ id: DOCK, title: 'Team Orchestrator' })
    await pull($)
    const kept = await readMembers($)
    if (kept.length > 0) await update($, members, () => kept)
    $.clock.every(30000, () => void refresh($))
    // ~3 frames a second, and only where something animates: the band or welcome screen with no team,
    // the form and the roster's org chart once typing has paused, and the spinner while a launch runs.
    $.clock.every(300, () =>
      void (async () => {
        const [m, v, n] = [await read($, members), await read($, view), await read($, note)]
        const busy = n.startsWith('⏳')
        const quiet = Date.now() - typedAt > 1500
        if ((m.length === 0 && (v !== 'new' || quiet)) || ((v === 'new' || v === 'roster') && quiet) || busy) await update($, frame, x => x + 1)
      })(),
    )
    return next(e)
  })

  on('tool.call', { tool: ADOPT }, async ($, e) => {
    const input = e as unknown as { team?: string; members: (Spec & { handle?: string; sessionId?: string })[] }
    // a short name is kept from an earlier adopt unless this call gives one (an empty one clears it)
    const given = (m: { short?: string }) => (typeof m.short === 'string' ? { short: m.short.trim() } : {})
    const team = clean(input.team || '') || 'team'
    const adopted: Member[] = input.members.map(m => ({
      team, name: m.name, address: (m as any).address || m.name, role: m.role, level: m.level, boss: m.boss, handle: m.handle ?? '',
      sessionId: m.sessionId ?? '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false, ...given(m),
    }))
    // keep what is already known about a session that is adopted again (briefing, model, effort, id)
    const known = (await readMembers($)).filter(m => m.team === team)
    await put($, team, adopted.map(a => ({ ...(known.find(k => k.name === a.name) ?? {}), ...a, briefed: known.find(k => k.name === a.name)?.briefed ?? false, noted: known.find(k => k.name === a.name)?.noted ?? false, sessionId: a.sessionId || known.find(k => k.name === a.name)?.sessionId || '' })))
    await update($, view, () => 'roster')
    // refresh finds an empty or dead handle by tab title and an empty session id by transcript title
    await refresh($)
    const notes = (await readMembers($)).filter(m => m.team === team && m.note !== '').map(m => `${m.name}: ${m.note}`)
    return { result: `Roster now shows ${adopted.length} adopted sessions.${notes.length ? ` Notes: ${notes.join('; ')}.` : ''}` } as any
  })

  on('tool.call', { tool: REMOVE_TEAM }, async ($, e) => {
    const input = e as unknown as { team: string }
    return { result: await remove($, input.team) } as any
  })

  on('tool.call', { tool: REMOVE_MEMBER }, async ($, e) => {
    const input = e as unknown as { team: string; name: string }
    return { result: await remove($, input.team, input.name) } as any
  })

  on('tool.call', { tool: MOVE }, async ($, e) => {
    const input = e as unknown as { team: string; name: string; toTeam: string; boss?: string }
    return { result: await move($, new Set([`${input.team}|${input.name}`]), input.toTeam, input.boss || undefined) } as any
  })

  // a roster member may not use subagents, and a member with reports may not write files itself, unless allowed
  for (const tool of [AGENT_TOOL, ...WRITE_TOOLS])
    on('tool.call', { tool } as any, async ($, e, next) => {
      const deny = await guard($, e, tool)
      return deny !== undefined ? ({ deny } as any) : next(e)
    })

  // housekeeping by role: a worker that reports to its boss is told to clean up after itself; a head that hears
  // from one of its reports is told to check on that worker's leftovers (see housekeeping.ts)
  on('tool.call', { tool: 'SendMessage' } as any, async ($, e, next) => {
    const r: any = await next(e)
    if (r?.deny !== undefined) return r
    const who = await rosterSelf($)
    const note = who && onSend(who.me, who.list, String((e as any).to ?? ''))
    return note ? { ...r, context: [...(r.context ?? []), note] } : r
  })
  // the turn ends: what the person allowed for it goes with it
  on('turn.complete', async ($, e, next) => {
    if ((e as any).agentId === undefined) turn = NO_GRANTS
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { team: string; members: Spec[] }
    await update($, view, () => 'roster')
    return { result: await launch($, input.team, input.members) } as any
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
    // the person's own Enter is stamped origin.kind 'composer'; a plugin's prompt counts only when it submits as the person (asUser)
    const o: any = e.origin
    // a report from another session: its head is told to check on that worker's leftovers (housekeeping.ts)
    if (o?.kind === 'peer' || o?.kind === 'peer-send-message') {
      const who = await rosterSelf($)
      const note = who && onReceive(who.me, who.list, e.text)
      return next(note ? { ...e, context: [...(e.context ?? []), note] } : e)
    }
    if (o !== undefined && o.kind !== 'composer' && !o.asUser) return next(e)
    const list = await readMembers($)
    for (const team of new Set(list.map(m => m.team))) {
      const mention = new RegExp(`(^|\\s)@${team}(?=\\s|$)`, 'i')
      if (!mention.test(e.text)) continue
      const head = list.find(m => m.team === team && !list.some(x => x.team === team && x.name === m.boss) && m.handle !== '')
      if (!head) return next(e)
      const rest = e.text.replace(mention, ' ').trim()
      const body = `[user -> team @${team}] ${rest}`
      let ok = false
      let why = ''
      try {
        const r: any = await $.tool.call({ tool: 'SendMessage', to: head.address || head.name, message: body, summary: `message for team @${team}` } as any)
        ok = !r?.isError
        why = String(r?.text ?? '')
      } catch (err) {
        why = String(err)
      }
      if (!ok) {
        const t = await orca($, 'terminal', 'send', '--terminal', head.handle, '--text', body, '--enter')
        ok = t.ok
        why = `${why} | terminal fallback: ${t.out.slice(0, 80)}`
      }
      return { drop: ok ? `Sent to team @${team}: ${head.name} will pick it up.` : `Could not reach ${head.name}: ${why.slice(0, 160)}` }
    }
    return next(e)
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
    return (
      <Box flexDirection="column">
        <Box>
          <Button
            key="main"
            label="◆ Team Orchestrator"
            hotkey="t"
            variant="primary"
            onPress={() => void (async () => go(open ? 'closed' : 'roster'))()}
          />
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
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            ◆ TEAM ORCHESTRATOR{'  '}
          </Text>
          <Button key="tab-roster" label="Roster" onPress={() => void go('roster')} />
          <Button key="tab-new" label="New team" onPress={() => void go('new')} />
          <Button key="tab-settings" label="Settings" onPress={() => void go('settings')} />
        </Box>
        <Button key="close" label="x Close" role="dismiss" onPress={() => void go('closed')} />
      </Box>
      {v === 'new' ? await formView($, ui) : v === 'settings' ? await settingsView($, ui) : await rosterView($, ui, cols)}
    </Box>
  )
}

async function settingsView($: any, ui: any) {
  const { Box, Text, Button } = ui
  const s = await readSettings($)
  const list: Member[] = await readMembers($)
  // a standing permission of one member, kept in the roster file like the rest of its structure
  const flip = async (key: string, field: 'allowAgent' | 'allowWrite') => {
    await pull($)
    await update($, members, old => old.map(m => (keyOf(m) === key ? { ...m, [field]: !m[field] } : m)))
    await share($)
  }
  const set = (patch: Partial<Settings>) => update($, settings, old => ({ ...SETTINGS0, ...old, ...patch }))
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
  : state === 'offline' ? ['○', 'gray']
  : state === 'failed' ? ['✗', 'red']
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
  const dead = (m: Member) => m.state === 'offline' || m.state === 'failed'

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
            void (async () => {
              await update($, note, () => '⏳ Launching...')
              await update($, view, () => 'roster')
              const msg = await launch($, f.team, plan(f))
              await update($, note, () => `✔ ${msg}`)
            })()
          }}
        />
        <Button key="interview" label="Interview me instead" onPress={() => void $.prompt.submit({ text: INTERVIEW })} />
      </Box>
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
    items: [['add', 'Add member…'], ['movehere', 'Move selected here'], ['boss', 'Change boss…']],
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
  // a derived note: never stored, so it goes the moment the second short name changes
  const noteOf = (m: Member) => [m.note, labelInfo.get(keyOf(m))?.dup ? 'short name used twice' : ''].filter(x => x !== '').join(', ')
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
      if (m) await $.process.run([ORCA, 'terminal', 'switch', '--terminal', m.handle, '--json'])
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
            <Text dimColor>A new session is launched from New team (or team_launch), not from here.</Text>
          </Box>
        ),
      )
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
                MODEL: [(p.tier === 'wide' ? m.model : family(m.model)) || '-', undefined],
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
                    <Text color={levelShade(m.level)}>{cell(r.name, p.nameW - Math.min(r.prefix.length, p.nameW - 1))}</Text>
                    {p.cols.map(c => (
                      <Text color={value[c.id]?.[1]}>{cell(value[c.id]?.[0] ?? '', c.w)}</Text>
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
