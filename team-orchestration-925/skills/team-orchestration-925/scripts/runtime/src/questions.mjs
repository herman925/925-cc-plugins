import {reference} from './writers.mjs';
import {byteOrder} from './configuration.mjs';
import {databaseInteger,integer,nextInteger} from './validation.mjs';
import {refusal} from './errors.mjs';
import {enqueueMessage} from './mailbox.mjs';
const fail=(code,message)=>{throw refusal(`API_${code}`,message);};

export async function questionAccess(db,teamId,threadId,memberId) {
 const thread=await reference(db,'threads','thread_id',threadId);
 if(thread.team_id!==teamId||thread.thread_kind!=='question'||![thread.endpoint_a_member_id,thread.endpoint_b_member_id].includes(memberId))fail('QUESTION_SCOPE','Only this question’s endpoints may read or answer it.');
 const [question]=await db.query("SELECT * FROM messages WHERE thread_id=:id AND kind='question'",{id:threadId});
 if(!question)fail('QUESTION_SCOPE','Question content is missing.');
 return {thread,question};
}
export async function askQuestion(db,command,member,now) {
 const recipient=await reference(db,'members','member_id',command.recipientMemberId);
 if(recipient.team_id!==command.teamId||recipient.membership_state!=='active'||!(recipient.boss_member_id===member.member_id||member.boss_member_id===recipient.member_id))fail('DIRECT_REPORT_REQUIRED','Questions follow the current direct head/report relationship. Relay through your own head.');
 let taskId=null,assignmentId=null,runId=command.runId;
 if(command.assignmentId!==null){
  const a=await reference(db,'assignments','assignment_id',command.assignmentId),task=await reference(db,'tasks','task_id',a.task_id);
  const [returned]=await db.query('SELECT 1 FROM assignment_returns WHERE assignment_id=:id',{id:a.assignment_id});
  if(![member.member_id,recipient.member_id].includes(a.member_id)||![member.member_id,recipient.member_id].includes(a.assigned_by_member_id)||returned||!['open','blocked'].includes(task.status))fail('QUESTION_SCOPE','Only the current task endpoints may ask about an active attempt.');
  taskId=a.task_id;assignmentId=a.assignment_id;runId=task.run_id;
 }else await db.query('INSERT INTO runs (run_id,consumer_generation,team_id) VALUES (:id,1,:team)',{id:runId,team:command.teamId});
 const [settings]=await db.query('SELECT answer_window_minutes FROM team_settings WHERE team_id=:id',{id:command.teamId});
 const [a,b]=byteOrder([member.member_id,recipient.member_id]);
 await db.query(`INSERT INTO threads (thread_id,run_id,status,generation,thread_kind,answer_window_minutes,task_id,assignment_id,endpoint_a_member_id,endpoint_b_member_id,team_id)
  VALUES (:id,:run,'open',1,'question',:window,:task,:assignment,:a,:b,:team)`,{id:command.threadId,run:runId,window:settings.answer_window_minutes,task:taskId,assignment:assignmentId,a,b,team:command.teamId});
 return enqueueMessage(db,{eventId:`question:${command.threadId}`,runId,teamId:command.teamId,threadId:command.threadId,senderId:member.member_id,recipientId:recipient.member_id,body:command.question,kind:'question',now});
}
export async function startQuestionWindow(db,message,now) {
 if(message.kind!=='question')return;
 const thread=await reference(db,'threads','thread_id',message.thread_id);
 if(thread.thread_kind!=='question'||thread.status!=='open')fail('QUESTION_SETTLED','This question has ended.');
 if(thread.question_delivered_at_ms!==null)return;
 const deadline=integer(now+databaseInteger(thread.answer_window_minutes,'answer window')*60000,'answer deadline');
 await db.query('UPDATE threads SET question_delivered_at_ms=:now,answer_deadline_ms=:deadline WHERE thread_id=:id AND question_delivered_at_ms IS NULL',{now,deadline,id:thread.thread_id});
}
async function notice(db,thread,question,event,now,answer,observerId) {
 await db.query("UPDATE deliveries SET status='fenced',generation=generation+1 WHERE status='outstanding' AND message_id IN (SELECT message_id FROM messages WHERE thread_id=:id)",{id:thread.thread_id});
 const recipients=new Set([question.sender_member_id]);
 if(event==='question_expired'){
  const sender=await reference(db,'members','member_id',question.sender_member_id);
  recipients.add(sender.boss_member_id??sender.member_id);
 }
 if(event==='question_expired'){
  for(const recipientId of recipients)await db.query('INSERT INTO deadline_notices (notice_id,team_id,recipient_member_id,event_json,created_at_ms) VALUES (:id,:team,:recipient,:event,:now)',{id:`question-expired:${thread.thread_id}:${recipientId}`,team:thread.team_id,recipient:recipientId,event:JSON.stringify({event,threadId:thread.thread_id,question:question.body,observedByMemberId:observerId}),now});
  return;
 }
 for(const recipientId of recipients)await enqueueMessage(db,{eventId:`${event}:${thread.thread_id}:${recipientId}`,runId:thread.run_id,teamId:thread.team_id,threadId:thread.thread_id,senderId:observerId??question.recipient_member_id,recipientId,kind:'status',body:JSON.stringify({event,threadId:thread.thread_id,...(answer!==undefined?{answer}:{})}),now});
}
export async function answerQuestion(db,command,member,now) {
 const {thread,question}=await questionAccess(db,command.teamId,command.threadId,member.member_id);
 if(question.recipient_member_id!==member.member_id)fail('QUESTION_RECIPIENT_REQUIRED','Only the addressed recipient may answer.');
 if(thread.status!=='open'||thread.question_delivered_at_ms===null||now>=databaseInteger(thread.answer_deadline_ms,'answer deadline'))fail('QUESTION_SETTLED','Read the question first; a question past its answer window cannot be answered.');
 const recipient=await reference(db,'members','member_id',question.sender_member_id);
 if(!(recipient.boss_member_id===member.member_id||member.boss_member_id===recipient.member_id))fail('QUESTION_SCOPE','The head/report relationship changed.');
 const changed=await db.query("UPDATE threads SET status='answered',answer=:answer,generation=:next WHERE thread_id=:id AND status='open' AND generation=:expected RETURNING thread_id",{id:thread.thread_id,answer:command.answer,expected:command.expectedThreadGeneration,next:nextInteger(command.expectedThreadGeneration,'thread generation')});
 if(changed.length!==1)fail('STALE_AUTHORITY','Another question transition already won.');
 await notice(db,thread,question,'question_answered',now,command.answer);
 return {threadId:thread.thread_id,status:'answered',generation:command.expectedThreadGeneration+1};
}
export async function expireQuestions(db,teamId,now,observerId) {
 const threads=await db.query("SELECT * FROM threads WHERE team_id=:team AND thread_kind='question' AND status='open' AND answer_deadline_ms<=:now ORDER BY answer_deadline_ms,thread_id",{team:teamId,now});
 const expired=[];
 for(const thread of threads){
  const changed=await db.query("UPDATE threads SET status='fenced',generation=generation+1 WHERE thread_id=:id AND status='open' AND generation=:expected RETURNING thread_id",{id:thread.thread_id,expected:thread.generation});
  if(changed.length!==1)continue;
  const [question]=await db.query("SELECT * FROM messages WHERE thread_id=:id AND kind='question'",{id:thread.thread_id});
  await notice(db,thread,question,'question_expired',now,undefined,observerId);expired.push(thread.thread_id);
 }
 return {expiredQuestions:expired};
}
