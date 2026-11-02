// Decisions belong to the task. A retry keeps its unresolved gates.
import {refusal} from './errors.mjs';
import {reference} from './writers.mjs';
import {databaseInteger,nextInteger} from './validation.mjs';
import {enqueueMessage,openAssignmentThread} from './mailbox.mjs';
const fail=(code,message)=>{throw refusal(`API_${code}`,message);};
export const effectiveGateSql="SELECT 1 FROM decision_gates g WHERE g.task_id=:task AND g.status='open' AND NOT EXISTS (SELECT 1 FROM decision_gate_supersessions s WHERE s.old_gate_id=g.gate_id)";
export async function taskGates(db,taskId) {
 return db.query(`SELECT g.*,s.new_gate_id AS superseded_by_gate_id FROM decision_gates g LEFT JOIN decision_gate_supersessions s ON s.old_gate_id=g.gate_id WHERE g.task_id=:task ORDER BY g.gate_id`,{task:taskId});
}
export async function currentTaskHead(db,{teamId,assignmentId,taskId,memberId}) {
 const assignment=assignmentId?await reference(db,'assignments','assignment_id',assignmentId):(await db.query(`SELECT a.* FROM assignments a WHERE a.task_id=:task AND NOT EXISTS (SELECT 1 FROM assignments n WHERE n.previous_assignment_id=a.assignment_id)`,{task:taskId}))[0];
 if(!assignment)fail('ASSIGNMENT_REQUIRED','A decision requires an admitted assignment.');
 const task=await reference(db,'tasks','task_id',assignment.task_id),run=await reference(db,'runs','run_id',task.run_id),report=await reference(db,'members','member_id',assignment.member_id);
 if(run.team_id!==teamId)fail('MEMBER_SCOPE','The decision belongs to another team.');
 if(assignment.assigned_by_member_id!==memberId||report.boss_member_id!==memberId||report.membership_state!=='active')fail('HEAD_REQUIRED','Only the current admitting direct head may record this decision.');
 const [successor]=await db.query('SELECT assignment_id FROM assignments WHERE previous_assignment_id=:id',{id:assignment.assignment_id});
 if(successor)fail('ATTEMPT_SETTLED','This assignment has been superseded.');
 return {assignment,task};
}
export async function applyGateCommand(db,command,member,now) {
 let old;
 if(command.type!=='openGate')old=await reference(db,'decision_gates','gate_id',command.gateId);
 const {assignment,task}=await currentTaskHead(db,{teamId:command.teamId,assignmentId:command.type==='openGate'?command.assignmentId:undefined,taskId:old?.task_id,memberId:member.member_id});
 if(!['open','blocked'].includes(task.status))fail('ATTEMPT_SETTLED','A terminal task cannot accept a gate.');
 if(command.type==='openGate') {
  const attempt=await reference(db,'assignment_attempts','assignment_id',assignment.assignment_id);
  if(databaseInteger(attempt.generation,'attempt generation')!==command.expectedAttemptGeneration)fail('STALE_AUTHORITY','Inspect the current attempt before opening a gate.');
  const [returned]=await db.query('SELECT assignment_id FROM assignment_returns WHERE assignment_id=:id',{id:assignment.assignment_id});
  if(returned)fail('RETURN_REQUIRED','Reassign the returned attempt before opening another gate.');
 } else {
  if(databaseInteger(old.generation,'gate generation')!==command.expectedGateGeneration)fail('STALE_AUTHORITY','Inspect the current gate before deciding it.');
  const [superseded]=await db.query('SELECT old_gate_id FROM decision_gate_supersessions WHERE old_gate_id=:id',{id:old.gate_id});
  if(old.status!=='open'||superseded)fail('GATE_SETTLED','This gate has already been answered or superseded.');
 }
 if(command.type==='resolveGate') {
  let options;try{options=JSON.parse(old.options_json);}catch{}
  if(!Array.isArray(options)||options.length<2||options.some(x=>typeof x!=='string'||!x.length)||new Set(options).size!==options.length)fail('GATE_OPTIONS_INVALID','This older gate needs a replacement with explicit offered options.');
  if(!options.includes(command.choice))fail('GATE_CHOICE_INVALID','Choose an offered option or create a replacement gate.');
  const changed=await db.query(`UPDATE decision_gates SET status='resolved',resolution_json=:resolution,resolved_at_ms=:now,generation=:next WHERE gate_id=:id AND status='open' AND generation=:expected RETURNING gate_id`,{id:old.gate_id,resolution:JSON.stringify({choice:command.choice,note:command.note}),now,next:nextInteger(command.expectedGateGeneration,'gate generation'),expected:command.expectedGateGeneration});
  if(changed.length!==1)fail('STALE_AUTHORITY','Another answer already won this gate transition.');
  const [remaining]=await db.query(effectiveGateSql,{task:task.task_id});
  const [returned]=await db.query('SELECT assignment_id FROM assignment_returns WHERE assignment_id=:id',{id:assignment.assignment_id});
  const valid=!returned&&(assignment.pickup_observed_at_ms===null?now<databaseInteger(assignment.pickup_deadline_ms,'pickup deadline'):assignment.task_deadline_ms===null||now<databaseInteger(assignment.task_deadline_ms,'task deadline')||(await reference(db,'assignment_attempts','assignment_id',assignment.assignment_id)).outcome!==null);
  const resumed=!remaining&&valid;
  if(resumed)await db.query("UPDATE tasks SET status='open' WHERE task_id=:id AND status='blocked'",{id:task.task_id});
  const gates=await taskGates(db,task.task_id);
  let delivery;
  const attempt=await reference(db,'assignment_attempts','assignment_id',assignment.assignment_id);
  if(resumed&&attempt.outcome===null) {
   const [thread]=await db.query("SELECT thread_id FROM threads WHERE assignment_id=:id AND status='open'",{id:assignment.assignment_id});
   const threadId=thread?.thread_id??await openAssignmentThread(db,{assignmentId:assignment.assignment_id,taskId:task.task_id,runId:task.run_id,teamId:command.teamId,headId:member.member_id,memberId:assignment.member_id,eventId:`gate:${old.gate_id}`});
   delivery=await enqueueMessage(db,{eventId:`gate-resume:${old.gate_id}`,runId:task.run_id,teamId:command.teamId,threadId,senderId:member.member_id,recipientId:assignment.member_id,body:JSON.stringify({event:'task_resumed',assignmentId:assignment.assignment_id,taskId:task.task_id,decisions:gates.filter(g=>g.status==='resolved'&&!g.superseded_by_gate_id).map(g=>({question:g.question,resolution:g.resolution_json}))}),kind:'status',now});
  }
  return {gateId:old.gate_id,gateGeneration:command.expectedGateGeneration+1,assignmentId:assignment.assignment_id,resumed,gates,...(delivery?{delivery}:{})};
 }
 const id=command.type==='openGate'?command.gateId:command.newGateId;
 await db.query('INSERT INTO decision_gates (gate_id,task_id,question,options_json) VALUES (:id,:task,:question,:options)',{id,task:task.task_id,question:command.question,options:JSON.stringify(command.options)});
 if(old)await db.query('INSERT INTO decision_gate_supersessions (old_gate_id,new_gate_id,task_id,created_by_member_id,created_at_ms) VALUES (:old,:id,:task,:head,:now)',{old:old.gate_id,id,task:task.task_id,head:member.member_id,now});
 await db.query("UPDATE tasks SET status='blocked' WHERE task_id=:id",{id:task.task_id});
 return {gateId:id,gateGeneration:1,assignmentId:assignment.assignment_id,resumed:false,gates:await taskGates(db,task.task_id)};
}
