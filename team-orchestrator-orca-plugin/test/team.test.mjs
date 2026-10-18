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

test('lead count and workers per lead are independent, and legacy fan remains readable', () => {
 const plan = planTeam(form({levels:3,leadCount:2,workersPerLead:4}));
 assert.equal(plan.members.length,11);
 assert.equal(plan.members.filter(m=>m.role==='head').length,1);
 const leads=plan.members.filter(m=>m.role==='lead');assert.equal(leads.length,2);
 for(const lead of leads)assert.equal(plan.members.filter(m=>m.boss===lead.id).length,4);
 assert.deepEqual(validateState({version:1,teams:[plan]}).teams[0],plan);
 const two=planTeam(form({levels:2,leadCount:5,workersPerLead:2}));
 assert.deepEqual(two.members.map(m=>m.role),['head','worker','worker']);
 assert.equal(planTeam(form({levels:3,fan:3})).members.length,13);
 for(const key of ['leadCount','workersPerLead'])for(const value of [0,6,1.5,'2',null])assert.throws(()=>planTeam(form({[key]:value})),/1–5/);
});

test('comma-separated lead names become the actual managers and survive saved configuration validation', () => {
 const plan=planTeam(form({levels:3,leadCount:3,workersPerLead:2,leadNames:' UI, Dev, Review '}));
 const leads=plan.members.filter(m=>m.role==='lead');
 assert.deepEqual(leads.map(m=>m.name),['UI','Dev','Review']);
 for(const lead of leads){const workers=plan.members.filter(m=>m.boss===lead.id);assert.deepEqual(workers.map(m=>m.name),[`${lead.name}-Worker-1`,`${lead.name}-Worker-2`]);assert.ok(workers.every(m=>m.brief.includes(`from ${lead.name}`)));}
 assert.deepEqual(validateState({version:1,teams:[plan]}).teams[0],plan);
 const single=planTeam(form({levels:2,leadCount:1,leadNames:'设计主管'}));
 assert.equal(single.members[0].name,'设计主管');assert.equal(single.members.filter(m=>m.role==='lead').length,0);
 assert.deepEqual(single.members.slice(1).map(m=>m.name),['设计主管-Worker-1','设计主管-Worker-2','设计主管-Worker-3']);
 assert.deepEqual(planTeam(form({levels:3,leadCount:2,leadNames:'UI，Dev'})).members.filter(m=>m.role==='lead').map(m=>m.name),['UI','Dev']);
});

test('lead naming refuses mismatched, empty, duplicate and colliding names while blank keeps legacy names',()=>{
 for(const leadNames of ['UI,Dev','UI,,Review','UI,ui,Review','Head,Dev,Review','UI,UI-Worker-1,Review',null])assert.throws(()=>planTeam(form({levels:3,leadCount:3,leadNames})));
 assert.throws(()=>planTeam(form({levels:2,leadCount:1,leadNames:'UI,Dev'})),/match Leads/);
 assert.deepEqual(planTeam(form({levels:3,leadCount:2,leadNames:''})).members.filter(m=>m.role==='lead').map(m=>m.name),['Lead-1-1','Lead-1-2']);
});
