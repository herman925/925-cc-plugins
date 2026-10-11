// #89: the roster shows each member's open assumptions, read from its Session Panel's file. Read only: Confirm and Wrong
// go to the member as one team message, and its own Session Panel changes its own file.
import { expect, test } from 'claude-code/testing'

import { collectOpen, confirmLine, openFrom, wrongLine } from './assumptions'
import { adopt, HUALONG, ID1, ID2, ID3, mountBand, world } from './test-world'

const DIR = 'C:/proj/.claude/session-panel/assumptions'
const file = (sessionId: string, entries: unknown[], version = 1) => JSON.stringify({ version, member: 'x', sessionId, entries })
const entry = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, text: `text of ${id}`, turn: 3, kind: 'declared', at: 1, status, ...extra })
const withIds = (rows: typeof HUALONG) =>
  rows.map(r => ({ ...r, handle: '', sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : r.name === 'Hualong Worker 5' ? ID3 : '' }))
// the session this test runs in: the team top is Hualong CEO (ID1), its boss-of-a-worker is Hualong Workers (ID2)
const sessionAs = (on: any, sid: string) => on('session.id', async () => ({ value: sid }) as any)

test('a file reads as its session id and only its open entries, with their text, kind and turn', () => {
  const f = openFrom(file(ID2, [entry('a1', 'open'), entry('a2', 'confirmed'), entry('a3', 'wrong'), entry('a4', 'open', { kind: 'flagged', path: 'src/a.ts', turn: 7 })]))
  expect(f?.sessionId).toBe(ID2)
  expect(f?.entries).toEqual([
    { id: 'a1', text: 'text of a1', kind: 'declared', turn: 3 },
    { id: 'a4', text: 'text of a4', kind: 'flagged', turn: 7 },
  ])
})

test('a file that cannot be read as an assumptions file is ignored', () => {
  expect(openFrom('not json')).toBeUndefined()
  expect(openFrom('[]')).toBeUndefined()
  expect(openFrom(JSON.stringify({ version: 1, entries: [] }))).toBeUndefined()
  expect(openFrom(JSON.stringify({ version: 1, sessionId: ID2, entries: 'x' }))).toBeUndefined()
  // an entry without an id or a text is skipped; the rest of the file still counts
  expect(openFrom(file(ID2, [{ status: 'open', text: 'no id' }, entry('a1', 'open')]))?.entries.map(e => e.id)).toEqual(['a1'])
})

test('two files of one session (plain name and tagged name) make one list, each entry once', () => {
  const got = collectOpen([file(ID2, [entry('a1', 'open'), entry('a2', 'open')]), 'not json', file(ID2, [entry('a2', 'open'), entry('a3', 'open')])])
  expect(got[ID2]?.map(e => e.id)).toEqual(['a1', 'a2', 'a3'])
})

test('the two one-line messages are exact', () => {
  expect(confirmLine('a1')).toBe('SESSION-PANEL: confirm a1')
  expect(wrongLine('a1')).toBe('SESSION-PANEL: wrong a1')
})

test('the row says "N open" for a member, found by its session id; confirmed and wrong entries do not count', async ($, on) => {
  const files = world(on)
  files.set(`${DIR}/tagged-9f2c.json`, file(ID2, [entry('a1', 'open'), entry('a2', 'open'), entry('a3', 'confirmed')]))
  files.set(`${DIR}/broken.json`, 'not json')
  files.set(`${DIR}/${ID1}.json`, file(ID1, [entry('c1', 'wrong')]))
  await adopt($, withIds(HUALONG))
  const band = await mountBand($)
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('2 open')
  expect(drawn).not.toContain('3 open')
  expect(await band.find({ key: 'assume-Hualong|Hualong Workers' })).toBeDefined()
  expect(await band.find({ key: 'assume-Hualong|Hualong CEO' })).toBeUndefined()
})

test('the open list shows each open entry; Confirm and Wrong send one line to the member and write no file', async ($, on) => {
  const files = world(on)
  const sends: any[] = []
  on('session.send', async (_$: any, e: any) => (sends.push(e), { isDelivered: true }) as any)
  files.set(`${DIR}/${ID2}.json`, file(ID2, [entry('a1', 'open', { text: 'the API takes a path', kind: 'flagged', turn: 7 }), entry('a2', 'confirmed')]))
  const before = files.get(`${DIR}/${ID2}.json`)
  sessionAs(on, ID1) // the team top answers
  await adopt($, withIds(HUALONG))
  const band = await mountBand($)
  await band.press({ key: 'assume-Hualong|Hualong Workers' })
  const open = JSON.stringify(await band.drawn())
  expect(open).toContain('the API takes a path')
  expect(open).toContain('flagged')
  expect(open).toContain('turn 7')
  expect(open).not.toContain('text of a2')
  await band.press({ key: 'assume-yes-a1' })
  await band.press({ key: 'assume-no-a1' })
  const lines = sends.filter(s => String(s.text).startsWith('SESSION-PANEL')).map(s => s.text)
  expect(lines).toEqual(['SESSION-PANEL: confirm a1', 'SESSION-PANEL: wrong a1'])
  expect(sends.find(s => String(s.text).startsWith('SESSION-PANEL')).to).toBe(ID2)
  expect(files.get(`${DIR}/${ID2}.json`)).toBe(before)
  expect([...files.keys()].filter(k => k.includes('session-panel'))).toEqual([`${DIR}/${ID2}.json`])
})

test('a session that is neither the member\'s boss nor the team top sees the count and the list, but no Confirm or Wrong', async ($, on) => {
  const files = world(on)
  files.set(`${DIR}/${ID2}.json`, file(ID2, [entry('a1', 'open', { text: 'the API takes a path' })]))
  sessionAs(on, ID3) // Hualong Worker 5 reports to Hualong Workers, so it is neither
  await adopt($, withIds(HUALONG))
  const band = await mountBand($)
  expect(JSON.stringify(await band.drawn())).toContain('1 open')
  await band.press({ key: 'assume-Hualong|Hualong Workers' })
  expect(JSON.stringify(await band.drawn())).toContain('the API takes a path')
  expect(await band.find({ key: 'assume-yes-a1' })).toBeUndefined()
  expect(await band.find({ key: 'assume-no-a1' })).toBeUndefined()
})

test('the boss of the member sees Confirm and Wrong, and the answer goes to the member', async ($, on) => {
  const files = world(on)
  const sends: any[] = []
  on('session.send', async (_$: any, e: any) => (sends.push(e), { isDelivered: true }) as any)
  files.set(`${DIR}/${ID3}.json`, file(ID3, [entry('w1', 'open', { text: 'the worker reads the file first' })]))
  sessionAs(on, ID2) // Hualong Workers is the boss of Hualong Worker 5
  await adopt($, withIds(HUALONG))
  const band = await mountBand($)
  await band.press({ key: 'assume-Hualong|Hualong Worker 5' })
  await band.press({ key: 'assume-yes-w1' })
  const lines = sends.filter(s => String(s.text).startsWith('SESSION-PANEL')).map(s => s.text)
  expect(lines).toEqual(['SESSION-PANEL: confirm w1'])
  expect(sends.find(s => String(s.text).startsWith('SESSION-PANEL')).to).toBe(ID3)
})

test('the files are read on a roster refresh, not on a redraw', async ($, on) => {
  const files = world(on)
  files.set(`${DIR}/${ID2}.json`, file(ID2, [entry('a1', 'open')]))
  await adopt($, withIds(HUALONG))
  files.set(`${DIR}/${ID2}.json`, file(ID2, [entry('a1', 'open'), entry('a2', 'open')]))
  const band = await mountBand($)
  expect(JSON.stringify(await band.drawn())).toContain('1 open')
  await band.press({ key: 'refresh' })
  expect(JSON.stringify(await band.drawn())).toContain('2 open')
})
