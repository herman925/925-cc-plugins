import { expect, test } from 'claude-code/testing'

import { workerNote } from './housekeeping'
import { countFromPs, scratchDeleteAllowed } from './platform'
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
