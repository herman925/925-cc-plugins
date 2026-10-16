const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
// Shared native fact/message authentication only. Callers separately verify
// admission or the immutable saved attempt, original start and worker binding.
export function verifiedWorkerReport(fact,message,dispatch,worker){
 const report=parse(fact?.payload),payload=parse(message?.payload);
 if(!fact||!dispatch||!worker||fact.facet!=='worker_report'||fact.dispatch_id!==dispatch.id||fact.task_id!==dispatch.task_id||fact.authority_id!==`run_home:${dispatch.run_id}`||!fact.id.startsWith('worker_report:')||report?.status!=='accepted'||report.reportId!==fact.id||!['succeeded','failed'].includes(report.outcome))return null;
 if(!message||message.id!==fact.id.slice('worker_report:'.length)||message.run_id!==dispatch.run_id||message.type!=='worker_done'||message.from_handle!==dispatch.assignee_handle||message.sender_pane_key!==dispatch.assignee_pane_key||payload?.dispatchId!==dispatch.id||payload.taskId!==dispatch.task_id||payload.outcome!==report.outcome)return null;
 if(dispatch.status!==(report.outcome==='succeeded'?'completed':'failed')||worker.state!==report.outcome)return null;
 return {outcome:report.outcome,result:String(message.body??'').slice(0,16000),evidenceId:fact.id};
}
