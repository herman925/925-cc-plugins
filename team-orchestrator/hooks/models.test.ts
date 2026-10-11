// Model names on an official config and on a custom one (ANTHROPIC_DEFAULT_*_MODEL): a member is started with the name
// that configuration serves.

import { expect, test } from 'claude-code/testing'

import { modelArg } from './status'
import { adopt, ID1, ID2, rawSaved, STATUS, TEAM, world } from './test-world'

const ROWS = [
  { name: 'Mod CEO', role: 'head', level: 1, boss: 'user', handle: '', sessionId: ID1 },
  { name: 'Mod Builder 2', role: 'specs', level: 2, boss: 'Mod CEO', handle: '', sessionId: ID2 },
]

// the --command a closed member is reopened with, its roster model set to `model`
const reopenWith = async ($: any, on: any, model: string, env: Record<string, string> = {}) => {
  const files = world(on, [], [{ id: ID2 }], (e: any) => {
    const a: string[] = e.argv
    if (a[1] === 'worktree' && a[2] === 'current') return '{"result":{"worktree":{"id":"r1::C:/proj"}}}'
    if (a[1] === 'terminal' && a[2] === 'create') return '{"result":{"terminal":{"handle":"term_ae1"}}}'
    if (a[1] === 'terminal' && a[2] === 'wait') return '{"result":{"satisfied": true}}'
    return undefined
  }, { env })
  on('session.id', async () => ({ value: ID1 }) as any)
  on('session.send', async () => ({ isDelivered: true }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await adopt($, ROWS, 'Mods')
  files.set(`${TEAM}/roster.json`, JSON.stringify(rawSaved(files).map((x: any) => (x.name === 'Mod Builder 2' ? { ...x, model } : x))))
  files.set(`${STATUS}/Mod_Builder_2.json`, JSON.stringify({ name: 'Mod Builder 2', sessionId: ID2, state: 'closed', heartbeat: Date.now() }))
  await $.tool.call({ tool: 'mcp__team-orchestrator__team_message', to: 'Mod Builder 2', message: 'hello' } as any)
  const create = files.calls.find(a => a[1] === 'terminal' && a[2] === 'create')!
  return String(create[create.indexOf('--command') + 1])
}

test('official config: the short shown name gets its claude- id back', async ($, on) => {
  expect(await reopenWith($, on, 'haiku-5-5')).toContain('--model claude-haiku-5-5')
})

test('custom config: a name set in ANTHROPIC_DEFAULT_HAIKU_MODEL is passed as set, not given a claude- prefix', async ($, on) => {
  const cmd = await reopenWith($, on, 'haiku-4-5', { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku-4-5' })
  expect(cmd).toContain('--model haiku-4-5')
  expect(cmd).not.toContain('claude-haiku-4-5')
})

test('custom config: names from the other ANTHROPIC_DEFAULT_* variables are passed as set too', async ($, on) => {
  expect(await reopenWith($, on, 'opus-4-1', { ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus-4-1' })).toContain('--model opus-4-1')
})

test('custom config: a family alias or short name starts with that family\'s ANTHROPIC_DEFAULT_*_MODEL value', async ($, on) => {
  expect(await reopenWith($, on, 'haiku', { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gw-haiku' })).toContain('--model gw-haiku ')
})

test('modelArg: official names unchanged with no env; the env value wins for its family only', () => {
  expect(modelArg('haiku')).toBe('haiku')
  expect(modelArg('Haiku 5.5')).toBe('claude-haiku-5-5')
  expect(modelArg('claude-haiku-5-5')).toBe('claude-haiku-5-5')
  const env = { haiku: 'gw-haiku', sonnet: 'sonnet-x' }
  expect(modelArg('haiku-5-5', env)).toBe('gw-haiku')
  expect(modelArg('Haiku 5.5', env)).toBe('gw-haiku')
  expect(modelArg('haiku[1m]', env)).toBe('gw-haiku[1m]')
  expect(modelArg('sonnet-x', env)).toBe('sonnet-x')
  // a full id is taken as typed; another family keeps the official form
  expect(modelArg('claude-haiku-5-5', env)).toBe('claude-haiku-5-5')
  expect(modelArg('opus-5-5', env)).toBe('claude-opus-5-5')
  // an env value a shell would split is not used
  expect(modelArg('haiku', { haiku: 'a b' })).toBe('haiku')
})
