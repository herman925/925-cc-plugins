export type SharedProof = { ok: true; root: string; sessionId: string; handle: string; contextId: string } | { ok: false; reason: string }
// Stale member identity must not prevent inspecting an independently approved
// controller. Recovery deliberately carries no member or binding authority.
export async function inspectSharedCaller($:any,proof:SharedProof,options:{node:string;orca:string}){
 const request=(type:string)=>sharedCall($,proof,{operationId:`inspect-${Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}`,command:{type}},options)
 const caller=await request('inspectCaller')
 if(caller.ok||caller.error?.code!=='API_STALE_BINDING')return caller
 const controller=await request('inspectController')
 if(!controller.ok)return controller
 const current=controller.result?.result
 return {ok:true,result:{...controller.result,result:{controllerGeneration:current?.controllerGeneration??null,controllerRevoked:current?.controllerRevoked===true,teams:Array.isArray(current?.teams)?current.teams:[],member:null,binding:null,recovery:{code:'API_STALE_BINDING'}}}}
}
// Called only from the native panel's Apply/retry button, never model arguments.
export async function sharedReviewedEdit($:any,proof:SharedProof,request:any,options:{node:string;orca:string}){
 if(!proof.ok)return {ok:false,error:{code:'API_NATIVE_UNVERIFIED',message:proof.reason}}
 if(request?.command?.type!=='editTeam'||JSON.stringify(request).length>12000)throw Error('This team edit is too large for one review. Shorten the purpose or split the change.')
 const config=String((await $.env.get('CLAUDE_CONFIG_DIR').catch(()=>''))??'')||`${String((await $.env.get('USERPROFILE').catch(()=>''))??'')||String((await $.env.get('HOME').catch(()=>''))??'')}/.claude`
 if(config==='/.claude')throw Error('The local configuration folder could not be verified.')
 const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')
 await $.fs.write(`${config}/team-orchestrator/controller-actions/${id}.json`,JSON.stringify({action:'editTeam',id,createdAt:Date.now(),projectRoot:proof.root,conversationId:proof.sessionId,terminalHandle:proof.handle,contextId:proof.contextId,request}))
 return sharedCall($,proof,request,{...options,mode:'manageTeam',uiApprovalId:id})
}
export async function sharedCall($:any, proof:SharedProof, request:any, options:{node:string;orca:string;mode?:string;uiApprovalId?:string}) {
 if(!proof.ok)return {ok:false,error:{code:'API_NATIVE_UNVERIFIED',message:proof.reason}}
 const envelope={mode:options.mode??'execute',proof:{projectRoot:proof.root,conversationId:proof.sessionId,terminalHandle:proof.handle,contextId:proof.contextId},request,orcaCommand:options.orca,...(options.uiApprovalId?{uiApprovalId:options.uiApprovalId}:{})}
 const result=await $.process.run([options.node,`${$.plugin.root}/store/mod-bridge.mjs`],{stdin:JSON.stringify(envelope),timeoutMs:30000}).catch(()=>undefined)
 if(!result)return {ok:false,error:{code:'API_BRIDGE_UNKNOWN',message:'The shared store adapter did not answer. Preserve the operation id and reconcile; do not repeat external effects.'}}
 try{
  const value=JSON.parse(String(result.stdout).trim())
  if(typeof value.ok!=='boolean' || (value.ok && result.exitCode!==0))throw Error()
  return value
 }catch{return {ok:false,error:{code:'API_BRIDGE_UNKNOWN',message:'The shared store adapter returned no confirmed receipt. Reconcile the same operation id.'}}}
}
