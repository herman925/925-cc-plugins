import { expect, test } from 'claude-code/testing'

import { workerNote } from './housekeeping'
import { countFromPs, livenessOf, parseWinProcs, psProc, scratchDeleteAllowed, winProcScript } from './platform'
import { pointer } from './roles'

const ID = '0638214f-11d8-4d45-be96-9d56f54f30ba'
const winWorker = {
  cwd: 'C:\\proj',
  sessionId: ID,
  head: false,
  temps: ['C:\\Users\\me\\AppData\\Local\\Temp', '', '', '/tmp'],
  projectScratch: 'C:\\proj/.claude/scratch',
}
const linuxHead = { cwd: '/home/lin/proj', sessionId: ID, head: true, temps: ['', '', '/tmp', '/tmp'], projectScratch: '/home/lin/proj/.claude/scratch' }

test('a worker may delete only inside its own session folder under the Claude temp folder, without asking', () => {
  const own = `C:\\Users\\me\\AppData\\Local\\Temp\\claude\\proj\\${ID}\\scratchpad`
  expect(scratchDeleteAllowed(`rm -rf "${own}"`, winWorker)).toBe(true)
  expect(scratchDeleteAllowed(`rm -rf /c/Users/me/AppData/Local/Temp/claude/proj/${ID}/scratchpad/x.py`, winWorker)).toBe(true)
  expect(scratchDeleteAllowed(`Remove-Item -Recurse -Force -LiteralPath '${own}'`, winWorker)).toBe(true)
  // another member's folder, the temp folder at large, the project scratch folder: workers still ask
  expect(scratchDeleteAllowed('rm -rf C:/Users/me/AppData/Local/Temp/claude/proj/other-session/scratchpad', winWorker)).toBe(false)
  expect(scratchDeleteAllowed('rm C:/Users/me/AppData/Local/Temp/out.csv', winWorker)).toBe(false)
  expect(scratchDeleteAllowed('rm -rf .claude/scratch/tmp', winWorker)).toBe(false)
})

test('a head may also clean the system temp folder and the project scratch folder, never the folders themselves', () => {
  expect(scratchDeleteAllowed('rm -rf /tmp/claude-1000/build', linuxHead)).toBe(true)
  expect(scratchDeleteAllowed('rm .claude/scratch/notes.md', linuxHead)).toBe(true)
  expect(scratchDeleteAllowed('rm -rf /tmp', linuxHead)).toBe(false)
  expect(scratchDeleteAllowed('rm -rf .claude/scratch', linuxHead)).toBe(false)
  expect(scratchDeleteAllowed('rm -rf outputs/report', linuxHead)).toBe(false)
})

test('anything that is not one plain delete still asks', () => {
  expect(scratchDeleteAllowed('rm -rf /tmp/a; rm -rf ~/x', linuxHead)).toBe(false)
  expect(scratchDeleteAllowed('rm -rf /tmp/a && echo done', linuxHead)).toBe(false)
  expect(scratchDeleteAllowed('rm -rf $HOME/x', linuxHead)).toBe(false)
  expect(scratchDeleteAllowed('rm -rf /tmp/../home/lin', linuxHead)).toBe(false)
  expect(scratchDeleteAllowed('rm -rf ~/tmp', linuxHead)).toBe(false)
  expect(scratchDeleteAllowed('cat /tmp/a', linuxHead)).toBe(false)
  expect(scratchDeleteAllowed('rm -rf', linuxHead)).toBe(false)
})

test('on macOS and Linux the leftover count comes from ps: shells and runtimes under the member\'s own claude', () => {
  const ps = [
    `  100     1 claude --resume ${ID} --name W1`,
    '  101   100 /bin/zsh -c python3 run.py',
    '  102   101 python3 run.py',
    '  103   100 node /usr/lib/node_modules/@playwright/mcp/cli.js',
    '  200     1 /bin/bash',
    '  201   200 node other.js',
  ].join('\n')
  expect(countFromPs(ps, ID)).toBe(3)
  expect(countFromPs(ps, 'no-such-session')).toBe(-1)
})

test('the housekeeping note names each platform\'s own processes', () => {
  expect(workerNote(true)).toContain('conhost.exe')
  expect(workerNote(false)).toContain('zsh')
  expect(workerNote(false)).not.toContain('.exe')
})

test('the start-up pointer is safe for cmd.exe and for sh or zsh', () => {
  const m: any = { team: 'T', name: 'W1', role: 'r', level: 2, boss: 'Head' }
  const p = pointer({ ...m, team: 'T!x', role: 'r' }, [m, { ...m, name: 'Head', boss: 'user$HOME`x`\\y!!' }])
  expect(/["%$`\\!\r\n]/.test(p)).toBe(false)
})

// ── 0.5.16, #71 and #65: the send-time crash check ──

test('the crash check looks each process up by its id alone: one Get-CimInstance query on Windows, ps -p elsewhere', () => {
  expect(winProcScript([101])).toContain("Get-CimInstance Win32_Process -Filter 'ProcessId=101'")
  expect(winProcScript([101, 7])).toContain("-Filter 'ProcessId=101 OR ProcessId=7'")
  const got = parseWinProcs(`NONE|101\r\nRUN|7|"C:/bin/claude.exe" --resume ${ID}\r\nDONE\r\n`, [101, 7])
  expect(got?.get(101)).toEqual({ running: false, args: '' })
  expect(got?.get(7)).toEqual({ running: true, args: `"C:/bin/claude.exe" --resume ${ID}` })
  // an answer cut short, or one missing an id, is no answer
  expect(parseWinProcs('NONE|101', [101])).toBeUndefined()
  expect(parseWinProcs('DONE', [101])).toBeUndefined()
  expect(psProc({ exitCode: 0, stdout: `claude --resume ${ID}\n` })).toEqual({ running: true, args: `claude --resume ${ID}` })
  expect(psProc({ exitCode: 1, stdout: '' })).toEqual({ running: false, args: '' })
  expect(psProc({ exitCode: 2, stdout: '' })).toBeUndefined()
  expect(psProc(undefined)).toBeUndefined()
})

test('alive, dead or unsure: only proof of death says dead; a reused pid proves nothing either way', () => {
  const run = (args: string) => ({ running: true, args })
  const gone = { running: false, args: '' }
  // no process named for it, or only ones that are gone: dead
  expect(livenessOf(ID, [], new Map())).toEqual({ kind: 'dead' })
  expect(livenessOf(ID, [5], new Map([[5, gone]]))).toEqual({ kind: 'dead' })
  // the pid now belongs to another program: the registry entry is stale
  expect(livenessOf(ID, [5], new Map([[5, run('C:/Windows/notepad.exe')]]))).toEqual({ kind: 'dead' })
  // its command line carries the id: alive
  expect(livenessOf(ID, [5], new Map([[5, run(`claude --resume ${ID.toUpperCase()}`)]]))).toEqual({ kind: 'alive', pid: 5 })
  // a claude started without the id on its command line, still in the registry file named after its pid: alive
  expect(livenessOf(ID, [5], new Map([[5, run('"C:/Users/me/.local/bin/claude.exe"')]]))).toEqual({ kind: 'alive', pid: 5 })
  // running but unreadable, or no answer for a pid: unsure
  expect(livenessOf(ID, [5], new Map([[5, run('')]])).kind).toBe('unsure')
  expect(livenessOf(ID, [5, 6], new Map([[5, gone]])).kind).toBe('unsure')
  // a live one wins over a doubt about another
  expect(livenessOf(ID, [5, 6], new Map([[5, run('')], [6, run(`claude --session-id ${ID}`)]]))).toEqual({ kind: 'alive', pid: 6 })
})
