import {join} from 'node:path';
import {withNativeRuntime} from './native-runtime.mjs';
import {matchesTerminalObservation,terminalIdentity} from './terminal-identity.mjs';
import {createTerminalContextReader} from './terminal-context.mjs';
import {claudeContextDirectory} from './claude-context.mjs';
import {STORE,identityEntry,writeGuardIdentity} from './guard-identity.mjs';
import {guardFilesPresent} from './guard.mjs';

const text=v=>typeof v==='string'&&v.trim()&&v.length<=200?v:null;
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function contextUsage(value){
 const used=value?.used;
 if(used?.kind==='report'&&finite(used.usedTokens)&&finite(used.windowTokens)&&used.windowTokens>0)return {used:used.usedTokens,limit:used.windowTokens,percent:100*used.usedTokens/used.windowTokens,estimated:false,capturedAt:used.capturedAt};
 const u=used?.usage,limit=value?.window?.tokens;
 if(used?.kind==='estimate'&&finite(limit)&&limit>0&&u&&['inputTokens','cacheCreationInputTokens','cacheReadInputTokens'].every(k=>finite(u[k]))){const tokens=u.inputTokens+u.cacheCreationInputTokens+u.cacheReadInputTokens;return {used:tokens,limit,percent:100*tokens/limit,estimated:true,capturedAt:used.capturedAt};}
 return null;
}
async function pendingRequests(rpc,page){
 const marker=page.currentRequests;if(!marker?.version)return null;
 let cursor=0,body='';
 for(let n=0;n<8;n++){
  const piece=await rpc('agentSession.currentRequests',{sessionId:page.sessionId,version:marker.version,cursor});
  if(piece?.restart||['version','owner','epoch','sessionId','publisher'].some(k=>piece?.marker?.[k]!==marker[k])||typeof piece.json!=='string')throw Error('Question state changed during observation.');
  body+=piece.json;if(body.length>262144)throw Error('Question snapshot exceeds the observation limit.');
  if(piece.nextCursor===null){const rows=JSON.parse(body);if(!Array.isArray(rows))throw Error('Invalid question snapshot.');if(!rows.every(r=>['approval','question'].includes(r.body?.kind)&&r.body?.resolution?.state==='pending'))throw Error('Invalid pending-question snapshot.');return rows.length>0;}
  if(!Number.isSafeInteger(piece.nextCursor)||piece.nextCursor<=cursor)throw Error('Invalid question cursor.');cursor=piece.nextCursor;
 }
 throw Error('Question snapshot is incomplete.');
}
export function createRosterStatusService({store,rpc,consent,userData,claudeContext,projectRoot,log=()=>{}}){
 let inFlight;
 const terminalContext=createTerminalContextReader();
 // Row 77: presence means the wrapper and its script are both there, because a config entry alone fails open.
 async function presence(root){
  const files=await guardFilesPresent(join(root,STORE,'guard')).catch(()=>({present:false}));
  return files.present?{installed:true}:{installed:false,reason:'The team store guard is not installed, so a member cannot change its own notes.'};
 }
 async function read(){
  await consent();const snapshot=store.readSnapshot(),status=await rpc('status.get');
  if(!status?.runtimeId)throw Error('Runtime status is unavailable.');
  const output={observedAt:new Date().toISOString(),members:{}},snapshots=new Map();
  const statuslineEnabled=await claudeContext?.status().then(s=>s.enabled).catch(()=>false)??false;
  const jobs=snapshot.teams.flatMap(team=>team.members.map(member=>({team,member})));let index=0;
  // Every verified provider session this pass, and nothing carried over from an earlier pass.
  const identities=[];
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(index<jobs.length){const {team,member}=jobs[index++];output.members[member.id]=await observe(team,member,status.runtimeId,snapshots,statuslineEnabled,identities);}}));
  // Written only after the whole pass, and it replaces the file: a member with no verified session loses its entry.
  // A guard that cannot be written is reported, never thrown: the roster stays readable, and its absence is the safe state.
  const root=typeof projectRoot==='function'?projectRoot():projectRoot;
  if(root){
   try{const result=await writeGuardIdentity(root,identities);output.guard=result.written?await presence(root):{installed:false,reason:result.reason};}
   catch(error){log(`The team store guard identity was not written: ${error.message}`);output.guard={installed:false,reason:String(error.message).slice(0,200)};}
  }
  return output;
 }
 async function observe(team,member,runtimeId,snapshots,statuslineEnabled,identities){
  const operation=store.readMemberOperation(member.id),attempt=store.readMemberDispatch(member.id);
  const binding=operation?.status==='created'?operation:attempt?.binding?{...attempt.binding,scope:attempt.scope,sessionId:attempt.binding.liveSessionId??attempt.binding.sessionId,paneKey:attempt.binding.paneKey,observation:{processIncarnation:attempt.binding.incarnationId},nativeRequest:{agent:attempt.reuse?.preferences?.agent??attempt.startParams?.agent??member.agent,sessionOptions:{model:attempt.reuse?.preferences?.model??attempt.startParams?.model??member.model,effort:attempt.reuse?.preferences?.effort??attempt.startParams?.effort??member.effort}}}:null;
  const row={state:operation?.status==='unknown'?'unknown':binding?'unknown':team.launch?.members?.[member.id]?'offline':'not-started',agent:binding?.nativeRequest?.agent??member.agent,model:null,effort:null,context:null,requestedModel:binding?.nativeRequest?.sessionOptions?.model??member.model,requestedEffort:binding?.nativeRequest?.sessionOptions?.effort??member.effort,observedAt:new Date().toISOString()};
  if(!binding)return row;
  try{return await withNativeRuntime(rpc,runtimeId,async()=>{
   await consent();const scope=store.readScope(team.id);let generation;
   const host=async()=>{if(scope.executionHostId==='local')return null;const targetId=decodeURIComponent(scope.executionHostId.slice(4)),state=(await rpc('ssh.getState',{targetId}))?.state;if(state?.status!=='connected')throw Error('Execution host is disconnected.');return state.connectionGeneration;};
   generation=await host();
   const workspace=(await rpc('worktree.show',{worktree:scope.workspaceId.startsWith('folder:')?scope.workspaceId:`id:${scope.workspaceId}`}))?.worktree;if(workspace?.id!==scope.workspaceId||(workspace.hostId??workspace.identity?.executionHostId)!==scope.executionHostId)throw Error('Member project or execution host changed.');
   if(binding.kind==='terminal'){
    const shown=(await rpc('terminal.show',{terminal:binding.handle}))?.terminal;
    if(shown?.handle!==binding.handle||shown.worktreeId!==scope.workspaceId||shown.executionHostId!==scope.executionHostId||`${shown.tabId}:${shown.leafId}`!==binding.paneKey||!matchesTerminalObservation(shown,binding.observation))throw Error('Member session identity is unverified.');
    const expected=terminalIdentity(shown),activity=(await rpc('terminal.agentStatus',{terminal:binding.handle}))?.agentStatus;
    if(activity?.handle!==binding.handle||!shown.connected||activity.isRunningAgent&&shown.agentIdentity!==row.agent)throw Error('Member session is unavailable.');
    row.state=activity.isRunningAgent===false?'offline':activity.status==='working'?'working':activity.status==='permission'?'asking':activity.status==='idle'?'idle':'unknown';
    if(activity.isRunningAgent){try{row.context=await terminalContext({rpc,shown,agent:row.agent,scope,snapshots,contextDirectory:claudeContextDirectory(userData),statuslineEnabled,onProvider:provider=>{try{identities.push(identityEntry(team,member,provider.sessionId));}catch{log(`Member ${member.id} of team ${team.id} has no valid role-file identity, so the team store guard does not certify it.`);}}});}catch{row.context=null;}}
    const final=(await rpc('terminal.show',{terminal:binding.handle}))?.terminal;if(!matchesTerminalObservation(final,expected)||final.handle!==binding.handle)throw Error('Member session changed during observation.');
   }else{
    const address=(await rpc('orchestration.sessionAddress',{sessionId:binding.sessionId}))?.orcaSessionId,location=address&&(await rpc('orchestration.partyLocation',{address}))?.location;
    if(!address?.startsWith('orca_session_id:')||location?.sessionId!==binding.sessionId||location.kind!=='chat'||location.worktreeId!==scope.workspaceId)throw Error('Member session location is unverified.');
    const owner=await rpc('agentSession.handoffStatus',{sessionId:binding.sessionId});
    if(owner?.owner==='none'&&owner.phase==='idle'&&!owner.stage){row.state='closed';return row;}
    if(owner?.owner!=='native'||owner.phase!=='idle'||owner.stage)throw Error('Native session ownership is unavailable or changing.');
    const result=await rpc('agentSession.history',{sessionId:binding.sessionId,direction:'tail',limit:1}),page=result?.page;
    if(result.ok!==true||page?.sessionId!==binding.sessionId||!Number.isSafeInteger(page.fence)||page.fence<1)throw Error('Member session owner is unverified.');
    let asking=null;try{asking=await pendingRequests(rpc,page);}catch{}
    const turn=page.latestTurn?.turn?.state;
    row.state=page.currentRequests&&asking===null?'unknown':asking===true?'asking':turn==='running'?'working':['completed','interrupted','failed'].includes(turn)&&asking===false?'idle':'unknown';
    try{const options=await rpc('agentSession.options',{sessionId:binding.sessionId});const current=options?.current,confirmed=Array.isArray(current?.confirmed)?current.confirmed:[];
     row.model=confirmed.includes('model')?text(current.model):null;row.effort=confirmed.includes('effort')?text(current.effort):null;
     row.sessionModel=text(current?.model);row.sessionEffort=text(current?.effort);
     row.context=contextUsage(options?.contextUsage?.current??page.latestTurn?.turn?.contextUsage);
    }catch{row.context=contextUsage(page.latestTurn?.turn?.contextUsage);}
    const final=await rpc('agentSession.history',{sessionId:binding.sessionId,direction:'tail',limit:1});if(final?.ok!==true||final.page?.sessionId!==binding.sessionId||final.page.fence!==page.fence||final.page.epoch!==page.epoch)throw Error('Member session owner changed during observation.');
    const finalOwner=await rpc('agentSession.handoffStatus',{sessionId:binding.sessionId});if(finalOwner?.owner!=='native'||finalOwner.phase!=='idle'||finalOwner.stage)throw Error('Native session ownership changed.');
   }
   if(await host()!==generation||(await rpc('status.get'))?.runtimeId!==runtimeId)throw Error('Execution host changed during observation.');
   const current=store.readMemberOperation(member.id),dispatch=store.readMemberDispatch(member.id);
   if(operation?current?.requestId!==operation.requestId:dispatch?.id!==attempt?.id)throw Error('Member binding changed during observation.');
   row.sessionRequestId=operation?.requestId??attempt.id;row.kind=binding.kind;return row;
  });}catch(error){return {...row,state:'unknown',model:null,effort:null,context:null,sessionModel:null,sessionEffort:null,detail:String(error.message).slice(0,350)};}
 }
 return {read(){if(!inFlight)inFlight=read().finally(()=>{inFlight=null;});return inFlight;}};
}
