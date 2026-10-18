import {staffingExpiryProof} from './staffing-expiry.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {sameStopIdentity} from './stop-store.mjs';
const CLEARED='[History manually cleared]';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const family=id=>id.split(':')[0];
const known=new Set(['runtime-control','runtime-reconnect','work','native-run-binding','work-request','active-work','session-work','operation','binding','binding-generation','launch','dispatch','dispatch-intent','intent-withdrawal','dispatch-member','dispatch-binding','dispatch-review','dispatch-protocol','dispatch-protocol-history','dispatch-queue','question','question-answer','question-event','team-message','collaboration','delivery','work-decision','goal','goal-request','next-goal','stop','stop-recovery','wake','wake-member','staffing-request','staffing-proposal','configuration-amendment','work-configuration','roster-delta','organization']);
const contains=(value,ids)=>typeof value==='string'?(ids.has(value)||[...ids].some(id=>id.length>=32&&value.includes(id))):Array.isArray(value)?value.some(v=>contains(v,ids)):value&&typeof value==='object'?Object.values(value).some(v=>contains(v,ids)):false;
const uncertain=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,v])=>(['state','status','processed'].includes(key)&&['unknown','sending','submitted','needs_decision','pending','unconfirmed'].includes(v))||(typeof v==='object'&&!['processing','run','snapshot','proof','controlProof','nativeSend','nativeRequest','binding','oldBinding','observation'].includes(key)&&uncertain(v)));
// The archived unknown observation is history only after the very same native stop
// has positive exit proof. Other fields and unresolved/mismatched links stay uncertain.
function settledStopRecovery(row,byId){
 const audit=row.value,previous=audit.previous,current=byId.get(`stop:${audit.stopRequestId}`)?.value;
 if(audit.requestId!==row.id.slice('stop-recovery:'.length)||!previous||previous.state!=='unknown'||previous.requestId!==audit.stopRequestId||previous.plan?.method!=='orchestration.workerStop'||!current||current.requestId!==audit.stopRequestId||current.state!=='stopped')return false;
 if(typeof previous.nativeRequestId!=='string'||!previous.nativeRequestId||typeof previous.target?.dispatchId!=='string'||!previous.target.dispatchId||previous.plan.params?.dispatch!==previous.target.dispatchId||previous.plan.envelope?.orchestrationRequestId!==previous.nativeRequestId||typeof current.confirmedAt!=='string'||!current.confirmedAt||!Number.isSafeInteger(previous.version)||!Number.isSafeInteger(current.version)||current.version<=previous.version)return false;
 if(current.nativeRequestId!==previous.nativeRequestId||!sameStopIdentity(current.target,previous.target)||!sameStopIdentity(current.plan,previous.plan))return false;
 return current.proof?.kind==='native-pty-exit'&&current.proof.ptyKilled===true||current.proof?.kind==='native-worker-exit'&&current.proof.dispatchId===current.target.dispatchId;
}
function settledStaffingNotification(row,byId){
 const event=row.value;if(event.kind!=='decision'||event.state!=='unconfirmed'||event.nativeSend||typeof event.id!=='string'||!event.id.startsWith('staffing-'))return false;
 const proposal=byId.get(`staffing-proposal:${event.workId}:${event.id.slice('staffing-'.length)}`)?.value;
 return proposal?.status==='expired'&&event.data?.body===proposal.rationale&&!!staffingExpiryProof(proposal,key=>byId.get(key)?.value);
}
// A frozen replacement intent stays immutable. Only its two launch-status fields
// become nonblocking after that exact operation and accepted Work are corroborated.
function settledRecipientIntents(work,byId,settledHistory){
 if(work.status!=='completed'||!work.closedAt||!Array.isArray(work.currentRecipientBindings))return work;
 const delivery=byId.get(`delivery:${work.id}:${work.handoff?.deliveryId}`)?.value;
 const accepted=delivery?.status==='accepted'&&delivery.workId===work.id&&[...byId.values()].some(r=>family(r.id)==='work-decision'&&r.value.workId===work.id&&r.value.deliveryId===delivery.id&&r.value.decision==='accept'&&r.value.recordedAt===work.closedAt&&r.value.input?.state==='none'&&r.value.fingerprint);
 if(!accepted)return work;
 const keys=['requestId','memberId','teamId','instanceGeneration','configVersion','roleVersion','nativeRequest','scope','replaces','resumedFrom','wakeRequestId','createdAt','runtimeId','executionHostId','hostGeneration'];
 function prove(recipient,seen=new Set()){
  if(seen.has(recipient.requestId))return null;seen.add(recipient.requestId);
  const op=byId.get(`operation:${recipient.requestId}`)?.value,wake=byId.get(`wake:${recipient.wakeRequestId}`)?.value;
  // Operation and wake records in this schema have no format discriminator.
  if(recipient.format!==undefined||op?.format!==undefined||wake?.format!==undefined||wake?.oldBinding?.format!==undefined)return null;
  if(!Number.isSafeInteger(recipient.version)||!Number.isSafeInteger(recipient.instanceGeneration)||recipient.instanceGeneration<2||(!recipient.nativeRequest||!recipient.resumedFrom&&!recipient.nativeRequest.operationId)||recipient.teamId!==work.teamId||!op||op.status!=='created'||op.public?.status!=='created'||!Number.isSafeInteger(op.version)||op.version<recipient.version||hash(keys.map(k=>recipient[k]))!==hash(keys.map(k=>op[k])))return null;
  if(recipient.status==='unknown'&&(recipient.version!==1||recipient.effectState!=='intent'||recipient.public?.status!=='unknown'||op.version<=recipient.version)||!['unknown','created'].includes(recipient.status))return null;
  if(!wake||wake.requestId!==recipient.wakeRequestId||!['bound','resumed'].includes(wake.state)||uncertain(wake)||wake.teamId!==work.teamId||wake.memberId!==recipient.memberId||wake.newInstance?.requestId!==recipient.requestId||wake.newInstance.instanceGeneration!==recipient.instanceGeneration||(wake.oldBinding?.instanceGeneration??1)+1!==recipient.instanceGeneration)return null;
  if(recipient.resumedFrom){
   const death=wake.proof?.death,fence=wake.newInstance.fence;
   if(recipient.status!=='created'||recipient.public?.status!=='created'||recipient.requestId!==`wake-${wake.requestId}`||wake.oldBinding?.requestId!==recipient.resumedFrom||op.kind!=='structured'||wake.oldBinding.kind!=='structured'||wake.oldBinding.status!=='created'||op.runtimeId!==wake.proof?.runtimeId||!['exit-observed','pid-absent','identity-mismatch'].includes(death?.kind)||!Number.isSafeInteger(death.ownerFence)||death.ownerFence<1||!Number.isSafeInteger(death.observedAt)||death.provider!==op.nativeRequest.agent||!Number.isSafeInteger(fence)||fence<=death.ownerFence||op.observation?.ownerFence!==fence)return null;
   const resumedKeys=['nativeRequest','scope','teamId','memberId','kind','handle','sessionId'];if(hash(resumedKeys.map(k=>op[k]))!==hash(resumedKeys.map(k=>wake.oldBinding[k])))return null;
  }else if(wake.state!=='bound'||wake.handoff?.decision!=='replace'||wake.oldBinding?.requestId!==recipient.replaces)return null;
  if(['requestId','memberId','teamId','instanceGeneration','configVersion','roleVersion'].some(k=>recipient.public?.[k]!==recipient[k]))return null;
  if(!op.handle||!(op.kind==='terminal'&&op.paneKey||op.kind==='structured'&&op.sessionId))return null;
  for(const id of [wake.oldBinding.sourceWorkId,wake.newInstance.workId].filter(Boolean)){const context=byId.get(`work:${id}`)?.value??byId.get(`native-run-binding:${id}`)?.value;if(!context||(context.teamWorkId??context.id)!==work.id)return null;}
  const prior=wake.oldBinding.wakeRequestId?prove(wake.oldBinding,seen):[];if(!prior)return null;
  return [...prior,`wake:${recipient.wakeRequestId}`,`operation:${recipient.requestId}`];
 }
 const currentRecipientBindings=work.currentRecipientBindings.map(recipient=>{
  if(recipient.status!=='unknown'||recipient.public?.status!=='unknown')return recipient;
  const history=prove(recipient);if(!history)return recipient;for(const id of history)settledHistory.add(id);
  return {...recipient,status:undefined,public:{...recipient.public,status:undefined}};
 });
 return {...work,currentRecipientBindings};
}
// Older pending proposals are display history only after the complete native
// revision chain leads to the exact delivery accepted at this Work's closure.
function supersededDeliveryHistory(work,byId){
 const prefix=`delivery:${work.id}:`,rows=[...byId.values()].filter(r=>family(r.id)==='delivery'&&(r.value.workId===work.id||r.id.startsWith(prefix))),current=byId.get(prefix+work.handoff?.deliveryId)?.value;
 const result={obsolete:new Set(),ancestors:new Set(),invalid:false};
 if(rows.length<2&&!current?.previousDeliveryId&&!(current?.revision>1))return result;
 const invalid=()=>({...result,invalid:true});
 if(work.status!=='completed'||!work.closedAt||!current||current.status!=='accepted'||current.format!==undefined||current.workId!==work.id||current.epoch!==(work.currentSupervisor?.epoch??work.epoch??0)||current.generation!==(work.currentSupervisor?.run??work.run).consumerGeneration)return invalid();
 const accepted=[...byId.values()].some(r=>r.id===`work-decision:${r.value.requestId}`&&r.value.format===undefined&&r.value.workId===work.id&&r.value.deliveryId===current.id&&r.value.decision==='accept'&&r.value.recordedAt===work.closedAt&&r.value.input?.state==='none'&&/^[a-f0-9]{64}$/.test(r.value.fingerprint??''));
 if(!accepted)return invalid();
 let row=current,child=null;
 while(row){
  const key=prefix+row.id;
  if(result.ancestors.has(key)||byId.get(key)?.value!==row||row.format!==undefined||row.workId!==work.id||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.epoch)||row.epoch<0||!Number.isSafeInteger(row.generation)||row.generation<1||!row.supervisorMemberId||!row.protocolToken||!row.proof?.requestId||!/^[a-f0-9]{64}$/.test(row.proof.payloadHash??'')||!Number.isFinite(Date.parse(row.createdAt))||row.createdAt>work.closedAt)return invalid();
  if(child&&(row.revision!==child.revision-1||row.epoch>child.epoch||row.generation>child.generation||row.createdAt>child.createdAt||row.supervisorMemberId!==child.supervisorMemberId||row.epoch===child.epoch&&(row.protocolToken!==child.protocolToken||row.generation!==child.generation)||!['pending','changes_requested','superseded'].includes(row.status)))return invalid();
  result.ancestors.add(key);if(child&&row.status==='pending')result.obsolete.add(key);
  if(row.previousDeliveryId==null){if(row.revision!==1)return invalid();break;}
  if(typeof row.previousDeliveryId!=='string'||!row.previousDeliveryId)return invalid();
  child=row;row=byId.get(prefix+row.previousDeliveryId)?.value;if(!row)return invalid();
 }
 if(rows.length!==result.ancestors.size)return invalid();
 return result;
}
export function historyCleanup({db,readSnapshot,write,atomic}){
 const previews=new Map();
 function plan(ids){
  const rows=db.prepare('SELECT id,json FROM receipts ORDER BY id').all().map(r=>({...r,value:JSON.parse(r.json)})),byId=new Map(rows.map(r=>[r.id,r]));
  const eligibleWorkIds=[],retained=[],changes=[],graph=new Map(),teamIds=new Set();
  const schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const knownTables=new Set(['metadata','snapshot','scopes','team_versions','role_versions','requests','receipts','maintenance']);
  const columns={metadata:['format'],snapshot:['id','json'],scopes:['team_id','json'],team_versions:['team_id','version','json'],role_versions:['member_id','version','json'],requests:['id','fingerprint','result'],receipts:['id','json'],maintenance:['id','json']};
  const unknownSchema=schema.some(row=>row.type==='table'&&!knownTables.has(row.name))||Object.entries(columns).some(([table,expected])=>JSON.stringify(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name))!==JSON.stringify(expected));
  for(const id of ids){
   const work=byId.get(`work:${id}`)?.value;
   if(!work||work.status!=='completed'||!work.closedAt){retained.push({workId:id,reason:'Only closed work explicitly accepted by you is eligible.'});continue;}
   if(work.historyPruned){retained.push({workId:id,reason:'This work was already cleaned; its closure and identity evidence remain.'});continue;}
   teamIds.add(work.teamId);
   const contexts=new Set([id,...rows.filter(r=>family(r.id)==='native-run-binding'&&r.value.teamWorkId===id).map(r=>r.value.id)]);
   const own=r=>contexts.has(r.value.workId)||contexts.has(r.value.teamWorkId)||contexts.has(r.value.target?.workId)||family(r.id)==='stop-recovery'&&contexts.has(r.value.previous?.target?.workId)||family(r.id)==='wake'&&contexts.has(r.value.newInstance?.workId)||contexts.has(r.value.id)&&['work','native-run-binding'].includes(family(r.id));
   const members=rows.filter(own),identities=new Set([...contexts,...members.flatMap(r=>[r.value.id,r.value.attemptId,r.value.dispatchId,r.value.nativeTaskId,r.value.evidenceId,r.value.binding?.requestId,r.value.currentSupervisor?.binding?.requestId,...(r.value.recipientBindings??[]).map(b=>b.requestId),...(r.value.currentRecipientBindings??[]).map(b=>b.requestId)]).filter(v=>typeof v==='string')]);
   let reason=unknownSchema?'An unknown storage table or column may reference this history; use a compatible cleanup implementation.':undefined;
   for(const r of rows)if(own(r)||contains(r.value,identities))graph.set(r.id,r.json);
   const settledHistory=new Set(),workUncertainty=settledRecipientIntents(work,byId,settledHistory);
   for(const id of settledHistory)graph.set(id,byId.get(id).json);
   const deliveryHistory=supersededDeliveryHistory(work,byId);
   for(const id of deliveryHistory.ancestors)graph.set(id,byId.get(id).json);
   if(deliveryHistory.invalid)reason='Delivery revision history is incomplete or unverified.';
   if(!members.some(r=>family(r.id)==='work-decision'&&r.value.workId===id&&r.value.decision==='accept'&&r.value.deliveryId===work.handoff?.deliveryId))reason='User acceptance provenance is missing.';
   for(const r of rows){
    const k=family(r.id),v=r.value,related=own(r),sameTeam=v.teamId===work.teamId||v.target?.teamId===work.teamId||k==='stop-recovery'&&v.previous?.target?.teamId===work.teamId;
    const uncertainty=k==='work'&&v.id===work.id?workUncertainty:k==='delivery'&&!deliveryHistory.invalid&&deliveryHistory.obsolete.has(r.id)?{...v,status:undefined}:k==='stop-recovery'&&settledStopRecovery(r,byId)?{...v,previous:undefined}:k==='question-event'&&settledStaffingNotification(r,byId)?{...v,state:undefined}:k==='question-event'&&['TEAM_SESSION_DECISIONS','TEAM_SESSION_QUESTION','TEAM_STAFFING_PROPOSAL','TEAM_SESSION_DECISION_RESULT'].includes(v.kind)?{state:v.state}:v;
    if(!known.has(k)&&(contains(v,identities)||sameTeam))reason='An unknown record references this history; preserve it for a compatible plugin.';
    if(related&&((v.format&&/-(v[0-9]+)$/.test(v.format)&&!v.format.endsWith('-v1'))||(!(k==='question-event'&&v.kind==='goal-delivery'&&!v.nativeSend)&&uncertain(uncertainty))))reason='Unknown, pending or unprocessed evidence remains in this work.';
    if(related&&k==='native-run-binding'&&(v.status!=='completed'||v.currentSupervisor&&v.currentSupervisor.status!=='completed'))reason='A descendant manager context remains active.';
    if(related&&k==='dispatch'&&!['accepted','rework','rejected'].includes(v.status))reason='A task is running or still requires supervisor acceptance.';
    if(sameTeam&&k==='goal'&&['queued','reserved'].includes(v.status))reason='A later goal awaits its Work transition.';
    if(related&&k==='dispatch-queue')reason='Queued task admission remains.';
    if(related&&k==='staffing-proposal'&&!(['approved','rejected'].includes(v.status)||v.status==='expired'&&staffingExpiryProof(v,key=>byId.get(key)?.value)))reason='A staffing proposal needs a decision.';
    if(related&&k==='roster-delta'&&!(v.state==='queued'&&!v.nativeSend||v.processed==='confirmed'))reason='A roster update awaits confirmed processing.';
    if(sameTeam&&k==='organization'&&v.state==='pending')reason='An organization change awaits its Work boundary.';
    if(sameTeam&&k==='wake'&&!['bound','resumed'].includes(v.state))reason='Member recovery or replacement remains unresolved.';
    if(sameTeam&&k==='stop'&&['intent','submitted','unknown'].includes(v.state))reason='A stop outcome remains unresolved.';
    if(sameTeam&&k==='operation'&&v.status!=='created')reason='An original native operation remains unknown.';
    if(k==='active-work'&&contexts.has(v.workId))reason='This work is still actively reserved.';
    // Replay indexes intentionally retain references; other surviving graphs must keep their evidence intact.
    if(!related&&!settledHistory.has(r.id)&&contains(v,identities)&&!(k==='operation'&&identities.has(v.requestId)&&v.status==='created')&&!['work-request','session-work','goal-request','question-answer','dispatch-intent','dispatch-review','staffing-request'].includes(k))reason='A surviving record depends on this history (including later goals or another Work).';
   }
   if(reason){retained.push({workId:id,reason});continue;}
   eligibleWorkIds.push(id);
   const associated=rows.filter(r=>own(r)||family(r.id)==='dispatch-review'&&identities.has(r.id.slice('dispatch-review:'.length)));
   for(const r of associated){
    const v=structuredClone(r.value),k=family(r.id),fields=[];
    const clear=(obj,key,path=key)=>{if(obj&&typeof obj[key]==='string'&&obj[key]!==CLEARED){obj[key]=CLEARED;fields.push(path);}};
    if(['work','native-run-binding'].includes(k)){
     clear(v.handoff,'summary','handoff.summary');
     // Cached native task projections are display history; original Run and send evidence remain.
     for(const [snapshot,path] of [[v.snapshot,'snapshot'],[v.currentSupervisor?.snapshot,'currentSupervisor.snapshot']])for(const [i,task] of (snapshot?.tasks??[]).entries()){clear(task,'result',`${path}.tasks[${i}].result`);clear(task,'summary',`${path}.tasks[${i}].summary`);}
     v.historyPruned={at:'$commit',kind:'summary-results',workId:id};fields.push('historyPruned');
    }
    if(k==='delivery')clear(v,'summary');
    if(k==='dispatch'){clear(v,'result');clear(v.review,'summary','review.summary');clear(v,'detail');}
    if(k==='dispatch-review')clear(v,'summary');
    if(fields.length)changes.push({id:r.id,workId:id,fields,value:v,beforeHash:hash(r.json),logicalBytes:Buffer.byteLength(r.json)});
   }
  }
  const requestRows=db.prepare('SELECT id,fingerprint,result FROM requests ORDER BY id').all();
  const snapshots=requestRows.filter(r=>{const v=JSON.parse(r.result);return v?.format==='orca-team-store'&&v.version===2&&Array.isArray(v.works)&&v.works.some(w=>eligibleWorkIds.includes(w.id));}).map(r=>r.id);
  const snapshot=JSON.parse(db.prepare('SELECT json FROM snapshot WHERE id=1').get().json);
  const teams=snapshot.teams.filter(t=>teamIds.has(t.id)).map(t=>({id:t.id,configVersion:t.configVersion,scope:t.scope,members:t.members.map(m=>({id:m.id,boss:m.boss,roleVersion:m.roleVersion}))}));
  const storageRevision=hash({schema,userVersion:db.prepare('PRAGMA user_version').get().user_version,teams,selectedWorkIds:ids,eligibleWorkIds,retained,graph:[...graph].sort(([a],[b])=>a.localeCompare(b)),snapshots:requestRows.filter(r=>snapshots.includes(r.id))});
  return {selectedWorkIds:ids,eligibleWorkIds,retained,changes,snapshots,storageRevision};
 }
 return {
  previewHistoryCleanup(input){
   if(!input||Object.keys(input).some(k=>k!=='selectedWorkIds')||!Array.isArray(input.selectedWorkIds)||input.selectedWorkIds.length<1||input.selectedWorkIds.length>100||input.selectedWorkIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,120}$/.test(id)))throw Error('Select 1–100 saved Work histories.');
   return atomic(()=>{
    const ids=[...new Set(input.selectedWorkIds)].sort(),p=plan(ids),previewToken=randomUUID(),storageRevision=p.storageRevision,expiresAt=Date.now()+300000;
    if(previews.size>=64)previews.delete(previews.keys().next().value);previews.set(previewToken,{...p,storageRevision,expiresAt});
    return {previewToken,storageRevision,expiresAt,selectedWorkIds:ids,eligibleWorkIds:p.eligibleWorkIds,retained:p.retained,changes:p.changes.map(({id,workId,fields,logicalBytes})=>({recordId:id,workId,fields,logicalBytes})),snapshotCount:p.snapshots.length,logicalBytes:p.changes.reduce((n,r)=>n+r.logicalBytes,0),notice:'Clears displayed delivery summaries, task results, review summaries and cached public snapshots. Keeps objectives, native request/proof bodies (which may contain copies), questions, notification evidence, closure decisions, identities, replay barriers, configuration and role versions. Migration backups may still contain history. Project files, login data, native sessions and provider conversations are outside this cleanup. No secure erasure or immediate file shrink is promised.'};
   });
  },
  applyHistoryCleanup(input){return atomic(()=>{
   if(!input||Object.keys(input).some(k=>!['requestId','previewToken','expectedStorageRevision'].includes(k))||!/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId)||typeof input.previewToken!=='string'||typeof input.expectedStorageRevision!=='string')throw Error('Invalid cleanup request.');
   const key=`cleanup:${input.requestId}`,fingerprint=hash({requestId:input.requestId,previewToken:input.previewToken,expectedStorageRevision:input.expectedStorageRevision}),prior=db.prepare('SELECT json FROM maintenance WHERE id=?').get(key);
   if(prior){const p=JSON.parse(prior.json);if(p.fingerprint!==fingerprint)throw Error('Cleanup request identity conflicts.');return p.result;}
   const p=previews.get(input.previewToken);if(!p||p.expiresAt<Date.now())throw Error('Cleanup preview expired or worker restarted; preview again.');
   if(p.storageRevision!==input.expectedStorageRevision||plan(p.selectedWorkIds).storageRevision!==p.storageRevision)throw Error('Storage changed since preview; preview again before cleaning.');
   if(!p.eligibleWorkIds.length)throw Error('No selected history is eligible for cleanup.');
   const at=new Date().toISOString();for(const row of p.changes){if(row.value.historyPruned)row.value.historyPruned.at=at;db.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify(row.value),row.id);}
   for(const id of p.snapshots)db.prepare('UPDATE requests SET result=? WHERE id=?').run(JSON.stringify({format:'history-pruned-replay-v1',recordedAt:at}),id);
   const state=readSnapshot();state.revision++;write(state);
   const result={requestId:input.requestId,cleanedWorkIds:p.eligibleWorkIds,retained:p.retained,changedRecords:p.changes.length,prunedSnapshots:p.snapshots.length,recordedAt:at};
   db.prepare('INSERT INTO maintenance VALUES(?,?)').run(key,JSON.stringify({fingerprint,result}));return result;
  });}
 };
}
