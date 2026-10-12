// A running member the roster still calls "not yet" heals on the top's refresh (0.5.33): with proof that its session
// runs (its own fresh status file under the roster's session id, or this PC's registry and process list) the stale
// pending flag is cleared (the member counts as briefed, as its lost start said) and a missing session id taken; without
// proof nothing changes, and no other field is touched.

import { expect, test } from 'claude-code/testing'

import { adopt, HUALONG, ID1, ID2, ID3, mountBand, rawSaved, STATUS, TEAM, world } from './test-world'

const ROSTER = `${TEAM}/roster.json`
const ID4 = '44444444-4444-4444-8444-444444444444'
const ID5 = '55555555-5555-4555-8555-555555555555'
const ID6 = '66666666-6666-4666-8666-666666666666'
const MIN = 60_000
const row = (files: Map<string, string>, name: string) => rawSaved(files).find((x: any) => x.name === name)
const status = (files: Map<string, string>, name: string, sessionId: string, ago: number) =>
  files.set(`${STATUS}/${name.replace(/ /g, '_')}.json`, JSON.stringify({ name, sessionId, state: 'idle', heartbeat: Date.now() - ago, ctx: 28, model: 'claude-haiku-5-5' }))

test('the top\'s refresh clears a stale "not yet" only on proof that the member\'s session runs', async ($, on) => {
  // this session (the CEO, the team top) at pid 100; the Console Boss's session at pid 101, still running
  const files = world(on, [], [], (e: any) => {
    const a: string[] = e.argv
    if (a[0] === 'powershell.exe' && String(a[3] ?? '').includes('Win32_Process -Filter')) {
      const ids = [...String(a[3]).matchAll(/ProcessId=(\d+)/g)].map(m => Number(m[1]))
      return [...ids.map(i => (i === 101 ? `RUN|101|claude --session-id ${ID3} --name "Hualong PC Console Boss"` : `NONE|${i}`)), 'DONE'].join('\r\n')
    }
    return undefined
  }, { env: { ORCA_TERMINAL_HANDLE: 'term_c' }, registry: [{ sessionId: ID1 }, { sessionId: ID3 }] })
  on('session.id', async () => ({ value: ID1 }) as any)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await adopt($, HUALONG.map(r => ({ ...r, handle: r.name === 'Hualong CEO' ? 'term_c' : '', sessionId: r.name === 'Hualong CEO' ? ID1 : '' })))
  // their starts never reached the roster: every worker still "not yet"
  const stale: Record<string, object> = {
    'Hualong Workers': { sessionId: ID2, handle: 'term_w', short: 'W' },
    'Hualong Worker 5': { sessionId: '' },
    'Hualong PC Console Boss': { sessionId: ID3 },
    'Hualong PC Worker A': { sessionId: ID4 },
    'Hualong PC Worker B': { sessionId: ID5 },
  }
  files.set(ROSTER, JSON.stringify(rawSaved(files).map((x: any) => (stale[x.name] ? { ...x, ...stale[x.name], pending: true, briefed: false } : x))))
  status(files, 'Hualong Workers', ID2, 20_000) // fresh, same session id: proof
  status(files, 'Hualong Worker 5', ID6, 4_000) // fresh, and the roster has no id: proof, and its id is taken
  status(files, 'Hualong PC Worker A', ID4, 10 * MIN) // silent for 10 minutes, and no process holds its id: no proof
  status(files, 'Hualong PC Worker B', ID2, 4_000) // fresh, but another session id than the roster's: no proof
  const band = await mountBand($, 300)
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
  // healed as its lost start would have written it (pending off, briefed); its other fields stay
  expect(row(files, 'Hualong Workers')).toMatchObject({ pending: false, briefed: true, sessionId: ID2, handle: 'term_w', short: 'W' })
  expect(row(files, 'Hualong Worker 5')).toMatchObject({ pending: false, sessionId: ID6 })
  // no status file at all, but this PC's registry and its process show the session running
  expect(row(files, 'Hualong PC Console Boss')).toMatchObject({ pending: false, sessionId: ID3 })
  expect(row(files, 'Hualong PC Worker A')).toMatchObject({ pending: true, briefed: false, sessionId: ID4 })
  expect(row(files, 'Hualong PC Worker B')).toMatchObject({ pending: true, briefed: false, sessionId: ID5 })
})
