import type { CleanChecklist, CleanTask } from '../types'

// Pure helpers for Clean View: no engine calls here, so tests can use them directly.

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

/** report_progress: checks off earlier steps, holds percent, starts the next step at 100. */
export function reportProgress(cl: CleanChecklist, name: unknown, percent: unknown): { cl: CleanChecklist; pct: number } {
  const raw = typeof percent === 'number' && Number.isFinite(percent) ? percent : Number(percent)
  const pct = Math.max(0, Math.min(100, Number.isFinite(raw) ? Math.round(raw) : 0))
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
  return changed ? { ...cl, tasks } : cl
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
  'mcp__clean-view__plan_steps',
  'mcp__clean-view__report_progress',
  'mcp__clean-view__ask_choices',
])

export function isGateExempt(tool: string): boolean {
  return EXEMPT.has(tool)
}

export const GATE_MESSAGE =
  'Clean View is on. Before any other tool, call plan_steps with 1 to 8 short plain-English step names (use ToolSearch to load plan_steps if it is not listed). Then continue.'

export function looksLikeUserDenial(text: string): boolean {
  return /doesn.?t want to proceed|rejected|permission (to use|for) .* (was )?denied|user denied|declined to/i.test(text)
}

export const SECTION_TEXT = `Clean View is on for this session. The person you are helping is not technical and sees a step checklist instead of tool calls.
- For EVERY request, even a quick question, call plan_steps first (load it with ToolSearch if it is deferred). Use 1 step for a quick question, 2 to 8 for bigger work.
- Step names are plain English, under 40 characters, and start with a verb, for example "Build the pricing section". Never put file paths, file names, commands, code or tool names in a step name.
- Then call report_progress as real progress happens, with the same step name, and call it with percent 100 the moment a step finishes.
- If you have TodoWrite or TaskCreate you may use that to-do list as the plan instead.
- Whenever you need the person's input, including quick questions, call ask_choices with 2 to 4 options, the recommended option first, instead of asking in prose. Then stop and wait for their reply.
- Keep written replies short, warm and free of jargon.`
