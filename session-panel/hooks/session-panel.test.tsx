import { expect, mock, test } from 'claude-code/testing'

import { DEFAULT_PREFS, buildContext, enhance, runEnhance, sendBox, undoEnhance, type EnhancerDeps, type EnhancerIo } from './enhancer'
import { parseEnhanced, enhancePrompt, actionLabel, asksUser, clampPercent, barSegments, barText, stepsOf, cleanName, easeStep, friendlyError, jobPercent, meter, migratedValues, recentExcerpt, GATE_MESSAGE, GATE_LIMIT, PLAN_SECTION, reportProgress, newChecklist, planSteps } from './logic'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  plugin: 'session-panel',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 30,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const PLAN = 'mcp__session-panel__plan_steps'
const REPORT = 'mcp__session-panel__report_progress'
const ASK = 'mcp__session-panel__ask_choices'

// The world beneath the plugin: a clock, a store, an env and a tool bottom that says ok.
function world(on: any, env: Record<string, string> = {}, hasOwnBand = false) {
  mock.clock(on)
  mock.store(on)
  mock.env(on, env)
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  // The engine draws nothing in the band of its own, so what is beneath us is empty.
  if (!hasOwnBand) {
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
  }
  // Bash always fails beneath the plugin, so the failure test can reach it.
  on('tool.call', (_$: any, e: any) =>
    e.tool === 'Bash' ? { result: 'failed', text: 'failed', isError: true } : { result: 'ok', text: 'ok' },
  )
}

async function begin($: any, text = 'Build my landing page') {
  await $.turn.start({ text, turnId: 't1' })
}

// Settings groups start closed except Enhancer, so the Band rows are opened first.
async function openBand(ui: any) {
  if (!(await ui.find({ key: 'toggle-band' }))) return
  if (await ui.find({ key: 'set-details' })) return
  await ui.press({ key: 'toggle-band' })
}

async function texts(ui: any): Promise<string> {
  const all = await ui.findAll({ type: 'Text' })
  return all.map((t: any) => t.text).join('\n')
}

// 1. the name cleaner
test('cleaner strips code, paths and file names, and trims to 40', () => {
  expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
  expect(cleanName('fix the src/app/page.tsx layout today')).toBe('Fix the layout today')
  expect(cleanName('Update Pricing.tsx and notes')).toBe('Update and notes')
  expect(cleanName('`npm run build`')).toBe('Working on it')
  const long = cleanName('Make the whole customer onboarding experience feel friendlier and faster for everyone who joins')
  expect(long.length).toBeLessThanOrEqual(40)
  expect(long.endsWith('…')).toBe(true)
})

test('helpers: meter, action words, calm errors', () => {
  expect(meter(60)).toBe('██████░░░░')
  expect(actionLabel('Read')).toBe('Reading a file')
  expect(actionLabel('Bash')).toBe('Running a check')
  expect(actionLabel('mcp__x__y')).toBe('Working')
  expect(friendlyError('429 rate limit')).toBe('you hit your usage limit, try again a little later')
  expect(friendlyError('Prompt is too long')).toBe('type /compact and try again')
  expect(friendlyError('401 unauthorized')).toBe('type /login')
  const c = reportProgress(planSteps(newChecklist(), ['One', 'Two'])!, 'Two', 50).cl
  expect(c.tasks.map(t => t.status)).toEqual(['done', 'active'])
})

// 2. a to-do list plus a 60% report draws the rows on the terminal and the desktop
test('to-do list and a 60% report draw the checklist rows', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing' },
    ],
  })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 60 })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const t = await texts(ui)
    expect(t).toContain('✓ ')
    expect(t).toContain('Read your brand notes')
    expect(t).toContain('Done')
    expect(t).toContain('▶ ')
    expect(t).toContain('60%')
    expect(t).toContain('Next')
    expect(t).toContain('Up next')
    expect(t).toContain('Step 2 of 4')
    expect((await ui.find({ key: 'settings' }))?.props.label).toBe('⚙ Settings ▾')
    await ui.unmount()
  }
})

// 3. a permission prompt shows Needs you
test('a permission prompt shows Needs you', async ($, on) => {
  world(on)
  on('classic.Notification', () => ({}))
  await begin($)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const t = await texts(ui)
    expect(t).toContain('Needs you')
    expect(t).toContain('Claude needs your OK to continue')
    expect(t).toContain('↓ Answer below')
    await ui.unmount()
  }
})

// 4. /simple off hides the band, leaving only the button
test('/simple off hides the band and only the button remains', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Up next|Next/ })).toBeDefined()
    await ui.unmount()
  }
  await $.command.run({ command: 'simple', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Up next|Next|Step /i })).toBeUndefined()
    expect(await texts(ui)).toContain('Session Panel · off')
    await ui.unmount()
  }
  await $.command.run({ command: 'simple', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'settings' }))?.props.label).toBe('⚙ Settings ▾')
  await ui.unmount()
})

// 5. plan_steps, then report_progress at 100, checks off step 1 and starts step 2
test('plan_steps then 100 checks off step 1 and starts step 2', async ($, on) => {
  world(on)
  await begin($)
  const planned = await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section', 'Polish the footer'] })
  expect(String((planned as any).result)).toBe('Planned 3 steps. The first one has started.')
  const noted = await $.tool.call({ tool: REPORT, task: 'Read your brand notes', percent: 100 })
  expect(String((noted as any).result)).toBe('Progress noted: 100%.')
  const clamped = await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 400 })
  expect(String((clamped as any).result)).toBe('Progress noted: 100%.')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('Step 3 of 3')
  expect(t).toContain('Polish the footer')
  await ui.unmount()
})

test('after a first report, step 2 is current and step 1 is done', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section'] })
  await $.tool.call({ tool: REPORT, task: 'Read your brand notes', percent: 100 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui)).toContain('Step 2 of 2')
  expect(await ui.find({ type: 'Text', text: /Done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Working/ })).toBeDefined()
  await ui.unmount()
})

// 6. every other tool is denied before a plan exists and allowed after
test('tools are denied before a plan and allowed after', async ($, on) => {
  world(on)
  await begin($)
  const denied = await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect(String((denied as any).deny ?? (denied as any).text ?? '')).toContain('plan_steps')
  const exempt = await $.tool.call({ tool: 'ToolSearch', query: 'plan_steps', max_results: 1 })
  expect((exempt as any).deny).toBeUndefined()
  await $.tool.call({ tool: PLAN, steps: ['Read the file'] })
  const allowed = await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect((allowed as any).deny).toBeUndefined()
})

test('a subagent is never gated', async ($, on) => {
  world(on)
  await begin($)
  const r = await $.tool.call({ tool: 'Read', file_path: 'a.md', agentId: 'sub1' } as any)
  expect((r as any).deny).toBeUndefined()
})

// A. live action line
test('the current step shows a plain action line', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section'] })
  await $.tool.call({ tool: 'Read', file_path: 'C:/secret/brand.md' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('Reading a file…')
  expect(t).not.toContain('secret')
  expect(t).not.toContain('brand.md')
  await ui.unmount()
})

// C. the meter never moves backwards
test('a lower percent is held', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 60 })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 40 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui)).toContain('60%')
  await ui.unmount()
})

// D. stable height: past five rows the finished steps fold into one line
test('more than five rows fold finished steps into one line', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Step one', 'Step two', 'Step three', 'Step four', 'Step five', 'Step six', 'Step seven'] })
  await $.tool.call({ tool: REPORT, task: 'Step three', percent: 20 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('✓ 2 steps done')
  expect(t).not.toContain('Step one')
  await ui.unmount()
})

// F. stuck: three failed tools in a row
test('three failures in a row show Stuck with the steer hint', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Run the checks', 'Polish the footer'] })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'false' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('a step keeps failing, Claude is trying another way')
  expect(t).toContain('Press Esc to stop, or type a message to steer.')
  await ui.unmount()
})

// G. the button is named by its action
test('the button flips between Hide details and Show details', async ($, on) => {
  world(on)
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'settings' }))?.props.label).toBe('⚙ Settings ▾')
  expect(await ui.find({ key: 'set-details' })).toBeUndefined()
  await ui.press({ key: 'settings' })
  await openBand(ui)
  expect((await ui.find({ key: 'settings' }))?.props.label).toBe('⚙ Settings ▴')
  await ui.press({ key: 'set-details' })
  expect(await texts(ui)).toContain('Session Panel · off')
  expect(await texts(ui)).toContain(' OFF')
  await ui.press({ key: 'set-details' })
  expect(await texts(ui)).not.toContain('Session Panel · off')
  expect(await texts(ui)).toContain(' ON ')
  await ui.unmount()
})

// H. a one-step job shows the header line only
test('a one-step job shows no checklist rows', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Answer your question'] })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).not.toContain('Answer your question')
  expect(t).not.toContain('Step 1 of 1')
  expect(t).toContain('Working on it')
  await ui.unmount()
})

// I. NO_COLOR and reduced motion
test('NO_COLOR draws no colour and reduced motion draws a static meter', async ($, on) => {
  world(on, { NO_COLOR: '1', NO_MOTION: '1' })
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const all = await ui.findAll({ type: 'Text' })
  expect(all.every((t: any) => t.props.color === undefined)).toBe(true)
  expect(await texts(ui)).toContain('▒▒▒▒▒▒▒▒▒▒')
  await ui.unmount()
})

// J. file-change count on Done
test('Done shows how many distinct files changed', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/a.tsx', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/a.tsx', old_string: 'b', new_string: 'c' })
  await $.tool.call({ tool: 'Write', file_path: 'C:/p/b.css', content: 'x' })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 100 })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('✓ ')
  expect(t).toContain('changed 2 files')
  expect(t).not.toContain('a.tsx')
  await ui.unmount()
})

test('Esc becomes Stopped and an API error becomes one calm sentence', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui)).toContain('Stopped')
  await ui.unmount()
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  await $.turn.complete({ answer: 'API Error: 429 rate limit', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui)).toContain('you hit your usage limit, try again a little later')
  await ui.unmount()
})

test('unfinished steps at the end of a turn become Needs you', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  await $.turn.complete({ answer: 'Shall I go on?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('Needs you')
  expect(t).toContain('Claude is waiting for your reply')
  await ui.unmount()
})

test('the whole band sits in one rounded frame, with the Settings button closed at first', async ($, on) => {
  world(on)
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some((b: any) => b.props.borderStyle === 'round')).toBe(true)
  expect(await ui.find({ key: 'set-ask' })).toBeUndefined()
  await ui.unmount()
})

// K. the in-band picker
const ASK_CMD = (args: string) => ({ command: 'askchoices', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }) as any

test('ask_choices is off by default and points the model to AskUserQuestion; /askchoices on turns it on', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] })
  const off = await $.tool.call({ tool: ASK, question: 'Which style?', options: ['A', 'B'] })
  expect(off.result).toContain('AskUserQuestion')
  await $.command.run(ASK_CMD('on'))
  const on1 = await $.tool.call({ tool: ASK, question: 'Which style?', options: ['A', 'B'] })
  expect(on1.result).toContain('wait for their reply')
  await $.command.run(ASK_CMD('off'))
  const off2 = await $.tool.call({ tool: ASK, question: 'Which style?', options: ['A', 'B'] })
  expect(off2.result).toContain('AskUserQuestion')
})

test('the Ask choices row in Settings flips the setting', async ($, on) => {
  world(on)
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'settings' })
  await openBand(ui)
  expect(await ui.find({ key: 'set-ask' })).toBeDefined()
  await ui.press({ key: 'set-ask' })
  const on1 = await $.tool.call({ tool: ASK, question: 'Which style?', options: ['A', 'B'] })
  expect(on1.result).toContain('wait for their reply')
  await ui.press({ key: 'set-ask' })
  const off1 = await $.tool.call({ tool: ASK, question: 'Which style?', options: ['A', 'B'] })
  expect(off1.result).toContain('AskUserQuestion')
  await ui.unmount()
})

test('ask_choices shows numbered choices and a press sends the answer', async ($, on) => {
  world(on)
  const sent: string[] = []
  on('prompt.submit', (_$: any, e: any) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await begin($)
  await $.command.run(ASK_CMD('on'))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  await $.tool.call({ tool: ASK, question: 'Which style do you want?', options: ['Clean and light (Recommended)', 'Bold and dark', 'Playful'] })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const t = await texts(ui)
    expect(t).toContain('Needs you')
    expect(t).toContain('Which style do you want?')
    expect(t).toContain('…or type your own answer below')
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b: any) => b.props.label)).toContain('Bold and dark')
    expect((await ui.find({ key: 'choice1' }))?.props.hotkey).toBe('1')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'choice2' })
  expect(sent).toEqual(['Bold and dark'])
  await ui.unmount()
})

test('hidden rows: tool rows draw nothing while Session Panel is on', async ($, on) => {
  world(on)
  await begin($)
  for (const component of ['ToolUse', 'ToolResult', 'ToolGroup'] as const) {
    const props: any =
      component === 'ToolGroup'
        ? { calls: [], isActive: false, isExpanded: false }
        : { tool_use_id: 'u1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: {} }
    const ui = await $.ui.mount({ plugin: 'session-panel', surface: 'terminal', component, props })
    expect(((await ui.drawn()) as any).props.display).toBe('none')
    await ui.unmount()
  }
})

test('an unknown step name ticks nothing off', async ($, on) => {
  // the pure rule
  const planned = planSteps(newChecklist(), ['Read your brand notes', 'Build the pricing section', 'Polish the footer'])!
  const mid = reportProgress(reportProgress(planned, 'Read your brand notes', 100).cl, 'Build the pricing section', 30).cl
  const after = reportProgress(mid, 'Check the invoice totals', 50).cl
  expect(after.tasks.map(t => t.name)).toEqual(['Read your brand notes', 'Build the pricing section', 'Check the invoice totals', 'Polish the footer'])
  expect(after.tasks.map(t => t.status)).toEqual(['done', 'upcoming', 'active', 'upcoming'])
  expect(after.tasks[2]!.percent).toBe(50)
  expect(after.tasks[1]!.percent).toBe(30)

  // and what the person sees
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section', 'Polish the footer'] })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 30 })
  await $.tool.call({ tool: REPORT, task: 'Check the invoice totals', percent: 50 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('Step 3 of 4')
  expect(t).toContain('Check the invoice totals')
  expect(t).toContain('50%')
  // step 1 was ticked off by the planned-name report; nothing else was
  expect((t.match(/Done/g) ?? []).length).toBe(1)
  await ui.unmount()
})

test('with two AbovePrompt handlers registered, both bands render', async ($, on) => {
  world(on, {}, true)
  // Another mod's band, beneath ours in the chain.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text>OTHER MOD BAND</Text>
      </Box>
    )
  })
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const t = await texts(ui)
    expect(t).toContain('OTHER MOD BAND')
    expect(t).toContain('Build the pricing section')
    expect(t).toContain('Step 1 of 2')
    expect((await ui.find({ key: 'settings' }))?.props.label).toBe('⚙ Settings ▾')
    // the other band sits above ours
    expect(t.indexOf('OTHER MOD BAND')).toBeLessThan(t.indexOf('Step 1 of 2'))
    await ui.unmount()
  }
})

test('with Session Panel off, the other band still shows', async ($, on) => {
  world(on, {}, true)
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text>OTHER MOD BAND</Text>
      </Box>
    )
  })
  await begin($)
  await $.command.run({ command: 'simple', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui)).toContain('OTHER MOD BAND')
  expect(await texts(ui)).toContain('Session Panel · off')
  await ui.unmount()
})

// ---- the bar style ----
const RUN = (args: string) => ({ command: 'simple', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }) as any

test('bar math: the job percent follows the steps and the eased bar never goes back', () => {
  let c = planSteps(newChecklist(), ['One', 'Two', 'Three', 'Four'])!
  expect(jobPercent(c)).toBe(0)
  c = reportProgress(c, 'Two', 50).cl
  expect(jobPercent(c)).toBe(38)
  let prev = 0
  for (let i = 0; i < 12; i++) {
    c = easeStep(c)
    expect(c.bar).toBeGreaterThanOrEqual(prev)
    prev = c.bar
  }
  expect(c.bar).toBe(38)
  expect(barText(50, 10, 0, false)).toEqual({ filled: '▓▒▓▒▓', rest: '░░░░░' })
})

test('bar style: a row with the job name, a stage pill, a bar, a percent and a dismiss button', async ($, on) => {
  world(on)
  await begin($)
  await $.command.run(RUN('bars'))
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section', 'Polish the footer'] })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 60 })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const t = await texts(ui)
    expect(t).toContain('Working on it')
    expect(t).toContain(' Build the pricing section ')
    expect(t).toMatch(/\d+%/)
    expect(t).not.toContain('Up next')
    expect(await ui.find({ key: 'x-now' })).toBeDefined()
    expect((await ui.find({ key: 'settings' }))?.props.label).toBe('⚙ Settings ▾')
    expect((await ui.find({ key: 'settings' }))?.props.label).toBe('⚙ Settings ▾')
    await ui.unmount()
  }
})

test('bar style: a finished job stays as a green bar with its time until it is dismissed', async ($, on) => {
  world(on)
  await begin($)
  await $.command.run(RUN('bars'))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 100 })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toMatch(/✓ \d+s/)
  expect(t).toContain('100%')
  expect(await ui.find({ key: 'x-j1' })).toBeDefined()
  await ui.press({ key: 'x-j1' })
  expect(await ui.find({ key: 'x-j1' })).toBeUndefined()
  await ui.unmount()
})

test('bar style: next steps show as numbered choices with 0 to dismiss, and a press sends the answer', async ($, on) => {
  world(on)
  const sent: string[] = []
  on('prompt.submit', (_$: any, e: any) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await begin($)
  await $.command.run(RUN('bars'))
  await $.command.run(ASK_CMD('on'))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  await $.tool.call({ tool: ASK, question: 'What next?', options: ['Ship steps 1 and 2', 'Fix the four bugs first'] })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const t = await texts(ui)
    expect(t).toContain('next: What next?')
    expect(t).toContain(' Needs you ')
    expect((await ui.find({ key: 'choice1' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'dismiss-next' }))?.props.hotkey).toBe('0')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'choice2' })
  expect(sent).toEqual(['Fix the four bugs first'])
  await ui.unmount()
})

test('the style flips with the button, /progress and /simple list, and /progress-clear empties the finished bars', async ($, on) => {
  world(on)
  await begin($)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'settings' })
  await openBand(ui)
  expect(await ui.find({ key: 'set-look-bars' })).toBeDefined()
  expect(await ui.find({ key: 'set-look-list' })).toBeUndefined()
  await ui.press({ key: 'set-look-bars' })
  expect(await ui.find({ key: 'set-look-list' })).toBeDefined()
  expect(await ui.find({ key: 'set-look-bars' })).toBeUndefined()
  await ui.press({ key: 'set-look-list' })
  expect(await ui.find({ key: 'set-look-bars' })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'set-look-list' })).toBeDefined()
  await ui.unmount()
  await $.command.run(RUN('list'))
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'set-look-bars' })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 100 })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.command.run(RUN('bars'))
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'x-j1' })).toBeDefined()
  await $.command.run({ command: 'progress-clear', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(await ui.find({ key: 'x-j1' })).toBeUndefined()
  await ui.unmount()
})

test('with Session Panel off, the bar style shows only the button', async ($, on) => {
  world(on)
  await begin($)
  await $.command.run(RUN('bars'))
  await $.command.run(RUN('off'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'set-look-bars' })).toBeUndefined()
  expect(await texts(ui)).toContain('Session Panel · off')
  await ui.unmount()
})

test('bar style: name, pill, bar and percent sit together, with the words inside the bar', async ($, on) => {
  world(on)
  await begin($)
  await $.command.run(RUN('bars'))
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section', 'Polish the footer'] })
  await $.tool.call({ tool: 'Read', file_path: 'C:/p/a.md' })
  const WIDTH = 120
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: WIDTH } })
  const rows = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.text.includes('%') && b.text.includes('Working on it'))
  const row = rows[rows.length - 1]!.text as string
  // the row never overflows
  expect(row.length).toBeLessThanOrEqual(WIDTH)
  // the words ride inside the bar
  expect(row).toContain(' Reading a file… ')
  // text gets at least 35% of the width: the name block plus the pill is 42 of 120 columns
  const boxes = await ui.findAll({ type: 'Box' })
  const nameBox = boxes.find((b: any) => String(b.key) === 'bar-now')
  const nameCol = (await ui.findAll({ type: 'Box' })).find((b: any) => b.props.flexShrink === 0 && typeof b.props.width === 'number' && b.text.startsWith('●'))
  expect(nameCol).toBeDefined()
  const pill = (await ui.findAll({ type: 'Text' })).find((t: any) => t.props.bold === true && t.props.backgroundColor !== undefined && t.text.startsWith(' Read your brand notes'))
  expect(pill).toBeDefined()
  expect((nameCol!.props.width as number) + (pill!.text as string).length).toBe(Math.floor((WIDTH - 4) * 0.35))
  // the bar takes the rest: 120 - text block (42) - percent and x (11) - 2 spare, words included
  const bar = [...row.matchAll(/[▓▒░]+/g)].map(m => m[0]).join('')
  expect(bar.length + ' Reading a file… '.length).toBe(WIDTH - 4 - 40 - 11 - 2)
  expect(nameBox).toBeDefined()
  await ui.unmount()
})

test('bar words: the label rides the edge of the fill, never outside the bar', () => {
  const segs = barSegments(50, 30, 0, false, 'Reading a file…')
  const joined = segs.map(s => s.text).join('')
  expect(joined.length).toBe(30)
  expect(segs.some(s => s.kind === 'label' && s.text.trim() === 'Reading a file…')).toBe(true)
  expect(barSegments(0, 30, 0, false, '').every(s => s.kind !== 'label')).toBe(true)
  expect(barSegments(100, 12, 0, false, 'a very long label that cannot fit').map(s => s.text).join('').length).toBe(12)
})

test('list view keeps finished jobs with their steps ticked until they are dismissed', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section'] })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 100 })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  // the job that just finished keeps its rows
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  let t = await texts(ui)
  expect(t).toContain('✓ ')
  expect(t).toContain('Read your brand notes')
  expect(t).toContain('Build the pricing section')
  await ui.unmount()
  // a new job starts: the old one stays above it with its steps ticked
  await begin($, 'Another job')
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  t = await texts(ui)
  expect(t).toMatch(/✓ .* · took \d+s/)
  expect(t).toContain('✓ Read your brand notes')
  expect(t).toContain('✓ Build the pricing section')
  expect(await ui.find({ key: 'x-j1' })).toBeDefined()
  await ui.press({ key: 'x-j1' })
  expect(await ui.find({ key: 'x-j1' })).toBeUndefined()
  expect(await texts(ui)).not.toContain('✓ Read your brand notes')
  await ui.unmount()
})

test('switching the view loses nothing: finished jobs show in both', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section'] })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 100 })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await begin($, 'Another job')
  for (const style of ['bars', 'list', 'bars', 'list']) {
    await $.command.run(RUN(style))
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ key: 'x-j1' })).toBeDefined()
    await ui.unmount()
  }
})

test('finished jobs saved by an older version (no steps) do not break the band', () => {
  expect(stepsOf({})).toEqual([])
  expect(stepsOf({ steps: ['One', 'Two'] })).toEqual(['One', 'Two'])
})

test('asksUser: only a real question counts as waiting', () => {
  expect(asksUser('All done. The report is on the shared drive.')).toBe(false)
  expect(asksUser('Reported to Head. Nothing else to do.')).toBe(false)
  expect(asksUser('')).toBe(false)
  expect(asksUser('Which style do you want?')).toBe(true)
  expect(asksUser('I built it. Let me know if you want changes.')).toBe(true)
  expect(asksUser('Shall I go on')).toBe(true)
})

test('a final answer with no question ends the job as Done, even if the last step was never reported', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Update the docs', 'Report to the head'] })
  await $.tool.call({ tool: REPORT, task: 'Update the docs', percent: 80 })
  await $.turn.complete({ answer: 'The docs are updated and the report is sent.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('✓ ')
  expect(t).not.toContain('Needs you')
  expect(t).not.toContain('Waiting')
  await ui.unmount()
})

test('bar style: every pill starts in the same column, finished and live alike', async ($, on) => {
  world(on)
  await $.command.run(RUN('bars'))
  for (const n of ['a', 'b']) {
    await $.turn.start({ text: n, turnId: 't' + n })
    await $.tool.call({ tool: PLAN, steps: ['Configure token access'] })
    await $.tool.call({ tool: REPORT, task: 'Configure token access', percent: 100 })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't' + n, reason: 'answer' })
  }
  await $.turn.start({ text: 'c', turnId: 'tc' })
  await $.tool.call({ tool: PLAN, steps: ['Understand your request', 'Audit the site'] })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 150 } })
  const flat = (await ui.findAll({ type: 'Box' })).filter((b: any) => String(b.key).startsWith('bar-')).map((b: any) => (b.text as string).replace(/\n/g, ''))
  expect(flat.length).toBeGreaterThanOrEqual(3)
  // pill start = first run of two-or-more spaces-free coloured text: compare where each row's bar starts
  const barStarts = flat.map((t: string) => t.search(/[▓▒░]/))
  expect(new Set(barStarts).size).toBe(1)
  // the name columns are fixed-width boxes that never shrink, all the same width
  const nameWidths = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.flexShrink === 0 && typeof b.props.width === 'number' && b.text.startsWith('●')).map((b: any) => b.props.width)
  expect(nameWidths.length).toBeGreaterThanOrEqual(3)
  expect(new Set(nameWidths).size).toBe(1)
  const pillStarts = flat.map((t: string) => t.search(/(✓ \d|Understand)/))
  expect(new Set(pillStarts).size).toBe(1)
  await ui.unmount()
})

test('a subagent report_progress and plan_steps leave the member checklist alone', async ($, on) => {
  world(on)
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 20 })
  // a subagent (it has an agentId) reports 60 on the same step, then an unknown one, then plans its own steps
  const sub = { agentId: 'sub1' } as any
  const a = await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 60, ...sub })
  const b = await $.tool.call({ tool: REPORT, task: 'Check the invoice totals', percent: 100, ...sub })
  const c = await $.tool.call({ tool: PLAN, steps: ['One', 'Two', 'Three'], ...sub })
  // each is answered as usual
  expect(String((a as any).result)).toBe('Progress noted: 60%.')
  expect(String((b as any).result)).toBe('Progress noted: 100%.')
  expect(String((c as any).result)).toBe('Planned 3 steps. The first one has started.')
  // the member's own checklist is exactly as the member left it
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('Step 1 of 2')
  expect(t).toContain('Build the pricing section')
  expect(t).toContain('Polish the footer')
  expect(t).toContain('20%')
  expect(t).not.toContain('60%')
  expect(t).not.toContain('Check the invoice totals')
  expect(t).not.toContain('One')
  await ui.unmount()
  // and the member's own report still works
  await $.tool.call({ tool: REPORT, task: 'Build the pricing section', percent: 60 })
  const ui2 = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui2)).toContain('60%')
  await ui2.unmount()
})

test('clampPercent: a number from 0 to 100, anything else is 0', () => {
  expect(clampPercent(60)).toBe(60)
  expect(clampPercent(400)).toBe(100)
  expect(clampPercent(-5)).toBe(0)
  expect(clampPercent('42')).toBe(42)
  expect(clampPercent('x')).toBe(0)
  expect(clampPercent(undefined)).toBe(0)
})

test('a subagent ask_choices stays out of the band; the member own ask_choices still shows the picker', async ($, on) => {
  world(on)
  await begin($)
  await $.command.run(ASK_CMD('on')) // the gap only matters when ask_choices is on (off by default)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  const sub = { agentId: 'sub1' } as any
  const r = await $.tool.call({ tool: ASK, question: 'Which style?', options: ['Light', 'Dark'], ...sub })
  expect(String((r as any).result)).toBe("Helpers can't ask the user. Put the question and its options in your final result so the agent that launched you can ask.")
  // the band is as the member left it: working, no picker, no Needs you
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  let t = await texts(ui)
  expect(t).toContain('Step 1 of 2')
  expect(t).not.toContain('Needs you')
  expect(t).not.toContain('Which style?')
  expect(await ui.find({ key: 'choice1' })).toBeUndefined()
  await ui.unmount()
  // the member's own question still shows the picker
  await $.tool.call({ tool: ASK, question: 'Which style?', options: ['Light', 'Dark'] })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  t = await texts(ui)
  expect(t).toContain('Needs you')
  expect(t).toContain('Which style?')
  expect((await ui.find({ key: 'choice1' }))?.props.label).toBe('Light')
  await ui.unmount()
})

// 4. one-time migration: the old settings row maps onto the store keys
test('migration: the old clean-view@herman-mods row maps onto the store keys', () => {
  const rows = { 'clean-view@herman-mods': { options: { cleanView: 'off', view: 'bars', askChoices: 'on' } } }
  expect(migratedValues(rows, {})).toEqual({ sessionPanelEnabled: false, sessionPanelStyle: 'bars', askChoicesEnabled: true })
})

test('migration: the plain clean-view key is read when the suffixed row is missing', () => {
  expect(migratedValues({ 'clean-view': { options: { view: 'list' } } }, {})).toEqual({ sessionPanelStyle: 'checklist' })
})

test('migration: a value already in the store is never overwritten', () => {
  const rows = { 'clean-view@herman-mods': { options: { cleanView: 'off', view: 'bars' } } }
  expect(migratedValues(rows, { sessionPanelEnabled: true })).toEqual({ sessionPanelStyle: 'bars' })
})

test('migration: no old row copies nothing', () => {
  expect(migratedValues(undefined, {})).toEqual({})
  expect(migratedValues({}, {})).toEqual({})
})

// 5. enhancer: the band's actions, run against a fake box and fake engine calls
type Reply = { isAnswered: true; text: string } | { isAnswered: false; reason: string }

function fakeDeps(replies: string[], answers: string[] = []) {
  const box = { text: 'make a page' }
  const fills: string[] = []
  const submits: string[] = []
  const asked: string[] = []
  const toasts: string[] = []
  let state = { original: null as string | null, passText: null as string | null, notes: [] as string[], busy: false }
  const store = new Map<string, any>()
  const forks: string[] = []
  const deps: EnhancerDeps = {
    home: async () => 'C:\\Users\\Herman',
    exists: async () => false,
    read: async () => '',
    mtime: async () => 1,
    list: async () => [],
    ancestors: async () => [],
    messages: async () => [],
    cacheGet: async k => store.get(k),
    cacheSet: async (k, v) => void store.set(k, v),
    gh: async () => undefined,
    fork: async (prompt): Promise<Reply> => {
      forks.push(prompt)
      return { isAnswered: true, text: replies.shift() ?? '' }
    },
    complete: async () => ({ isAnswered: false }),
    askUser: async (q, options) => {
      asked.push(q)
      return answers.shift() ?? options[0]
    },
    prefs: async () => ({ ...DEFAULT_PREFS, chat: 'full' as const }),
    state: async () => state,
    setState: async patch => void (state = { ...state, ...patch }),
    readBox: async () => box.text,
    fillBox: async text => void (box.text = text, fills.push(text)),
    submitBox: async text => void submits.push(text),
    toast: text => void toasts.push(text),
  }
  return { deps, box, fills, submits, asked, toasts, forks, getState: () => state }
}

test('enhancer: Enhance fills the box with the enhanced text and shows the notes', async () => {
  const f = fakeDeps([JSON.stringify({ prompt: 'Build a landing page for a bakery', notes: ['Added the audience'], questions: [] })])
  const line = await runEnhance(f.deps)
  expect(line).toBe('Enhanced. Check the box, then Send.')
  expect(f.fills).toEqual(['Build a landing page for a bakery'])
  expect(f.getState().notes).toEqual(['Added the audience'])
  expect(f.getState().original).toBe('make a page')
})

test('enhancer: Undo restores the original text and clears the notes', async () => {
  const f = fakeDeps([JSON.stringify({ prompt: 'Build a page', notes: ['x'], questions: [] })])
  await runEnhance(f.deps)
  await undoEnhance(f.deps)
  expect(f.box.text).toBe('make a page')
  expect(f.getState().original).toBeNull()
  expect(f.getState().notes).toEqual([])
})

test('enhancer: Send submits the box as it stands, then clears the draft', async () => {
  const f = fakeDeps([JSON.stringify({ prompt: 'Build a page', notes: [], questions: [] })])
  await runEnhance(f.deps)
  await sendBox(f.deps)
  expect(f.submits).toEqual(['Build a page'])
  expect(f.getState().original).toBeNull()
})

test('enhancer: an empty box is not sent and says so', async () => {
  const f = fakeDeps([])
  f.box.text = '   '
  await sendBox(f.deps)
  expect(f.submits).toEqual([])
  expect(f.toasts).toEqual(['The box is empty.'])
})

test('enhancer: a vague draft asks one question per call, then enhances with the answer', async () => {
  const f = fakeDeps(
    [
      JSON.stringify({ prompt: '', notes: [], questions: [{ question: 'What is it for?', options: ['A bakery', 'A school'] }] }),
      JSON.stringify({ prompt: 'Build a landing page for the bakery site', notes: ['Used the answer'], questions: [] }),
    ],
    ['A bakery'],
  )
  const outcome = await enhance(f.deps, 'do the thing', { ...DEFAULT_PREFS, chat: 'full' })
  expect(f.asked).toEqual(['What is it for?'])
  expect(f.forks.length).toBe(2)
  expect(f.forks[1]).toContain('What is it for? A bakery')
  expect(outcome.kind).toBe('filled')
  expect(outcome.kind === 'filled' && outcome.prompt).toBe('Build a landing page for the bakery site')
})

test('enhancer: a model reply with no usable prompt fails and leaves the box alone', async () => {
  const f = fakeDeps(['not json at all'])
  expect(await runEnhance(f.deps)).toBe('Enhancer: the model gave no usable reply.')
  expect(f.fills).toEqual([])
})

// 6. enhancer helpers: parsing, prompt shape, context caching
test('enhancer: a reply wrapped in prose still parses; bad questions are dropped', () => {
  const reply = 'Here you go: {"prompt":"Do X","notes":["a","b"],"questions":[{"question":"Q?","options":["1"]},{"question":"Q2?","options":["A","B"]}]} thanks'
  const parsed = parseEnhanced(reply)!
  expect(parsed.prompt).toBe('Do X')
  expect(parsed.questions).toEqual([{ question: 'Q2?', options: ['A', 'B'] }])
  expect(parseEnhanced('no json here')).toBeNull()
})

test('enhancer: the prompt carries the draft and the context', () => {
  const text = enhancePrompt('make a page', '## CLAUDE.md\nUse Tailwind', [])
  expect(text).toContain('make a page')
  expect(text).toContain('Use Tailwind')
  expect(text).toContain('Reply with JSON only')
})

function fakeIo(files: Record<string, string>, log: string[]): EnhancerIo {
  const store = new Map<string, any>()
  return {
    home: async () => 'C:\\Users\\Herman',
    exists: async p => p in files,
    read: async p => {
      log.push('read ' + p)
      return files[p]
    },
    mtime: async () => 1000,
    list: async p => {
      if (p === 'C:/Users/Herman/.claude/skills') return [{ name: 'pdf', kind: 'dir' }]
      throw new Error('ENOENT')
    },
    ancestors: async () => [],
    messages: async () => [],
    cacheGet: async k => store.get(k),
    cacheSet: async (k, v) => void store.set(k, v),
    gh: async () => undefined,
    fork: async () => ({ isAnswered: false, reason: 'nothing-to-fork' }),
    complete: async () => ({ isAnswered: false }),
    askUser: async () => '',
  }
}

test('enhancer: context reads the global CLAUDE.md with forward slashes and reuses the cached digest', async () => {
  const log: string[] = []
  const io = fakeIo({ 'C:/Users/Herman/.claude/CLAUDE.md': 'Global rule' }, log)
  const sources = { instructions: true, skills: true, docs: false, github: false }
  const first = await buildContext(io, sources)
  expect(first.text).toContain('Global rule')
  expect(first.used).toContain('Global CLAUDE.md')
  expect(first.text).toContain('pdf')
  const second = await buildContext(io, sources)
  expect(second.text).toBe(first.text)
  expect(log.filter(l => l.includes('CLAUDE.md')).length).toBe(1)
})

test('enhancer: a missing project skills folder counts as zero, not an error', async () => {
  const io = fakeIo({}, [])
  const ctx = await buildContext(io, { instructions: false, skills: true, docs: false, github: false })
  expect(ctx.used).toEqual(['Skills'])
})

// 7. chat route: recent mode reads the last turns and calls complete(); full mode forks the session
test('chat: the excerpt keeps six text turns, caps each at 1500 and the whole at 6000', () => {
  const short = Array.from({ length: 10 }, (_, i) => ({ role: 'user', text: `m${i}` }))
  const kept = recentExcerpt([...short, { role: 'tool', text: 'ignored' }])
  expect(kept).toContain('m4')
  expect(kept).toContain('m9')
  expect(kept).not.toContain('m3')
  expect(kept).not.toContain('ignored')
  const long = Array.from({ length: 6 }, () => ({ role: 'assistant', text: 'z'.repeat(3000) }))
  const capped = recentExcerpt(long)
  expect(capped.length).toBeLessThanOrEqual(6000)
})

test('chat: recent mode sends the docs and a trimmed excerpt to complete() on the haiku model, never forks', async () => {
  const f = fakeDeps([])
  const rows = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: i === 7 ? `turn ${i} ${'x'.repeat(3000)}` : `turn ${i}` }))
  const calls: Array<{ model: string; prompt: string }> = []
  const prefs = { ...DEFAULT_PREFS, chat: 'recent' as const, model: 'haiku' }
  const deps = {
    ...f.deps,
    prefs: async () => prefs,
    messages: async () => rows,
    complete: async (model: string, prompt: string) => {
      calls.push({ model, prompt })
      return { isAnswered: true as const, text: JSON.stringify({ prompt: 'Enhanced page', notes: [], questions: [] }) }
    },
  }
  const outcome = await enhance(deps, 'make a page', prefs)
  expect(outcome.kind === 'filled' && outcome.via).toBe('complete:haiku')
  expect(calls.length).toBe(1)
  expect(calls[0].model).toBe('haiku')
  expect(calls[0].prompt).toContain('Recent conversation:')
  expect(calls[0].prompt).toContain('turn 2')
  expect(calls[0].prompt).not.toContain('turn 0')
  expect(calls[0].prompt).not.toContain('x'.repeat(1501))
  expect(f.forks.length).toBe(0)
})

test('chat: full mode forks the session, and calls complete() only on nothing-to-fork', async () => {
  const f = fakeDeps([JSON.stringify({ prompt: 'Forked page', notes: [], questions: [] })])
  const forked = await enhance(f.deps, 'make a page', { ...DEFAULT_PREFS, chat: 'full' })
  expect(f.forks.length).toBe(1)
  expect(forked.kind === 'filled' && forked.via).toBe('fork')

  const g = fakeDeps([])
  const calls: string[] = []
  const deps = {
    ...g.deps,
    fork: async () => ({ isAnswered: false as const, reason: 'nothing-to-fork' }),
    complete: async (model: string) => {
      calls.push(model)
      return { isAnswered: true as const, text: JSON.stringify({ prompt: 'Plain page', notes: [], questions: [] }) }
    },
  }
  const plain = await enhance(deps, 'make a page', { ...DEFAULT_PREFS, chat: 'full' })
  expect(calls).toEqual(['haiku'])
  expect(plain.kind === 'filled' && plain.via).toBe('complete:haiku')
})

test('enhancer: with no picker open, a vague draft fails calmly and the box is not touched', async () => {
  const f = fakeDeps([JSON.stringify({ prompt: '', notes: [], questions: [{ question: 'What for?', options: ['A', 'B'] }] })])
  f.deps.askUser = async () => {
    throw new Error('no tool named AskUserQuestion in this session')
  }
  const outcome = await enhance(f.deps, 'make a page', { ...DEFAULT_PREFS, chat: 'full' })
  expect(outcome).toEqual({ kind: 'failed', reason: 'it needs answers, and no picker is open in this session' })
  expect(f.fills).toEqual([])
})

test('enhancer: an explicit draft is enhanced even when the box is empty (auto-enhance path)', async () => {
  const f = fakeDeps([JSON.stringify({ prompt: 'Build a bakery page', notes: [], questions: [] })])
  f.box.text = ''
  const line = await runEnhance(f.deps, 'make a bakery page')
  expect(line).toBe('Enhanced. Check the box, then Send.')
  expect(f.fills).toEqual(['Build a bakery page'])
})

// 8. the gate: factual deny text, a system-section rule, and an escape after GATE_LIMIT denials
test('gate: the deny text is a fact, not an order, and the rule sits in the system section', () => {
  expect(GATE_MESSAGE).toContain('mcp__session-panel__plan_steps')
  expect(GATE_MESSAGE).not.toMatch(/before any other tool/i)
  expect(PLAN_SECTION).toContain('mcp__session-panel__plan_steps')
  expect(GATE_LIMIT).toBe(3)
})

test('gate: after three denials in a row with no plan, tools go through', async ($, on) => {
  world(on)
  await begin($)
  for (let i = 0; i < GATE_LIMIT; i++) {
    const denied = await $.tool.call({ tool: 'Read', file_path: 'a.md' })
    expect((denied as any).deny).toBe(GATE_MESSAGE)
  }
  const escaped = await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect((escaped as any).deny).toBeUndefined()
})

// 9. assumptions: the parser, the turn reducers, edit detection, the stored file, and the Stop, Confirm and Wrong actions
import {
  ASSUME_SECTION,
  addDeclared,
  addEdits,
  editTargets,
  finishTurn,
  idTag,
  loadTrack,
  newTrack,
  openCount,
  panelOrder,
  parseAssumptions,
  parseStored,
  redirectText,
  resolveStorePath,
  responseText,
  setStatus,
  shellTargets,
  startTurn,
  storedJson,
  STORE_IGNORE,
} from './logic'

test('assumptions: ASSUMPTION lines are read in order; code fences and other text are ignored', () => {
  const reply = 'Working on it.\nASSUMPTION: The page is for a bakery.\n```\nASSUMPTION: not this one\n```\n  ASSUMPTION: Prices are in pounds.\nASSUMPTION:   \nNot an assumption.'
  expect(parseAssumptions(reply)).toEqual(['The page is for a bakery.', 'Prices are in pounds.'])
  expect(parseAssumptions('Assumption: wrong case')).toEqual([])
  expect(parseAssumptions('ASSUMPTION: ' + 'x'.repeat(300))[0].length).toBe(200)
})

test('assumptions: declared lines go to the top, newest first, with status open and a time', () => {
  let t = startTurn(newTrack(), 't1')
  t = addDeclared(t, ['first', 'second'], 500)
  expect(t.entries.map(e => e.text)).toEqual(['second', 'first'])
  expect(t.entries.every(e => e.turn === 1 && e.kind === 'declared' && e.status === 'open' && e.at === 500)).toBe(true)
  expect(t.turnDeclared).toBe(true)
  t = startTurn(t, 't2')
  t = addDeclared(t, ['third'], 600)
  expect(t.entries[0]).toMatchObject({ text: 'third', turn: 2 })
})

test('dedupe: the same assumption twice in one turn is listed once; the next turn may repeat it', () => {
  let t = startTurn(newTrack(), 't1')
  t = addDeclared(t, ['Keep the header'], 1)
  t = addDeclared(t, ['Keep the header', 'Keep the header'], 2)
  expect(t.entries.length).toBe(1)
  t = startTurn(t, 't2')
  t = addDeclared(t, ['Keep the header'], 3)
  expect(t.entries.map(e => e.turn)).toEqual([2, 1])
})

test('flagged edits: a turn that edits and declares nothing gets one entry per file, newest first', () => {
  let t = startTurn(newTrack(), 't1')
  t = addEdits(t, ['a.md', 'b.ts', 'a.md'])
  expect(t.turnEdits).toEqual(['a.md', 'b.ts'])
  const done = finishTurn(t, true, 9)
  expect(done.entries.map(e => e.text)).toEqual(['edited b.ts with no stated assumption', 'edited a.md with no stated assumption'])
  expect(done.entries.every(e => e.kind === 'flagged' && e.status === 'open' && e.at === 9)).toBe(true)
  expect(done.entries[0].path).toBe('b.ts')
  expect(done.runningTurnId).toBe('')
})

test('flagged edits: a declared assumption in the same turn stops the flag, and flagging off adds nothing', () => {
  let t = startTurn(newTrack(), 't1')
  t = addEdits(addDeclared(t, ['Keep the old header'], 1), ['a.md'])
  expect(finishTurn(t, true, 2).entries.filter(e => e.kind === 'flagged')).toEqual([])
  const u = addEdits(startTurn(newTrack(), 't2'), ['c.md'])
  expect(finishTurn(u, false, 2).entries).toEqual([])
})

test('the list keeps the newest 50 entries', () => {
  let t = startTurn(newTrack(), 't1')
  t = addDeclared(t, Array.from({ length: 60 }, (_, i) => `a${i}`), 1)
  expect(t.entries.length).toBe(50)
  expect(t.entries[0].text).toBe('a59')
})

test('edit targets: writing tools name their file; reading and no-file commands name none', () => {
  expect(editTargets('Edit', { file_path: 'src/a.ts' })).toEqual(['src/a.ts'])
  expect(editTargets('Write', { file_path: 'notes.md' })).toEqual(['notes.md'])
  expect(editTargets('NotebookEdit', { notebook_path: 'x.ipynb' })).toEqual(['x.ipynb'])
  expect(editTargets('Read', { file_path: 'a.md' })).toEqual([])
  expect(shellTargets('echo hi > out.txt')).toEqual(['out.txt'])
  expect(shellTargets('echo hi >> "docs/log.md"')).toEqual(['docs/log.md'])
  expect(shellTargets('Set-Content -Path "src/a.ts" -Value x')).toEqual(['src/a.ts'])
  expect(shellTargets("sed -i 's/a/b/' file.md")).toEqual(['file.md'])
  expect(shellTargets('cp a.txt b.txt')).toEqual(['b.txt'])
  expect(shellTargets('cat a.txt && ls')).toEqual([])
  expect(shellTargets('npm test > /dev/null 2>&1')).toEqual([])
  expect(editTargets('Bash', { command: 'echo x > y.md' })).toEqual(['y.md'])
})

test('wrong: a declared entry and a flagged edit each get their own opening, and nothing is submitted', () => {
  expect(redirectText({ kind: 'declared', text: 'Use Tailwind' })).toBe("Assumption 'Use Tailwind' is wrong. Instead: ")
  expect(redirectText({ kind: 'flagged', text: 'edited a.md with no stated assumption', path: 'a.md' })).toBe('About the edit to a.md: ')
})

test('guard: a row with no content, a null block or a string body yields no text and does not throw', () => {
  expect(responseText(undefined)).toBe('')
  expect(responseText(null)).toBe('')
  expect(responseText('ASSUMPTION: plain string')).toBe('')
  expect(responseText([null, { type: 'tool_use' }, { type: 'text', text: 'ASSUMPTION: kept' }])).toBe('ASSUMPTION: kept')
  expect(parseAssumptions(responseText([null, { type: 'text', text: 'ASSUMPTION: kept' }]))).toEqual(['kept'])
})

test('prompt: the rule says the line must start with plain ASSUMPTION:, with no bold, bullet or heading', () => {
  expect(ASSUME_SECTION).toContain('start of the line')
  expect(ASSUME_SECTION).toContain('no bold')
})

test('file: the stored shape is version 1 with the session, the entries and the status fields', () => {
  const entries = finishTurn(addEdits(startTurn(newTrack(), 't1'), ['notes.md']), true, 42).entries
  const json = JSON.parse(storedJson('abc123', 'abc123', entries))
  expect(json.version).toBe(1)
  expect(json.sessionId).toBe('abc123')
  expect(json.member).toBe('abc123')
  expect(json.entries[0]).toEqual({ id: 1, text: 'edited notes.md with no stated assumption', turn: 1, kind: 'flagged', path: 'notes.md', status: 'open', at: 42 })
  expect(STORE_IGNORE).toBe('*\n')
})

test('file: the path is the project folder, the session id, and a tagged name only when the plain one is someone else', () => {
  expect(resolveStorePath('C:/proj', 'abc123', undefined)).toEqual({ file: 'C:/proj/.claude/session-panel/assumptions/abc123.json', foreign: false })
  const mine = storedJson('abc123', 'abc123', [])
  expect(resolveStorePath('C:/proj', 'abc123', mine).foreign).toBe(false)
  const theirs = storedJson('other9', 'other9', [])
  const r = resolveStorePath('C:/proj', 'abc123', theirs)
  expect(r.foreign).toBe(true)
  expect(r.file).toBe(`C:/proj/.claude/session-panel/assumptions/abc123-${idTag('abc123')}.json`)
  expect(resolveStorePath('C:/proj', 'abc123', '{not json').foreign).toBe(true)
  expect(idTag('abc123')).toBe(idTag('abc123'))
  expect(idTag('abc123')).not.toBe(idTag('abc124'))
})

test('reload: a stored list reads back with its statuses, and the counters move past it', () => {
  const stored = storedJson('abc123', 'abc123', [
    { id: 7, text: 'Keep the header', turn: 3, kind: 'declared', status: 'confirmed', at: 1, resolvedAt: 2 },
    { id: 9, text: 'edited a.md with no stated assumption', turn: 4, kind: 'flagged', path: 'a.md', status: 'open', at: 3 },
  ])
  const parsed = parseStored(stored)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  const t = loadTrack(newTrack(), parsed.entries)
  expect(t.entries.map(e => e.status)).toEqual(['confirmed', 'open'])
  expect(t.seq).toBe(9)
  expect(t.turnNo).toBe(4)
  expect(openCount(t)).toBe(1)
  expect(panelOrder(t.entries).map(e => e.id)).toEqual([9, 7])
})

test('reload: a file this code cannot read is reported, not used', () => {
  expect(parseStored('{"version":2,"entries":[]}').ok).toBe(false)
  expect(parseStored('not json').ok).toBe(false)
  expect(parseStored(undefined)).toEqual({ ok: true, entries: [] })
})

test('confirm and wrong: a resolved entry does not change again; the count and the order follow the status', () => {
  let t = startTurn(newTrack(), 't1')
  t = addDeclared(t, ['one', 'two', 'three'], 1)
  t = setStatus(t, 2, 'confirmed', 5)
  expect(t.entries.find(e => e.id === 2)).toMatchObject({ status: 'confirmed', resolvedAt: 5 })
  t = setStatus(t, 2, 'wrong', 6)
  expect(t.entries.find(e => e.id === 2)?.status).toBe('confirmed')
  t = setStatus(t, 3, 'wrong', 7)
  expect(openCount(t)).toBe(1)
  expect(panelOrder(t.entries).map(e => e.id)).toEqual([1, 3, 2])
})

test('stop: the Stop button aborts the running turn by its id and says Stopped', async ($, on) => {
  world(on)
  const aborts: string[] = []
  on('ui.toast', () => ({ value: undefined }))
  on('turn.abort', (_$: any, e: any) => {
    aborts.push(e.turnId)
    return { value: undefined }
  })
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'stop' })).toBeDefined()
  await ui.press({ key: 'stop' })
  expect(aborts).toEqual(['t1'])
  await ui.unmount()
})

test('stop: the button is gone once the turn has completed', async ($, on) => {
  world(on)
  await begin($)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  await ui.unmount()
})

// The engine's file and session calls, as the test kit answers them. `files` is what the disk holds, by path.
function storeWorld(on: any, opts: { root?: string; id?: string; files?: Record<string, string> } = {}) {
  const writes: Array<{ path: string; text: string }> = []
  const fill: string[] = []
  const reached: string[] = []
  on('session.root', () => ({ value: opts.root ?? 'C:/proj' }))
  on('session.id', () => ({ value: opts.id ?? 'abc123' }))
  // the kit reports paths in native form; the plugin uses forward slashes, so compare in that form
  const slash = (q: string) => q.replace(/\\/g, '/')
  on('fs.read', (_$: any, e: any) => ({ value: opts.files?.[slash(e.path)] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_$: any, e: any) => {
    writes.push({ path: slash(e.path), text: e.text })
    return { value: undefined }
  })
  on('prompt.fill', (_$: any, e: any) => {
    fill.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_$: any, e: any) => {
    reached.push(e.text)
    return { text: e.text }
  })
  return { writes, fill, reached, last: () => JSON.parse(writes.filter(w => w.path.endsWith('.json')).at(-1)!.text) }
}

const FILE = 'C:/proj/.claude/session-panel/assumptions/abc123.json'

// A flagged edit: plan, one Edit to notes.md, then the turn ends with no assumption.
async function flaggedEdit($: any) {
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Edit the notes'] })
  await $.tool.call({ tool: 'Edit', file_path: 'notes.md', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

test('file: a flagged edit writes this session file with the right path and shape, and the folder ignore file', async ($, on) => {
  world(on)
  const w = storeWorld(on)
  await flaggedEdit($)
  expect(w.writes.some(x => x.path === 'C:/proj/.claude/session-panel/.gitignore' && x.text === '*\n')).toBe(true)
  const saved = w.last()
  expect(w.writes.at(-1)!.path).toBe(FILE)
  expect(saved).toMatchObject({ version: 1, sessionId: 'abc123', member: 'abc123' })
  expect(saved.entries).toEqual([
    expect.objectContaining({ kind: 'flagged', path: 'notes.md', status: 'open', text: 'edited notes.md with no stated assumption' }),
  ])
})

test("file: a session never writes another session's file; its own goes to a tagged name", async ($, on) => {
  world(on)
  const theirs = storedJson('other9', 'other9', [])
  const w = storeWorld(on, { files: { [FILE]: theirs } })
  await flaggedEdit($)
  expect(w.writes.length).toBeGreaterThan(0)
  expect(w.writes.some(x => x.path.endsWith('/other9.json'))).toBe(false)
  expect(w.writes.every(x => x.path !== FILE)).toBe(true)
  expect(w.writes.at(-1)!.path).toBe(`C:/proj/.claude/session-panel/assumptions/abc123-${idTag('abc123')}.json`)
})

test('confirm: the entry becomes confirmed, the file is rewritten, and the count drops', async ($, on) => {
  world(on)
  const w = storeWorld(on)
  await flaggedEdit($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'assumptions-toggle' }))?.props.label).toBe('▸ Assumptions (1 open)')
  await ui.press({ key: 'assumptions-toggle' })
  await ui.press({ key: 'confirm-1' })
  expect(w.last().entries[0]).toMatchObject({ status: 'confirmed' })
  expect(typeof w.last().entries[0].resolvedAt).toBe('number')
  expect((await ui.find({ key: 'assumptions-toggle' }))?.props.label).toBe('▾ Assumptions (0 open)')
  expect(w.fill).toEqual([])
  await ui.unmount()
})

test('wrong: the entry becomes wrong, the file is rewritten, and the box gets the edit prefix', async ($, on) => {
  world(on)
  const w = storeWorld(on)
  await flaggedEdit($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'assumptions-toggle' })
  await ui.press({ key: 'wrong-1' })
  expect(w.last().entries[0]).toMatchObject({ status: 'wrong' })
  expect(w.fill).toEqual(['About the edit to notes.md: '])
  await ui.unmount()
})

// 10. messages from the team head: SESSION-PANEL: confirm <id> and SESSION-PANEL: wrong <id>
import { applyIncoming, parseIncoming } from './logic'

test('incoming: only the exact form is read; anything else is an ordinary prompt', () => {
  expect(parseIncoming('SESSION-PANEL: confirm 3')).toEqual({ verb: 'confirm', id: 3 })
  expect(parseIncoming('  SESSION-PANEL: wrong 12  ')).toEqual({ verb: 'wrong', id: 12 })
  expect(parseIncoming('SESSION-PANEL: confirm x')).toBeNull()
  expect(parseIncoming('SESSION-PANEL: confirm 3 please')).toBeNull()
  expect(parseIncoming('confirm 3')).toBeNull()
  expect(parseIncoming('SESSION-PANEL: delete 3')).toBeNull()
})

test('incoming: a known open entry is set; an unknown id or a resolved entry changes nothing and says why', () => {
  let t = startTurn(newTrack(), 't1')
  t = addEdits(t, ['a.md'])
  t = finishTurn(t, true, 1)
  const id = t.entries[0].id
  const done = applyIncoming(t, { verb: 'confirm', id }, 5)
  expect(done.changed).toBe(true)
  expect(done.track.entries[0]).toMatchObject({ status: 'confirmed', resolvedAt: 5 })
  expect(done.note).toBe(`Assumption ${id} marked confirmed.`)
  const again = applyIncoming(done.track, { verb: 'wrong', id }, 6)
  expect(again.changed).toBe(false)
  expect(again.note).toBe(`Assumption ${id} is already confirmed.`)
  const unknown = applyIncoming(t, { verb: 'wrong', id: 999 }, 7)
  expect(unknown.changed).toBe(false)
  expect(unknown.note).toBe('No assumption 999 in this session.')
})

test('incoming: a confirm line from the head sets the entry, rewrites the file, and starts no model turn', async ($, on) => {
  world(on)
  const w = storeWorld(on)
  await flaggedEdit($)
  const result: any = await $.prompt.submit({ text: 'SESSION-PANEL: confirm 1', asUser: true })
  expect(result.drop).toBe('Assumption 1 marked confirmed.')
  expect(w.reached).toEqual([])
  expect(w.last().entries[0]).toMatchObject({ status: 'confirmed' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'assumptions-toggle' }))?.props.label).toBe('▸ Assumptions (0 open)')
  await ui.unmount()
})

test('incoming: an unknown id is dropped with a note and the file is not touched', async ($, on) => {
  world(on)
  const w = storeWorld(on)
  await flaggedEdit($)
  const before = w.writes.length
  const result: any = await $.prompt.submit({ text: 'SESSION-PANEL: wrong 99', asUser: true })
  expect(result.drop).toBe('No assumption 99 in this session.')
  expect(w.writes.length).toBe(before)
})

// 11. status lines inside cross-session envelopes: the wrapped form, the sender check, mixed text, and a head's wrong (0.3.3)
import { applyStatuses, headsFor, sortPrompt } from './logic'

const wrap = (from: string, body: string) =>
  `Another Claude session sent a message:\n<cross-session-message from="uds:x" from-name="${from}" from-mode="bypass">\n${body}\n</cross-session-message>`

const ROSTER = JSON.stringify([
  { name: 'Mod CEO', team: 'Mods', boss: 'user', sessionId: '06e389e1' },
  { name: 'Mod Builder', team: 'Mods', boss: 'Mod CEO', sessionId: 'abc123' },
  { name: 'Mod Builder 2', team: 'Mods', boss: 'Mod CEO', sessionId: 'def456' },
])
const ROSTER_PATH = 'C:/proj/.claude/team-orchestrator/roster.json'

test('envelope: a status line alone inside a cross-session message is read with its sender', () => {
  expect(sortPrompt(wrap('Mod CEO', 'SESSION-PANEL: confirm 1'))).toEqual({
    statuses: [{ line: 'SESSION-PANEL: confirm 1', sender: 'Mod CEO' }],
    other: '',
  })
})

test('envelope: other text beside the status line is kept as other text', () => {
  const parts = sortPrompt(wrap('Mod CEO', 'SESSION-PANEL: confirm 1\nPlease also check the header.'))
  expect(parts.statuses.map(s => s.sender)).toEqual(['Mod CEO'])
  expect(parts.other).toBe('Please also check the header.')
})

test('envelope: a plain typed line is the user, and the preamble is not text', () => {
  expect(sortPrompt('SESSION-PANEL: wrong 2')).toEqual({ statuses: [{ line: 'SESSION-PANEL: wrong 2', sender: 'user' }], other: '' })
  expect(sortPrompt('Another Claude session sent a message:\nhello there').other).toBe('hello there')
})

test('head: the roster gives a member its boss and the team top; an unknown session or a bad roster gives none', () => {
  expect(headsFor(ROSTER, 'abc123')).toEqual(new Set(['Mod CEO']))
  expect(headsFor(ROSTER, '06e389e1')).toEqual(new Set(['user', 'Mod CEO']))
  expect(headsFor(ROSTER, 'nobody')).toBeUndefined()
  expect(headsFor('not json', 'abc123')).toBeUndefined()
})

test('apply: a refused line changes nothing and its refusal is the note; an allowed one applies', () => {
  let t = startTurn(newTrack(), 't1')
  t = addEdits(t, ['a.md'])
  t = finishTurn(t, true, 1)
  const id = t.entries[0].id
  const r = applyStatuses(t, [{ verb: 'confirm', id, allowed: false, refusal: "Refused: x is not this session's team head." }], 2)
  expect(r.changed).toBe(false)
  expect(r.notes).toEqual(["Refused: x is not this session's team head."])
  expect(r.track.entries[0].status).toBe('open')
  const ok = applyStatuses(t, [{ verb: 'confirm', id, allowed: true, refusal: '' }], 3)
  expect(ok.track.entries[0].status).toBe('confirmed')
})

test('head: a wrapped line from the team head sets the entry and starts no model turn', async ($, on) => {
  world(on)
  const w = storeWorld(on, { files: { [ROSTER_PATH]: ROSTER } })
  await flaggedEdit($)
  const result: any = await $.prompt.submit({ text: wrap('Mod CEO', 'SESSION-PANEL: confirm 1'), asUser: true })
  expect(result.drop).toBe('Assumption 1 marked confirmed.')
  expect(w.reached).toEqual([])
  expect(w.last().entries[0].status).toBe('confirmed')
})

test("head: a wrong from the team head sets the entry and fills the box with the Redirect text, without submitting", async ($, on) => {
  world(on)
  const w = storeWorld(on, { files: { [ROSTER_PATH]: ROSTER } })
  await flaggedEdit($)
  const result: any = await $.prompt.submit({ text: wrap('Mod CEO', 'SESSION-PANEL: wrong 1'), asUser: true })
  expect(result.drop).toBe('Assumption 1 marked wrong.')
  expect(w.last().entries[0].status).toBe('wrong')
  expect(w.fill).toEqual(['About the edit to notes.md: '])
  expect(w.reached).toEqual([])
})

test('head: a line from a session that is not the head is refused, with a note, and the entry stays open', async ($, on) => {
  world(on)
  const w = storeWorld(on, { files: { [ROSTER_PATH]: ROSTER } })
  await flaggedEdit($)
  const writes = w.writes.length
  const result: any = await $.prompt.submit({ text: wrap('Mod Builder 2', 'SESSION-PANEL: confirm 1'), asUser: true })
  expect(result.drop).toBe("Refused: Mod Builder 2 is not this session's team head.")
  expect(w.writes.length).toBe(writes)
  expect(w.reached).toEqual([])
})

test('head: with no readable roster, the line is refused with the reason', async ($, on) => {
  world(on)
  const w = storeWorld(on)
  await flaggedEdit($)
  const result: any = await $.prompt.submit({ text: wrap('Mod CEO', 'SESSION-PANEL: confirm 1'), asUser: true })
  expect(result.drop).toBe('Refused: the team roster cannot be read, so Mod CEO cannot be checked.')
  expect(w.last().entries[0].status).toBe('open')
})

test('mixed: the status is applied and the message goes on to the model, because other text is in it', async ($, on) => {
  world(on)
  const w = storeWorld(on, { files: { [ROSTER_PATH]: ROSTER } })
  await flaggedEdit($)
  const text = wrap('Mod CEO', 'SESSION-PANEL: confirm 1\nPlease also check the header.')
  const result: any = await $.prompt.submit({ text, asUser: true })
  expect(result.drop).toBeUndefined()
  expect(w.last().entries[0].status).toBe('confirmed')
  expect(w.reached).toEqual([text])
})
