import type { AssumptionTrack, CleanChecklist, CleanTask } from '../types'

// Pure helpers for Session Panel: no engine calls here, so tests can use them directly.

export const MAX_NAME = 40
export const MAX_STEPS = 8
export const METER_CELLS = 10

const CODE_EXT =
  /\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|cs|cpp|c|h|php|sh|ps1|json|ya?ml|toml|md|css|scss|html?|xml|sql|txt|csv|lock|docx?|xlsx?|pptx?)$/i

/** One cleaner for every name: no code, no paths, no file names, 40 characters at most. */
export function cleanName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : ''
  const withoutCode = text.replace(/`[^`]*`/g, ' ')
  const words = withoutCode
    .split(/\s+/)
    .filter(w => w !== '' && !/[\\/]/.test(w) && !CODE_EXT.test(w.replace(/[.,;:!?)"'\]]+$/, '')))
  let name = words.join(' ').trim()
  if (name === '') return 'Working on it'
  name = name.charAt(0).toUpperCase() + name.slice(1)
  if (name.length > MAX_NAME) {
    let cut = name.slice(0, MAX_NAME - 1)
    const space = cut.lastIndexOf(' ')
    if (space > 8) cut = cut.slice(0, space)
    name = cut.trimEnd().replace(/[,.;:\-]+$/, '') + '…'
  }
  return name
}

/** A 2 to 6 word job name from the model's answer. */
export function cleanTitle(raw: unknown): string {
  const first = String(raw ?? '').split('\n')[0] ?? ''
  const words = cleanName(first.replace(/["“”]/g, '')).replace(/…$/, '').split(' ').slice(0, 6)
  return cleanName(words.join(' '))
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function meter(percent: number, cells = METER_CELLS): string {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

/** A moving three-cell block, or a static bar when motion is off. */
export function sweep(frame: number, isStill: boolean, cells = METER_CELLS): string {
  if (isStill) return '▒'.repeat(cells)
  const span = cells + 2
  const pos = (frame % span) - 2
  let out = ''
  for (let i = 0; i < cells; i++) out += i >= pos && i < pos + 3 ? '▓' : '░'
  return out
}

export function actionLabel(tool: string): string {
  if (tool === 'Read') return 'Reading a file'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'Making changes'
  if (tool === 'Bash' || tool === 'PowerShell') return 'Running a check'
  if (tool === 'Grep' || tool === 'Glob') return 'Looking through files'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'Searching the web'
  if (tool === 'Agent') return 'Getting help from a helper'
  return 'Working'
}

/** One calm sentence for a failed turn, from the text the engine ended it with. */
export function friendlyError(text: string): string {
  const t = text.toLowerCase()
  if (/rate.?limit|usage limit|429|quota/.test(t)) return 'you hit your usage limit, try again a little later'
  if (/overload|529|servers? (are )?busy|503/.test(t)) return "Claude's servers are busy, try again in a minute"
  if (/context|too long|prompt is too long|token limit/.test(t)) return 'type /compact and try again'
  if (/network|connection|econn|enotfound|timed? ?out|offline|fetch failed/.test(t)) return 'the internet connection dropped'
  if (/auth|login|api key|401|unauthor|forbidden|403/.test(t)) return 'type /login'
  return 'something went wrong, try again in a moment'
}

export function newChecklist(): CleanChecklist {
  return {
    title: '',
    phase: 'idle',
    tasks: [],
    needsYouReason: '',
    stuckReason: '',
    startedAt: 0,
    finishedAt: 0,
    isCollapsed: false,
    jobId: 0,
    hasPlan: false,
    action: '',
    question: null,
    changedFiles: [],
    failStreak: 0,
    isBelled: false,
    bar: 0,
  }
}

function task(id: string, name: string, status: CleanTask['status']): CleanTask {
  return { id, name: cleanName(name), status, percent: 0, hasReported: false, shown: 0 }
}

export function startJob(prev: CleanChecklist, now: number): CleanChecklist {
  return {
    ...newChecklist(),
    title: 'Working on it',
    phase: 'working',
    tasks: [task('s1', 'Understand your request', 'active'), task('s2', 'Plan the steps', 'upcoming')],
    startedAt: now,
    jobId: prev.jobId + 1,
  }
}

/** plan_steps: the first step starts at once. */
export function planSteps(cl: CleanChecklist, names: unknown): CleanChecklist | null {
  if (!Array.isArray(names)) return null
  const list = names.filter((n): n is string => typeof n === 'string').slice(0, MAX_STEPS)
  if (list.length < 1) return null
  const tasks = list.map((n, i) => task(`p${i + 1}`, n, i === 0 ? 'active' : 'upcoming'))
  return { ...cl, tasks, hasPlan: true, phase: cl.phase === 'idle' ? 'working' : cl.phase, isCollapsed: false }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** A reported percent as 0 to 100: a number, rounded, clamped; anything else counts as 0. */
export function clampPercent(percent: unknown): number {
  const raw = typeof percent === 'number' && Number.isFinite(percent) ? percent : Number(percent)
  return Math.max(0, Math.min(100, Number.isFinite(raw) ? Math.round(raw) : 0))
}

/** report_progress: checks off earlier steps, holds percent, starts the next step at 100. */
export function reportProgress(cl: CleanChecklist, name: unknown, percent: unknown): { cl: CleanChecklist; pct: number } {
  const pct = clampPercent(percent)
  const wanted = norm(cleanName(name))
  const tasks: CleanTask[] = cl.tasks.map(t => ({ ...t }))
  let idx = tasks.findIndex(t => norm(t.name) === wanted)
  if (idx < 0) idx = tasks.findIndex(t => norm(t.name).startsWith(wanted) || wanted.startsWith(norm(t.name)))
  if (idx < 0) {
    // An unknown name ticks nothing off: it goes in right after the current step and becomes the active one.
    const was = tasks.findIndex(t => t.status === 'active')
    const fresh = task(`n${tasks.length + 1}`, String(name ?? ''), 'active')
    fresh.hasReported = true
    fresh.percent = pct
    if (was >= 0) tasks[was]!.status = 'upcoming'
    if (pct >= 100) {
      fresh.status = 'done'
      if (was >= 0) tasks[was]!.status = 'active'
    }
    tasks.splice(was >= 0 ? was + 1 : tasks.length, 0, fresh)
    return { cl: { ...cl, tasks, hasPlan: true, phase: cl.phase === 'idle' ? 'working' : cl.phase }, pct }
  }
  for (let i = 0; i < idx; i++) {
    const t = tasks[i]!
    t.status = 'done'
    t.percent = 100
    t.hasReported = true
  }
  const cur = tasks[idx]!
  cur.hasReported = true
  cur.percent = Math.max(cur.percent, pct)
  if (cur.percent >= 100) {
    cur.status = 'done'
    const next = tasks.slice(idx + 1).find(t => t.status !== 'done')
    if (next) next.status = 'active'
  } else {
    cur.status = 'active'
    for (let i = idx + 1; i < tasks.length; i++) if (tasks[i]!.status === 'active') tasks[i]!.status = 'upcoming'
  }
  return {
    cl: { ...cl, tasks, hasPlan: true, phase: cl.phase === 'idle' ? 'working' : cl.phase },
    pct,
  }
}

type Todo = { content?: unknown; status?: unknown }

/** TodoWrite as checklist rows. */
export function applyTodos(cl: CleanChecklist, todos: unknown): CleanChecklist {
  if (!Array.isArray(todos) || todos.length === 0) return cl
  const old = new Map(cl.tasks.map(t => [norm(t.name), t]))
  let sawActive = false
  const tasks = (todos as Todo[]).map((t, i) => {
    const status: CleanTask['status'] =
      t.status === 'completed' ? 'done' : t.status === 'in_progress' && !sawActive ? 'active' : 'upcoming'
    if (status === 'active') sawActive = true
    const row = task(`t${i + 1}`, String(t.content ?? ''), status)
    const before = old.get(norm(row.name))
    if (before) {
      row.percent = status === 'done' ? 100 : before.percent
      row.hasReported = before.hasReported || status === 'done'
      row.shown = before.shown
    } else if (status === 'done') {
      row.percent = 100
      row.hasReported = true
    }
    return row
  })
  if (!sawActive) {
    const first = tasks.find(t => t.status === 'upcoming')
    if (first) first.status = 'active'
  }
  return { ...cl, tasks, hasPlan: true }
}

export function applyTaskCreate(cl: CleanChecklist, subject: unknown, id: string): CleanChecklist {
  const fresh = cl.hasPlan ? cl.tasks : []
  const t = task(id, String(subject ?? ''), fresh.some(x => x.status === 'active') ? 'upcoming' : 'active')
  return { ...cl, tasks: [...fresh, t], hasPlan: true }
}

export function applyTaskUpdate(cl: CleanChecklist, args: { taskId?: unknown; status?: unknown; subject?: unknown }): CleanChecklist {
  const id = String(args.taskId ?? '')
  let tasks = cl.tasks.map(t => ({ ...t }))
  const t = tasks.find(x => x.id === id)
  if (!t) return cl
  if (typeof args.subject === 'string') t.name = cleanName(args.subject)
  if (args.status === 'completed') {
    t.status = 'done'
    t.percent = 100
    t.hasReported = true
    if (!tasks.some(x => x.status === 'active')) {
      const next = tasks.find(x => x.status === 'upcoming')
      if (next) next.status = 'active'
    }
  } else if (args.status === 'in_progress') {
    tasks.forEach(x => {
      if (x.status === 'active') x.status = 'upcoming'
    })
    t.status = 'active'
  } else if (args.status === 'deleted') {
    tasks = tasks.filter(x => x.id !== id)
  }
  return { ...cl, tasks }
}

/** The whole job as one percent: finished steps count full, the others by what was reported. */
export function jobPercent(cl: CleanChecklist): number {
  if (cl.phase === 'done') return 100
  if (cl.tasks.length === 0) return 0
  const sum = cl.tasks.reduce((n, t) => n + (t.status === 'done' ? 100 : t.percent), 0)
  return Math.max(0, Math.min(100, Math.round(sum / cl.tasks.length)))
}

/** One 250 ms step of easing: meters move toward their percent and never back. */
export function easeStep(cl: CleanChecklist): CleanChecklist {
  let changed = false
  const tasks = cl.tasks.map(t => {
    const target = t.status === 'done' ? 100 : t.percent
    if (t.shown >= target) return t
    changed = true
    const step = Math.max(2, Math.ceil((target - t.shown) * 0.35))
    return { ...t, shown: Math.min(target, t.shown + step) }
  })
  let bar = cl.bar
  const goal = jobPercent({ ...cl, tasks })
  if (bar < goal) {
    changed = true
    bar = Math.min(goal, bar + Math.max(1, Math.ceil((goal - bar) * 0.35)))
  }
  return changed ? { ...cl, tasks, bar } : cl
}

/** The bar style's cells: a dotted fill that drifts while live, and an empty rest. */
export function barText(percent: number, cells: number, frame: number, isLive: boolean): { filled: string; rest: string } {
  const n = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  let filled = ''
  for (let i = 0; i < n; i++) filled += (i + (isLive ? frame : 0)) % 2 === 0 ? '▓' : '▒'
  return { filled, rest: '░'.repeat(cells - n) }
}

export type BarSegment = { text: string; kind: 'fill' | 'rest' | 'label' }

/** The bar with its words inside: dotted fill, empty rest, and a label that rides the edge of the fill. */
export function barSegments(percent: number, cells: number, frame: number, isLive: boolean, label: string): BarSegment[] {
  const base = barText(percent, cells, frame, isLive)
  const chars = [...base.filled, ...base.rest]
  const n = base.filled.length
  const text = label.trim() === '' ? '' : ` ${shortName(label.trim(), Math.max(1, cells - 4))} `
  const len = text.length
  const at = len === 0 || len >= cells ? -1 : Math.max(2, Math.min(cells - len - 1, n - len))
  const out: BarSegment[] = []
  const push = (t: string, kind: BarSegment['kind']) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += t
    else out.push({ text: t, kind })
  }
  for (let i = 0; i < chars.length; i++) {
    if (at >= 0 && i === at) {
      push(text, 'label')
      i += len - 1
    } else push(chars[i]!, i < n ? 'fill' : 'rest')
  }
  return out
}

/** The steps of a finished job; jobs saved by older versions have none. */
export function stepsOf(f: { steps?: string[] }): string[] {
  return Array.isArray(f.steps) ? f.steps : []
}

export function shortName(name: string, max: number): string {
  return name.length <= max ? name : name.slice(0, Math.max(1, max - 1)).trimEnd() + '…'
}

/** True when the end of Claude's answer asks the person something. */
export function asksUser(answer: unknown): boolean {
  const tail = String(answer ?? '').trim().slice(-300)
  if (tail === '') return false
  if (/[?？]/.test(tail)) return true
  return /\b(let me know|shall i|should i|would you like|do you want|want me to|which (one|option)|please confirm|waiting for your)\b/i.test(tail)
}

export function stepNumber(cl: CleanChecklist): number {
  const i = cl.tasks.findIndex(t => t.status === 'active')
  if (i >= 0) return i + 1
  return Math.min(cl.tasks.length, cl.tasks.filter(t => t.status === 'done').length + 1)
}

/** Stable height: past 5 rows, finished steps fold into one line. */
export function visibleRows(cl: CleanChecklist): { doneCount: number; rows: CleanTask[] } {
  if (cl.tasks.length <= 5) return { doneCount: 0, rows: cl.tasks }
  const done = cl.tasks.filter(t => t.status === 'done')
  return { doneCount: done.length, rows: cl.tasks.filter(t => t.status !== 'done') }
}

export function fitName(name: string, width: number): string {
  if (name.length <= width) return name.padEnd(width, ' ')
  return name.slice(0, Math.max(1, width - 1)) + '…'
}

const EXEMPT = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  'mcp__session-panel__plan_steps',
  'mcp__session-panel__report_progress',
  'mcp__session-panel__ask_choices',
])

export function isGateExempt(tool: string): boolean {
  return EXEMPT.has(tool)
}

/** Factual, not an order: a tool result is data, so the rule itself lives in the system section (PLAN_SECTION). */
export const GATE_MESSAGE =
  'Blocked by the Session Panel mod until this session calls mcp__session-panel__plan_steps (see the Session Panel system section).'

/** Denied calls in a row, with no plan_steps call, before the gate lets tools through. Never traps a session. */
export const GATE_LIMIT = 3

/** The first-tool rule, from the system prompt. It is not in a tool result, so it is not treated as an instruction from one. */
export const PLAN_SECTION = `Session Panel rule for this session: at the start of each job, before any other tool, call mcp__session-panel__plan_steps with 1 to 8 short plain-English step names. The person sees these steps as their progress checklist. If plan_steps is not in your tool list, load it with ToolSearch. If it is still missing, skip the plan and continue the work.`

export function looksLikeUserDenial(text: string): boolean {
  return /doesn.?t want to proceed|rejected|permission (to use|for) .* (was )?denied|user denied|declined to/i.test(text)
}

export const SECTION_TEXT = `Session Panel is on for this session. The person you are helping is not technical and sees a step checklist instead of tool calls.
- For EVERY request, even a quick question, call plan_steps first (load it with ToolSearch if it is deferred). Use 1 step for a quick question, 2 to 8 for bigger work.
- Step names are plain English, under 40 characters, and start with a verb, for example "Build the pricing section". Never put file paths, file names, commands, code or tool names in a step name.
- Then call report_progress as real progress happens, with the same step name, and call it with percent 100 the moment a step finishes.
- If you have TodoWrite or TaskCreate you may use that to-do list as the plan instead.
- Whenever you need the person's input, including quick questions, call ask_choices with 2 to 4 options, the recommended option first, instead of asking in prose. Then stop and wait for their reply.
- Keep written replies short, warm and free of jargon.`

/**
 * The values to copy from the old clean-view settings row into this plugin's store. The row keyed with the
 * marketplace suffix wins, then the plain key. A store key that already holds a value is left alone.
 */
export function migratedValues(
  rows: Record<string, { options?: Record<string, unknown> }> | undefined,
  stored: { sessionPanelEnabled?: unknown; sessionPanelStyle?: unknown; askChoicesEnabled?: unknown },
): Record<string, unknown> {
  const old = rows?.['clean-view@herman-mods']?.options ?? rows?.['clean-view']?.options ?? {}
  const out: Record<string, unknown> = {}
  if (stored.sessionPanelEnabled === undefined && (old.cleanView === 'on' || old.cleanView === 'off')) {
    out.sessionPanelEnabled = old.cleanView === 'on'
  }
  if (stored.sessionPanelStyle === undefined && (old.view === 'bars' || old.view === 'list')) {
    out.sessionPanelStyle = old.view === 'bars' ? 'bars' : 'checklist'
  }
  if (stored.askChoicesEnabled === undefined && (old.askChoices === 'on' || old.askChoices === 'off')) {
    out.askChoicesEnabled = old.askChoices === 'on'
  }
  return out
}

/** Context sources the enhancer may read. Each one has its own toggle in Settings. */
export const SOURCE_IDS = ['instructions', 'skills', 'docs', 'github'] as const
export type SourceId = (typeof SOURCE_IDS)[number]

export const SOURCE_LABELS: Record<SourceId, string> = {
  instructions: 'CLAUDE.md and AGENTS.md (project and global)',
  skills: 'Project skills list',
  docs: 'CONTEXT.md, PRD, ADRs and glossary',
  github: 'GitHub wayfinder (via gh)',
}

/** Characters kept from each source, so one source cannot crowd out the rest. */
export const SOURCE_CAP = 4000

/** Instructions for the model: rewrite the draft and return JSON only. */
export function enhancePrompt(draft: string, context: string, answers: string[], chat = ''): string {
  const answered = answers.length ? `The person answered these questions:\n${answers.join('\n')}\n` : ''
  return [
    'Rewrite the draft prompt below so the assistant can act on it, using the project context.',
    'Reply with JSON only, no prose: {"prompt": string, "notes": string[], "questions": [{"question": string, "options": string[]}]}.',
    '"notes": 2 to 4 short lines: what you added, and which context you used.',
    '"questions": up to 3, only when the draft is too vague to act on. Each has 2 to 4 options. Otherwise [].',
    'If you ask questions, "prompt" is "".',
    answered,
    'Project context:',
    context || '(none)',
    chat ? `Recent conversation:\n${chat}` : '',
    '',
    'Draft:',
    draft,
  ].join('\n')
}

export type Enhanced = { prompt: string; notes: string[]; questions: Array<{ question: string; options: string[] }> }

/** Reads the model's JSON reply. Returns null when no usable object is in it. */
export function parseEnhanced(text: string): Enhanced | null {
  const found = text.match(/\{[\s\S]*\}/)
  if (!found) return null
  try {
    const j = JSON.parse(found[0])
    return {
      prompt: typeof j.prompt === 'string' ? j.prompt.trim() : '',
      notes: Array.isArray(j.notes) ? j.notes.filter((s: unknown) => typeof s === 'string').slice(0, 4) : [],
      questions: Array.isArray(j.questions)
        ? j.questions
            .filter((q: any) => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length >= 2)
            .slice(0, 3)
            .map((q: any) => ({ question: q.question, options: q.options.slice(0, 4).map(String) }))
        : [],
    }
  } catch {
    return null
  }
}

/** The last six user and assistant turns, text only, each capped; the whole excerpt keeps its newest end. */
export const EXCERPT_TURNS = 6
export const EXCERPT_MESSAGE_CAP = 1500
export const EXCERPT_CAP = 6000

export function recentExcerpt(rows: Array<{ role: string; text: string }>): string {
  const joined = rows
    .filter(r => (r.role === 'user' || r.role === 'assistant') && r.text.trim() !== '')
    .slice(-EXCERPT_TURNS)
    .map(r => `${r.role}: ${r.text.trim().slice(0, EXCERPT_MESSAGE_CAP)}`)
    .join('\n\n')
  return joined.length > EXCERPT_CAP ? joined.slice(-EXCERPT_CAP) : joined
}

// ---------- assumptions (stage 2) ----------

export const ASSUMPTION_CAP = 50
export const ASSUMPTION_TEXT_CAP = 200

/** The system-prompt rule that asks for ASSUMPTION lines. Kept here so the parser and the rule name the same form. */
export const ASSUME_SECTION = `Session Panel rule for stated assumptions: when you make an assumption about what the person wants while you build, write it on its own line in exactly this form: ASSUMPTION: <one short sentence>. Write one line per assumption. Use this form only for assumptions, never for facts you checked. The line must start with plain ASSUMPTION: at the start of the line, with no bold, no bullet and no heading. Do not put ASSUMPTION lines inside code blocks.`

const EMPTY_TRACK: AssumptionTrack = { entries: [], seq: 0, turnNo: 0, runningTurnId: '', turnDeclared: false, turnEdits: [], open: false }
export const newTrack = (): AssumptionTrack => ({ ...EMPTY_TRACK, entries: [], turnEdits: [] })

/** The texts of the ASSUMPTION lines in a reply, in order. Lines inside a code fence are ignored. */
export function parseAssumptions(text: string): string[] {
  const out: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^\s*ASSUMPTION:\s*(\S.*?)\s*$/)
    if (m) out.push(m[1].slice(0, ASSUMPTION_TEXT_CAP))
  }
  return out
}

/** A turn began: count it, remember its id for Stop, and clear what the last turn left. */
export function startTurn(t: AssumptionTrack, turnId: string): AssumptionTrack {
  return { ...t, turnNo: t.turnNo + 1, runningTurnId: turnId, turnDeclared: false, turnEdits: [] }
}

/** The reply declared assumptions: they go to the top of the list, newest first. A text already listed for this turn is not added twice. */
export function addDeclared(t: AssumptionTrack, texts: string[]): AssumptionTrack {
  const listed = new Set(t.entries.filter(e => e.kind === 'declared' && e.turn === t.turnNo).map(e => e.text))
  const fresh = texts.filter(text => !listed.has(text) && listed.add(text))
  if (fresh.length === 0) return t
  let seq = t.seq
  const added = [...fresh].reverse().map(text => ({ id: ++seq, text, turn: t.turnNo, kind: 'declared' as const }))
  return { ...t, seq, turnDeclared: true, entries: [...added, ...t.entries].slice(0, ASSUMPTION_CAP) }
}

/** A file was written during the turn. Each path is kept once. */
export function addEdits(t: AssumptionTrack, paths: string[]): AssumptionTrack {
  const turnEdits = [...new Set([...t.turnEdits, ...paths])]
  return { ...t, turnEdits }
}

/** The turn ended. With flagging on, an edit in a turn that declared no assumption becomes one entry per file. */
export function finishTurn(t: AssumptionTrack, flag: boolean): AssumptionTrack {
  let seq = t.seq
  const flagged =
    flag && !t.turnDeclared
      ? [...t.turnEdits].reverse().map(path => ({ id: ++seq, text: `edited ${path} with no stated assumption`, turn: t.turnNo, kind: 'undeclared' as const, path }))
      : []
  return { ...t, seq, runningTurnId: '', turnDeclared: false, turnEdits: [], entries: [...flagged, ...t.entries].slice(0, ASSUMPTION_CAP) }
}

/** The text the box takes when the person presses Redirect, by entry kind. The person finishes it; nothing is sent. */
export const redirectText = (a: Pick<Assumption, 'kind' | 'text' | 'path'>) =>
  a.kind === 'undeclared' ? `About the edit to ${a.path ?? a.text}: ` : `Assumption '${a.text}' is wrong. Instead: `

/** The text of the text blocks in a row's content. Anything else (no content, not a list, a null block) is no text. */
export function responseText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map(b => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
    .filter(text => text !== '')
    .join('\n')
}

const NOT_A_FILE = /^(\/dev\/null|nul|\$null|&\d)$/i
const clean = (raw: string) => raw.replace(/^["']|["']$/g, '')

/** The file paths a shell command writes to. Best effort: redirects, a few cmdlets and common file tools. */
export function shellTargets(command: string): string[] {
  const found: string[] = []
  for (const m of command.matchAll(/(?:^|[^>\d&])\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>"']+)/g)) found.push(clean(m[1]))
  for (const m of command.matchAll(/\b(?:Set-Content|Add-Content|Out-File|Copy-Item|Move-Item)\b([^;|\n]*)/gi)) {
    const named = m[1].match(/-(?:FilePath|Path|LiteralPath|Destination)\s+("[^"]+"|'[^']+'|\S+)/i)
    const first = m[1].split(/\s+/).find(w => w !== '' && !w.startsWith('-'))
    const target = named ? named[1] : first
    if (target) found.push(clean(target))
  }
  for (const m of command.matchAll(/\bsed\s+-i[^;|&\n]*/g)) {
    const last = m[0].trim().split(/\s+/).pop()
    if (last) found.push(clean(last))
  }
  for (const m of command.matchAll(/\b(?:cp|mv)\s+[^;|&\n]+/g)) {
    const last = m[0].trim().split(/\s+/).pop()
    if (last) found.push(clean(last))
  }
  return [...new Set(found.filter(p => p !== '' && !NOT_A_FILE.test(p)))]
}

/** The files a tool call writes to, by tool name and its input. Other tools write nothing this panel tracks. */
export function editTargets(tool: string, input: Record<string, unknown>): string[] {
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? [v] : [])
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return str(input.file_path)
  if (tool === 'NotebookEdit') return str(input.notebook_path)
  if (tool === 'Bash' || tool === 'PowerShell') return shellTargets(String(input.command ?? ''))
  return []
}
