import { expect, test } from 'claude-code/testing'

import { adopt, HUALONG, ID1, ID2, ID3, TEAM, world } from './test-world'

const TEMP = 'C:/Users/me/AppData/Local/Temp'
const OWN = `${TEMP}/claude/proj/${ID3}/scratchpad`
const ids = (rows: typeof HUALONG) => rows.map(r => ({ ...r, handle: '', sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : r.name === 'Hualong Worker 5' ? ID3 : '' }))
const setup = async ($: any, on: any) => {
  const files = world(on, [], [], undefined, { env: { TEMP }, dirs: { [OWN]: [{ name: 'link-to-retained-file.txt', kind: 'other', isLink: true }] } })
  on('session.id', async () => ({ value: ID3 }) as any)
  for (const tool of ['Bash', 'PowerShell']) on('tool.check', { tool } as any, async (_$: any, e: any) =>
    String(e.input?.command ?? '').includes('denied-marker') ? ({ decision: 'deny', reason: 'policy deny' }) as any : ({ decision: 'ask', reason: 'engine asks' }) as any)
  await adopt($, ids(HUALONG))
  files.set(`${TEAM}/settings.json`, JSON.stringify({ autoScratch: true, scratchDir: '.claude/scratch' }))
  return files
}
const check = ($: any, tool: string, command: string) => $.tool.check({ tool, input: { command } } as any)

test('cleanup deletes preserve normal permission decisions for every path, even when AutoScratch is on', async ($, on) => {
  await setup($, on)
  const commands = [
    `rm ${OWN}/notes.tmp`,
    `rm ${OWN}/final_answer.md`,
    `rm ${OWN}/submission.zip`,
    `rm ${OWN}/benchmark.csv`,
    `rm ${OWN}/link-to-retained-file.txt`,
    'rm C:/Users/me/AppData/Local/Temp/shared/cache.tmp',
    'rm .claude/scratch/output.tmp',
    `rm -rf ${OWN}/nested`,
    `Remove-Item -Recurse -Force -LiteralPath '${OWN}/nested'`,
  ]
  for (const command of commands) {
    const result: any = await check($, command.startsWith('Remove-Item') ? 'PowerShell' : 'Bash', command)
    expect(result.decision).toBe('ask')
    expect(result.reason).toBe('engine asks')
  }
  const denied: any = await check($, 'Bash', `rm ${OWN}/denied-marker.tmp`)
  expect(denied).toEqual({ decision: 'deny', reason: 'policy deny' })
})

// ── #70: the Orca command corrects itself ──

const orcaWorld = (on: any, works: string[]) => {
  const sets: any[] = []
  const toasts: string[] = []
  world(on, [], [], e => (works.includes(e.argv[0]) && e.argv[1] === '--version' ? '1.4.0' : undefined))
  on('config.set', async (_$: any, e: any) => (sets.push(e), { value: e.value }) as any)
  on('ui.toast', async (_$: any, e: any) => (toasts.push(String(e.text)), { value: undefined }) as any)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }) as any)
  for (const ev of ['command.register', 'tool.register', 'ui.close', 'ui.open', 'clock.every']) on(ev, async () => ({ value: undefined }) as any)
  return { sets, toasts }
}
// the test runtime has timers; the hooks environment's types do not declare them
declare const setTimeout: (fn: () => void, ms: number) => unknown
// orcaSetup runs unawaited from session.start: wait for what it does
const started = async ($: any, until: () => boolean) => {
  await $.session.start({ cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as any)
  for (let i = 0; i < 200 && !until(); i++) await new Promise<void>(r => setTimeout(() => r(), 5))
}

test('a synced orca that does not run on Windows is switched to orca.exe, with a toast', { options: { orcaCommand: 'orca' } } as any, async ($: any, on: any) => {
  const w = orcaWorld(on, ['orca.exe'])
  await started($, () => w.toasts.some(t => t.includes('switched')))
  expect(w.sets.some(s => s.key === 'team-orchestrator.orcaCommand' && s.value === 'orca.exe')).toBe(true)
  expect(w.toasts.find(t => t.includes('switched'))).toContain('"Orca command" was orca, which does not run here; switched it to orca.exe')
})

test('a saved command that fails while the default fails too is only reported', { options: { orcaCommand: 'C:/old/orca.exe' } } as any, async ($: any, on: any) => {
  const w = orcaWorld(on, [])
  await started($, () => w.toasts.some(t => t.includes('Fix "Orca command"')))
  expect(w.toasts.some(t => t.includes('Fix "Orca command" in /config'))).toBe(true)
  expect(w.sets.filter(s => s.key === 'team-orchestrator.orcaCommand')).toEqual([])
})

test('a saved command that works is left alone', { options: { orcaCommand: 'C:/tools/orca.exe' } } as any, async ($: any, on: any) => {
  const w = orcaWorld(on, ['C:/tools/orca.exe', 'orca.exe'])
  await started($, () => false)
  expect(w.sets.filter(s => s.key === 'team-orchestrator.orcaCommand')).toEqual([])
  expect(w.toasts.some(t => /orca/i.test(t) && /switched|Fix/.test(t))).toBe(false)
})
