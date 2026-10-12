// 0.5.32: a reopen in the top's round gives an unstarted member a new session id; the same round's transcript
// search by name (snapshot said no id) must not replace it with an older transcript of the same title.
import { expect, test } from 'claude-code/testing'

import { fileName } from './changes'
import { adopt, HUALONG, ID1, ID3, mountBand, rawSaved, TEAM, world } from './test-world'

const ROSTER = `${TEAM}/roster.json`
const row = (files: Map<string, string>, name: string) => rawSaved(files).find((x: any) => x.name === name)
const ROWS = HUALONG.map(r => ({ ...r, handle: r.name === 'Hualong CEO' ? 'term_c' : '', sessionId: r.name === 'Hualong CEO' ? ID1 : '' }))

test('a reopen\'s new session id survives the same round\'s search by name', async ($, on) => {
  let made = ''
  const files = world(on, [], [{ id: ID3, title: 'Hualong Workers' }], (e: any) => {
    const a: string[] = e.argv
    if (a[1] === 'worktree' && a[2] === 'current') return '{"result":{"worktree":{"id":"r1::C:/proj"}}}'
    if (a[1] === 'terminal' && a[2] === 'create') {
      made = String(a[a.indexOf('--command') + 1]).match(/--session-id (\S+)/)?.[1] ?? ''
      return '{"result":{"terminal":{"handle":"term_ae5"}}}'
    }
    if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
    return undefined
  }, { env: { ORCA_TERMINAL_HANDLE: 'term_c' }, registry: [{ sessionId: ID1 }] })
  on('session.id', async () => ({ value: ID1 }) as any)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await adopt($, ROWS)
  // Workers saved as not yet started (no id, no tab), with a message waiting for it
  files.set(ROSTER, JSON.stringify(rawSaved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, sessionId: '', handle: '', pending: true } : x))))
  files.set(`${TEAM}/queue/${fileName(Date.now(), 'q1')}`, JSON.stringify({ to: 'Hualong Workers', from: 'Hualong CEO', message: 'hi', created: Date.now(), state: 'pending', tries: 0 }))
  const band = await mountBand($, 300)
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
  expect(made).not.toBe('')
  expect(row(files, 'Hualong Workers')).toMatchObject({ handle: 'term_ae5', pending: false })
  expect(row(files, 'Hualong Workers').sessionId).toBe(made)
})
