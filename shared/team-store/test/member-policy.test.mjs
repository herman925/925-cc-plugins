import {test} from 'node:test';
import assert from 'node:assert/strict';
import {teamGuardPolicies} from '../src/member-policy.mjs';
import {codexGuard} from '../src/codex-guard.mjs';
const rows=[{member_id:'head',boss_member_id:null,generation:1,cli:'claude',membership_state:'active',allow_write:0,allow_agent:0},{member_id:'worker',boss_member_id:'head',generation:2,cli:'codex',membership_state:'active',allow_write:0,allow_agent:0}];
test('guard explanations distinguish a leaf with writes off from a manager, without granting task or private-state access',()=>{
 const [head,worker]=teamGuardPolicies(rows);
 assert.equal(head.managerWriteRule,'requires-write-grant');assert.equal(head.directReportCount,1);
 assert.equal(worker.managerWriteRule,'not-blocked-by-manager-rule');assert.equal(worker.standingWritesEnabled,false);assert.equal(worker.directReportCount,0);
 assert.match(worker.scope,/assignment validity separately/);assert.match(worker.scope,/new assignment changes no permissions/);
 for(const member of rows){const policy=teamGuardPolicies(rows).find(p=>p.memberId===member.member_id),authority={member,hasReports:policy.directReportCount>0};
  const event={tool:'apply_patch',input:{command:'*** Begin Patch\n*** Add File: AGENTS.md\n+fixture\n*** End Patch'}};
  assert.equal(codexGuard(authority,event).hookSpecificOutput?.permissionDecision==='deny',policy.managerWriteRule==='requires-write-grant');
  assert.equal(codexGuard(authority,{tool:'spawn_agent',input:{}}).hookSpecificOutput.permissionDecision,'deny');
  assert.equal(codexGuard({...authority,staleBinding:true},event).hookSpecificOutput.permissionDecision,'deny');
 }
});
test('live hierarchy and switch changes alter explanations; retired children and unsupported providers grant nothing',()=>{
 const changed=structuredClone(rows);changed.push({...changed[1],member_id:'child',boss_member_id:'worker'});
 assert.equal(teamGuardPolicies(changed).find(p=>p.memberId==='worker').managerWriteRule,'requires-write-grant');
 changed[1].allow_write=1;assert.equal(teamGuardPolicies(changed).find(p=>p.memberId==='worker').managerWriteRule,'not-blocked-by-manager-rule');
 changed[1].allow_write=0;changed[2].membership_state='retired';assert.equal(teamGuardPolicies(changed).find(p=>p.memberId==='worker').directReportCount,0);
 changed[1].cli='hermes';assert.equal(teamGuardPolicies(changed).find(p=>p.memberId==='worker').managerWriteRule,'unverified');
 assert.equal(teamGuardPolicies(changed).length,2);
});
