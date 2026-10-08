import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren, RenderElement, Timer } from 'claude-code'

import type { CleanChecklist, CleanFinished, CleanStyle } from '../types'
import {
  GATE_MESSAGE,
  SECTION_TEXT,
  actionLabel,
  applyTaskCreate,
  applyTaskUpdate,
  applyTodos,
  asksUser,
  barSegments,
  cleanName,
  cleanTitle,
  clampPercent,
  easeStep,
  fitName,
  formatDuration,
  friendlyError,
  isGateExempt,
  looksLikeUserDenial,
  meter,
  newChecklist,
  planSteps,
  reportProgress,
  shortName,
  stepsOf,
  startJob,
  stepNumber,
  sweep,
  visibleRows,
} from './logic'

type Hooked = EngineInterface

const enabledA = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)
const askEnabledA = atom({ plugin: 'clean-view', key: 'askChoicesEnabled' } as const, false)
const settingsOpenA = atom({ plugin: 'clean-view', key: 'settingsOpen' } as const, false)
const checklistA = atom({ plugin: 'clean-view', key: 'checklist' } as const, newChecklist())
const tickA = atom({ plugin: 'clean-view', key: 'tick' } as const, 0)
const styleA = atom({ plugin: 'clean-view', key: 'viewStyle' } as const, 'checklist' as CleanStyle)
const finishedA = atom({ plugin: 'clean-view', key: 'finished' } as const, [] as CleanFinished[])

const PLAN = 'mcp__clean-view__plan_steps'
const REPORT = 'mcp__clean-view__report_progress'
const ASK = 'mcp__clean-view__ask_choices'

let timer: Timer | undefined
let doneTimer: Timer | undefined
let lastInputAt = 0

function patch($: Hooked, fn: (c: CleanChecklist) => CleanChecklist) {
  return update($, checklistA, fn)
}

function runClock($: Hooked) {
  if (timer) return
  timer = $.clock.every(250, () => {
    void tickOnce($)
  })
}

async function tickOnce($: Hooked) {
  const c = await read($, checklistA)
  if (c.phase !== 'working' && c.phase !== 'needs-you') return
  await update($, tickA, n => (n ?? 0) + 1)
  await patch($, easeStep)
}

function stopClock() {
  timer?.cancel()
  timer = undefined
}

async function bell($: Hooked) {
  const now = await $.clock.now()
  // No focus API: ring only when the person has been quiet for a while.
  if (now - lastInputAt < 15000) return
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows
    ? ['powershell', '-NoProfile', '-Command', '[console]::Beep(880,200)']
    : ['afplay', '/System/Library/Sounds/Ping.aiff']
  $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
}

async function needsYou($: Hooked, reason: string, question: CleanChecklist['question'] = null) {
  const before = await read($, checklistA)
  const isNew = before.phase !== 'needs-you' || before.isBelled === false
  await patch($, c => ({
    ...c,
    phase: 'needs-you',
    needsYouReason: reason,
    question,
    isBelled: true,
    finishedAt: 0,
  }))
  runClock($)
  if (isNew) await bell($)
}

function resume($: Hooked) {
  return patch($, c =>
    c.phase === 'needs-you' || c.phase === 'stuck'
      ? { ...c, phase: 'working', needsYouReason: '', stuckReason: '', question: null, isBelled: false }
      : c,
  )
}

/** Keeps the /config row in step with a button or slash command; a session without the row ignores the call. */
async function syncRow($: Hooked, field: string, value: string) {
  await $.config.set({ key: `clean-view.${field}`, value }).catch(() => undefined)
}

async function setStyle($: Hooked, value: CleanStyle) {
  await update($, styleA, () => value)
  await $.store.set('cleanViewStyle', value)
  $.ui.toast(value === 'bars' ? 'Bar view' : 'List view')
  await syncRow($, 'view', value === 'bars' ? 'bars' : 'list')
}

async function setEnabled($: Hooked, value: boolean) {
  await update($, enabledA, () => value)
  await $.store.set('cleanViewEnabled', value)
  $.ui.toast(value ? 'Clean View is on: details are hidden.' : 'Clean View is off: details are showing.')
  await syncRow($, 'cleanView', value ? 'on' : 'off')
}

async function setAskEnabled($: Hooked, value: boolean) {
  await update($, askEnabledA, () => value)
  await $.store.set('askChoicesEnabled', value)
  $.ui.toast(value ? 'ask_choices is on.' : 'ask_choices is off: Claude uses AskUserQuestion.')
  await syncRow($, 'askChoices', value ? 'on' : 'off')
}

function title0(cl: CleanChecklist): string {
  return cl.title === '' ? 'Working on it' : cl.title
}

export function registerCleanView(on: On, options: Record<string, unknown> = {}) {
  // ---------- session start: tools, command, saved setting ----------
  // The /config menu rows (options) win; where a row is unset, the setting kept by a button or command applies.
  on('session.start', async ($, e, next) => {
    const saved = options.cleanView === 'on' ? true : options.cleanView === 'off' ? false : await $.store.get('cleanViewEnabled')
    if (typeof saved === 'boolean') await update($, enabledA, () => saved)
    const savedStyle = options.view === 'bars' ? 'bars' : options.view === 'list' ? 'checklist' : await $.store.get('cleanViewStyle')
    if (savedStyle === 'bars' || savedStyle === 'checklist') await update($, styleA, () => savedStyle)
    const savedAsk = options.askChoices === 'on' ? true : options.askChoices === 'off' ? false : await $.store.get('askChoicesEnabled')
    if (typeof savedAsk === 'boolean') await update($, askEnabledA, () => savedAsk)
    await $.tool.register({
      name: 'plan_steps',
      description:
        'Clean View: list the steps of the job in order, 1 to 8 short plain-English names starting with a verb (no paths, file names, commands or code). The first step starts at once. Call this first for every request.',
      inputSchema: {
        type: 'object',
        properties: { steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 } },
        required: ['steps'],
      },
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Clean View: report progress on a planned step by its name and a percent from 0 to 100. Use 100 the moment the step is finished.',
      inputSchema: {
        type: 'object',
        properties: { task: { type: 'string' }, percent: { type: 'number' } },
        required: ['task', 'percent'],
      },
    })
    await $.tool.register({
      name: 'ask_choices',
      description:
        'Off by default: use AskUserQuestion to ask the person. Call this only if the person has said they turned on ask_choices. When on: ask a question with 2 to 4 options, the recommended option first, then stop and wait for their reply.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
        },
        required: ['question', 'options'],
      },
    })
    await $.command.register({
      name: 'askchoices',
      description: 'Turn the ask_choices question tool on or off (no argument flips it). Off by default.',
      argumentHint: 'on|off',
    })
    await $.command.register({
      name: 'simple',
      description: 'Turn Clean View on or off (no argument flips it), or pick the look: bars or list.',
      argumentHint: 'on|off|bars|list',
    })
    await $.command.register({ name: 'progress', description: 'Flip between the bar view and the list view.' })
    await $.command.register({ name: 'progress-clear', description: 'Remove the finished bars.' })
    const c = await read($, checklistA)
    if (c.phase === 'working' || c.phase === 'needs-you') runClock($)
    return next(e)
  })

  // ---------- /simple ----------
  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'bars' || arg === 'list') {
      await setStyle($, arg === 'bars' ? 'bars' : 'checklist')
      return { text: arg === 'bars' ? 'Bar view.' : 'List view.' }
    }
    const current = await read($, enabledA)
    const value = arg === 'on' ? true : arg === 'off' ? false : !current
    await setEnabled($, value)
    return { text: value ? 'Clean View is on.' : 'Clean View is off.' }
  })

  on('command.run', { command: 'askchoices' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, askEnabledA)
    const value = arg === 'on' ? true : arg === 'off' ? false : !current
    await setAskEnabled($, value)
    return { text: value ? 'ask_choices is on.' : 'ask_choices is off.' }
  })

  on('command.run', { command: 'progress' }, async ($) => {
    const now = await read($, styleA)
    await setStyle($, now === 'bars' ? 'checklist' : 'bars')
    return { text: now === 'bars' ? 'List view.' : 'Bar view.' }
  })
  on('command.run', { command: 'progress-clear' }, async ($) => {
    await update($, finishedA, () => [])
    return { text: 'Finished bars removed.' }
  })

  // ---------- system prompt ----------
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!(await read($, enabledA))) return result
    const text = (await read($, askEnabledA))
      ? SECTION_TEXT
      : SECTION_TEXT.split('\n').filter(l => !l.includes('ask_choices')).join('\n')
    return { sections: [...result.sections, { id: 'clean-view:rules', text, scope: 'session' as const }] }
  })

  // ---------- a prompt starts a job ----------
  on('prompt.submit', async ($, e, next) => {
    lastInputAt = await $.clock.now()
    if ((await read($, enabledA)) && (await read($, checklistA)).phase === 'needs-you') await resume($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (!(await read($, enabledA))) return result
    const text = e.text.trim()
    if (text === '' || text.startsWith('/')) return result
    const now = await $.clock.now()
    const before = await read($, checklistA)
    const isContinue = before.phase === 'needs-you' || before.phase === 'working'
    if (isContinue) {
      await resume($)
      runClock($)
      return result
    }
    doneTimer?.cancel()
    await patch($, c => startJob(c, now))
    const jobId = (await read($, checklistA)).jobId
    runClock($)
    void (async () => {
      const r = await $.model.complete({
        model: 'haiku',
        effort: 'low',
        maxTokens: 30,
        timeoutMs: 15000,
        prompt: `Name this job in 2 to 6 plain words, starting with a verb. Reply with the name only: no quotes, no file names, no punctuation.\n\nRequest: ${text.slice(0, 600)}`,
      })
      if (!r.isAnswered) return
      const title = cleanTitle(r.text)
      await patch($, c => (c.jobId === jobId ? { ...c, title } : c))
    })().catch(() => undefined)
    return result
  })

  // ---------- permission prompts ----------
  on('classic.Notification', async ($, e, next) => {
    if ((await read($, enabledA)) && /permission|elicitation/i.test(e.notification_type)) {
      await needsYou($, 'Claude needs your OK to continue')
    }
    return next(e)
  })

  // ---------- serve our tools ----------
  on('tool.call', { tool: 'mcp__clean-view__plan_steps' }, async ($, e) => {
    if (!(await read($, enabledA))) return { result: 'Clean View is off. No plan needed. Continue the work.' }
    const steps = (e as { steps?: unknown }).steps
    // A subagent's plan is its own business: answer it, leave the member's checklist alone.
    if (e.agentId !== undefined) {
      const n = Array.isArray(steps) ? Math.min(Array.isArray(steps) ? steps.length : 0, 8) : 0
      return { result: n < 1 ? 'Give 1 to 8 short step names as an array of strings.' : `Planned ${n} steps. The first one has started.` }
    }
    const c = await read($, checklistA)
    const planned = planSteps(c, steps)
    if (planned === null) return { result: 'Give 1 to 8 short step names as an array of strings.' }
    await patch($, () => planned)
    runClock($)
    return { result: `Planned ${planned.tasks.length} steps. The first one has started.` }
  })

  on('tool.call', { tool: 'mcp__clean-view__report_progress' }, async ($, e) => {
    if (!(await read($, enabledA))) return { result: 'Clean View is off. No progress report needed. Continue the work.' }
    const args = e as { task?: unknown; percent?: unknown }
    // A subagent's report never touches the member's checklist (the dock may read it per agent).
    if (e.agentId !== undefined) return { result: `Progress noted: ${clampPercent(args.percent)}%.` }
    let pct = 0
    await patch($, c => {
      const r = reportProgress(c, args.task, args.percent)
      pct = r.pct
      return r.cl.phase === 'stuck' ? { ...r.cl, phase: 'working', stuckReason: '', failStreak: 0 } : r.cl
    })
    runClock($)
    return { result: `Progress noted: ${pct}%.` }
  })

  on('tool.call', { tool: 'mcp__clean-view__ask_choices' }, async ($, e) => {
    if (!(await read($, enabledA)) || !(await read($, askEnabledA))) return { result: 'ask_choices is off. Ask this question with AskUserQuestion instead.' }
    const args = e as { question?: unknown; options?: unknown }
    const question = cleanName(typeof args.question === 'string' ? args.question.replace(/`[^`]*`/g, '') : '').replace(/…$/, '')
    const options = Array.isArray(args.options) ? args.options.filter((o): o is string => typeof o === 'string').slice(0, 4) : []
    if (options.length < 2) return { result: 'Give a question and 2 to 4 options.' }
    const q = typeof args.question === 'string' && args.question.trim() !== '' ? args.question.trim().slice(0, 160) : question
    await needsYou($, q, { question: q, options })
    return { result: 'The question is on the person’s screen. Stop now and wait for their reply.' }
  })

  // ---------- the gate and the bookkeeping for every other tool ----------
  on('tool.call', async ($, e, next) => {
    if (!(await read($, enabledA)) || e.agentId !== undefined) return next(e)
    const tool = String(e.tool)
    const c = await read($, checklistA)
    const isInJob = c.phase === 'working' || c.phase === 'needs-you' || c.phase === 'stuck'
    if (isInJob && !c.hasPlan && !isGateExempt(tool)) return { deny: GATE_MESSAGE }

    const isOurs = tool === PLAN || tool === REPORT || tool === ASK
    if (!isOurs) {
      await patch($, cl => ({
        ...cl,
        action: tool === 'ToolSearch' || tool === 'TodoWrite' || tool.startsWith('Task') ? cl.action : actionLabel(tool),
      }))
    }
    if (tool === 'AskUserQuestion') {
      const qs = (e as { questions?: Array<{ question?: string }> }).questions
      await needsYou($, qs?.[0]?.question ?? 'Claude has a question for you')
    }

    const res = await next(e)
    if (isOurs) return res

    const isFailure = res.deny === undefined && res.isError === true
    if (res.deny === undefined && !isFailure) {
      if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
        const file = String((e as { file_path?: string; notebook_path?: string }).file_path ?? (e as { notebook_path?: string }).notebook_path ?? '')
        if (file !== '') await patch($, cl => (cl.changedFiles.includes(file) ? cl : { ...cl, changedFiles: [...cl.changedFiles, file] }))
      }
      if (tool === 'TodoWrite') await patch($, cl => applyTodos(cl, (e as { todos?: unknown }).todos))
      if (tool === 'TaskCreate') {
        const m = /#?(\d+)/.exec(res.text ?? '')
        await patch($, cl => applyTaskCreate(cl, (e as { subject?: unknown }).subject, m?.[1] ?? String(cl.tasks.length + 1)))
      }
      if (tool === 'TaskUpdate') await patch($, cl => applyTaskUpdate(cl, e as { taskId?: unknown; status?: unknown; subject?: unknown }))
    }
    await patch($, cl => {
      let out: CleanChecklist = cl
      if (tool === 'AskUserQuestion' || (cl.phase === 'needs-you' && cl.question === null)) {
        out = { ...out, phase: 'working', needsYouReason: '', isBelled: false }
      }
      if (res.deny !== undefined) return out
      if (!isFailure) {
        return out.phase === 'stuck' ? { ...out, phase: 'working', stuckReason: '', failStreak: 0 } : { ...out, failStreak: 0 }
      }
      if (looksLikeUserDenial(res.text ?? '')) {
        return { ...out, phase: 'stuck', stuckReason: 'you said no to a step, so Claude paused' }
      }
      const streak = out.failStreak + 1
      return streak >= 3
        ? { ...out, failStreak: streak, phase: 'stuck', stuckReason: 'a step keeps failing, Claude is trying another way' }
        : { ...out, failStreak: streak }
    })
    return res
  })

  // ---------- the end of a turn ----------
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || !(await read($, enabledA))) return result
    const now = await $.clock.now()
    const c = await read($, checklistA)
    if (c.phase === 'idle') return result
    if (e.reason === 'aborted') {
      stopClock()
      await patch($, cl => ({ ...cl, phase: 'stopped', finishedAt: now, action: '', question: null }))
    } else if (e.reason === 'error') {
      stopClock()
      await patch($, cl => ({ ...cl, phase: 'stuck', stuckReason: friendlyError(e.answer), finishedAt: now, action: '' }))
    } else if (e.reason === 'refusal') {
      stopClock()
      await patch($, cl => ({ ...cl, phase: 'stuck', stuckReason: "Claude couldn't help with that request", finishedAt: now, action: '' }))
    } else if (c.question !== null) {
      await needsYou($, c.question.question, c.question)
    } else if (c.hasPlan && c.tasks.some(t => t.status !== 'done') && asksUser(e.answer)) {
      // Unfinished steps only mean "waiting for you" when Claude actually asked something; a final answer with no
      // question means the job is done, even if the last step was never reported at 100.
      await needsYou($, 'Claude is waiting for your reply')
    } else {
      stopClock()
      await patch($, cl => ({
        ...cl,
        phase: 'done',
        finishedAt: now,
        action: '',
        isCollapsed: false,
        tasks: cl.tasks.map(t => ({ ...t, status: 'done' as const, percent: 100, hasReported: true })),
      }))
      const seconds = Math.max(0, Math.round((now - c.startedAt) / 1000))
      await update($, finishedA, f => [...f, { id: `j${c.jobId}`, title: c.title === '' ? 'Working on it' : c.title, seconds, steps: c.tasks.map(t => t.name) }].slice(-3))
      doneTimer?.cancel()
      doneTimer = $.clock.after(5000, () => {
        void patch($, cl => (cl.phase === 'done' ? { ...cl, isCollapsed: true } : cl))
      })
    }
    return result
  })

  // ---------- hide the noise ----------
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, enabledA))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, enabledA))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, enabledA))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await read($, enabledA))) return next(e)
    return next({ ...e, props: { ...e.props, hint: '' } })
  })

  // ---------- the band ----------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    // Another mod's band (below us in the chain) stays on screen: it goes above ours, in a column.
    let rest: Awaited<ReturnType<typeof next>> | undefined
    try {
      rest = await next(e)
    } catch {
      rest = undefined
    }
    const stack = (own: RenderElement): RenderElement =>
      rest ? (
        <Box flexDirection="column">
          {rest}
          {own}
        </Box>
      ) : (
        own
      )
    try {
    const enabled = await read($, enabledA)
    const cl = await read($, checklistA)
    const tick = await read($, tickA)
    const now = await $.clock.now()
    const isPlain = ((await $.env.get('NO_COLOR')) ?? '') !== ''
    const isStill =
      ((await $.env.get('NO_MOTION')) ?? '') !== '' ||
      ((await $.env.get('REDUCE_MOTION')) ?? '') !== '' ||
      ((await $.env.get('PREFERS_REDUCED_MOTION')) ?? '') !== ''
    const color = (c: string): string | undefined => (isPlain ? undefined : c)
    // The whole mod sits in one rounded frame so it never blends into another mod's band. Inside it, `width` is the
    // room left after the two border cells and one cell of padding on each side.
    const outer = e.props.bodyColumns
    const width = Math.max(20, outer - 4)
    const files = cl.changedFiles.length
    const elapsed = formatDuration((cl.finishedAt > 0 ? cl.finishedAt : now) - cl.startedAt)
    const style = await read($, styleA)
    const finished = await read($, finishedA)
    const askOn = await read($, askEnabledA)
    const settingsOpen = await read($, settingsOpenA)

    // Coloured words that carry the state: a filled pill for what is on or chosen, plain dim words for the rest.
    const pillOf = (label: string, bg: string) => (
      <Text bold inverse={isPlain} backgroundColor={isPlain ? undefined : bg} color={isPlain ? undefined : 'white'}>
        {` ${label} `}
      </Text>
    )

    // Settings are data: add an entry here and it shows in the dropdown. A toggle is on or off; a choice picks one value.
    type Setting =
      | { id: string; label: string; hint: string; kind: 'toggle'; isOn: boolean; set: (v: boolean) => void }
      | { id: string; label: string; hint: string; kind: 'choice'; value: string; options: Array<{ value: string; label: string }>; set: (v: string) => void }
    const settings: Setting[] = [
      {
        id: 'details',
        label: 'Hide tool details',
        hint: 'Show a step checklist instead of every tool call',
        kind: 'toggle',
        isOn: enabled,
        set: v => void setEnabled($, v),
      },
      {
        id: 'ask',
        label: 'Ask choices',
        hint: 'Let Claude ask with the picker in this box',
        kind: 'toggle',
        isOn: askOn,
        set: v => void setAskEnabled($, v),
      },
      {
        id: 'look',
        label: 'Progress look',
        hint: 'A checklist or one bar for each job',
        kind: 'choice',
        value: style === 'bars' ? 'bars' : 'list',
        options: [
          { value: 'list', label: 'List' },
          { value: 'bars', label: 'Bars' },
        ],
        set: v => void setStyle($, v === 'bars' ? 'bars' : 'checklist'),
      },
    ]
    const labelW = Math.max(...settings.map(s => s.label.length))
    const settingRows = settings.map(s => {
      const name = <Text bold>{s.label.padEnd(labelW, ' ')}</Text>
      if (s.kind === 'toggle') {
        return (
          <Box key={`row-${s.id}`} flexDirection="row">
            {s.isOn ? pillOf(' ON ', 'green') : pillOf(' OFF', 'gray')}
            <Text> </Text>
            <Button key={`set-${s.id}`} plain label={s.label.padEnd(labelW, ' ')} onPress={() => s.set(!s.isOn)} />
            <Text dimColor>{`  ${s.hint}`}</Text>
          </Box>
        )
      }
      return (
        <Box key={`row-${s.id}`} flexDirection="row">
          {name}
          <Text>  </Text>
          {s.options.map(o =>
            o.value === s.value ? (
              <Box key={`opt-${s.id}-${o.value}`} flexDirection="row">
                {pillOf(o.label, 'magenta')}
                <Text> </Text>
              </Box>
            ) : (
              <Box key={`opt-${s.id}-${o.value}`} flexDirection="row">
                <Button key={`set-${s.id}-${o.value}`} plain dimColor label={` ${o.label} `} onPress={() => s.set(o.value)} />
                <Text> </Text>
              </Box>
            ),
          )}
          <Text dimColor>{`  ${s.hint}`}</Text>
        </Box>
      )
    })
    const settingsButton = (
      <Button
        key="settings"
        variant={settingsOpen ? 'primary' : 'secondary'}
        label={settingsOpen ? '⚙ Settings ▴' : '⚙ Settings ▾'}
        onPress={() => void update($, settingsOpenA, v => !v)}
      />
    )
    // Frame: a title tab and the Settings button on top, the dropdown under them, then the body.
    const frame = (body: RenderChildren): RenderElement =>
      stack(
        <Box flexDirection="column" borderStyle="round" borderColor={color('cyan')} paddingX={1} width={outer}>
          <Box flexDirection="row" justifyContent="space-between" width={width}>
            <Text bold inverse={isPlain} backgroundColor={isPlain ? undefined : 'cyan'} color={isPlain ? undefined : 'black'}>
              {enabled ? ' Clean View ' : ' Clean View · off '}
            </Text>
            {settingsButton}
          </Box>
          {settingsOpen ? (
            <Box flexDirection="row" justifyContent="flex-end" width={width}>
              <Box flexDirection="column" borderStyle="round" borderColor={color('magenta')} paddingX={1}>
                <Text bold>Settings</Text>
                {settingRows}
              </Box>
            </Box>
          ) : null}
          {body}
        </Box>,
      )

    if (!enabled) {
      return frame(
        <Text dimColor wrap="truncate">
          {cl.phase === 'done' && files > 0
            ? `Changed: ${cl.changedFiles.map(f => f.split(/[\\/]/).pop()).join(', ')}`
            : 'Tool calls are showing. Open Settings to hide them again.'}
        </Text>,
      )
    }

    if (style === 'bars') {
      const live = cl.phase === 'working' || cl.phase === 'needs-you' || cl.phase === 'stuck' || cl.phase === 'stopped'
      const active = cl.tasks.find(t => t.status === 'active')
      const upcoming = cl.tasks.find(t => t.status === 'upcoming')
      let pillText = shortName(active ? active.name : 'Working', 32)
      let pillBg = 'magenta'
      if (cl.phase === 'needs-you') {
        pillText = 'Needs you'
        pillBg = 'yellow'
      } else if (cl.phase === 'stuck') {
        pillText = 'Stuck'
        pillBg = 'red'
      } else if (cl.phase === 'stopped') {
        pillText = 'Stopped'
        pillBg = 'gray'
      }
      // The words inside the bar: what Claude is doing now, else the step that comes next.
      const liveLabel = cl.phase === 'working' ? (cl.action !== '' ? `${cl.action}…` : upcoming ? upcoming.name : '') : ''
      type Item = {
        id: string
        name: string
        pillText: string
        bg: string
        pct: number
        isLive: boolean
        label: string
        onDismiss: () => void
      }
      const items: Item[] = finished.map(f => ({
        id: f.id,
        name: f.title,
        pillText: `✓ ${formatDuration(f.seconds * 1000)}`,
        bg: 'green',
        pct: 100,
        isLive: false,
        label: '',
        onDismiss: () => {
          void update($, finishedA, list => list.filter(x => x.id !== f.id))
        },
      }))
      if (live) {
        items.push({
          id: 'now',
          name: title0(cl),
          pillText,
          bg: pillBg,
          pct: Math.round(cl.bar ?? 0),
          isLive: cl.phase === 'working',
          label: liveLabel,
          onDismiss: () => {
            stopClock()
            void patch($, c => ({ ...newChecklist(), jobId: c.jobId }))
          },
        })
      }
      // Text takes at least 35% of the width (more if a name or stage needs it); the bar, percent and x take
      // everything that is left, so the row always runs to the right edge. The pill sits against the bar, and
      // every bar starts at the same column.
      // Every pill is the same width, so pills and bars line up on the left: short ones are padded with their own colour.
      const pillW = Math.min(34, Math.max(9, ...items.map(it => it.pillText.length + 2)))
      const maxPill = pillW
      const maxName = Math.max(12, ...items.map(it => it.name.length))
      const textBlock = Math.min(Math.floor(width * 0.6), Math.max(Math.floor(width * 0.35), 2 + maxName + 1 + maxPill))
      // Two cells of slack: if a terminal counts a symbol as wide, the bar gives way, never the name.
      const barW = Math.max(10, width - textBlock - (6 + 5) - 2)
      const rows: RenderChildren[] = items.map(it => (
        <Box key={`bar-${it.id}`} flexDirection="row">
          <Box width={textBlock - pillW} flexShrink={0} flexDirection="row">
            <Text color={color(it.bg)}>● </Text>
            <Text bold={it.isLive} wrap="truncate">{shortName(it.name, Math.max(8, textBlock - 3 - pillW))}</Text>
          </Box>
          <Box flexShrink={0}>{pillOf(shortName(it.pillText, pillW - 2).padEnd(pillW - 2, ' '), it.bg)}</Box>
          {barSegments(it.pct, barW, tick, it.isLive && !isStill, it.label).map((seg, k) =>
            seg.kind === 'label' ? (
              <Text key={`seg-${k}`} bold inverse={isPlain} backgroundColor={isPlain ? undefined : it.bg} color={isPlain ? undefined : 'white'}>
                {seg.text}
              </Text>
            ) : seg.kind === 'fill' ? (
              <Text key={`seg-${k}`} color={color(it.bg)}>{seg.text}</Text>
            ) : (
              <Text key={`seg-${k}`} dimColor>{seg.text}</Text>
            ),
          )}
          <Text>{` ${String(it.pct).padStart(3, ' ')}% `}</Text>
          <Button key={`x-${it.id}`} label="×" onPress={it.onDismiss} />
        </Box>
      ))
      const nextList =
        cl.phase === 'needs-you' && cl.question !== null ? (
          <Box flexDirection="column">
            <Text dimColor>next: {cl.question.question}</Text>
            {cl.question.options.map((o, i) => (
              <Button
                key={`choice${i + 1}`}
                hotkey={String(i + 1)}
                plain
                label={o}
                onPress={() => {
                  void patch($, c => ({ ...c, phase: 'working', needsYouReason: '', question: null, isBelled: false }))
                  void $.prompt.submit({ text: o, asUser: true })
                }}
              />
            ))}
            <Button
              key="dismiss-next"
              hotkey="0"
              plain
              label="dismiss"
              onPress={() => {
                void patch($, c => ({ ...c, phase: 'done', needsYouReason: '', question: null, isBelled: false }))
              }}
            />
          </Box>
        ) : null
      return frame(
        <Box flexDirection="column" width={width}>
          {rows.length === 0 ? <Text dimColor>Waiting for your next request.</Text> : null}
          {rows}
          {cl.phase === 'stuck' ? (
            <Text dimColor>{`⚠ ${cl.stuckReason}. Press Esc to stop, or type a message to steer.`}</Text>
          ) : null}
          {cl.phase === 'needs-you' && cl.question === null ? <Text dimColor>{`${cl.needsYouReason}  ↓ Answer below`}</Text> : null}
          {nextList}
        </Box>
      )
    }

    const title = title0(cl)
    const isSingle = cl.hasPlan && cl.tasks.length <= 1
    const isLive = cl.phase === 'working' || cl.phase === 'needs-you' || cl.phase === 'stuck' || cl.phase === 'stopped'
    const phasePill =
      cl.phase === 'needs-you'
        ? pillOf('Needs you', 'yellow')
        : cl.phase === 'stuck'
          ? pillOf('Stuck', 'red')
          : cl.phase === 'stopped'
            ? pillOf('Stopped', 'gray')
            : pillOf('Working', 'magenta')
    const stepNote = isSingle || cl.tasks.length === 0 ? '' : ` · Step ${stepNumber(cl)} of ${cl.tasks.length}`
    const detail =
      cl.phase === 'needs-you'
        ? `${cl.needsYouReason}  ↓ Answer below`
        : cl.phase === 'stuck'
          ? `${cl.stuckReason}. Press Esc to stop, or type a message to steer.`
          : cl.phase === 'stopped'
            ? 'You pressed Esc.'
            : cl.action !== ''
              ? `${cl.action}…`
              : ''
    const liveHead = isLive ? (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {phasePill}
          <Text bold wrap="truncate">{` ${title}`}</Text>
          <Text dimColor>{`${stepNote} · ${elapsed}`}</Text>
        </Box>
        {detail !== '' ? <Text dimColor wrap="truncate">{`  ${detail}`}</Text> : null}
      </Box>
    ) : null

    const showRows = isLive && !isSingle && cl.tasks.length > 0 && (cl.phase === 'working' || cl.phase === 'needs-you')
    const nameCol = Math.max(12, width - 24)
    const { doneCount, rows } = visibleRows(cl)
    const firstUpcoming = rows.findIndex(t => t.status === 'upcoming')
    const pct = (n: number) => `${String(Math.round(n)).padStart(3, ' ')}%`

    const rowEls = showRows
      ? rows.map((t, i) => {
          if (t.status === 'done') {
            return (
              <Box key={`r-${t.id}`} flexDirection="row">
                <Text color={color('success')}>✓ </Text>
                <Text dimColor>{fitName(t.name, nameCol)} </Text>
                <Text color={color('success')}>{meter(100)}</Text>
                <Text dimColor>  Done</Text>
              </Box>
            )
          }
          if (t.status === 'active') {
            const waiting = cl.phase === 'needs-you'
            return (
              <Box key={`r-${t.id}`} flexDirection="row">
                <Text bold color={color(waiting ? 'yellow' : 'magenta')}>{waiting ? '‖ ' : '▶ '}</Text>
                <Text bold>{fitName(t.name, nameCol)} </Text>
                <Text color={color(waiting ? 'yellow' : 'magenta')}>{t.hasReported ? meter(t.shown) : sweep(tick, isStill || waiting)}</Text>
                <Text bold>{t.hasReported ? `  ${pct(t.percent)}` : waiting ? '  Waiting' : '  Working'}</Text>
              </Box>
            )
          }
          return (
            <Box key={`r-${t.id}`} flexDirection="row">
              <Text dimColor>○ {fitName(t.name, nameCol)} </Text>
              <Text dimColor>{meter(0)}</Text>
              <Text dimColor>{i === firstUpcoming ? '  Next' : '  Up next'}</Text>
            </Box>
          )
        })
      : null

    const picker =
      cl.phase === 'needs-you' && cl.question !== null
        ? (
            <Box flexDirection="column">
              {cl.question.options.map((o, i) => (
                <Button
                  key={`choice${i + 1}`}
                  hotkey={String(i + 1)}
                  plain
                  label={o}
                  onPress={() => {
                    void patch($, c => ({ ...c, phase: 'working', needsYouReason: '', question: null, isBelled: false }))
                    void $.prompt.submit({ text: o, asUser: true })
                  }}
                />
              ))}
              <Text dimColor>…or type your own answer below</Text>
            </Box>
          )
        : null

    // Finished jobs keep themselves, as in the bar view: the last three stay as one calm row each, with a × to clear
    // one. The newest also shows its steps ticked.
    const lastId = finished.length > 0 ? finished[finished.length - 1]!.id : ''
    const historyEls = finished.map(f => {
      const isJustDone = cl.phase === 'done' && f.id === `j${cl.jobId}`
      const changed = isJustDone && files > 0 ? ` · changed ${files} ${files === 1 ? 'file' : 'files'}` : ''
      return (
        <Box key={`old-${f.id}`} flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" width={width}>
            <Text wrap="truncate">
              <Text bold color={color('success')}>{'✓ '}</Text>
              <Text>{f.title}</Text>
              <Text dimColor>{` · took ${formatDuration(f.seconds * 1000)}${changed}`}</Text>
            </Text>
            <Button
              key={`x-${f.id}`}
              label="×"
              onPress={() => {
                void update($, finishedA, list => list.filter(x => x.id !== f.id))
              }}
            />
          </Box>
          {f.id === lastId && stepsOf(f).length > 1
            ? stepsOf(f).map((n, i) => <Text key={`${f.id}-${i}`} dimColor>{`  ✓ ${n}`}</Text>)
            : null}
        </Box>
      )
    })
    return frame(
      <Box flexDirection="column" width={width}>
        {historyEls}
        {liveHead}
        {picker}
        {showRows && doneCount > 0 ? <Text dimColor color={color('success')}>{`✓ ${doneCount} steps done`}</Text> : null}
        {rowEls}
        {!isLive && finished.length === 0 ? <Text dimColor>Waiting for your next request.</Text> : null}
      </Box>
    )
    } catch (err) {
      // Never let the band vanish silently: say what went wrong, and how to carry on.
      const why = err instanceof Error ? err.message : String(err)
      return stack(
        <Box flexDirection="column">
          <Text color="red" wrap="truncate">{`Clean View hit a problem: ${why.slice(0, 80)}`}</Text>
          <Text dimColor>Type /simple off to hide Clean View, or /simple bars or /simple list to try the other look.</Text>
        </Box>,
      )
    }
  })
}
