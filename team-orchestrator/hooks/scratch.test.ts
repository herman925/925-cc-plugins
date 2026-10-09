// 0.5.11: scratch auto-approve cannot be steered into real files (#60), and a synced Orca command that fails on this
// platform corrects itself (#70).
import { expect, test } from 'claude-code/testing'

import { linkFree, type ListEntry, scratchDeletePlan, WALK_CAP } from './platform'
import { adopt, HUALONG, ID1, ID2, ID3, world } from './test-world'

const TEMP = 'C:/Users/me/AppData/Local/Temp'
const OWN = `${TEMP}/claude/proj/${ID3}/scratchpad`
const worker = { cwd: 'C:/proj', sessionId: ID3, head: false, temps: [TEMP, '', '', '/tmp'], projectScratch: 'C:/proj/.claude/scratch' }
const head = { ...worker, sessionId: ID2, head: true }

// ── the words ──

test('only plain literal paths: no wildcard, no trailing slash, no "." or ".."', () => {
  expect(scratchDeletePlan(`rm -rf ${OWN}/out`, worker)).toEqual({ targets: [{ root: `${TEMP}/claude`, path: `${OWN}/out` }], recursive: true })
  for (const bad of [`${OWN}/*`, `${OWN}/link/*.ts`, `${OWN}/a?c`, `${OWN}/[ab]`, `${OWN}/x]`, `${OWN}/link/`, `${OWN}\\link\\`, `${OWN}/.`, `${OWN}/link/../x`]) {
    expect(scratchDeletePlan(`rm -rf "${bad}"`, worker)).toBeUndefined()
    expect(scratchDeletePlan(`Remove-Item -Recurse -LiteralPath '${bad}'`, worker)).toBeUndefined()
  }
  // one bad target spoils the command
  expect(scratchDeletePlan(`rm ${OWN}/a ${OWN}/*`, worker)).toBeUndefined()
})

test('a recursive delete is told apart in every shell, and the case of the path is kept for the disk', () => {
  for (const c of [`rm -r ${OWN}/x`, `rm -rf ${OWN}/x`, `rm -R ${OWN}/x`, `rm --recursive ${OWN}/x`, `Remove-Item -Recurse ${OWN}/x`, `ri -r ${OWN}/x`, `rd /s /q ${OWN}/x`, `rmdir /S ${OWN}/x`, `del /s ${OWN}/x`])
    expect(scratchDeletePlan(c, worker)?.recursive).toBe(true)
  for (const c of [`rm ${OWN}/x`, `rm -f ${OWN}/x`, `rmdir ${OWN}/x`, `del /q ${OWN}/x`])
    expect(scratchDeletePlan(c, worker)?.recursive).toBe(false)
  expect(scratchDeletePlan('rm C:\\Users\\Me\\AppData\\Local\\Temp\\Build\\Out.txt', head)?.targets).toEqual([{ root: 'C:/Users/Me/AppData/Local/Temp', path: 'C:/Users/Me/AppData/Local/Temp/Build/Out.txt' }])
  expect(scratchDeletePlan('rm -rf .claude/scratch/tmp', head)?.targets).toEqual([{ root: 'C:/proj/.claude/scratch', path: 'C:/proj/.claude/scratch/tmp' }])
})

// ── the disk ──

const d = (name: string): ListEntry => ({ name, kind: 'dir', isLink: false })
const f = (name: string): ListEntry => ({ name, kind: 'file', isLink: false })
const link = (name: string): ListEntry => ({ name, kind: 'other', isLink: true })
const fs = (tree: Record<string, ListEntry[]>) => async (p: string) => {
  const got = tree[p]
  if (!got) throw new Error(`ENOENT ${p}`)
  return got
}
const SAFE = {
  [`${TEMP}/claude`]: [d('proj')],
  [`${TEMP}/claude/proj`]: [d(ID3)],
  [`${TEMP}/claude/proj/${ID3}`]: [d('scratchpad')],
  [OWN]: [d('out'), f('notes.md')],
  [`${OWN}/out`]: [f('a.csv'), d('deep')],
  [`${OWN}/out/deep`]: [f('b.csv')],
}

test('linkFree: a plain path is approved, recursive or not', async () => {
  expect(await linkFree(scratchDeletePlan(`rm -rf ${OWN}/out`, worker)!, fs(SAFE))).toBe(true)
  expect(await linkFree(scratchDeletePlan(`rm ${OWN}/notes.md`, worker)!, fs(SAFE))).toBe(true)
})

test('linkFree: a link anywhere from the allowed root down to the target, or the target itself, asks', async () => {
  // the session folder is a junction into the project
  expect(await linkFree(scratchDeletePlan(`rm -rf ${OWN}/out`, worker)!, fs({ ...SAFE, [`${TEMP}/claude/proj/${ID3}`]: [link('scratchpad')] }))).toBe(false)
  // the target is a link
  expect(await linkFree(scratchDeletePlan(`rm -rf ${OWN}/out`, worker)!, fs({ ...SAFE, [OWN]: [link('out')] }))).toBe(false)
  // a symbolic link that reports a kind but isLink
  expect(await linkFree(scratchDeletePlan(`rm ${OWN}/out`, worker)!, fs({ ...SAFE, [OWN]: [{ name: 'out', kind: 'dir', isLink: true }] }))).toBe(false)
})

test('linkFree: a recursive delete also asks when anything inside the target is a link', async () => {
  const inner = { ...SAFE, [`${OWN}/out/deep`]: [f('b.csv'), link('project')] }
  expect(await linkFree(scratchDeletePlan(`rm -rf ${OWN}/out`, worker)!, fs(inner))).toBe(false)
  expect(await linkFree(scratchDeletePlan(`Remove-Item -Recurse -Force ${OWN}/out`, worker)!, fs(inner))).toBe(false)
  expect(await linkFree(scratchDeletePlan(`rd /s /q ${OWN}/out`, worker)!, fs(inner))).toBe(false)
})

test('linkFree: a path it cannot list or find, or a folder over the cap, asks', async () => {
  expect(await linkFree(scratchDeletePlan(`rm -rf ${OWN}/gone`, worker)!, fs(SAFE))).toBe(false)
  expect(await linkFree(scratchDeletePlan(`rm -rf ${OWN}/out`, worker)!, fs({ [`${TEMP}/claude`]: [d('proj')] }))).toBe(false)
  const big = { ...SAFE, [`${OWN}/out`]: Array.from({ length: WALK_CAP + 1 }, (_, i) => f(`f${i}`)) }
  expect(await linkFree(scratchDeletePlan(`rm -rf ${OWN}/out`, worker)!, fs(big))).toBe(false)
  const atCap = { ...SAFE, [`${OWN}/out`]: Array.from({ length: WALK_CAP }, (_, i) => f(`f${i}`)) }
  expect(await linkFree(scratchDeletePlan(`rm -rf ${OWN}/out`, worker)!, fs(atCap))).toBe(true)
})

// ── in the engine: tool.check lifts the engine's ask only when the words and the disk both allow it ──

const ids = (rows: typeof HUALONG) =>
  rows.map(r => ({ ...r, handle: '', sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : r.name === 'Hualong Worker 5' ? ID3 : '' }))
const setup = async ($: any, on: any, dirs: Record<string, ListEntry[]>) => {
  world(on, [], [], undefined, { env: { TEMP }, dirs: dirs as any })
  on('session.id', async () => ({ value: ID3 }) as any)
  on('session.cwd', async () => ({ value: 'C:/proj' }) as any)
  for (const tool of ['Bash', 'PowerShell']) on('tool.check', { tool } as any, async () => ({ decision: 'ask', reason: 'engine asks' }) as any)
  await adopt($, ids(HUALONG))
}
const check = ($: any, tool: string, command: string) => $.tool.check({ tool, input: { command } } as any)

test('a worker\'s plain scratch delete is approved; through a link, with a wildcard or a trailing slash it asks', async ($, on) => {
  await setup($, on, { ...SAFE, [`${OWN}/out/deep`]: [f('b.csv'), link('project')], [OWN]: [d('out'), f('notes.md'), link('proj-link')] })
  expect((await check($, 'Bash', `rm ${OWN}/notes.md`)).decision).toBe('allow')
  // the engine's own ask comes back unchanged
  for (const c of [`rm -rf ${OWN}/out`, `rm -rf ${OWN}/proj-link`, `rm -rf ${OWN}/*`, `rm -rf ${OWN}/out/`, `rm ${OWN}/proj-link/x.ts`]) {
    const r: any = await check($, 'Bash', c)
    expect(r.decision).toBe('ask')
    expect(r.reason).toBe('engine asks')
  }
  expect((await check($, 'PowerShell', `Remove-Item -Recurse -Force -LiteralPath '${OWN}/out'`)).decision).toBe('ask')
})

test('without links the recursive delete is approved as before', async ($, on) => {
  await setup($, on, SAFE)
  expect((await check($, 'Bash', `rm -rf ${OWN}/out`)).decision).toBe('allow')
  expect((await check($, 'PowerShell', `Remove-Item -Recurse -Force -LiteralPath '${OWN}/out'`)).decision).toBe('allow')
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
