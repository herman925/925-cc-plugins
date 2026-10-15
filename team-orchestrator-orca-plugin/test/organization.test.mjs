import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './work.test.mjs';
test('organization changes wait for accepted work and atomically shape the reserved next goal',async t=>{
 const f=await fixture(t),s=f.store,member=f.team.members[1];let w=s.prepareWork({teamId:f.team.id,requestId:'goal-org',expectedRevision:s.readSnapshot().revision,objective:'Current'}).work;
 s.updateWork(w.id,w.version,{run:{state:'verified',id:'run-org',consumerGeneration:1}});
 s.enqueueGoal({teamId:f.team.id,requestId:'next-org',expectedRevision:s.readSnapshot().revision,objective:'Next'});
 const input={requestId:'remove-org',teamId:f.team.id,workId:w.id,expectedRevision:s.readSnapshot().revision,configVersion:1,changes:[{memberId:member.id,remove:true}],pause:true};
 s.scheduleOrganization(input);
 assert.ok(s.readSnapshot().teams[0].members.some(m=>m.id===member.id));assert.equal(s.readSnapshot().organizationChanges[0].state,'pending');assert.throws(()=>s.assertAdmission(f.team.id,member.id),/paused/);
 s.recordDelivery(w.id,{id:'org-delivery',summary:'Done',evidenceRefs:['report'],attemptIds:[],generation:1,proof:{requestId:'proof',payloadHash:'a'.repeat(64)}});w=s.readWork(w.id);
 s.decideWork({workId:w.id,requestId:'org-accept',deliveryId:'org-delivery',expectedWorkVersion:w.version,decision:'accept'});
 assert.equal(s.readSnapshot().teams[0].members.some(m=>m.id===member.id),false);assert.equal(s.nextGoal(f.team.id).configVersion,2);assert.equal(s.readWork(w.id).configVersion,1);assert.equal(s.readTeamVersion(f.team.id,1).members.some(m=>m.id===member.id),true);assert.equal(s.readSnapshot().organizationChanges[0].state,'applied');
 assert.throws(()=>s.scheduleOrganization({...input,requestId:'late-org',expectedRevision:s.readSnapshot().revision}),/transition|completed|boundary|configuration changed/);
});

test('invalid trees and stale acceptance leave the entire current roster intact',async t=>{
 const f=await fixture(t),s=f.store;let w=s.prepareWork({teamId:f.team.id,requestId:'org-current',expectedRevision:s.readSnapshot().revision,objective:'Current'}).work;s.updateWork(w.id,w.version,{run:{state:'verified',id:'org-run',consumerGeneration:1}});
 const input=changes=>({requestId:'org-'+Math.random().toString(36).slice(2),teamId:f.team.id,workId:w.id,expectedRevision:s.readSnapshot().revision,configVersion:1,changes});
 assert.throws(()=>s.scheduleOrganization(input([{memberId:f.head.id,remove:true}])),/highest/);
 assert.throws(()=>s.scheduleOrganization(input([{memberId:f.team.members[1].id,boss:f.team.members[2].id},{memberId:f.team.members[2].id,boss:f.team.members[1].id}])),/cycle/);
 s.recordDelivery(w.id,{id:'org-stale-delivery',summary:'Done',evidenceRefs:['report'],attemptIds:[],generation:1,proof:{requestId:'proof',payloadHash:'a'.repeat(64)}});w=s.readWork(w.id);
 const decision={workId:w.id,requestId:'org-stale-accept',deliveryId:'org-stale-delivery',expectedWorkVersion:w.version,decision:'accept'};
 s.scheduleOrganization(input([{memberId:f.team.members[2].id,boss:f.team.members[1].id}]));
 assert.throws(()=>s.decideWork(decision),/changed|superseded/);
 s.updateAgentPreferences({teamId:f.team.id,memberId:f.head.id,requestId:'preferences-race',expectedRevision:s.readSnapshot().revision,agent:'claude',model:'default',effort:'default'});
 assert.throws(()=>s.decideWork({...decision,expectedWorkVersion:s.readWork(w.id).version}),/configuration changed/);
 assert.equal(s.readWork(w.id).status,'awaiting_acceptance');assert.equal(s.nextGoal(f.team.id),null);assert.equal(s.readSnapshot().teams[0].members[2].boss,f.head.id);
 s.cancelOrganization({requestId:s.readSnapshot().organizationChanges[0].requestId,expectedRevision:s.readSnapshot().revision});
 s.decideWork({...decision,expectedWorkVersion:s.readWork(w.id).version});assert.equal(s.readWork(w.id).status,'completed');
});
