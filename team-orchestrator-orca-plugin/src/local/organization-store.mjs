import {createHash} from 'node:crypto';
// A complete prospective tree is validated without rewriting the current authority.
function reorganize(team,changes){
 const members=structuredClone(team.members),ids=new Set();
 if(!Array.isArray(changes)||!changes.length||changes.length>49)throw Error('Choose at least one organization change.');
 for(const change of changes){
  if(!change||ids.has(change.memberId)||Object.keys(change).some(k=>!['memberId','remove','boss'].includes(k)))throw Error('Invalid or duplicate organization change.');
  ids.add(change.memberId);const member=members.find(m=>m.id===change.memberId);if(!member)throw Error('Organization member is no longer present.');
  if(change.remove===true){if(Object.hasOwn(change,'boss'))throw Error('Removal cannot also reparent a member.');members.splice(members.indexOf(member),1);}else if(Object.hasOwn(change,'boss'))member.boss=change.boss;else throw Error('Choose removal or a new direct supervisor.');
 }
 const heads=members.filter(m=>m.boss===null);if(heads.length!==1||!['ceo','head'].includes(heads[0].role))throw Error('The organization requires one highest Head or CEO.');
 const ordered=[],visited=new Set();
 function visit(member,level){if(level>3||visited.has(member.id))throw Error('Reporting tree has a cycle or unsupported depth.');visited.add(member.id);member.level=level;ordered.push(member);for(const child of members.filter(m=>m.boss===member.id))visit(child,level+1);}
 visit(heads[0],1);if(ordered.length!==members.length)throw Error('Reporting tree has a cycle, removed parent or foreign supervisor.');
 for(const m of ordered){const previous=team.members.find(p=>p.id===m.id);if(m.boss!==null&&ordered.some(c=>c.boss===m.id)&&m.role==='worker')m.role='lead';if(m.boss!==previous.boss||m.level!==previous.level||m.role!==previous.role)m.roleVersion++;}
 return ordered;
}
export function organizationStore({db,readPrivate,putPrivate,atomic,readSnapshot,write,readWork,archive,validate}){
 const list=()=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'organization:%' ORDER BY rowid").all().map(r=>JSON.parse(r.json));
 return {
  organizationProjection:()=>list(),
  scheduleOrganization(input){return atomic(()=>{
   if(!input||!/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId)||Object.keys(input).some(k=>!['requestId','teamId','workId','expectedRevision','configVersion','changes','pause'].includes(k)))throw Error('Invalid organization request.');
   const key=`organization:${input.requestId}`,fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex'),prior=readPrivate(key);if(prior){if(prior.fingerprint!==fingerprint)throw Error('Organization request conflicts with saved input.');return prior;}
   const state=readSnapshot(),team=state.teams.find(t=>t.id===input.teamId),work=readWork(input.workId);
   if(!team||state.revision!==input.expectedRevision||team.configVersion!==input.configVersion)throw Error('Organization configuration changed; reload and review your changes.');
   if(readPrivate(`next-goal:${team.id}`)||!work||work.teamId!==team.id||work.status==='completed'||readPrivate(`active-work:${team.id}`)?.workId!==work.id)throw Error('The current accepted-end boundary changed or a goal transition is reserved. Reload the active work.');
   if(list().some(r=>r.teamId===team.id&&r.state==='pending'))throw Error('An organization change already awaits this boundary; cancel it before replacing.');
   reorganize(team,input.changes);
   const row={...input,fingerprint,state:'pending',createdAt:new Date().toISOString()};putPrivate(key,row);
   if(input.pause===true){team.admission??={paused:false,members:{}};for(const c of input.changes)team.admission.members[c.memberId]=true;}
   // Invalidate an already reviewed acceptance snapshot, so another panel must see this boundary change.
   const raw=readPrivate(`work:${work.id}`);raw.version++;putPrivate(`work:${work.id}`,raw);
   state.revision++;write(state);return row;
  });},
  cancelOrganization(input){return atomic(()=>{const row=readPrivate(`organization:${input.requestId}`),state=readSnapshot();if(!row||row.state!=='pending'||state.revision!==input.expectedRevision)throw Error('Organization request changed; reload.');row.state='cancelled';row.cancelledAt=new Date().toISOString();putPrivate(`organization:${row.requestId}`,row);const raw=readPrivate(`work:${row.workId}`);raw.version++;putPrivate(`work:${row.workId}`,raw);state.revision++;write(state);return row;});},
  applyOrganization(work,team){
   if(!db.isTransaction)throw Error('Organization application requires the acceptance transaction.');
   const row=list().find(r=>r.teamId===team.id&&r.workId===work.id&&r.state==='pending');if(!row)return;
   if(team.configVersion!==row.configVersion)throw Error('Pending organization configuration changed; cancel and review it again before acceptance.');
   team.members=reorganize(team,row.changes);team.configVersion++;validate(team);archive(team);
   row.state='applied';row.appliedConfigVersion=team.configVersion;row.appliedAt=new Date().toISOString();putPrivate(`organization:${row.requestId}`,row);
  }
 };
}
