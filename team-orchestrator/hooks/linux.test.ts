// macOS and Linux. This machine's name comes from the system when the environment gives none (#64's multi-PC
// checks were off there), and members start with the browser-automation plugins off.
import { expect, test } from 'claude-code/testing'

import { sameMachine } from './changes'
import { adopt, HUALONG, ID1, ID2, mountBand, world } from './test-world'

const roster = (files: Map<string, string>) => [...files].find(([k]) => k.endsWith('/.claude/team-orchestrator/roster.json'))?.[1] ?? ''
const machines = (files: Map<string, string>) => [...roster(files).matchAll(/"machine": "([^"]*)"/g)].map(m => m[1])
const asked = (files: { calls: string[][] }, cmd: string) => files.calls.filter(a => a[0] === cmd).length

test('on Linux the machine is uname -n, asked once per load', async ($, on) => {
  const files = world(on, [], [], e => (e.argv[0] === 'uname' ? 'herman925.chan\n' : undefined), { env: { OS: 'Linux' } })
  await adopt($, HUALONG)
  await adopt($, HUALONG)
  expect(machines(files)).toEqual(HUALONG.map(() => 'herman925.chan'))
  expect(asked(files, 'uname')).toBe(1)
})

test('on macOS the machine is the LocalHostName, which does not follow the network', async ($, on) => {
  const files = world(on, [], [], e => (e.argv[0] === 'scutil' ? 'Hermans-Mac\n' : e.argv[0] === 'uname' ? 'dhcp-10-0-0-5.example.com\n' : undefined), { env: { OS: 'Darwin' } })
  await adopt($, HUALONG)
  expect(machines(files)).toEqual(HUALONG.map(() => 'Hermans-Mac'))
  expect(asked(files, 'uname')).toBe(0)
})

test('a machine called localhost names no machine: the roster records none', async ($, on) => {
  const files = world(on, [], [], e => (e.argv[0] === 'uname' ? 'localhost.localdomain\n' : undefined), { env: { OS: 'Linux' } })
  await adopt($, HUALONG)
  expect(machines(files)).toEqual([])
})

test('a member recorded with no machine gets this PC once its transcript shows it ran here; one without stays unknown', async ($, on) => {
  // launched while this PC gave no name: the roster records no machine (the PC's name comes later, with the fix)
  const env: Record<string, string> = { OS: 'Windows_NT' }
  let prefix = ''
  // off Windows the engine hands fs hooks the path made absolute: the roster's path shows how
  const refuse = (path: string) => {
    const at = path.indexOf('C:/proj/.claude/team-orchestrator/roster.json')
    if (at > 0) prefix = path.slice(0, at)
    return false
  }
  const files = world(on, [], [{ id: ID1 }], undefined, { env, registry: [], refuse })
  const ids: Record<string, string> = { 'Hualong CEO': ID1, 'Hualong Workers': ID2 }
  await adopt($, HUALONG.map(r => ({ ...r, handle: '', sessionId: ids[r.name] ?? '' })))
  expect(machines(files)).toEqual([])
  // only the CEO's session left a transcript on this PC
  files.set(`${prefix}C:/home/.claude/projects/proj/${ID1}.jsonl`, '')
  env.COMPUTERNAME = 'PC-A'
  const band = await mountBand($)
  await band.press({ key: 'tab-roster' })
  await band.press({ key: 'refresh' })
  const rows: any[] = JSON.parse(roster(files))
  expect(rows.find(r => r.name === 'Hualong CEO')?.machine).toBe('PC-A')
  expect(rows.filter(r => r.name !== 'Hualong CEO').map(r => r.machine ?? '')).toEqual(HUALONG.slice(1).map(() => ''))
})

test('a machine is the same by its name before any domain, in any case', () => {
  expect(sameMachine('herman925.chan', 'HERMAN925')).toBe(true)
  expect(sameMachine('Hermans-Mac', 'hermans-mac.local')).toBe(true)
  expect(sameMachine('PC-A', 'PC-B')).toBe(false)
})

test('members start with the browser-automation plugins the person enabled turned off, by a settings file of their own', async ($, on) => {
  const commands: string[] = []
  let n = 0
  const on1 = { 'chrome-devtools-mcp@claude-plugins-official': true, 'playwright@claude-plugins-official': true, 'ponytail@ponytail': true }
  const settings: Record<string, string> = {
    'C:/home/.claude/settings.json': JSON.stringify({ enabledPlugins: on1 }),
    'C:/proj/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'playwright@claude-plugins-official': false } }),
  }
  const box: { files?: Map<string, string> } = {}
  // the settings files go in where the roster is written: off Windows the engine hands fs hooks the path made absolute
  const refuse = (path: string) => {
    const at = path.indexOf('C:/proj/.claude/team-orchestrator/roster.json')
    if (at >= 0) for (const [k, v] of Object.entries(settings)) box.files?.set(`${path.slice(0, at)}${k}`, v)
    return false
  }
  const files = world(on, [], [], e => {
    const a = JSON.stringify(e)
    if (a.includes('"current"')) return '{"result":{"worktree":{"id":"wt1"}}}'
    if (a.includes('"create"')) return (commands.push(a), `{"result":{"terminal":{"handle":"term_${++n}"}}}`)
    if (a.includes('"wait"')) return '{"result":{"satisfied": true}}'
    return undefined
  }, { refuse })
  box.files = files
  await $.tool.call({
    tool: 'mcp__team-orchestrator__team_launch',
    team: 'Org',
    members: [
      { name: 'CEO', role: 'ceo', level: 1, boss: 'user' },
      { name: 'A-Head', role: 'head', level: 2, boss: 'CEO', team: 'A' },
    ],
  } as any)
  expect(commands.length).toBe(2)
  expect(commands.every(c => /--settings \\"[^"\\]*\/team-orchestrator\/member-settings\.json\\"/.test(c))).toBe(true)
  const file = [...files].find(([k]) => k.endsWith('/team-orchestrator/member-settings.json'))?.[1]
  // the project's own "off" for Playwright stands; a plugin that is not for browsers is left alone
  expect(JSON.parse(file ?? '{}')).toEqual({ enabledPlugins: { 'chrome-devtools-mcp@claude-plugins-official': false } })
})
