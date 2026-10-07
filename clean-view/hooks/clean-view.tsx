import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren, Timer } from 'claude-code'

import type { CleanChecklist } from '../types'
import {
  GATE_MESSAGE,
  SECTION_TEXT,
  actionLabel,
  applyTaskCreate,
  applyTaskUpdate,
  applyTodos,
  cleanName,
  cleanTitle,
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
  startJob,
  stepNumber,
  sweep,
  visibleRows,
} from './logic'

type Hooked = EngineInterface

const enabledA = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)
const checklistA = atom({ plugin: 'clean-view', key: 'checklist' } as const, newChecklist())
const tickA = atom({ plugin: 'clean-view', key: 'tick' } as const, 0)

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

async function setEnabled($: Hooked, value: boolean) {
  await update($, enabledA, () => value)
  await $.store.set('cleanViewEnabled', value)
  $.ui.toast(value ? 'Clean View is on: details are hidden.' : 'Clean View is off: details are showing.')
}

export function registerCleanView(on: On) {
  // ---------- session start: tools, command, saved setting ----------
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('cleanViewEnabled')
    if (typeof saved === 'boolean') await update($, enabledA, () => saved)
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
        "Clean View: ask the person a question with 2 to 4 options, the recommended option first. Use this whenever you need their input, then stop and wait for their reply.",
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
      name: 'simple',
      description: 'Turn Clean View on or off (no argument flips it).',
      argumentHint: 'on|off',
    })
    const c = await read($, checklistA)
    if (c.phase === 'working' || c.phase === 'needs-you') runClock($)
    return next(e)
  })

  // ---------- /simple ----------
  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, enabledA)
    const value = arg === 'on' ? true : arg === 'off' ? false : !current
    await setEnabled($, value)
    return { text: value ? 'Clean View is on.' : 'Clean View is off.' }
  })

  // ---------- system prompt ----------
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!(await read($, enabledA))) return result
    return { sections: [...result.sections, { id: 'clean-view:rules', text: SECTION_TEXT, scope: 'session' as const }] }
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
    const steps = (e as { steps?: unknown }).steps
    const c = await read($, checklistA)
    const planned = planSteps(c, steps)
    if (planned === null) return { result: 'Give 1 to 8 short step names as an array of strings.' }
    await patch($, () => planned)
    runClock($)
    return { result: `Planned ${planned.tasks.length} steps. The first one has started.` }
  })

  on('tool.call', { tool: 'mcp__clean-view__report_progress' }, async ($, e) => {
    const args = e as { task?: unknown; percent?: unknown }
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
    } else if (c.hasPlan && c.tasks.some(t => t.status !== 'done')) {
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
    const width = e.props.bodyColumns

    const toggle = (
      <Button
        key="toggle"
        label={enabled ? 'Hide details' : 'Show details'}
        onPress={() => setEnabled($, !enabled)}
      />
    )
    const files = cl.changedFiles.length
    const elapsed = formatDuration((cl.finishedAt > 0 ? cl.finishedAt : now) - cl.startedAt)

    if (!enabled) {
      return (
        <Box flexDirection="row" justifyContent="space-between" width={width}>
          <Text dimColor wrap="truncate">
            {cl.phase === 'done' && files > 0 ? `Changed: ${cl.changedFiles.map(f => f.split(/[\\/]/).pop()).join(', ')}` : ''}
          </Text>
          {toggle}
        </Box>
      )
    }

    const title = cl.title === '' ? 'Working on it' : cl.title
    const isSingle = cl.hasPlan && cl.tasks.length <= 1
    let left: RenderChildren = <Text dimColor>Clean View is on</Text>
    let hint: RenderChildren = null
    if (cl.phase === 'working') {
      left = (
        <Text bold wrap="truncate">
          {title}
          {isSingle || cl.tasks.length === 0 ? '' : ` · Step ${stepNumber(cl)} of ${cl.tasks.length}`} · {elapsed}
        </Text>
      )
    } else if (cl.phase === 'needs-you') {
      left = (
        <Text wrap="truncate">
          <Text inverse bold color={color('permission')}>
            {' Needs you '}
          </Text>
          <Text> {cl.needsYouReason}</Text>
          <Text dimColor>  ↓ Answer below</Text>
        </Text>
      )
    } else if (cl.phase === 'stuck') {
      left = (
        <Text bold color={color('error')} wrap="truncate">
          ⚠ Stuck: {cl.stuckReason}
        </Text>
      )
      hint = <Text dimColor>Press Esc to stop, or type a message to steer.</Text>
    } else if (cl.phase === 'stopped') {
      left = <Text wrap="truncate">■ Stopped · {title} · you pressed Esc</Text>
    } else if (cl.phase === 'done') {
      left = (
        <Text bold color={color('success')} wrap="truncate">
          ✓ All done · {title} · took {elapsed}
          {files > 0 ? ` · changed ${files} ${files === 1 ? 'file' : 'files'}` : ''}
        </Text>
      )
    }

    const showRows =
      !isSingle &&
      cl.tasks.length > 0 &&
      (cl.phase === 'working' || cl.phase === 'needs-you' || (cl.phase === 'done' && !cl.isCollapsed))
    const nameCol = Math.max(12, width - 22)
    const { doneCount, rows } = visibleRows(cl)
    const firstUpcoming = rows.findIndex(t => t.status === 'upcoming')

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
              <Box key={`r-${t.id}`} flexDirection="column">
                <Box flexDirection="row">
                  <Text bold>{waiting ? '‖ ' : '▶ '}</Text>
                  <Text bold>{fitName(t.name, nameCol)} </Text>
                  <Text color={color('claude')}>{t.hasReported ? meter(t.shown) : sweep(tick, isStill || waiting)}</Text>
                  <Text>{t.hasReported ? `  ${Math.round(t.percent)}%` : waiting ? '  Waiting' : '  Working'}</Text>
                </Box>
                {cl.action !== '' && cl.phase === 'working' ? <Text dimColor>{`   ${cl.action}…`}</Text> : null}
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

    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" justifyContent="space-between" width={width}>
          <Box flexGrow={1}>{left}</Box>
          {toggle}
        </Box>
        {hint}
        {picker}
        {showRows && doneCount > 0 ? <Text dimColor color={color('success')}>{`✓ ${doneCount} steps done`}</Text> : null}
        {rowEls}
      </Box>
    )
  })
}
