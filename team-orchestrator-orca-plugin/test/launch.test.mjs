import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, PRESETS, planTeam, validateState } from '../src/team.mjs';
import { initialMembers, memberLaunch, launchMembers } from '../src/launch.mjs';
const context = { nativeAgentLaunch: true, workspaceKey: 'a'.repeat(64) };
const team = overrides => ({ ...planTeam({ ...structuredClone(DEFAULT_FORM), ...overrides }), id: 'launch-request-123' });
test('on-demand starts managers; all-at-create starts the exact roster', () => {
  assert.deepEqual(initialMembers(team(), 'on-demand').map(member => member.role), ['head']);
  const organisation = team(PRESETS[2].form);
  assert.equal(initialMembers(organisation, 'on-demand').length, 5);
  assert.equal(initialMembers(organisation, 'all').length, 21);
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
test('all-at-create returns four created handles without sending to an existing agent', async () => {
  const t = team(); const calls = []; const receipts = {};
  await launchMembers(async (action, params) => {
    calls.push({ action, params }); return { handle: params.requestId, title: params.title, briefAccepted: true };
  }, t, 'all', context, async (id, receipt) => { receipts[id] = receipt; });
  assert.equal(calls.length, 4); assert.ok(calls.every(call => call.action === 'terminal.createAgent'));
  assert.equal(Object.keys(receipts).length, 4); assert.ok(Object.values(receipts).every(row => row.status === 'created'));
});
test('unsupported host performs no mutations; ambiguous partial creation stops later members', async () => {
  let calls = 0;
  await assert.rejects(launchMembers(async () => calls++, team(), 'all', {}, async () => {}), /host patch/);
  assert.equal(calls, 0);
  const receipts = {};
  await assert.rejects(launchMembers(async (_, params) => {
    calls++; if (calls === 2) throw new Error('Transport lost');
    return { handle: 'head-handle', title: params.title, briefAccepted: true };
  }, team(), 'all', context, async (id, receipt) => { receipts[id] = receipt; }), /Transport lost/);
  assert.equal(calls, 2); assert.equal(receipts['member-1'].terminalId, 'head-handle'); assert.equal(receipts['member-2'].status, 'unknown');
});
test('native partial receipts and legacy coordinator requests restore without claiming readiness', () => {
  const t = team(); t.launch = { native: true, workspaceKey: context.workspaceKey, status: 'unknown', mode: 'all', members: { 'member-1': { status: 'created', terminalId: 'head-handle', title: 'Squad/Head', briefAccepted: true, executionHostId: 'ssh:demo' } } };
  assert.deepEqual(validateState({ version: 1, teams: [t] }).teams[0], t);
  t.launch.members['not-in-roster'] = { status: 'unknown' };
  assert.throws(() => validateState({ version: 1, teams: [t] }), /receipt/);
  t.launch = { status: 'accepted', terminalId: 'legacy-coordinator', mode: 'all' };
  assert.equal(validateState({ version: 1, teams: [t] }).teams[0].launch.native, undefined);
});
