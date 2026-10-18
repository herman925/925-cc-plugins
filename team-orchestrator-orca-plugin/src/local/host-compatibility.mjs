import {realpath,stat} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';

export const REQUIRED_HOST_CAPABILITIES = Object.freeze([
  'orchestration.contract.v1', 'agent.launch.v2', 'agent.launch.replay-required.v1',
  'agent-session.structured.v1', 'terminal.prompt-delivery.v1'
]);
const reject=(code,message)=>{throw Object.assign(Error(message),{code});};
export function validateHostCapabilities(status,settings,appVersion) {
  if(!status || typeof status.runtimeId!=='string' || !status.runtimeId || !Array.isArray(status.capabilities) || status.capabilities.some(v=>typeof v!=='string'))
    reject('runtime_contract_incompatible','Orca returned an unsupported runtime status format.');
  if(status.appVersion && status.appVersion!==appVersion)reject('runtime_identity_mismatch','The native runtime belongs to a different Orca version.');
  const missing=REQUIRED_HOST_CAPABILITIES.filter(capability=>!status.capabilities.includes(capability));
  if(missing.length)reject('runtime_capability_missing',`Orca is missing required interfaces: ${missing.join(', ')}.`);
  if(!settings?.settings || typeof settings.settings!=='object' || Array.isArray(settings.settings))
    reject('runtime_contract_incompatible','Orca returned an unsupported settings response.');
  return {runtimeId:status.runtimeId,capabilities:[...REQUIRED_HOST_CAPABILITIES]};
}

// These are the actual evidence formats read by the plugin. Application releases are unrelated.
const DATABASES = [
  {file:'orchestration.db',version:43,tables:{
    runs:['id','objective','home_database','legacy','consumer_generation','coordinator_handle','coordinator_pane_key','coordinator_orca_session_id','coordinator_orca_session_id_generation'],
    tasks:['id','run_id','spec','status','result','created_by_terminal_handle','created_by_pane_key','created_by_process_incarnation','created_by_run_generation'],
    mutation_receipts:['caller_fingerprint','request_id','method','payload_hash','state','receipt'],
    mutation_caller_identities:['transport','caller_fingerprint'],
    dispatch_contexts:['id','run_id','task_id','assignee_handle','assignee_pane_key','process_incarnation','host_scope'],
    worker_dispatches:['dispatch_id','worktree_id','agent_terminal_handle','state','runtime_epoch','start_options'],
    attempt_observation_facts:['id','dispatch_id','task_id','authority_id','facet','payload'],
    messages:['id','run_id','from_handle','sender_pane_key','type','body','payload']
  }},
  {file:'agent-session-journal.db',version:4,tables:{agent_session_operations:['operation_key','row_json']}}
];
export async function inspectEvidenceSchemas(userData) {
  if(!isAbsolute(userData||''))reject('profile_missing','Orca did not supply an absolute profile directory.');
  const profile=await realpath(userData),{DatabaseSync}=await import('node:sqlite'),results=[];
  for(const spec of DATABASES){
    const requested=join(profile,spec.file);let path;
    try{await stat(requested);path=await realpath(requested);}catch(error){
      if(error.code==='ENOENT'){results.push({file:spec.file,state:'not-created',expectedVersion:spec.version});continue;}
      reject('evidence_unavailable',`Cannot inspect ${spec.file}; existing data was preserved.`);
    }
    const rel=relative(profile,path);if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))reject('profile_mismatch','Evidence database is outside the verified Orca profile.');
    let db;
    try{
      db=new DatabaseSync(path,{readOnly:true});db.exec('BEGIN');
      const version=db.prepare('PRAGMA user_version').get().user_version;
      if(version!==spec.version)reject('evidence_schema_incompatible',`${spec.file} uses schema ${version}; this plugin reads schema ${spec.version}. Update the plugin; do not reset the database.`);
      for(const [table,required] of Object.entries(spec.tables)){
        const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
        if(required.some(column=>!columns.includes(column)))reject('evidence_schema_incompatible',`${spec.file} has an incompatible ${table} table. Existing data was preserved.`);
      }
      results.push({file:spec.file,state:'verified',version});
    }catch(error){if(error.code?.startsWith('evidence_'))throw error;reject('evidence_unavailable',`Cannot read the ${spec.file} evidence format. Existing data was preserved.`);}
    finally{if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
  }
  return results;
}
export async function probeHostCompatibility({rpc,userData,appVersion}) {
  const status=await rpc('status.get'),settings=await rpc('settings.get');
  const host=validateHostCapabilities(status,settings,appVersion);
  const schemas=await inspectEvidenceSchemas(userData);
  return {verification:'runtime-contract',...host,schemas,liveProviderVerified:false};
}
