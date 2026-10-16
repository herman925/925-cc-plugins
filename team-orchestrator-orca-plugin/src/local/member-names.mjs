import {terminalIdentity} from './terminal-identity.mjs';
import {controlRuntime} from './runtime-control.mjs';

// Display-only operation. Never infer a provider conversation ID from its title.
// Native terminal.show.title is an OSC title, not the renderer's custom title.
export async function nameDispatchedMember({store,rpc,consent,work,attempt,team}) {
 const binding=attempt?.binding;
 // Prepared and retained sessions already keep their original custom title.
 if(binding?.kind!=='terminal'||attempt.reuse||attempt.sidebarNaming||attempt.admission!=='committed')return;
 const member=team.members.find(row=>row.id===attempt.memberId);
 if(!member||store.readMemberDispatch(member.id)?.id!==attempt.id||store.readMemberOperation(member.id))return;
 const current=()=>{
  const saved=store.readMemberDispatch(member.id),active=store.readCurrentWork(work.id);
  return saved?.id===attempt.id&&saved.version===attempt.version&&!store.readMemberOperation(member.id)&&active?.status!=='completed'&&active?.version===work.version&&controlRuntime(active)===controlRuntime(work);
 };
 try {
  await consent();
  if((await rpc('status.get'))?.runtimeId!==controlRuntime(work))return;
  const shown=(await rpc('terminal.show',{terminal:binding.handle}))?.terminal;
  if(shown?.handle!==binding.handle||shown.worktreeId!==binding.workspaceId||shown.executionHostId!==binding.executionHostId||`${shown.tabId}:${shown.leafId}`!==binding.paneKey||terminalIdentity(shown).processIncarnation!==binding.incarnationId||shown.agentIdentity!==member.agent||shown.connected!==true||shown.writable!==true||!current())return;
  const title=`${team.name}/${member.name}`,at=new Date().toISOString();
  // Persist before the effect: a lost response or restart never repeats rename
  // and overwrites a subsequent manual user title.
  attempt=store.recordDispatchName(attempt.id,attempt.version,{title,outcome:'attempted',at});
  let naming;
  try {
   const receipt=(await rpc('terminal.rename',{terminal:binding.handle,title}))?.rename;
   if(receipt?.handle!==binding.handle||receipt.tabId!==shown.tabId||receipt.title!==title)throw Error('Native sidebar rename was not confirmed.');
   naming={title,outcome:'confirmed',at};
  }catch(error){naming={title,outcome:'unconfirmed',at,detail:String(error.message).slice(0,1200)};}
  store.recordDispatchName(attempt.id,attempt.version,naming);
 }catch{/* Naming failure never changes task admission, execution or acceptance. */}
}
