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

const SECTION_BASE = `Session Panel is on for this session. The person you are helping is not technical and sees a step checklist instead of tool calls.
- For EVERY request, even a quick question, call plan_steps first (load it with ToolSearch if it is deferred). Use 1 step for a quick question, 2 to 8 for bigger work.
- Step names are plain English, under 40 characters, and start with a verb, for example "Build the pricing section". Never put file paths, file names, commands, code or tool names in a step name.
- Then call report_progress as real progress happens, with the same step name, and call it with percent 100 the moment a step finishes.
- If you have TodoWrite or TaskCreate you may use that to-do list as the plan instead.
- Keep written replies short, warm and free of jargon.`

const ASK_CHOICES_LINE =
  "- Whenever you need the person's input, including quick questions, call ask_choices with 2 to 4 options, the recommended option first, instead of asking in prose. Then stop and wait for their reply."

const QUESTION_BOX_LINE =
  "- Ask with AskUserQuestion, never in prose, whenever you need the person's go-ahead: permission to act (edits, deletes, sends, pushes, installs), or a choice that changes scope, cost, files or direction. Do not ask about routine details; decide them and state them as ASSUMPTION lines. Every question from /grilling, /grill-me or /grill-with-docs goes through AskUserQuestion, one call per question, with the recommended option first. Then stop and wait for the reply."

/** The rules section. The question-box rule replaces the picker line when it is on; otherwise the picker is used when it is on. */
export function rulesSection(questionBox: boolean, picker: boolean): string {
  if (questionBox) return `${SECTION_BASE}\n${QUESTION_BOX_LINE}`
  if (picker) return `${SECTION_BASE}\n${ASK_CHOICES_LINE}`
  return SECTION_BASE
}

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
  github: 'GitHub (wayfinder map, else recent issues)',
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

const EMPTY_TRACK: AssumptionTrack = { entries: [], seq: 0, turnNo: 0, runningTurnId: '', turnDeclared: false, turnEdits: [], open: false, file: '', sessionId: '', member: '', warned: false, root: '', os: '', merged: [], idMap: {} }
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
export function addDeclared(t: AssumptionTrack, texts: string[], now: number): AssumptionTrack {
  const listed = new Set(t.entries.filter(e => e.kind === 'declared' && e.turn === t.turnNo).map(e => e.text))
  const fresh = texts.filter(text => !listed.has(text) && listed.add(text))
  if (fresh.length === 0) return t
  // ids rise in the order written; the list shows the newest first
  const added = fresh.map((text, i) => ({ id: t.seq + i + 1, text, turn: t.turnNo, kind: 'declared' as const, status: 'open' as const, at: now, sessionId: t.sessionId })).reverse()
  return { ...t, seq: t.seq + fresh.length, turnDeclared: true, entries: [...added, ...t.entries].slice(0, ASSUMPTION_CAP) }
}

/** A file was written during the turn. Each path is kept once. */
export function addEdits(t: AssumptionTrack, paths: string[]): AssumptionTrack {
  const turnEdits = [...new Set([...t.turnEdits, ...paths])]
  return { ...t, turnEdits }
}

/** The turn ended. With flagging on, an edit in a turn that declared no assumption becomes one entry per file. */
export function finishTurn(t: AssumptionTrack, flag: boolean, now: number): AssumptionTrack {
  const paths = flag && !t.turnDeclared ? t.turnEdits : []
  if (paths.length === 0) return { ...t, runningTurnId: '', turnDeclared: false, turnEdits: [] }
  // one row for the whole turn, however many files it wrote
  const first = paths[0] as string
  const name = first.split('/').pop() ?? first
  const text = paths.length === 1 ? `${name}, no stated assumption` : `${paths.length} files, no stated assumption`
  const row: Assumption = { id: t.seq + 1, text, turn: t.turnNo, kind: 'flagged', path: first, paths: [...paths], status: 'open', at: now, sessionId: t.sessionId }
  return { ...t, seq: t.seq + 1, runningTurnId: '', turnDeclared: false, turnEdits: [], entries: [row, ...t.entries].slice(0, ASSUMPTION_CAP) }
}

/** A path relative to the project root, with forward slashes. Undefined when the path lies outside the root. A relative path is inside it. */
export function relativeTo(root: string, path: string, os: 'windows' | 'macos' | 'linux' | ''): string | undefined {
  const p = normPath(path)
  if (!/^([a-zA-Z]:)?\//.test(p)) return p
  const r = normPath(root)
  const fold = (s: string) => (os === 'windows' || os === 'macos' ? s.toLowerCase() : s)
  if (!fold(p).startsWith(`${fold(r)}/`)) return undefined
  return p.slice(r.length + 1)
}

/** Confirm or Wrong on an open entry. A resolved entry does not change again. */
export function setStatus(t: AssumptionTrack, id: number, status: 'confirmed' | 'wrong', now: number): AssumptionTrack {
  return { ...t, entries: t.entries.map(e => (e.id === id && e.status === 'open' ? { ...e, status, resolvedAt: now } : e)) }
}

export const openCount = (t: AssumptionTrack) => t.entries.filter(e => e.status === 'open').length

/** The question asked before an open entry is deleted, and its two answers. */
export const deleteQuestion = (a: Assumption) => `Delete open assumption ${a.id}? Nobody has decided on it yet.`
export const DELETE_OPTIONS = ['Delete', 'Keep']

/** Removes one entry, whatever its status. */
export function removeEntry(t: AssumptionTrack, id: number): AssumptionTrack {
  return { ...t, entries: t.entries.filter(e => e.id !== id) }
}

/** Removes every confirmed and wrong entry. Returns how many went. */
export function dropResolved(t: AssumptionTrack): { track: AssumptionTrack; count: number } {
  const keep = t.entries.filter(e => e.status === 'open')
  return { track: { ...t, entries: keep }, count: t.entries.length - keep.length }
}

export const DAY = 24 * 60 * 60 * 1000
/** An open entry older than this shows as stale. Display only: the stored status stays open. */
export const STALE_OPEN_MS = 3 * DAY
/** A resolved entry older than this (by resolvedAt) is removed when the list is tidied. */
export const TIDY_RESOLVED_MS = 7 * DAY

/** An open entry added more than three days ago. */
export const isStale = (a: Assumption, now: number = Date.now()) => a.status === 'open' && now - a.at > STALE_OPEN_MS

/** Removes the resolved entries older than seven days. Open entries stay, whatever their age. Returns the same track when nothing goes. */
export function tidy(t: AssumptionTrack, now: number): AssumptionTrack {
  const keep = t.entries.filter(e => e.status === 'open' || e.resolvedAt === undefined || now - e.resolvedAt <= TIDY_RESOLVED_MS)
  return keep.length === t.entries.length ? t : { ...t, entries: keep }
}

/** The panel's order: open entries first, then the resolved ones. Each group keeps its newest-first order. */
export const panelOrder = (entries: Assumption[]) => [...entries.filter(e => e.status === 'open'), ...entries.filter(e => e.status !== 'open')]

/** The text the box takes when the person presses Wrong, by entry kind. The person finishes it; nothing is sent. */
export const redirectText = (a: Pick<Assumption, 'kind' | 'text' | 'path' | 'turn' | 'paths'>) =>
  a.kind === 'flagged' ? flaggedRedirect(a) : `Assumption '${a.text}' is wrong. Instead: `

/** The opening for a flagged row: the turn, the first file, and how many more. */
const flaggedRedirect = (a: Pick<Assumption, 'text' | 'path' | 'turn' | 'paths'>) => {
  const more = (a.paths?.length ?? 1) - 1
  return more > 0 ? `About the edits in turn ${a.turn} (${a.path} and ${more} more): ` : `About the edits in turn ${a.turn} (${a.path ?? a.text}): `
}

// ---------- the stored file: <project>/.claude/session-panel/assumptions/<session id>.json ----------

export const STORE_DIR = '.claude/session-panel/assumptions'
export const STORE_VERSION = 1
/** Written into .claude/session-panel/ so git ignores the whole folder. */
export const STORE_IGNORE = '*\n'

/** A session's file name: its id, with anything unsafe in a file name replaced. */
export const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'session'

/** A short, stable tag of a session id, used in the second file name when the plain one belongs to another session. */
export function idTag(id: string): string {
  let h = 5381
  for (const ch of id) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0
  return h.toString(16).padStart(8, '0')
}

export const plainPath = (root: string, sessionId: string) => `${root}/${STORE_DIR}/${safeName(sessionId)}.json`

/** The session that a stored file belongs to, or undefined when the text is not a stored file. */
export function ownerOf(text: string): string | undefined {
  try {
    const j = JSON.parse(text)
    return j && typeof j.sessionId === 'string' ? j.sessionId : undefined
  } catch {
    return undefined
  }
}

/** This session's file: its plain name, or a tagged name when the plain file holds another session's list (or cannot be read). */
export function resolveStorePath(root: string, sessionId: string, baseText: string | undefined): { file: string; foreign: boolean } {
  if (baseText === undefined || ownerOf(baseText) === sessionId) return { file: plainPath(root, sessionId), foreign: false }
  return { file: `${root}/${STORE_DIR}/${safeName(sessionId)}-${idTag(sessionId)}.json`, foreign: true }
}

const isEntry = (e: any) =>
  !!e &&
  typeof e.id === 'number' &&
  typeof e.text === 'string' &&
  typeof e.turn === 'number' &&
  (e.kind === 'declared' || e.kind === 'flagged') &&
  (e.status === 'open' || e.status === 'confirmed' || e.status === 'wrong')

export function storedJson(member: string, sessionId: string, entries: Assumption[], merged: string[] = [], idMap: Record<string, number> = {}): string {
  return JSON.stringify({ version: STORE_VERSION, member, sessionId, entries, merged, idMap }, null, 2) + '\n'
}

/** The file an old id file is retired to once its entries are merged: no entries, and the named file it went into. */
export const retiredJson = (member: string, sessionId: string, mergedInto: string) =>
  JSON.stringify({ version: STORE_VERSION, member, sessionId, entries: [], mergedInto }, null, 2) + '\n'

/** A registry record: <pid>.json. The pattern is pinned by a test, since its backslashes were lost twice in editing. */
export const REGISTRY_RECORD = /^\d+\.json$/

/** The entries a stored file holds, and the old id files already merged into it, or why it cannot be read. A file this code cannot read is never overwritten. */
export function parseStored(text: string | undefined): { ok: true; entries: Assumption[]; merged: string[]; idMap: Record<string, number> } | { ok: false; reason: string } {
  if (text === undefined) return { ok: true, entries: [], merged: [], idMap: {} }
  let j: any
  try {
    j = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'the file is not JSON' }
  }
  if (!j || j.version !== STORE_VERSION || !Array.isArray(j.entries)) return { ok: false, reason: 'the file is not a version 1 assumptions file' }
  // an entry written before 0.3.34 has no sessionId: it belongs to the file's owner
  const entries = j.entries.filter(isEntry).map((e: any) => ({ ...e, sessionId: typeof e.sessionId === 'string' ? e.sessionId : String(j.sessionId ?? '') })) as Assumption[]
  const merged = Array.isArray(j.merged) ? j.merged.filter((x: unknown): x is string => typeof x === 'string') : []
  const idMap: Record<string, number> = {}
  if (j.idMap && typeof j.idMap === 'object') for (const [k, v] of Object.entries(j.idMap)) if (typeof v === 'number') idMap[k] = v
  return { ok: true, entries, merged, idMap }
}

/** The track after a load: the stored entries, with the counters moved past them so new entries do not clash. */
export function loadTrack(t: AssumptionTrack, entries: Assumption[]): AssumptionTrack {
  // the counters never go back: a file loaded in the middle of a turn keeps the turn number that turn already has
  const seq = entries.reduce((m, e) => Math.max(m, e.id), t.seq)
  const turnNo = entries.reduce((m, e) => Math.max(m, e.turn), t.turnNo)
  return { ...t, entries: entries.slice(0, ASSUMPTION_CAP), seq, turnNo }
}

/**
 * Merges one old id file (this session's own, named `<session id>.json`) into the named file's track. Its entries keep
 * their status and get this session's id from the old file; their ids follow the named file's highest id. Each old file
 * is merged once: its name is recorded in `merged`, and a file already listed there is not merged again.
 */
export function mergeOld(t: AssumptionTrack, old: { fileName: string; sessionId: string; entries: Assumption[] }): AssumptionTrack {
  if (t.merged.includes(old.fileName)) return t
  // an old id the named file does not have is kept; an old id it already has gets the next free id, recorded in idMap
  const named = new Set(t.entries.map(e => e.id))
  const kept = new Set(old.entries.map(e => e.id).filter(id => !named.has(id)))
  const taken = new Set([...named, ...kept])
  let seq = Math.max(t.seq, ...kept)
  const idMap = { ...t.idMap }
  const added = old.entries.map(e => {
    if (!named.has(e.id)) return { ...e, sessionId: old.sessionId }
    do seq++
    while (taken.has(seq))
    taken.add(seq)
    idMap[String(e.id)] = seq
    return { ...e, id: seq, sessionId: old.sessionId }
  })
  return { ...t, seq, idMap, merged: [...t.merged, old.fileName], entries: [...t.entries, ...added].slice(0, ASSUMPTION_CAP) }
}
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

// ---------- messages from the team head (0.3.2) ----------

/** The head's verbs: confirm and wrong set a status; delete removes the entry. */
export type Verb = 'confirm' | 'wrong' | 'delete'

/** The line the team head sends: `SESSION-PANEL: confirm 3`, `SESSION-PANEL: wrong 3` or `SESSION-PANEL: delete 3`. */
export function parseIncoming(text: string): { verb: Verb; id: number } | null {
  const m = text.trim().match(/^SESSION-PANEL: (confirm|wrong|delete) (\d+)$/)
  return m ? { verb: m[1] as Verb, id: Number(m[2]) } : null
}

/** Applies a head's message to this session's list. An unknown id, or an entry already resolved, changes nothing and says why. */
export function applyIncoming(t: AssumptionTrack, cmd: { verb: Verb; id: number }, now: number): { track: AssumptionTrack; note: string; changed: boolean } {
  // a head line names the current id: the roster reads the ids of the named file. idMap is a record only
  const id = cmd.id
  const entry = t.entries.find(e => e.id === id)
  if (!entry) return { track: t, note: `No assumption ${cmd.id} in this session.`, changed: false }
  if (cmd.verb === 'delete') return { track: removeEntry(t, id), note: `Assumption ${id} deleted.`, changed: true }
  if (entry.status !== 'open') return { track: t, note: `Assumption ${cmd.id} is already ${entry.status}.`, changed: false }
  const status = cmd.verb === 'confirm' ? 'confirmed' : 'wrong'
  return { track: setStatus(t, id, status, now), note: `Assumption ${cmd.id} marked ${status}.`, changed: true }
}

// ---------- status lines inside cross-session envelopes (0.3.3) ----------

/**
 * A message from another session arrives in this envelope. Only unescaped tags are envelope tags: the harness writes a tag
 * that appears inside a body with a backslash (`<\cross-session-message`, `<\/cross-session-message>`), which is plain text.
 */
const OPEN = /<cross-session-message\b([^>]*)>/g
const CLOSE = /<\/cross-session-message>/g
const PREAMBLE = /^\s*Another Claude session sent a message:\s*$/gm

/**
 * Splits a prompt into the status lines it carries and the other text. A status line typed by the user has sender
 * `user`; one inside the envelope has the envelope's `from-name`. A prompt with more than one envelope, or a broken one,
 * is refused as a whole: its status lines are not applied, and `refusal` says why.
 */
export function sortPrompt(text: string): { statuses: Array<{ line: string; sender: string }>; other: string; refusal?: string } {
  const opens = [...text.matchAll(OPEN)]
  const closes = [...text.matchAll(CLOSE)]
  const lines = (t: string) => t.split('\n').map(l => l.trim()).filter(l => l !== '')
  const refuse = (why: string) => ({
    statuses: lines(text).filter(l => parseIncoming(l) !== null).map(line => ({ line, sender: '' })),
    other: '',
    refusal: why,
  })
  if (opens.length > 1 || closes.length > 1) return refuse('Refused: more than one message envelope.')
  if (opens.length !== closes.length) return refuse('Refused: the message envelope is malformed.')
  const statuses: Array<{ line: string; sender: string }> = []
  const other: string[] = []
  const take = (body: string, sender: string) => {
    for (const line of lines(body)) {
      if (parseIncoming(line) !== null) statuses.push({ line, sender })
      else other.push(line)
    }
  }
  let rest = text
  const open = opens[0]
  const close = closes[0]
  if (open !== undefined && close !== undefined) {
    if (close.index! < open.index! + open[0].length) return refuse('Refused: the message envelope is malformed.')
    take(text.slice(open.index! + open[0].length, close.index), open[1].match(/from-name="([^"]*)"/)?.[1] ?? '')
    rest = text.slice(0, open.index) + text.slice(close.index! + close[0].length)
  }
  take(rest.replace(PREAMBLE, ''), 'user')
  return { statuses, other: other.join('\n') }
}

/** The team roster's heads for this session: its boss, and the team top (the member whose boss is the user). Undefined when the roster cannot be read or this session is not on it. */
export function headsFor(rosterText: string, sessionId: string): Set<string> | undefined {
  let roster: any
  try {
    roster = JSON.parse(rosterText)
  } catch {
    return undefined
  }
  if (!Array.isArray(roster)) return undefined
  const me = roster.find((m: any) => m && m.sessionId === sessionId)
  if (!me || typeof me.team !== 'string') return undefined
  const heads = new Set<string>()
  if (typeof me.boss === 'string') heads.add(me.boss)
  for (const m of roster) if (m && m.team === me.team && m.boss === 'user' && typeof m.name === 'string') heads.add(m.name)
  return heads
}

/** Applies status lines in order. A refused line changes nothing and its refusal is the note. */
export function applyStatuses(
  t: AssumptionTrack,
  items: Array<{ verb: Verb; id: number; allowed: boolean; refusal: string }>,
  now: number,
): { track: AssumptionTrack; notes: string[]; changed: boolean } {
  let track = t
  let changed = false
  const notes: string[] = []
  for (const it of items) {
    if (!it.allowed) {
      notes.push(it.refusal)
      continue
    }
    const r = applyIncoming(track, it, now)
    track = r.track
    changed = changed || r.changed
    notes.push(r.note)
  }
  return { track, notes, changed }
}

// ---------- the version in the band (0.3.31) ----------

/** The `version` a plugin manifest states, or '' when the text is missing, not JSON, or has no version. */
export function versionFrom(manifest: string | undefined): string {
  if (manifest === undefined) return ''
  try {
    const v = JSON.parse(manifest)?.version
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

// ---------- file names, OS and paths: the team-orchestrator rules (0.3.34) ----------

export type Os = 'windows' | 'macos' | 'linux'
export type Live = { sessionId: string; name: string }

/** A file name for a session name: the rule team-orchestrator uses for its status files. Runs of other characters become "_". */
export const nameFile = (name: string) => name.replace(/[^\p{L}\p{N}._-]+/gu, '_')

/** The OS from the OS variable (Windows_NT on Windows) and `uname -s` elsewhere, as team-orchestrator reads them. */
export const osFrom = (osVar: string | undefined, uname: string): Os => (osVar === 'Windows_NT' ? 'windows' : /darwin/i.test(uname) ? 'macos' : 'linux')

/** Two names are the same name: case-insensitive on Windows and macOS, case-sensitive on Linux. */
export const sameName = (a: string, b: string, os: Os) => (os === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase())

/** A path with forward slashes and no trailing slash. */
export const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** The home folder: USERPROFILE, else HOME, as team-orchestrator resolves it. */
export const homeOf = (env: { USERPROFILE?: string; HOME?: string }) => normPath(env.USERPROFILE || env.HOME || '')

/** The Claude config folder: CLAUDE_CONFIG_DIR, else <home>/.claude, as the session registry is found. '' when none is set. */
export const configDirOf = (env: { CLAUDE_CONFIG_DIR?: string; USERPROFILE?: string; HOME?: string }) =>
  env.CLAUDE_CONFIG_DIR ? normPath(env.CLAUDE_CONFIG_DIR) : homeOf(env) ? `${homeOf(env)}/.claude` : ''

/** The key /enhance-key adds to keybindings.json: Ctrl+X, then E, in the Chat context, running /enhance. */
export const ENHANCE_CHORD = 'ctrl+x e'
export const ENHANCE_ACTION = 'command:enhance'
const RESTART = 'Restart the session if the key does nothing.'

/**
 * What /enhance-key does to keybindings.json, given its text (undefined: there is no file): the text to write, if any,
 * and the one line to show. A file that does not parse, or a Ctrl+X E already bound in Chat (to anything, null too), is
 * left as it is. Otherwise every other field is kept, with the file's own indent and line ends.
 */
export function enhanceKeyEdit(text: string | undefined): { write?: string; line: string } {
  const added = `Added Ctrl+X E for Enhance. ${RESTART}`
  if (text === undefined) {
    const file = {
      $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
      $docs: 'https://code.claude.com/docs/en/keybindings',
      bindings: [{ context: 'Chat', bindings: { [ENHANCE_CHORD]: ENHANCE_ACTION } }],
    }
    return { write: `${JSON.stringify(file, null, 2)}\n`, line: added }
  }
  const unreadable = { line: 'keybindings.json is not readable JSON, so nothing was changed.' }
  let file: any
  try {
    file = JSON.parse(text)
  } catch {
    return unreadable
  }
  if (!file || typeof file !== 'object' || Array.isArray(file) || (file.bindings !== undefined && !Array.isArray(file.bindings))) return unreadable
  const chats = ((file.bindings ?? []) as any[]).filter(b => b?.context === 'Chat' && b.bindings && typeof b.bindings === 'object' && !Array.isArray(b.bindings))
  // keys are read case-insensitively, with any spacing between the two presses
  const isChord = (k: string) => k.trim().toLowerCase().replace(/^control\+/, 'ctrl+').split(/\s+/).join(' ') === ENHANCE_CHORD
  const bound = chats.flatMap(c => Object.entries(c.bindings).filter(([k]) => isChord(k)).map(([, v]) => v))
  if (bound.length > 0) {
    const v = bound[bound.length - 1]
    if (v === ENHANCE_ACTION) return { line: `Ctrl+X E is already set for Enhance. ${RESTART}` }
    return { line: `Ctrl+X E is taken by ${typeof v === 'string' ? v : JSON.stringify(v)} in keybindings.json, so nothing was changed.` }
  }
  if (chats.length > 0) chats[0].bindings[ENHANCE_CHORD] = ENHANCE_ACTION
  else file.bindings = [...(file.bindings ?? []), { context: 'Chat', bindings: { [ENHANCE_CHORD]: ENHANCE_ACTION } }]
  const indent = text.match(/^([ \t]+)\S/m)?.[1] ?? 2
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return { write: JSON.stringify(file, null, indent).split('\n').join(eol) + (/\n$/.test(text) ? eol : ''), line: added }
}

export const assumptionsDir = (root: string) => `${normPath(root)}/${STORE_DIR}`

/**
 * The file a session writes. With a name, the name's file; with the name's file held by a session that is not this one
 * (and still live), or by a session that cannot be read, or when another live session has the same name, the tagged
 * `<name>-<first 8 of the session id>.json`. Without a name, the session-id file as before. `takeover` means the name's
 * file belongs to a session that has closed, so this session takes it over and keeps its entries.
 */
export function chooseFile(p: { root: string; sessionId: string; name: string | undefined; os: Os; baseText: string | undefined; live: Live[]; complete: boolean }): {
  file: string
  tagged: boolean
  takeover: boolean
} {
  if (p.name === undefined || p.name.trim() === '') {
    const r = resolveStorePath(p.root, p.sessionId, p.baseText)
    return { file: r.file, tagged: r.foreign, takeover: false }
  }
  const dir = assumptionsDir(p.root)
  const owner = p.baseText === undefined ? undefined : ownerOf(p.baseText)
  const unreadable = p.baseText !== undefined && owner === undefined
  const sameNameLive = p.live.some(s => s.sessionId !== p.sessionId && sameName(s.name, p.name as string, p.os))
  const ownerLive = owner !== undefined && owner !== p.sessionId && p.live.some(s => s.sessionId === owner)
  // the registry must have been read whole: a folder that could not be listed, or a record that could not be parsed,
  // leaves the owner unknown, so this session never takes a file over
  if (!p.complete || unreadable || sameNameLive || ownerLive) {
    return { file: `${dir}/${nameFile(p.name)}-${p.sessionId.slice(0, 8)}.json`, tagged: true, takeover: false }
  }
  return { file: `${dir}/${nameFile(p.name)}.json`, tagged: false, takeover: owner !== undefined && owner !== p.sessionId }
}

// ---------- the table (0.3.34; column rules 0.3.35; separators 0.3.39; fitted widths and colours 0.3.40) ----------

/** The text cut to `n` cells, with "…" as its last cell when it is cut. */
export const clip = (s: string, n: number) => (n <= 0 ? '' : s.length <= n ? s : n <= 1 ? '…' : `${s.slice(0, n - 1)}…`)

/** A time as HH:MM, in this machine's clock. */
export const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export type Col = { key: 'id' | 'kind' | 'status' | 'turn' | 'text' | 'path' | 'at' | 'actions'; header: string; width: number; short?: boolean }

/** The text column keeps at least this many cells while any optional column shows. */
export const TEXT_MIN = 30
/** A path column narrower than this is not worth showing: it is dropped instead. */
const PATH_MIN = 8
/** The optional columns, in the order they drop as the band narrows. Text and the actions always stay. */
const DROP_ORDER = ['at', 'path', 'turn', 'id'] as const
/** The actions column: [Confirm] [Wrong] [Delete] on an open row, [Delete] on a resolved one. */
const ACTIONS = 26
/** The bar between two columns, with a space either side. It is three cells wide. */
export const SEP = ' │ '
/** The rule's crossing under each bar. */
const CROSS = '─┼─'

/** The header of each column, in Title Case: the display label only; the field names stay the same. */
export const TITLE: Record<Col['key'], string> = { id: 'ID', kind: 'Cat', status: 'Status', turn: 'Turn', text: 'Text', path: 'Path', at: 'Time', actions: '' }
/** The header of a shortened column. */
const SHORT_TITLE: Partial<Record<Col['key'], string>> = { kind: 'C', status: 'S' }

/** The width each fixed column needs: its header, or its longest cell, whichever is longer. */
export type Sizes = { id: number; kind: number; status: number; turn: number; at: number }
export function sizesOf(entries: readonly Assumption[]): Sizes {
  const longest = (header: string, cells: string[]) => Math.max(header.length, ...cells.map(c => c.length))
  return {
    id: longest('id', entries.map(a => String(a.id))),
    kind: longest('kind', entries.map(a => a.kind)),
    status: longest('status', entries.map(a => a.status)),
    turn: longest('turn', entries.map(a => String(a.turn))),
    at: longest('at', entries.map(a => hhmm(a.at))),
  }
}

/**
 * One layout: the columns in `present` (plus kind, status, text and actions), with kind and status as full words or as
 * one letter. `ok` is false when the text would fall below TEXT_MIN, or the path below PATH_MIN, while an optional column shows.
 */
function build(width: number, present: ReadonlySet<string>, short: boolean, sizes: Sizes, textOn: boolean): { cols: Col[]; ok: boolean } {
  const cols: Array<{ key: Col['key']; width: number }> = []
  if (present.has('id')) cols.push({ key: 'id', width: sizes.id })
  cols.push({ key: 'kind', width: short ? 1 : sizes.kind })
  cols.push({ key: 'status', width: short ? 1 : sizes.status })
  if (present.has('turn')) cols.push({ key: 'turn', width: sizes.turn })
  if (textOn) cols.push({ key: 'text', width: 0 })
  if (present.has('path')) cols.push({ key: 'path', width: 0 })
  if (present.has('at')) cols.push({ key: 'at', width: sizes.at })
  cols.push({ key: 'actions', width: ACTIONS })
  // a bar sits between each pair of columns: the bars come out of the width first
  const room = width - cols.reduce((n, c) => n + c.width, 0) - SEP.length * (cols.length - 1)
  const pathOn = present.has('path')
  // with text hidden, path takes all the spare width; with text shown, text keeps its share
  const text = !textOn ? 0 : pathOn ? Math.max(TEXT_MIN, Math.floor(room * 0.6)) : room
  const path = !pathOn ? 0 : textOn ? room - text : room
  const ok = (!textOn || text >= TEXT_MIN) && (!pathOn || path >= PATH_MIN)
  const laid = cols.map(c => ({
    key: c.key,
    header: c.key === 'actions' ? '' : short && SHORT_TITLE[c.key] !== undefined ? (SHORT_TITLE[c.key] as string) : TITLE[c.key],
    width: c.key === 'text' ? Math.max(text, 1) : c.key === 'path' ? path : c.width,
    ...(c.key === 'kind' || c.key === 'status' ? { short } : {}),
  })) as Col[]
  return { cols: laid, ok }
}

/**
 * The table's columns for a band of `width` cells, sized to the entries. The fixed columns take what their content needs.
 * As the band narrows, kind and status first shrink to one letter, then the optional columns drop in the order at, path,
 * turn, id. Spare width goes to text, and to path when it shows. Text never falls below TEXT_MIN while an optional column shows.
 */
export function tableColumns(width: number, entries: readonly Assumption[] = [], hidden: readonly string[] = []): Col[] {
  const sizes = sizesOf(entries)
  // a column the reader hid is not drawn, and frees its width for the others; the drop order applies to what is left
  const textOn = !hidden.includes('text')
  for (let dropped = 0; dropped <= DROP_ORDER.length; dropped++) {
    const present = new Set<string>(DROP_ORDER.slice(dropped).filter(k => !hidden.includes(k)))
    for (const short of [false, true]) {
      const laid = build(width, present, short, sizes, textOn)
      if (laid.ok) return laid.cols
    }
  }
  return build(width, new Set(), true, sizes, textOn).cols
}

/** The row whose full text is open: one at a time. Pressing the open row again closes it. */
export const selectedAfter = (current: number | null, id: number): number | null => (current === id ? null : id)

/** The open row closes when its entry is no longer in the list, so a new entry that reuses the id does not open expanded. */
export const expandedAfterChange = (expanded: number | null, entries: readonly Assumption[]): number | null =>
  expanded !== null && !entries.some(e => e.id === expanded) ? null : expanded

/** The columns a reader can hide, in the order of the toggle line. Cat, Status and the actions column always show. */
export const TOGGLES: ReadonlyArray<{ key: 'id' | 'turn' | 'text' | 'path' | 'at'; label: string }> = [
  { key: 'id', label: 'ID' },
  { key: 'turn', label: 'Turn' },
  { key: 'text', label: 'Text' },
  { key: 'path', label: 'Path' },
  { key: 'at', label: 'Time' },
]

/** Hidden columns are kept as a list of keys; anything else in the stored value is ignored. */
export function hiddenFrom(stored: unknown): string[] {
  const keys = new Set(TOGGLES.map(t => t.key as string))
  const hidden = Array.isArray(stored) ? stored.filter((k): k is string => typeof k === 'string' && keys.has(k)) : []
  // ID and Text are never both hidden: a row must still open its full text. A stored state that has both shows ID.
  return hidden.includes('id') && hidden.includes('text') ? hidden.filter(k => k !== 'id') : hidden
}

/** Shown when a toggle would hide the last of ID and Text. */
export const KEEP_ONE_MESSAGE = 'Keep ID or Text visible, so each row can still open its full text.'

/** False when hiding `key` would leave both ID and Text hidden. Showing a column is always allowed. */
export function canHide(hidden: readonly string[], key: string): boolean {
  if (hidden.includes(key)) return true
  const pair = key === 'id' ? 'text' : key === 'text' ? 'id' : null
  return pair === null || !hidden.includes(pair)
}

/** Shows a hidden column, or hides a shown one. */
export function toggled(hidden: readonly string[], key: string): string[] {
  return hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key]
}

/** The one-letter status when shortened: o, c, w, and t for a stale open entry. */
const STATUS_LETTER: Record<string, string> = { open: 'o', confirmed: 'c', wrong: 'w', stale: 't' }

/** The text of one cell, cut to its column. */
export function cellText(c: Col, a: Assumption, now: number = Date.now()): string {
  if (c.key === 'text') return clip(a.text, c.width)
  if (c.key === 'path') {
    // the first file, and how many more the turn wrote
    const more = (a.paths?.length ?? 1) - 1
    return clip(more > 0 ? `${a.path ?? ''} +${more}` : (a.path ?? ''), c.width)
  }
  if (c.key === 'at') return hhmm(a.at)
  if (c.key === 'turn') return String(a.turn)
  if (c.key === 'id') return String(a.id)
  // one letter when shortened: d or f for kind, o, c, w or t for status
  if (c.key === 'kind') return c.short ? a.kind[0]! : a.kind
  if (c.key === 'status') {
    const s = isStale(a, now) ? 'stale' : a.status
    return c.short ? STATUS_LETTER[s]! : s
  }
  return ''
}

/** The colour of a status or kind cell. Other cells have none. */
export const CELL_COLOR: { status: Record<string, string>; kind: Record<string, string> } = {
  status: { open: 'yellow', confirmed: 'green', wrong: 'red' },
  kind: { declared: 'cyan', flagged: 'magenta' },
}
export const cellColor = (key: 'status' | 'kind', value: string): string | undefined => CELL_COLOR[key][value]

/** A cell padded to its column's width. */
const fit = (s: string, w: number) => clip(s, w).padEnd(w)

/** One piece of a table line: a cell, a bar, or a rule. The band styles each piece; the text of the pieces is the line. */
export type Piece = { key: Col['key'] | 'bar' | 'rule'; text: string }

/** The header line, in pieces: each header above its column, with the bars between. */
export function headerPieces(cols: Col[]): Piece[] {
  return cols.flatMap((c, i) => [...(i > 0 ? [{ key: 'bar' as const, text: SEP }] : []), { key: c.key, text: fit(c.header, c.width) }])
}

/** The rule under the header, and between rows, in pieces: a dash under each column, with a crossing under each bar. */
export function rulePieces(cols: Col[]): Piece[] {
  return cols.flatMap((c, i) => [...(i > 0 ? [{ key: 'rule' as const, text: CROSS }] : []), { key: 'rule' as const, text: '─'.repeat(c.width) }])
}

/**
 * One data row, in pieces, up to and including the bar before the actions column. The buttons are drawn beside it, in
 * the actions column, which is the last column's width.
 */
export function rowPieces(cols: Col[], a: Assumption, now: number = Date.now()): Piece[] {
  const shown = cols.filter(c => c.key !== 'actions')
  return shown.flatMap((c, i) => [...(i > 0 ? [{ key: 'bar' as const, text: SEP }] : []), { key: c.key, text: fit(cellText(c, a, now), c.width) }]).concat([{ key: 'bar', text: SEP }])
}

const joined = (ps: Piece[]) => ps.map(p => p.text).join('')
export const tableHeader = (cols: Col[]) => joined(headerPieces(cols))
export const tableRule = (cols: Col[]) => joined(rulePieces(cols))
export const tableRow = (cols: Col[], a: Assumption) => joined(rowPieces(cols, a))

/** Short names for the enhancer sources in the Settings table, with the detail in each one's description. */
export const SOURCE_SHORT: Record<SourceId, { label: string; hint: string }> = {
  instructions: { label: 'CLAUDE.md, AGENTS.md', hint: 'Project and global instruction files. Capped at 4000 characters.' },
  skills: { label: 'Skills list', hint: 'The project skills list. Capped at 4000 characters.' },
  docs: { label: 'Context docs', hint: 'CONTEXT.md, PRD, ADRs and glossary. Capped at 4000 characters.' },
  github: { label: 'GitHub', hint: 'Wayfinder map, else recent issues. Off by default. Uses gh.' },
}

/** The space between two columns of the Settings table. */
export const TABLE_GAP = 2

/** The narrowest the description column gets; on a narrower card the row runs past the edge rather than lose its words. */
export const MIN_DESC = 12

/** Word-wraps text into lines no wider than width. A word longer than the width is cut across lines. */
export function wrapWords(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(x => x !== '')) {
    let piece = word
    while (piece.length > w) {
      if (cur !== '') {
        lines.push(cur)
        cur = ''
      }
      lines.push(piece.slice(0, w))
      piece = piece.slice(w)
    }
    if (piece === '') continue
    if (cur === '') cur = piece
    else if (cur.length + 1 + piece.length <= w) cur += ` ${piece}`
    else {
      lines.push(cur)
      cur = piece
    }
  }
  if (cur !== '') lines.push(cur)
  return lines.length > 0 ? lines : ['']
}

/**
 * Column widths for the Settings table. The selector and name columns fit their widest entry across every tab, so the
 * columns do not move when the tab changes; the description takes what is left of the card.
 */
export function tableWidths(inner: number, selectorWidths: number[], names: string[]): { selector: number; name: number; desc: number } {
  const selector = Math.max(0, ...selectorWidths)
  const name = Math.max(0, ...names.map(n => n.length))
  return { selector, name, desc: Math.max(MIN_DESC, inner - selector - name - 2 * TABLE_GAP) }
}

/** Splits rows into pages of at most `budget` lines. A row taller than the budget has a page of its own. */
export function pageRows<T>(rows: T[], heights: number[], budget: number): T[][] {
  const pages: T[][] = []
  let cur: T[] = []
  let used = 0
  rows.forEach((row, i) => {
    const h = Math.max(1, heights[i] ?? 1)
    if (cur.length > 0 && used + h > budget) {
      pages.push(cur)
      cur = []
      used = 0
    }
    cur.push(row)
    used += h
  })
  if (cur.length > 0) pages.push(cur)
  return pages.length > 0 ? pages : [[]]
}
