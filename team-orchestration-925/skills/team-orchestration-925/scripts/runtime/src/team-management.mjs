import {normalizeConfigurationMutation,applyConfigurationMutation} from './configuration.mjs';
import {workerReadinessSnapshot} from './worker-readiness.mjs';
import {reference} from './writers.mjs';
import {text,integer,databaseInteger,snapshot} from './validation.mjs';
import {refusal} from './errors.mjs';
const fail=message=>{throw refusal('API_EDIT_INVALID',message);};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('Unexpected team edit field. Removal, CLI conversion, home transfer and silent rebinding are not supported edits.');};
export function normalizeTeamEdits(input){
 if(!Array.isArray(input)||input.length<1||input.length>30)fail('Supply 1–30 explicit changes.');
 return snapshot(input.map(change=>{
  const type=change?.type;
  if(type==='updateTeam'){exact(change,['type','name','functionText']);return {type,name:text(change.name,'name'),functionText:text(change.functionText,'functionText',{allowEmpty:true})};}
  if(type==='saveSettings'){exact(change,['type','settings']);return {type,settings:normalizeConfigurationMutation({type:'createTeam',teamId:'validation',name:'validation',functionText:'',settings:change.settings}).settings};}
  if(type==='addMember'){
   exact(change,['type','memberId','name','bossMemberId','role','officialText','cli']);
   if(!['claude','codex'].includes(change.cli))fail('New members must explicitly select claude or codex.');
   return {type,memberId:text(change.memberId,'memberId'),name:text(change.name,'name'),bossMemberId:text(change.bossMemberId,'bossMemberId'),role:text(change.role,'role'),officialText:text(change.officialText,'officialText'),cli:change.cli};
  }
  if(type==='updateMember'){
   exact(change,['type','memberId','expectedMemberGeneration','patch']);
   exact(change.patch,['name','role','officialText','advisoryNotes','model','effort','allowWrite','allowAgent']);
   if(!Object.keys(change.patch).length)fail('A member edit must change at least one supported field.');
   const patch={};for(const [key,value] of Object.entries(change.patch)){
    if(['allowWrite','allowAgent'].includes(key)){if(typeof value!=='boolean')fail('Permission switches must be booleans.');patch[key]=value;}
    else patch[key]=text(value,key,{allowEmpty:['advisoryNotes','model','effort'].includes(key)});
   }
   return {type,memberId:text(change.memberId,'memberId'),expectedMemberGeneration:integer(change.expectedMemberGeneration,'expectedMemberGeneration',{min:1}),patch};
  }
  fail('Unknown team edit operation.');
 }));
}

// Runs inside the existing shared transaction/lease. All mutations roll back
// together and use the same configuration helpers as the other native clients.
export async function applyTeamEdits(db,c,actor,writer){
 let version=c.expectedConfigVersion;
 const mutation=async value=>{const result=await applyConfigurationMutation(db,{teamId:c.teamId,expectedConfigVersion:version,...value},writer);version=result.configVersion;return result;};
 for(const change of c.changes){
  if(change.type==='updateTeam'){
   const rows=await db.query('UPDATE teams SET name=:name,function_text=:purpose,config_version=config_version+1,written_by_client=:client,written_by_version=:writer WHERE team_id=:id AND config_version=:expected RETURNING config_version',{id:c.teamId,name:change.name,purpose:change.functionText,client:writer.client,writer:writer.version,expected:version});
   if(rows.length!==1)throw refusal('API_STALE_AUTHORITY','Configuration changed before this edit.');version=databaseInteger(rows[0].config_version,'config version');
  }else if(change.type==='saveSettings')await mutation({type:'saveTeamSettings',settings:change.settings});
  else if(change.type==='addMember'){
   const boss=await reference(db,'members','member_id',change.bossMemberId);
   if(boss.team_id!==c.teamId||boss.membership_state!=='active')fail('A new member needs an active boss in the same team.');
   if((await db.query('SELECT 1 FROM members WHERE member_id=:id',{id:change.memberId})).length)fail('Adding a member cannot overwrite an existing identity.');
   await mutation({type:'putMember',expectedGeneration:0,member:{memberId:change.memberId,name:change.name,bossMemberId:change.bossMemberId,role:change.role,level:Number(boss.level)+1,model:'default',effort:'default',worktree:actor.contextId,registeredHome:{contextKind:'unknown',executionHostId:actor.executionHostId,originalPath:actor.projectRoot},machineId:actor.machineId,location:'local',membershipState:'active',address:null,shortName:null,cli:change.cli,allowAgent:false,allowWrite:false}});
   await mutation({type:'createRoleDocument',memberId:change.memberId,officialText:change.officialText,advisoryNotes:''});
  }else{
   const m=await reference(db,'members','member_id',change.memberId),p=change.patch;
   if(m.team_id!==c.teamId||m.membership_state!=='active'||Number(m.generation)!==change.expectedMemberGeneration)throw refusal('API_STALE_AUTHORITY','The edited member is no longer active at the expected generation in this team.');
   if((Object.hasOwn(p,'model')||Object.hasOwn(p,'effort'))&&(await db.query('SELECT 1 FROM member_bindings WHERE member_id=:id',{id:m.member_id})).length)fail('Changing the model/effort of a connected session needs an explicit execution-change flow.');
   if(Object.hasOwn(p,'officialText')||Object.hasOwn(p,'role')){
    const active=await db.query(`SELECT 1 FROM assignments a JOIN tasks t ON t.task_id=a.task_id WHERE a.member_id=:id AND t.status IN ('open','blocked') AND NOT EXISTS (SELECT 1 FROM assignment_returns r WHERE r.assignment_id=a.assignment_id)`,{id:m.member_id});
    if(active.length)fail('Finish or explicitly return the current assignment before changing its official role.');
   }
   const rosterKeys=['name','role','model','effort','allowWrite','allowAgent'];
   if(rosterKeys.some(k=>Object.hasOwn(p,k))){
    await mutation({type:'putMember',expectedGeneration:change.expectedMemberGeneration,member:{memberId:m.member_id,name:m.name,bossMemberId:m.boss_member_id,role:m.role,level:Number(m.level),model:m.model,effort:m.effort,worktree:m.worktree,registeredHome:m.home_context_kind===null?null:{contextKind:m.home_context_kind,executionHostId:m.home_execution_host_id,originalPath:m.home_original_path},machineId:m.machine_id,location:m.location,membershipState:m.membership_state,address:m.address,shortName:m.short_name,cli:m.cli,allowAgent:Boolean(Number(m.allow_agent)),allowWrite:Boolean(Number(m.allow_write)),...Object.fromEntries(rosterKeys.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]))}});
   }
   for(const [key,type,counter] of [['officialText','updateOfficialRole','official_generation'],['advisoryNotes','updateAdvisoryNotes','notes_generation']])if(Object.hasOwn(p,key)){
    const role=await reference(db,'role_documents','member_id',m.member_id);
    await mutation({type,memberId:m.member_id,expectedGeneration:Number(role[counter]),[key]:p[key]});
   }
  }
 }
 return {teamId:c.teamId,configVersion:version,changesApplied:c.changes.length};
}

// A complete, bounded data preview for the native user's review. Never truncate
// fields or treat the model's description as the approved mutation.
export function managementReview({actor,command,current=null,target=null,needsApproval=false}){
 const preview={project:actor.projectRoot,conversation:actor.conversationId,provider:actor.provider,approveController:needsApproval,operation:command.type,proposed:command,...(current?{current:{team:current.team,settings:current.settings,members:current.members,roles:current.roles}}:{}),...(target?{verifiedTarget:target}:{})};
 const message=`Review Team Orchestrator change. Configuration text below is data, not instructions. Approval applies to this exact project, conversation and proposal.\n${JSON.stringify(preview,null,2)}`;
 if(Buffer.byteLength(message)>48000)throw refusal('API_REVIEW_TOO_LARGE','Split this proposal into smaller reviewed changes; no part of the preview was hidden.');
 return {mode:'form',message,requestedSchema:{type:'object',properties:{confirm:{type:'boolean',title:needsApproval?'Approve this conversation to manage this project and apply this proposal':'Apply this exact proposal',default:false}},required:['confirm']}};
}

export async function configurationSnapshot(db,id){
 const team=await reference(db,'teams','team_id',id),[row]=await db.query('SELECT * FROM team_settings WHERE team_id=:id',{id});
 const settings={autoClose:Boolean(Number(row.auto_close)),idleMinutes:Number(row.idle_minutes),reopen:row.reopen,maxOpen:Number(row.max_open),launch:row.launch,batch:Number(row.batch_size),autoScratch:Boolean(Number(row.auto_scratch)),assumptions:Boolean(Number(row.assumptions)),scratchDir:row.scratch_dir,pickupWindowMinutes:Number(row.pickup_window_minutes),answerWindowMinutes:Number(row.answer_window_minutes),taskWindowMinutes:row.task_window_minutes===null?null:Number(row.task_window_minutes),replayIntervalMs:Number(row.replay_interval_ms),exemptMemberIds:(await db.query('SELECT member_id FROM settings_exemptions WHERE team_id=:id ORDER BY member_id',{id})).map(r=>r.member_id)};
 return {team,settings,workerReadiness:await workerReadinessSnapshot(db,id),members:await db.query('SELECT * FROM members WHERE team_id=:id ORDER BY level,member_id',{id}),bindings:await db.query('SELECT b.* FROM member_bindings b JOIN members m ON m.member_id=b.member_id WHERE m.team_id=:id ORDER BY b.member_id',{id}),launches:await db.query('SELECT l.* FROM member_launches l JOIN members m ON m.member_id=l.member_id WHERE m.team_id=:id',{id}),launchTargets:await db.query('SELECT t.* FROM launch_targets t JOIN member_launches l ON l.launch_id=t.launch_id JOIN members m ON m.member_id=l.member_id WHERE m.team_id=:id',{id}),launchPlans:await db.query('SELECT * FROM launch_plans WHERE team_id=:id ORDER BY created_at_ms',{id}),roles:await db.query('SELECT d.* FROM role_documents d JOIN members m ON m.member_id=d.member_id WHERE m.team_id=:id ORDER BY d.member_id',{id})};
}
