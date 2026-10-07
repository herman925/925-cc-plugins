import { expect, mock, test } from 'claude-code/testing'

import { actionLabel, barSegments, barText, stepsOf, cleanName, easeStep, friendlyError, jobPercent, meter, reportProgress, newChecklist, planSteps } from './logic'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  plugin: 'clean-view',
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

const PLAN = 'mcp__clean-view__plan_steps'
const REPORT = 'mcp__clean-view__report_progress'
const ASK = 'mcp__clean-view__ask_choices'

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
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Hide details')
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
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Show details')
    await ui.unmount()
  }
  await $.command.run({ command: 'simple', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Hide details')
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
  expect(t).toContain('⚠ Stuck: a step keeps failing, Claude is trying another way')
  expect(t).toContain('Press Esc to stop, or type a message to steer.')
  await ui.unmount()
})

// G. the button is named by its action
test('the button flips between Hide details and Show details', async ($, on) => {
  world(on)
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Hide details')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Show details')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Hide details')
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
  expect(t).toContain('✓ All done')
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
  expect(await texts(ui)).toContain('■ Stopped')
  await ui.unmount()
  await begin($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Polish the footer'] })
  await $.turn.complete({ answer: 'API Error: 429 rate limit', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui)).toContain('⚠ Stuck: you hit your usage limit, try again a little later')
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

// K. the in-band picker
test('ask_choices shows numbered choices and a press sends the answer', async ($, on) => {
  world(on)
  const sent: string[] = []
  on('prompt.submit', (_$: any, e: any) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await begin($)
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

test('hidden rows: tool rows draw nothing while Clean View is on', async ($, on) => {
  world(on)
  await begin($)
  for (const component of ['ToolUse', 'ToolResult', 'ToolGroup'] as const) {
    const props: any =
      component === 'ToolGroup'
        ? { calls: [], isActive: false, isExpanded: false }
        : { tool_use_id: 'u1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: {} }
    const ui = await $.ui.mount({ plugin: 'clean-view', surface: 'terminal', component, props })
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
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Hide details')
    // the other band sits above ours
    expect(t.indexOf('OTHER MOD BAND')).toBeLessThan(t.indexOf('Step 1 of 2'))
    await ui.unmount()
  }
})

test('with Clean View off, the other band still shows', async ($, on) => {
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
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Show details')
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
    expect((await ui.find({ key: 'style' }))?.props.label).toBe('List view')
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Hide details')
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
  expect((await ui.find({ key: 'style' }))?.props.label).toBe('Bar view')
  await ui.press({ key: 'style' })
  expect((await ui.find({ key: 'style' }))?.props.label).toBe('List view')
  await ui.press({ key: 'style' })
  expect((await ui.find({ key: 'style' }))?.props.label).toBe('Bar view')
  await ui.unmount()
  await $.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'style' }))?.props.label).toBe('List view')
  await ui.unmount()
  await $.command.run(RUN('list'))
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'style' }))?.props.label).toBe('Bar view')
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

test('with Clean View off, the bar style shows only the button', async ($, on) => {
  world(on)
  await begin($)
  await $.command.run(RUN('bars'))
  await $.command.run(RUN('off'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'style' })).toBeUndefined()
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Show details')
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
  // no wide hole between the parts of the row, and the row fits
  expect(/ {6,}/.test(row)).toBe(false)
  expect(row.length).toBeLessThanOrEqual(WIDTH)
  // the words ride inside the bar
  expect(row).toContain(' Reading a file… ')
  // and the bar is long: most of what is left after the name and pill
  const bar = [...row.matchAll(/[▓▒░]+/g)].map(m => m[0]).join('')
  expect(bar.length).toBeGreaterThanOrEqual(30)
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
  expect(t).toContain('✓ All done')
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
