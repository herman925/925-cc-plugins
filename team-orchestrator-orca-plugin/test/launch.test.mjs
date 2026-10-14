import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, PRESETS, planTeam } from '../src/team.mjs';
import { configurationFor, initialMembers, launchInstructions, prepareLaunch } from '../src/launch.mjs';
const team = overrides => ({ ...planTeam({ ...structuredClone(DEFAULT_FORM), ...overrides }), id: 'launch-request-123' });
test('on-demand launches head/CEO first; all-at-create includes every worker', () => {
  assert.deepEqual(initialMembers(team(), 'on-demand').map(member => member.role), ['head']);
  const organisation = team(PRESETS[2].form);
  assert.equal(initialMembers(organisation, 'on-demand').length, 5);
  assert.equal(initialMembers(organisation, 'all').length, 21);
});
test('launch instruction preserves CLI, model, effort and request identity within the panel limit', () => {
  const definition = team({ agents: ['claude', 'codex', 'codex'], models: ['opus', 'gpt-6.1-sol', 'default'], efforts: ['high', 'medium', 'default'] });
  const text = launchInstructions(definition, 'all');
  assert.ok(text.length <= 4096);
  const specification = JSON.parse(text.split('\n').at(-1));
  assert.equal(specification.request, definition.id);
  assert.deepEqual(specification.agents, ['claude', 'codex', 'codex']);
  assert.deepEqual(specification.models, ['opus', 'gpt-6.1-sol', 'default']);
  assert.deepEqual(specification.efforts, ['high', 'medium', 'default']);
  for (const instruction of ['terminal create', 'tui-idle', '/rename', 'role file', 'orchestration', 'never launch duplicates']) assert.ok(text.includes(instruction), instruction);
});
test('existing 0.1.0 team definitions can be launched without recreating the roster', () => {
  const definition = team({ levels: 3, fan: 2 });
  delete definition.configuration;
  assert.deepEqual(planTeam(configurationFor(definition)).members, definition.members);
  assert.ok(launchInstructions(definition, 'all').includes('7 initial sessions'));
});
test('a missing coordinator fails before any terminal mutation', async () => {
  const calls = [];
  const call = async (action, params) => { calls.push({ action, params }); return { terminals: [{ id: 'other' }] }; };
  await assert.rejects(prepareLaunch(call, team(), 'all', 'chosen'), /no longer/);
  assert.deepEqual(calls.map(call => call.action), ['workspace.readContext']);
});
