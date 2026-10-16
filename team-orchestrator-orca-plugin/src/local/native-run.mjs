import {withOrchestrationSnapshot} from './orchestration-snapshot.mjs';
import {isAbsolute} from 'node:path';
const columns=['id','objective','home_database','coordinator_handle','coordinator_pane_key','coordinator_orca_session_id','coordinator_orca_session_id_generation','consumer_generation','legacy'];
export async function readNativeRunEvidence(userData,{objective,owner,runId}={}){
 const unknown=detail=>({state:'unverified',detail});
 try{
  if(!isAbsolute(userData||'')||typeof objective!=='string'||!owner)throw Error();
  return await withOrchestrationSnapshot(userData,{pathError:'',schemaError:''},db=>{
  const names=new Set(db.prepare('PRAGMA table_info(runs)').all().map(row=>row.name));if(columns.some(name=>!names.has(name)))throw Error();
  const rows=runId?db.prepare(`SELECT ${columns.join(',')} FROM runs WHERE id=? LIMIT 2`).all(runId):db.prepare(`SELECT ${columns.join(',')} FROM runs WHERE objective=? LIMIT 2`).all(objective);
  if(rows.length!==1)return unknown('No unambiguous native Run matches this TeamWork yet. The supervisor must create its own Run.');
  const run=rows[0];
  if(run.objective!==objective||run.legacy!==0||run.home_database!=='this_database'||!Number.isSafeInteger(run.consumer_generation)||run.consumer_generation<1)return unknown('Native Run scope or generation is unverified.');
  if(owner.kind==='structured'){
   if(run.coordinator_orca_session_id!==owner.sessionId||run.coordinator_orca_session_id_generation!==run.consumer_generation)return unknown('Native Run is not bound to this supervisor at its current consumer generation.');
  }else if(owner.kind!=='terminal'||!owner.paneKey||run.coordinator_pane_key!==owner.paneKey||run.coordinator_handle!==owner.handle)return unknown('Native Run terminal owner does not match this supervisor.');
  return {state:'verified',id:run.id,consumerGeneration:run.consumer_generation,observedAt:new Date().toISOString(),detail:'Native owner and generation observed; process liveness is separate.'};
  });
 }catch{return unknown('Native Run evidence is unavailable or incompatible. Preserve the work and reconnect its owning Orca host.');}
}
