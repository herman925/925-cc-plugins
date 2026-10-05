import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Bulk, Form, Member, View } from '../types'

const ORCA = 'orca.exe'
const TOOL = 'mcp__team-orchestrator__team_launch'
const ADOPT = 'mcp__team-orchestrator__team_adopt'
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
  low: 'green', medium: 'cyan', high: 'yellow', xhigh: 'magenta', max: 'red',
}
const nice = (v: string) => LABEL[v] ?? v
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
const bulk = atom({ plugin: 'team-orchestrator', key: 'bulk' } as const, {
  prefix: '',
  base: '',
  numbering: 'none',
  model: 'keep',
  effort: 'keep',
  msg: '',
} as Bulk)

type Spec = { name: string; role: string; level: number; boss: string; team?: string; model?: string; effort?: string }

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

const bar = (pct: number): [string, string] => {
  if (pct < 0) return ['[········]   --', 'gray']
  const f = Math.min(8, Math.round(pct / 12.5))
  return [`[${'█'.repeat(f)}${'░'.repeat(8 - f)}] ${String(pct).padStart(3)}%`, pct < 50 ? 'green' : pct < 80 ? 'yellow' : 'red']
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

const STRUCT = ['team', 'name', 'address', 'role', 'level', 'boss', 'handle', 'sessionId', 'briefed', 'noted'] as const

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
  if (!Array.isArray(saved) || saved.length === 0) return
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

async function briefTeam($: any, team: string) {
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
      .filter(m => m.handle)
      .map(async m => {
        const r = await orca($, 'terminal', 'send', '--terminal', m.handle, '--text', briefText(m, list, team), '--enter')
        if (r.ok) sent.add(m.name)
      }),
  )
  await update($, members, old => old.map(m => ((m.team || 'team') === team && sent.has(m.name) ? { ...m, briefed: true, noted: false } : m)))
  await share($)
}

// Reads state, context, model and effort of every member: Orca's agent state plus the tab's status line.
async function refresh($: any) {
  await pull($)
  const list: Member[] = await readMembers($)
  if (list.length === 0) return
  const ps = await orca($, 'worktree', 'ps')
  const agents: any[] = []
  try {
    for (const w of JSON.parse(ps.out).result.worktrees) agents.push(...(w.agents ?? []))
  } catch {
    // keep whatever we had
  }
  const next = await Promise.all(
    list.map(async m => {
      if (!m.handle) return m
      const show = await orca($, 'terminal', 'show', '--terminal', m.handle)
      if (!show.ok) return { ...m, state: 'offline' }
      let t: any = {}
      try {
        t = JSON.parse(show.out).result.terminal
      } catch {
        return m
      }
      if (t.connected === false) return { ...m, state: 'offline' }
      const rd = await orca($, 'terminal', 'read', '--terminal', m.handle)
      let screen = ''
      let exited = false
      try {
        const rt = JSON.parse(rd.out).result.terminal
        screen = (rt.tail ?? []).join('\n')
        exited = rt.status === 'exited'
      } catch {
        // no screen
      }
      if (exited) return { ...m, state: 'offline' }
      const a = agents.find(x => x.paneKey === `${t.tabId}:${t.leafId}`)
      const raw = String(a?.state ?? '')
      const state = /work|run/.test(raw) ? 'working' : /block|wait|ask|input|permission|question/.test(raw) ? 'asking' : raw === '' ? m.state : 'idle'
      const model = screen.match(/Model:\s*(.+?)\s+v\d[\d.]*\s*\|/)?.[1] ?? m.model
      const effort = screen.match(/Thinking:\s*(\w+)/)?.[1] ?? m.effort
      const ctx = Number(screen.match(/Context:[^\n]*?\((\d+)%\)/)?.[1] ?? m.ctx)
      const noted = m.noted || (m.briefed && /●\s*Noted/.test(screen))
      return { ...m, state, model, effort, ctx, noted }
    }),
  )
  await update($, members, old => next.map(n => ({ ...n, sel: old.find(o => o.name === n.name && (o.team || n.team) === n.team)?.sel ?? n.sel })))
  await share($)
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
        'Put ALREADY RUNNING sessions into the roster without launching anything. members ordered boss-first; handle is the Orca terminal handle (may be empty); address is the session name SendMessage uses (default: name); sessionId optional (needed for restart-based rename/model/effort); boss is a member name or "user".',
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
              },
              required: ['name', 'role', 'level', 'boss'],
            },
          },
        },
        required: ['members'],
      },
    })
    // the side panes of earlier versions: the UI now lives above the prompt
    for (const id of ['team-form', 'team-roster']) await $.ui.close({ id })
    await pull($)
    const kept = await readMembers($)
    if (kept.length > 0) await update($, members, () => kept)
    $.clock.every(15000, () => void refresh($))
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
    const team = clean(input.team || '') || 'team'
    const adopted: Member[] = input.members.map(m => ({
      team, name: m.name, address: (m as any).address || m.name, role: m.role, level: m.level, boss: m.boss, handle: m.handle ?? '',
      sessionId: m.sessionId ?? '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false,
    }))
    // keep what is already known about a session that is adopted again (briefing, model, effort, id)
    const known = (await readMembers($)).filter(m => m.team === team)
    await put($, team, adopted.map(a => ({ ...(known.find(k => k.name === a.name) ?? {}), ...a, briefed: known.find(k => k.name === a.name)?.briefed ?? false, noted: known.find(k => k.name === a.name)?.noted ?? false, sessionId: a.sessionId || known.find(k => k.name === a.name)?.sessionId || '' })))
    await update($, view, () => 'roster')
    await refresh($)
    return { result: `Roster now shows ${adopted.length} adopted sessions.` } as any
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
    // the person's own Enter is stamped origin.kind 'composer'; a plugin's prompt counts only when it submits as the person (asUser)
    const o: any = e.origin
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
        {open && (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
              <Box>
                <Text bold color="cyan">
                  ◆ TEAM ORCHESTRATOR{'  '}
                </Text>
                <Button key="tab-roster" label="Roster" onPress={() => void go('roster')} />
                <Button key="tab-new" label="New team" onPress={() => void go('new')} />
              </Box>
              <Button key="close" label="x Close" role="dismiss" onPress={() => void go('closed')} />
            </Box>
            {v === 'new' ? await formView($, ui) : await rosterView($, ui, Number((e.props as any).bodyColumns) || 100)}
          </Box>
        )}
      </Box>
    )
  })
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
type Cell = { c: string; k?: string; b?: boolean; d?: boolean }

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
  const short = (m: Member) => (m.name.startsWith(`${m.team}-`) ? m.name.slice(m.team.length + 1) : m.name)
  const all: TNode[] = []
  const collect = (n: TNode) => (all.push(n), n.kids.forEach(collect))
  roots.forEach(collect)
  if (all.length === 0) return []
  // one pass per tier of bosses, then a rest, so a squad repeats faster than a three-tier org
  const f = t % (Math.max(...all.map(n => n.depth)) * 6 + 6)
  const tagOf = (mode: string, m: Member) => (mode === 'name' ? short(m) : mode === 'num' ? (short(m).match(/\d+$/)?.[0] ?? short(m).slice(0, 1)) : '')
  const widthOf = (mode: string) => {
    const gap = mode === 'dot' ? 1 : 2
    const cell = Math.max(...all.map(n => 1 + (tagOf(mode, n.m) ? 1 + tagOf(mode, n.m).length : 0))) + (mode === 'dot' ? 2 : 2)
    const lay = (n: TNode): number =>
      (n.w = n.kids.length === 0 ? cell : Math.max(cell, n.kids.map(lay).reduce((a, b) => a + b, 0) + gap * (n.kids.length - 1)))
    const total = roots.map(lay).reduce((a, b) => a + b, 0) + gap * (roots.length - 1)
    return { cell, gap, total }
  }
  const mode = ['name', 'num'].find(md => widthOf(md).total <= Math.max(20, cols - 6)) ?? 'dot'
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
    const text = tag ? `${g} ${tag}` : g
    const start = n.x - (text.length >> 1)
    const sending = n.kids.length > 0 && f >= n.depth * 6 && f <= n.depth * 6 + 1
    ;[...text].forEach((ch, i) =>
      setCell(row, start + i, i === 0 ? { c: ch, k: gc, b: parentSends || sending || n.m.state === 'working' } : { c: ch, b: n.depth === 0, d: dead(n.m) }),
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

function orgChart(ui: any, list: Member[], t: number, cols: number) {
  const { Box, Text } = ui
  const grid = chartGrid(list, t, cols)
  if (grid.length === 0) return <Text dimColor>No chart: every member reports to a member that is not on the roster.</Text>
  const segs = (r: Cell[]) => {
    const out: { s: string; k?: string; b?: boolean; d?: boolean }[] = []
    for (const c of r) {
      const last = out[out.length - 1]
      if (last && last.k === c.k && last.b === c.b && last.d === c.d) last.s += c.c
      else out.push({ s: c.c, k: c.k, b: c.b, d: c.d })
    }
    return out
  }
  return (
    <Box flexDirection="column">
      {grid.map(r => (
        <Text>
          {segs(r).map(s => (
            <Text color={s.k} bold={s.b} dimColor={s.d}>
              {s.s}
            </Text>
          ))}
        </Text>
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

// A row of buttons where the chosen one is drawn in the accent colour and the rest are not.
function Seg(ui: any, id: string, items: [string, string][], value: string, pick: (v: string) => void) {
  const { Box, Button } = ui
  return (
    <Box flexWrap="wrap" columnGap={1}>
      {items.map(([v, label]) => (
        <Button key={`${id}-${v}`} label={label} variant={v === value ? 'primary' : undefined} onPress={() => pick(v)} />
      ))}
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

async function rosterView($: any, ui: any, cols: number) {
  const { Box, Text, Input, Button } = ui
  const list: Member[] = await readMembers($)
  const b: Bulk = await readBulk($)
  const teams = [...new Set(list.map(m => m.team))]
  const picked = list.filter(m => m.sel).length
  const maxLevel = (team: string) => Math.max(1, ...list.filter(m => m.team === team).map(m => m.level))
  const keyOf = (m: Member) => `${m.team}|${m.name}`
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
  return (
    <Box flexDirection="column">
      {list.length === 0 && emptyState($, ui, t)}
      {list.length > 0 && (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold color="cyan">◆ LIVE ORG{'  '}<Text dimColor>dots follow each session's status; the line shows the boss passing work down</Text></Text>
          {orgChart(ui, list, t, cols)}
        </Box>
      )}
      {teams.map((team, ti) => {
        const mine = list.filter(m => m.team === team)
        const rows = treeLines(mine)
        const byName = new Map(mine.map(m => [m.name, m]))
        const nameW = Math.max(12, ...rows.map(r => (r.prefix + r.name).length)) + 1
        const unbriefed = mine.filter(m => m.handle && !m.briefed).length
        const head = mine.find(m => !mine.some(x => x.name === m.boss))
        return (
          <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
            <Text bold color="cyan">
              ╔═ TEAM @{team} ═ {mine.length} member{mine.length === 1 ? '' : 's'}, head {head?.name ?? '-'} ═╗
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
            <Text dimColor>
              {'    '}
              {'NAME'.padEnd(nameW)}
              {'STATUS'.padEnd(11)}
              {'CONTEXT'.padEnd(16)}
              {'MODEL'.padEnd(14)}
              {'EFFORT'.padEnd(8)}
              {'BRIEF'}
            </Text>
            {rows.map(r => {
              const m = byName.get(r.name)!
              const [glyph, label, color] = look(m.state)
              const [ctxText, ctxColor] = bar(m.ctx)
              const [bt, bc] = m.noted ? ['✓ noted', 'green'] : m.briefed ? ['… sent', 'yellow'] : ['- none', 'gray']
              return (
                <Box>
                  <Button key={`sel-${keyOf(m)}`} label={m.sel ? '[x]' : '[ ]'} plain onPress={() => void toggle(keyOf(m))} />
                  <Text> </Text>
                  <Text>{(r.prefix + r.name).padEnd(nameW)}</Text>
                  <Text color={color}>{`${glyph} ${label}`.padEnd(11)}</Text>
                  <Text color={ctxColor}>{ctxText.padEnd(16)}</Text>
                  <Text>{(m.model || '-').padEnd(14)}</Text>
                  <Text>{(m.effort || '-').padEnd(8)}</Text>
                  <Text color={bc}>{bt.padEnd(9)}</Text>
                  {m.handle !== '' && (
                    <Button
                      key={`go-${keyOf(m)}`}
                      label="open"
                      plain
                      onPress={() => void $.process.run([ORCA, 'terminal', 'switch', '--terminal', m.handle, '--json'])}
                    />
                  )}
                </Box>
              )
            })}
            <Box>
              <Button key={`selteam-${ti}`} label="Select team" onPress={() => void tick(m => m.sel || m.team === team)} />
              <Button
                key={`selwork-${ti}`}
                label="Select workers"
                onPress={() => void tick(m => m.sel || (m.team === team && m.level === maxLevel(team) && maxLevel(team) > 1))}
              />
              <Button
                key={`brief-${ti}`}
                label={unbriefed > 0 ? `Brief team (${unbriefed})` : 'Brief again'}
                onPress={() => void briefTeam($, team)}
              />
            </Box>
            <Text dimColor>╚{'═'.repeat(60)}╝</Text>
          </Box>
        )
      })}
      <Box>
        <Button key="refresh" label="Refresh" onPress={() => void refresh($)} />
        <Button key="none" label="Clear selection" onPress={() => void tick(() => false)} />
        <Text dimColor> {picked} selected</Text>
      </Box>
      {picked > 0 && (
        <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text color="yellow">┤ Bulk edit: {picked} selected ├</Text>
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
          </Box>
          {b.msg !== '' && <Text color="green">{b.msg}</Text>}
        </Box>
      )}
    </Box>
  )
}
