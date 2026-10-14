import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, PRESETS, planTeam, addTeam, validateState } from '../src/team.mjs';
const form = overrides => ({ ...structuredClone(DEFAULT_FORM), ...overrides });
test('original presets produce 4, 11 and 21 members with a single root', () => {
  for (const [i, expected] of [4, 11, 21].entries()) {
    const plan = planTeam(form(PRESETS[i].form));
    assert.equal(plan.members.length, expected);
    assert.equal(plan.members.filter(member => member.boss === null).length, 1);
    assert.equal(validateState({ version: 1, teams: [plan] }).teams.length, 1);
  }
});
test('branching applies to each manager: 1 head, 3 leads, 9 workers', () => {
  const plan = planTeam(form({ levels: 3, fan: 3 }));
  assert.equal(plan.members.length, 13);
  for (const lead of plan.members.filter(member => member.role === 'lead')) assert.equal(plan.members.filter(member => member.boss === lead.id).length, 3);
});
test('head-only and model settings follow levels', () => {
  assert.equal(planTeam(form({ levels: 1 })).members.length, 1);
  const plan = planTeam(form({ models: ['head-model', 'worker-model', 'default'], efforts: ['high', 'low', 'default'] }));
  assert.equal(plan.members[0].model, 'head-model');
  assert.equal(plan.members[1].model, 'worker-model');
  assert.equal(plan.members[1].effort, 'low');
});
test('invalid structures, duplicate names and incomplete settings fail before saving', () => {
  for (const value of [form({ name: '<script>' }), form({ fan: 6 }), form({ structure: 'organisation', groups: 'Dev,dev' }), form({ structure: 'organisation', groups: '' }), form({ efforts: ['high', 'default', 'default'] })]) assert.throws(() => planTeam(value));
  const team = planTeam(form());
  const state = addTeam(validateState(null), team);
  assert.throws(() => addTeam(state, { ...team, name: 'squad' }), /already exists/);
  assert.throws(() => addTeam(state, planTeam(form({ name: 'Org', structure: 'organisation', groups: 'Squad' }))), /already exists/);
  assert.equal(state.teams.length, 1);
});
test('persisted data validates before use; malformed state is not overwritten', () => {
  const plan = planTeam(form());
  const saved = { version: 1, teams: [plan], settings: { chart: false, layout: 'columns' } };
  assert.deepEqual(validateState(saved), saved);
  assert.throws(() => validateState({ version: 2, teams: [] }), /unsupported/);
  assert.throws(() => validateState({ version: 1, teams: [{ ...plan, members: [{ ...plan.members[0], boss: 'missing' }] }] }), /reporting/);
});
