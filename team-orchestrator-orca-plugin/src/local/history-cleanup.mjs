import {randomUUID,createHash} from 'node:crypto';
import {storageDigest} from './storage-maintenance.mjs';
const CLEARED='[History manually cleared]';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const family=id=>id.split(':')[0];
const known=new Set(['work','native-run-binding','work-request','active-work','session-work','operation','binding','binding-generation','launch','dispatch','dispatch-intent','dispatch-member','dispatch-binding','dispatch-review','dispatch-protocol','dispatch-protocol-history','dispatch-queue','question','question-answer','question-event','team-message','collaboration','delivery','work-decision','goal','goal-request','next-goal','stop','wake','wake-member','staffing-request','staffing-proposal','configuration-amendment','work-configuration','roster-delta','organization']);
const contains=(value,ids)=>typeof value==='string'?(ids.has(value)||[...ids].some(id=>id.length>=32&&value.includes(id))):Array.isArray(value)?value.some(v=>contains(v,ids)):value&&typeof value==='object'?Object.values(value).some(v=>contains(v,ids)):false;
const uncertain=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,v])=>(['state','status','processed'].includes(key)&&['unknown','sending','submitted','needs_decision','pending','unconfirmed'].includes(v))||(typeof v==='object'&&!['processing','run','snapshot','proof','nativeSend','nativeRequest','binding','oldBinding','observation'].includes(key)&&uncertain(v)));
export function historyCleanup({db,readSnapshot,write,atomic}){
 const previews=new Map();
 function plan(ids){
  const rows=db.prepare('SELECT id,json FROM receipts ORDER BY id').all().map(r=>({...r,value:JSON.parse(r.json)})),byId=new Map(rows.map(r=>[r.id,r]));
  const eligibleWorkIds=[],retained=[],changes=[];
  for(const id of ids){
   const work=byId.get(`work:${id}`)?.value;
   if(!work||work.status!=='completed'||!work.closedAt){retained.push({workId:id,reason:'Only closed work explicitly accepted by you is eligible.'});continue;}
   if(work.historyPruned){retained.push({workId:id,reason:'This work was already cleaned; its closure and identity evidence remain.'});continue;}
   const contexts=new Set([id,...rows.filter(r=>family(r.id)==='native-run-binding'&&r.value.teamWorkId===id).map(r=>r.value.id)]);
   const own=r=>contexts.has(r.value.workId)||contexts.has(r.value.teamWorkId)||contexts.has(r.value.target?.workId)||contexts.has(r.value.id)&&['work','native-run-binding'].includes(family(r.id));
   const members=rows.filter(own),identities=new Set([...contexts,...members.flatMap(r=>[r.value.id,r.value.attemptId,r.value.dispatchId,r.value.nativeTaskId,r.value.evidenceId]).filter(v=>typeof v==='string')]);
   let reason;
   if(!members.some(r=>family(r.id)==='work-decision'&&r.value.workId===id&&r.value.decision==='accept'&&r.value.deliveryId===work.handoff?.deliveryId))reason='User acceptance provenance is missing.';
   for(const r of rows){
    const k=family(r.id),v=r.value,related=own(r),sameTeam=v.teamId===work.teamId||v.target?.teamId===work.teamId;
    if(!known.has(k)&&contains(v,identities))reason='An unknown record references this history; preserve it for a compatible plugin.';
    if(related&&((v.format&&/-(v[0-9]+)$/.test(v.format)&&!v.format.endsWith('-v1'))||(!(k==='question-event'&&v.kind==='goal-delivery'&&!v.nativeSend)&&uncertain(v))))reason='Unknown, pending or unprocessed evidence remains in this work.';
    if(related&&k==='dispatch'&&!['accepted','rework','rejected'].includes(v.status))reason='A task is running or still requires supervisor acceptance.';
    if(sameTeam&&k==='goal'&&['queued','reserved'].includes(v.status))reason='A later goal awaits its Work transition.';
    if(related&&k==='dispatch-queue')reason='Queued task admission remains.';
    if(related&&k==='staffing-proposal'&&!['approved','rejected'].includes(v.status))reason='A staffing proposal needs a decision.';
    if(related&&k==='roster-delta'&&!(v.state==='queued'&&!v.nativeSend||v.processed==='confirmed'))reason='A roster update awaits confirmed processing.';
    if(sameTeam&&k==='organization'&&v.state==='pending')reason='An organization change awaits its Work boundary.';
    if(sameTeam&&k==='wake'&&!['bound','resumed'].includes(v.state))reason='Member recovery or replacement remains unresolved.';
    if(sameTeam&&k==='stop'&&['intent','submitted','unknown'].includes(v.state))reason='A stop outcome remains unresolved.';
    if(sameTeam&&k==='operation'&&v.status!=='created')reason='An original native operation remains unknown.';
    if(k==='active-work'&&contexts.has(v.workId))reason='This work is still actively reserved.';
    // Replay indexes intentionally retain references; other surviving graphs must keep their evidence intact.
    if(!related&&contains(v,identities)&&!['work-request','session-work','goal-request','question-answer','dispatch-intent','dispatch-review','staffing-request'].includes(k))reason='A surviving record depends on this history (including later goals or another Work).';
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
  const requestRows=db.prepare('SELECT id,result FROM requests ORDER BY id').all();
  const snapshots=requestRows.filter(r=>{const v=JSON.parse(r.result);return v?.format==='orca-team-store'&&v.version===2&&Array.isArray(v.works)&&v.works.some(w=>eligibleWorkIds.includes(w.id));}).map(r=>r.id);
  return {selectedWorkIds:ids,eligibleWorkIds,retained,changes,snapshots};
 }
 return {
  previewHistoryCleanup(input){
   if(!input||Object.keys(input).some(k=>k!=='selectedWorkIds')||!Array.isArray(input.selectedWorkIds)||input.selectedWorkIds.length<1||input.selectedWorkIds.length>100||input.selectedWorkIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,120}$/.test(id)))throw Error('Select 1–100 saved Work histories.');
   return atomic(()=>{
    const ids=[...new Set(input.selectedWorkIds)].sort(),p=plan(ids),previewToken=randomUUID(),storageRevision=storageDigest(db),expiresAt=Date.now()+300000;
    if(previews.size>=64)previews.delete(previews.keys().next().value);previews.set(previewToken,{...p,storageRevision,expiresAt});
    return {previewToken,storageRevision,expiresAt,selectedWorkIds:ids,eligibleWorkIds:p.eligibleWorkIds,retained:p.retained,changes:p.changes.map(({id,workId,fields,logicalBytes})=>({recordId:id,workId,fields,logicalBytes})),snapshotCount:p.snapshots.length,logicalBytes:p.changes.reduce((n,r)=>n+r.logicalBytes,0),notice:'Clears displayed delivery summaries, task results, review summaries and cached public snapshots. Keeps objectives, native request/proof bodies (which may contain copies), questions, notification evidence, closure decisions, identities, replay barriers, configuration and role versions. Migration backups may still contain history. Project files, login data, native sessions and provider conversations are outside this cleanup. No secure erasure or immediate file shrink is promised.'};
   });
  },
  applyHistoryCleanup(input){return atomic(()=>{
   if(!input||Object.keys(input).some(k=>!['requestId','previewToken','expectedStorageRevision'].includes(k))||!/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId)||typeof input.previewToken!=='string'||typeof input.expectedStorageRevision!=='string')throw Error('Invalid cleanup request.');
   const key=`cleanup:${input.requestId}`,fingerprint=hash({requestId:input.requestId,previewToken:input.previewToken,expectedStorageRevision:input.expectedStorageRevision}),prior=db.prepare('SELECT json FROM maintenance WHERE id=?').get(key);
   if(prior){const p=JSON.parse(prior.json);if(p.fingerprint!==fingerprint)throw Error('Cleanup request identity conflicts.');return p.result;}
   const p=previews.get(input.previewToken);if(!p||p.expiresAt<Date.now())throw Error('Cleanup preview expired or worker restarted; preview again.');
   if(p.storageRevision!==input.expectedStorageRevision||storageDigest(db)!==p.storageRevision)throw Error('Storage changed since preview; preview again before cleaning.');
   if(!p.eligibleWorkIds.length)throw Error('No selected history is eligible for cleanup.');
   const at=new Date().toISOString();for(const row of p.changes){if(row.value.historyPruned)row.value.historyPruned.at=at;db.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify(row.value),row.id);}
   for(const id of p.snapshots)db.prepare('UPDATE requests SET result=? WHERE id=?').run(JSON.stringify({format:'history-pruned-replay-v1',recordedAt:at}),id);
   const state=readSnapshot();state.revision++;write(state);
   const result={requestId:input.requestId,cleanedWorkIds:p.eligibleWorkIds,retained:p.retained,changedRecords:p.changes.length,prunedSnapshots:p.snapshots.length,recordedAt:at};
   db.prepare('INSERT INTO maintenance VALUES(?,?)').run(key,JSON.stringify({fingerprint,result}));return result;
  });}
 };
}
