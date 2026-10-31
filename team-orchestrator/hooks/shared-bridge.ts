export type SharedProof = { ok: true; root: string; sessionId: string; handle: string; contextId: string } | { ok: false; reason: string }
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
