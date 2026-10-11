// 0.5.11: the team files are changed only by the team top and the mod (#58), and a helper (a subagent or a workflow
// agent, whose calls carry agentId) is judged by its spawner's grants as they stand right now (#73).
import { expect, test } from 'claude-code/testing'

import type { Member } from '../types'
import { grantChanges, grantMap, isTeamFilePath, judgeTeamFiles, namesTeamFile, notReadOnly, recordAfterWrite } from './guard'
import { adopt, HUALONG, ID1, ID2, ID3, mountBand, saved, shown, world } from './test-world'

const ROSTER = 'C:/proj/.claude/team-orchestrator/roster.json'
const SETTINGS = 'C:/proj/.claude/team-orchestrator/settings.json'

// ── the rules alone ──

const m = (name: string, boss: string): Member => ({
  team: 'T', name, role: 'r', level: 1, boss, handle: '', sessionId: '', state: 'idle', ctx: -1, model: '', effort: '', sel: false, note: '', briefed: false, noted: false,
})

test('a team file is roster.json or settings.json in a team-orchestrator folder, however it is spelt', () => {
  for (const p of [
    ROSTER,
    SETTINGS,
    'C:\\proj\\.claude\\team-orchestrator\\roster.json',
    'c:/PROJ/.Claude/Team-Orchestrator/Settings.JSON',
    'C:/proj/.claude/team-orchestrator/status/../roster.json',
    'C:/proj/.claude/team-orchestrator/./settings.json',
    'C:/proj/.claude/team-orchestrator//roster.json',
    'C:/proj/.claude/team-orchestrator/roster.json.',
    'C:/proj/.claude/team-orchestrator/roster.json::$DATA',
    'C:/proj/CLAUDE~1/TEAM-O~1/ROSTER~1.JSO',
    '/home/lin/proj/.claude/team-orchestrator/settings.json',
  ])
    expect(isTeamFilePath(p)).toBe(true)
  for (const p of [
    'C:/proj/.claude/team-orchestrator/status/W1.json',
    'C:/proj/.claude/team-orchestrator/roles/W1.md',
    'C:/proj/.claude/team-orchestrator/queue.json',
    'C:/proj/.claude/settings.json',
    'C:/proj/.claude/team-orchestrator/roster.json/../status/a.json',
    'C:/proj/src/roster.json',
    '',
  ])
    expect(isTeamFilePath(p)).toBe(false)
})

test('a command names a team file by its name, or by the team folder with a wildcard or variable', () => {
  expect(namesTeamFile('echo [] > .claude/team-orchestrator/roster.json')).toBe(true)
  expect(namesTeamFile('Set-Content -Path .claude\\team-orchestrator\\settings.json -Value x')).toBe(true)
  expect(namesTeamFile('sed -i s/a/b/ roster.json')).toBe(true)
  expect(namesTeamFile('echo {} > settings.json')).toBe(true)
  expect(namesTeamFile('rm .claude/team-orchestrator/*.json')).toBe(true)
  expect(namesTeamFile('cp x $D/team-orchestrator/a')).toBe(true)
  // not a team file: another settings.json, a status file, unrelated work
  expect(namesTeamFile('cat ~/.claude/settings.json')).toBe(false)
  expect(namesTeamFile('jq . .claude/settings.json')).toBe(false)
  expect(namesTeamFile('rm .claude/team-orchestrator/status/W1.json')).toBe(false)
  expect(namesTeamFile('npm test')).toBe(false)
})

test('a command that only mentions the words, or the folder with a wildcard in another word, names no team file', () => {
  expect(namesTeamFile('echo roster')).toBe(false)
  expect(namesTeamFile('git -C C:/proj/repo log --oneline')).toBe(false)
  expect(namesTeamFile('cd C:/proj && claude plugin test team-orchestrator')).toBe(false)
  expect(namesTeamFile("claude plugin test team-orchestrator 2>&1 | grep -E 'fail|[0-9]+ *pass'")).toBe(false)
  expect(namesTeamFile('gh issue comment 85 --body "the roster in team-orchestrator is *fine*"')).toBe(false)
  expect(judgeTeamFiles({ me: m('W1', 'Head'), confirmed: true, tool: 'Bash', path: '', command: "claude plugin test team-orchestrator 2>&1 | grep -E 'fail|[0-9]+ *pass'" })).toBeUndefined()
})

test('real edits to the team files stay blocked: Write, Edit, Set-Content, a redirect, rm of the changes folder', () => {
  const w1 = m('W1', 'Head')
  const deny = (tool: string, path: string, command: string) => judgeTeamFiles({ me: w1, confirmed: true, tool, path, command })?.kind
  expect(deny('Write', ROSTER, '')).toBe('deny')
  expect(deny('Edit', ROSTER, '')).toBe('deny')
  expect(deny('PowerShell', '', 'Set-Content .claude/team-orchestrator/settings.json x')).toBe('deny')
  expect(deny('Bash', '', 'echo x > .claude/team-orchestrator/roster.json')).toBe('deny')
  expect(deny('Bash', '', 'rm -r .claude/team-orchestrator/changes')).toBe('deny')
})

test('a command that changes into the team folder is a team-file command, whatever its wildcards and separators', () => {
  const w1 = m('W1', 'Head')
  for (const cd of ['cd', 'chdir', 'pushd', 'sl', 'Set-Location']) {
    expect(namesTeamFile(`${cd} .claude/team-orchestrator && rm *.json`)).toBe(true)
    expect(namesTeamFile(`${cd} .claude/team-orchestrator; Remove-Item *`)).toBe(true)
  }
  expect(judgeTeamFiles({ me: w1, confirmed: true, tool: 'Bash', path: '', command: 'cd .claude/team-orchestrator && rm *.json' })?.kind).toBe('deny')
  expect(judgeTeamFiles({ me: w1, confirmed: true, tool: 'PowerShell', path: '', command: 'Set-Location .claude/team-orchestrator; Remove-Item *' })?.kind).toBe('deny')
  // a change into another folder, then a command in that folder, names no team file
  expect(namesTeamFile('cd C:/proj && claude plugin test team-orchestrator')).toBe(false)
})

test('plainly read-only means cat, type, Get-Content, ls, dir, grep, Select-String or jq without -i', () => {
  for (const c of [
    'cat .claude/team-orchestrator/roster.json',
    'type .claude\\team-orchestrator\\roster.json',
    'Get-Content .claude/team-orchestrator/settings.json -Raw',
    'ls -la .claude/team-orchestrator',
    'dir .claude\\team-orchestrator',
    'grep -n allowWrite .claude/team-orchestrator/roster.json',
    'Select-String -Path .claude/team-orchestrator/roster.json -Pattern allow',
    "jq '.[] | .name' .claude/team-orchestrator/roster.json",
    'cat .claude/team-orchestrator/roster.json | grep allow',
    'cat .claude/team-orchestrator/roster.json 2>/dev/null',
    'Get-Content .claude/team-orchestrator/roster.json 2>$null',
  ])
    expect(notReadOnly(c)).toBe('')
  for (const c of [
    'echo [] > .claude/team-orchestrator/roster.json',
    'cat x >> .claude/team-orchestrator/roster.json',
    'sed -i s/false/true/ .claude/team-orchestrator/roster.json',
    'jq -i .x .claude/team-orchestrator/roster.json',
    'jq --in-place .x .claude/team-orchestrator/roster.json',
    'cat .claude/team-orchestrator/roster.json; rm x',
    'cat .claude/team-orchestrator/roster.json && cp a .claude/team-orchestrator/roster.json',
    'Get-Content .claude/team-orchestrator/roster.json | Set-Content x',
    'cat $(echo .claude/team-orchestrator/roster.json)',
    'python -c "open(\'.claude/team-orchestrator/roster.json\',\'w\')"',
    'cat "unbalanced .claude/team-orchestrator/roster.json',
  ])
    expect(notReadOnly(c)).not.toBe('')
  expect(notReadOnly('sed -i s/a/b/ roster.json')).toContain('"sed"')
})

test('judgeTeamFiles: every member but the team top is refused; a held session is refused even as the top', () => {
  const top = m('Head', 'user')
  const w1 = m('W1', 'Head')
  for (const tool of ['Write', 'Edit', 'NotebookEdit']) {
    const v = judgeTeamFiles({ me: w1, confirmed: true, tool, path: ROSTER, command: '' })
    expect(v?.kind).toBe('deny')
    expect((v as any).reason).toContain(`Blocked ${tool}`)
    expect(judgeTeamFiles({ me: w1, confirmed: true, tool, path: 'C:/proj/src/a.ts', command: '' })).toBeUndefined()
    expect(judgeTeamFiles({ me: top, confirmed: true, tool, path: ROSTER, command: '' })).toBeUndefined()
    expect(judgeTeamFiles({ me: top, confirmed: false, tool, path: ROSTER, command: '' })?.kind).toBe('deny')
  }
  const bash = judgeTeamFiles({ me: w1, confirmed: true, tool: 'Bash', path: '', command: 'echo [] > .claude/team-orchestrator/roster.json' })
  expect(bash?.kind).toBe('deny')
  expect((bash as any).reason).toContain('redirects')
  expect(judgeTeamFiles({ me: w1, confirmed: true, tool: 'PowerShell', path: '', command: 'Set-Content .claude/team-orchestrator/settings.json x' })?.kind).toBe('deny')
  expect(judgeTeamFiles({ me: w1, confirmed: true, tool: 'Bash', path: '', command: 'cat .claude/team-orchestrator/roster.json' })).toBeUndefined()
  expect(judgeTeamFiles({ me: top, confirmed: true, tool: 'Bash', path: '', command: 'echo [] > .claude/team-orchestrator/roster.json' })).toBeUndefined()
  // other tools are not this rule's
  expect(judgeTeamFiles({ me: w1, confirmed: true, tool: 'Read', path: ROSTER, command: '' })).toBeUndefined()
})

test('the grant record: a change the mod writes is recorded; one pulled in from the file and written back is not', () => {
  const rows = (w5: boolean) => [{ team: 'T', name: 'Head', allowWrite: true }, { team: 'T', name: 'W5', allowWrite: w5 }]
  const first = recordAfterWrite(undefined, {}, grantMap(rows(false)))
  expect(first).toEqual({ 'T|Head': { agent: false, write: true }, 'T|W5': { agent: false, write: false } })
  // somebody set W5's switch in the file; the mod pulled it and wrote the roster again for another reason
  const tampered = grantMap(rows(true))
  const kept = recordAfterWrite(first, tampered, tampered)
  expect(kept['T|W5']).toEqual({ agent: false, write: false })
  expect(grantChanges(kept, tampered)).toEqual([{ key: 'T|W5', name: 'W5', changes: ['Allow writes on'] }])
  // the person flips it in Settings (the mod's own write changes it): recorded, nothing to report
  const flipped = recordAfterWrite(kept, grantMap(rows(false)), grantMap(rows(true)))
  expect(grantChanges(flipped, grantMap(rows(true)))).toEqual([])
  // a member the record does not know is not reported
  expect(grantChanges({}, tampered)).toEqual([])
})

// ── in the engine ──

const ids = (rows: typeof HUALONG) =>
  rows.map(r => ({ ...r, handle: '', sessionId: r.name === 'Hualong CEO' ? ID1 : r.name === 'Hualong Workers' ? ID2 : r.name === 'Hualong Worker 5' ? ID3 : '' }))
const engine = (on: any, toasts: string[], sid: string) => {
  on('session.id', async () => ({ value: sid }) as any)
  on('ui.toast', async (_$: any, e: any) => (toasts.push(String(e.text)), { value: undefined }) as any)
  for (const tool of ['Agent', 'Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell']) on('tool.call', { tool } as any, async () => ({ result: 'done' }) as any)
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text }) as any)
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }) as any)
}
const ok = (r: any) => r.deny === undefined
const write = ($: any, path: string, agentId?: string) => $.tool.call({ tool: 'Write', file_path: path, content: '[]', ...(agentId ? { agentId } : {}) } as any)
const shell = ($: any, tool: string, command: string, agentId?: string) => $.tool.call({ tool, command, ...(agentId ? { agentId } : {}) } as any)

test('a worker may not change roster.json or settings.json by Write, Edit, Bash or PowerShell, but may read them', async ($, on) => {
  const toasts: string[] = []
  const files = world(on)
  engine(on, toasts, ID3) // Hualong Worker 5: nobody reports to it, so it may write elsewhere
  await adopt($, ids(HUALONG))
  const before = files.get(ROSTER)
  for (const path of [ROSTER, SETTINGS]) {
    const r: any = await write($, path)
    expect(ok(r)).toBe(false)
    expect(r.deny).toContain('Blocked Write: Hualong Worker 5 may not change the team file')
  }
  expect(ok(await $.tool.call({ tool: 'Edit', file_path: ROSTER, old_string: 'false', new_string: 'true' } as any))).toBe(false)
  expect(ok(await $.tool.call({ tool: 'NotebookEdit', notebook_path: SETTINGS, new_source: 'x' } as any))).toBe(false)
  const b: any = await shell($, 'Bash', `sed -i 's/"allowWrite": false/"allowWrite": true/' .claude/team-orchestrator/roster.json`)
  expect(b.deny).toContain('Blocked Bash: this command names a team file')
  expect(b.deny).toContain('"sed"')
  expect(ok(await shell($, 'PowerShell', 'Set-Content .claude\\team-orchestrator\\settings.json "{}"'))).toBe(false)
  expect(ok(await shell($, 'Bash', 'cat .claude/team-orchestrator/roster.json && echo x > .claude/team-orchestrator/roster.json'))).toBe(false)
  // reading stays open, and so do its other files and its own work
  expect(ok(await shell($, 'Bash', 'cat .claude/team-orchestrator/roster.json'))).toBe(true)
  expect(ok(await shell($, 'PowerShell', 'Get-Content .claude/team-orchestrator/settings.json'))).toBe(true)
  expect(ok(await shell($, 'Bash', 'npm test > out.txt'))).toBe(true)
  expect(ok(await write($, 'C:/proj/.claude/team-orchestrator/roles/hualong-worker-5.md'))).toBe(true)
  expect(ok(await write($, 'C:/proj/src/app.ts'))).toBe(true)
  expect(toasts).toContain('blocked Write: Hualong Worker 5 on a team file')
  expect(files.get(ROSTER)).toBe(before)
})

test('#allow-write and Allow writes do not open the team files to a member', async ($, on) => {
  const toasts: string[] = []
  const files = world(on)
  engine(on, toasts, ID2) // Hualong Workers, a lead
  await adopt($, ids(HUALONG))
  files.set(ROSTER, JSON.stringify(saved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, allowWrite: true } : x))))
  await $.prompt.submit({ text: '#allow-write', origin: { kind: 'composer' }, wait: false } as any)
  expect(ok(await write($, 'C:/proj/src/app.ts'))).toBe(true)
  expect(ok(await write($, ROSTER))).toBe(false)
  expect(ok(await shell($, 'Bash', 'echo [] > .claude/team-orchestrator/roster.json'))).toBe(false)
})

test('the team top and a session not on the roster may change the team files', async ($, on) => {
  const toasts: string[] = []
  world(on)
  engine(on, toasts, ID1) // the CEO, boss "user"
  await adopt($, ids(HUALONG))
  // the top is a boss, so its Write still needs Allow writes; the shell is open to it
  expect(ok(await shell($, 'Bash', 'echo [] > .claude/team-orchestrator/roster.json'))).toBe(true)
  await $.prompt.submit({ text: '#allow-write', origin: { kind: 'composer' }, wait: false } as any)
  expect(ok(await write($, ROSTER))).toBe(true)
})

test('a session that is not on the roster is not judged on the team files', async ($, on) => {
  const toasts: string[] = []
  world(on)
  engine(on, toasts, 'ffffffff-ffff-4fff-8fff-ffffffffffff')
  await adopt($, ids(HUALONG))
  expect(ok(await write($, ROSTER))).toBe(true)
  expect(ok(await shell($, 'Bash', 'echo [] > .claude/team-orchestrator/roster.json'))).toBe(true)
  expect(toasts).toEqual([])
})

test('a member\'s rights changed in roster.json outside the mod are reported to the team top, not reverted', async ($, on) => {
  const toasts: string[] = []
  const files = world(on)
  engine(on, toasts, ID1) // the CEO is the team top: its refresh checks
  await adopt($, ids(HUALONG))
  const band = await mountBand($)
  await band.press({ key: 'refresh' })
  expect(toasts.some(t => t.includes('changed outside the mod'))).toBe(false)
  files.set(ROSTER, JSON.stringify(saved(files).map((x: any) => (x.name === 'Hualong Worker 5' ? { ...x, allowWrite: true, allowAgent: true } : x))))
  // seen once: it may be another session's write caught half way; seen again: reported
  await band.press({ key: 'refresh' })
  expect(toasts.some(t => t.includes('changed outside the mod'))).toBe(false)
  await band.press({ key: 'refresh' })
  const told = toasts.filter(t => t.includes('roster.json changed outside the mod'))
  expect(told.length).toBe(1)
  expect(told[0]).toContain('Hualong Worker 5: Allow writes on, Allow subagents on')
  expect(told[0]).toContain('Nothing was reverted')
  // the note names the file and the rights, on the member's row
  expect(await shown($, 300)).toContain('roster.json changed outside the mod: Allow writes on, Allow subagents on')
  // nothing reverted, and it is said once
  expect(saved(files).find((x: any) => x.name === 'Hualong Worker 5').allowWrite).toBe(true)
  await band.press({ key: 'refresh' })
  expect(toasts.filter(t => t.includes('changed outside the mod')).length).toBe(1)
})

test('a change the person makes through Settings is the mod\'s own and is not reported', async ($, on) => {
  const toasts: string[] = []
  world(on)
  engine(on, toasts, ID1)
  await adopt($, ids(HUALONG))
  const band = await mountBand($)
  await band.press({ key: 'refresh' })
  await band.press({ key: 'settings' })
  await band.press({ key: 'perm-write-Hualong|Hualong Worker 5' })
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
  await band.press({ key: 'refresh' })
  expect(toasts.some(t => t.includes('changed outside the mod'))).toBe(false)
})

// ── #73: helpers carry their spawner's grants, live ──

test('a subagent\'s Write (agentId) is judged by its spawner\'s standing Allow writes', async ($, on) => {
  const toasts: string[] = []
  const files = world(on)
  engine(on, toasts, ID2) // Hualong Workers: a lead, so writes need a grant
  await adopt($, ids(HUALONG))
  const SUB = 'a1b2c3d4e5f60718'
  const w: any = await write($, 'C:/proj/src/app.ts', SUB)
  expect(ok(w)).toBe(false)
  expect(w.deny).toContain('Blocked Write: Hualong Workers has reports')
  files.set(ROSTER, JSON.stringify(saved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, allowWrite: true } : x))))
  expect(ok(await write($, 'C:/proj/src/app.ts', SUB))).toBe(true)
  // switched off again: the helper loses it at once (nothing frozen at spawn)
  files.set(ROSTER, JSON.stringify(saved(files).map((x: any) => (x.name === 'Hualong Workers' ? { ...x, allowWrite: false } : x))))
  expect(ok(await write($, 'C:/proj/src/app.ts', SUB))).toBe(false)
  // and a helper's own Agent call is judged by Allow subagents the same way
  expect(ok(await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y', agentId: SUB } as any))).toBe(false)
})

test('a workflow agent\'s calls carry the spawner\'s one-turn grant while it lasts, and lose it when the turn ends', async ($, on) => {
  const toasts: string[] = []
  world(on)
  engine(on, toasts, ID2)
  await adopt($, ids(HUALONG))
  // a workflow agent's id is one no agent list names
  const WF = 'wf_7f3e9a/agent-2'
  expect(ok(await write($, 'C:/proj/src/app.ts', WF))).toBe(false)
  await $.prompt.submit({ text: 'run it #allow-write', origin: { kind: 'composer' }, wait: false } as any)
  expect(ok(await write($, 'C:/proj/src/app.ts', WF))).toBe(true)
  expect(ok(await write($, 'C:/proj/src/app.ts', 'a1b2c3d4e5f60718'))).toBe(true)
  // a helper finishing its own loop does not end the spawner's turn
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: WF } as any)
  expect(ok(await write($, 'C:/proj/src/app.ts', WF))).toBe(true)
  // the spawner's turn ends: the grant goes, for the helpers too
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  expect(ok(await write($, 'C:/proj/src/app.ts', WF))).toBe(false)
  expect(ok(await write($, 'C:/proj/src/app.ts', 'a1b2c3d4e5f60718'))).toBe(false)
})

test('a helper is never taken as "not on the team": a worker\'s subagent is refused Agent and the team files', async ($, on) => {
  const toasts: string[] = []
  world(on)
  engine(on, toasts, ID3) // Hualong Worker 5
  await adopt($, ids(HUALONG))
  for (const agentId of ['a1b2c3d4e5f60718', 'wf_7f3e9a/agent-2']) {
    expect(ok(await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y', agentId } as any))).toBe(false)
    expect(ok(await write($, ROSTER, agentId))).toBe(false)
    expect(ok(await shell($, 'Bash', 'echo [] > .claude/team-orchestrator/roster.json', agentId))).toBe(false)
    // and has what the worker has: its own writes
    expect(ok(await write($, 'C:/proj/src/app.ts', agentId))).toBe(true)
  }
})
