import { expect, test } from 'claude-code/testing'

import { livenessOf, parseWinProcs, psProc, winProcScript } from './platform'
import { pointer } from './roles'

const ID = '0638214f-11d8-4d45-be96-9d56f54f30ba'

test('the start-up pointer is safe for cmd.exe and for sh or zsh', () => {
  const m: any = { team: 'T', name: 'W1', role: 'r', level: 2, boss: 'Head' }
  const p = pointer({ ...m, team: 'T!x', role: 'r' }, [m, { ...m, name: 'Head', boss: 'user$HOME`x`\\y!!' }])
  expect(/["%$`\\!\r\n]/.test(p)).toBe(false)
})

test('the crash check still looks up known process ids only and proves liveness conservatively', () => {
  expect(winProcScript([101])).toContain("Get-CimInstance Win32_Process -Filter 'ProcessId=101'")
  expect(winProcScript([101, 7])).toContain("-Filter 'ProcessId=101 OR ProcessId=7'")
  const got = parseWinProcs(`NONE|101\r\nRUN|7|"C:/bin/claude.exe" --resume ${ID}\r\nDONE\r\n`, [101, 7])
  expect(got?.get(101)).toEqual({ running: false, args: '' })
  expect(got?.get(7)).toEqual({ running: true, args: `"C:/bin/claude.exe" --resume ${ID}` })
  expect(parseWinProcs('NONE|101', [101])).toBeUndefined()
  expect(parseWinProcs('DONE', [101])).toBeUndefined()
  expect(psProc({ exitCode: 0, stdout: `claude --resume ${ID}\n` })).toEqual({ running: true, args: `claude --resume ${ID}` })
  expect(psProc({ exitCode: 1, stdout: '' })).toEqual({ running: false, args: '' })
  expect(psProc({ exitCode: 2, stdout: '' })).toBeUndefined()
  expect(psProc(undefined)).toBeUndefined()
  const run = (args: string) => ({ running: true, args })
  const gone = { running: false, args: '' }
  expect(livenessOf(ID, [], new Map())).toEqual({ kind: 'dead' })
  expect(livenessOf(ID, [5], new Map([[5, gone]]))).toEqual({ kind: 'dead' })
  expect(livenessOf(ID, [5], new Map([[5, run('C:/Windows/notepad.exe')]]))).toEqual({ kind: 'dead' })
  expect(livenessOf(ID, [5], new Map([[5, run(`claude --resume ${ID.toUpperCase()}`)]]))).toEqual({ kind: 'alive', pid: 5 })
  expect(livenessOf(ID, [5], new Map([[5, run('"C:/Users/me/.local/bin/claude.exe"')]]))).toEqual({ kind: 'alive', pid: 5 })
  expect(livenessOf(ID, [5], new Map([[5, run('')]])).kind).toBe('unsure')
  expect(livenessOf(ID, [5, 6], new Map([[5, gone]])).kind).toBe('unsure')
  expect(livenessOf(ID, [5, 6], new Map([[5, run('')], [6, run(`claude --session-id ${ID}`)]]))).toEqual({ kind: 'alive', pid: 6 })
})
