import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, PRESETS, planTeam, validateState } from '../src/team.mjs';
import { initialMembers, memberLaunch } from '../src/launch.mjs';
const context = { nativeAgentLaunch: true, workspaceKey: 'a'.repeat(64) };
const team = overrides => ({ ...planTeam({ ...structuredClone(DEFAULT_FORM), ...overrides }), id: 'launch-request-123' });
test('on demand prepares every saved manager while all prepares the exact roster', () => {
  assert.deepEqual(initialMembers(team()).map(member => member.role), ['head']);
  assert.deepEqual(initialMembers(team(PRESETS[2].form)).map(member => member.role), ['ceo', 'head', 'head', 'head', 'head']);
  const all=team({launchMode:'all'}); assert.deepEqual(initialMembers(all).map(row=>row.id),all.members.map(row=>row.id));
});
test('native launch uses selected CLI and preferences with exact role and no extra CEO', () => {
  const t = team({ agents: ['claude', 'codex', 'codex'], models: ['opus', 'gpt-6.1-sol', 'default'], efforts: ['high', 'medium', 'default'] });
  const head = memberLaunch(t, t.members[0], context.workspaceKey);
  assert.equal(head.agent, 'claude'); assert.equal(head.model, 'opus'); assert.equal(head.effort, 'high');
  assert.equal(head.title, 'Squad/Head'); assert.equal(head.requestId, 'launch-request-123-member-1');
  assert.match(head.brief, /exactly 4 members/); assert.match(head.brief, /user is outside/); assert.doesNotMatch(head.brief, /CEO/);
  const defaults = memberLaunch(team(), team().members[1], context.workspaceKey);
  assert.equal(defaults.model, undefined); assert.equal(defaults.effort, undefined);
});
test('native partial receipts and legacy coordinator requests restore without claiming readiness', () => {
  const t = team(); t.launch = { native: true, workspaceKey: context.workspaceKey, status: 'unknown', mode: 'all', members: { 'member-1': { status: 'created', terminalId: 'head-handle', title: 'Squad/Head', briefAccepted: true, executionHostId: 'ssh:demo' } } };
  assert.deepEqual(validateState({ version: 1, teams: [t] }).teams[0], t);
  t.launch.members['not-in-roster'] = { status: 'unknown' };
  assert.throws(() => validateState({ version: 1, teams: [t] }), /receipt/);
  t.launch = { status: 'accepted', terminalId: 'legacy-coordinator', mode: 'all' };
  assert.equal(validateState({ version: 1, teams: [t] }).teams[0].launch.native, undefined);
});
