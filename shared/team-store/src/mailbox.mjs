// Durable messages are created in the same transaction as the lifecycle event.
// Transport runs after commit. A wake-up is never evidence of recipient read.
import {createHash} from 'node:crypto';
import {byteOrder} from './configuration.mjs';
import {databaseInteger,integer,nextInteger} from './validation.mjs';
import {startQuestionWindow} from './questions.mjs';
import {refusal} from './errors.mjs';

const identity=(kind,id)=>`${kind}-${createHash('sha256').update(id).digest('hex')}`;
export const assignmentThreadId=id=>identity('assignment-thread',id);

export async function inspectInbox(db,teamId,recipientId) {
 // Recipient order is stable across different senders and process restarts.
 // Terminal threads and old consumer generations cannot resurrect mail.
 return db.query(`SELECT m.*,d.status AS delivery_status,d.generation AS delivery_generation,d.replay_count,d.last_replayed_at_ms,
  t.status AS thread_status,t.assignment_id FROM messages m
  JOIN deliveries d ON d.message_id=m.message_id JOIN threads t ON t.thread_id=m.thread_id JOIN runs r ON r.run_id=d.run_id
  WHERE m.team_id=:team AND m.recipient_member_id=:recipient AND d.status='outstanding'
   AND d.consumer_generation=r.consumer_generation AND (t.status='open' OR (t.thread_kind='question' AND m.kind='status'))
  ORDER BY m.created_at_ms,m.message_id LIMIT 1`,{team:teamId,recipient:recipientId});
}

export async function readOwnInbox(db,{teamId,memberId,deliveryId,expectedDeliveryGeneration,now}) {
 const [message]=await inspectInbox(db,teamId,memberId);
 if(!message || message.delivery_id!==deliveryId)throw refusal('API_INBOX_ORDER','Only the oldest outstanding delivery addressed to this member can be read. Inspect the inbox again.');
 if(databaseInteger(message.delivery_generation,'delivery generation')!==expectedDeliveryGeneration)throw refusal('API_STALE_AUTHORITY','Delivery generation changed; inspect before a new read operation.');
 const generation=nextInteger(expectedDeliveryGeneration,'delivery generation');
 const changed=await db.query(`UPDATE deliveries SET status='acknowledged',generation=:next
  WHERE delivery_id=:id AND status='outstanding' AND generation=:expected RETURNING delivery_id`,{id:deliveryId,next:generation,expected:expectedDeliveryGeneration});
 if(!changed.length)throw refusal('API_STALE_AUTHORITY','Delivery was already decided.');
 await startQuestionWindow(db,message,now);
 return {message:{...message,delivery_status:'acknowledged',delivery_generation:generation},deliveryId,deliveryGeneration:generation,acknowledged:true};
}

export async function prepareDeliveries(db,{teamId,member,now}) {
 const [settings]=await db.query('SELECT replay_interval_ms FROM team_settings WHERE team_id=:team',{team:teamId});
 const interval=databaseInteger(settings.replay_interval_ms,'replay interval');
 const recipients=await db.query(`SELECT member_id FROM members WHERE team_id=:team AND membership_state='active' ORDER BY member_id`,{team:teamId});
 const claims=[];
 for(const recipient of recipients) {
  const [message]=await inspectInbox(db,teamId,recipient.member_id);
  if(!message || (member.boss_member_id!==null && message.sender_member_id!==member.member_id))continue;
  if(message.last_replayed_at_ms!==null && now-databaseInteger(message.last_replayed_at_ms,'last replay')<interval)continue;
  const [binding]=await db.query('SELECT * FROM member_bindings WHERE member_id=:id',{id:recipient.member_id});
  if(!binding)continue; // Undeliverable mail remains queued; nobody is evicted.
  const count=nextInteger(databaseInteger(message.replay_count,'replay count'),'replay count');
  const generation=nextInteger(databaseInteger(message.delivery_generation,'delivery generation'),'delivery generation');
  const changed=await db.query(`UPDATE deliveries SET replay_count=:count,last_replayed_at_ms=:now,generation=:next
   WHERE delivery_id=:id AND status='outstanding' AND generation=:expected RETURNING delivery_id`,
   {count,now,next:generation,id:message.delivery_id,expected:databaseInteger(message.delivery_generation,'delivery generation')});
  if(changed.length)claims.push({deliveryId:message.delivery_id,messageId:message.message_id,threadId:message.thread_id,replay:count>1,recipient:binding});
 }
 const notices=await db.query(`SELECT n.* FROM deadline_notices n WHERE n.team_id=:team AND n.read_at_ms IS NULL
  AND (n.last_notified_at_ms IS NULL OR n.last_notified_at_ms<=:cutoff) ORDER BY n.created_at_ms,n.notice_id`,{team:teamId,cutoff:now-interval});
 for(const n of notices){
  const [binding]=await db.query('SELECT * FROM member_bindings WHERE member_id=:id',{id:n.recipient_member_id});
  if(!binding)continue;
  await db.query('UPDATE deadline_notices SET last_notified_at_ms=:now WHERE notice_id=:id',{id:n.notice_id,now});
  claims.push({noticeId:n.notice_id,recipient:binding});
 }
 return {deliveries:claims};
}

export async function openAssignmentThread(db,{assignmentId,taskId,runId,teamId,headId,memberId,eventId=assignmentId}) {
 const [a,b]=byteOrder([headId,memberId]);
 const id=assignmentThreadId(eventId);
 await db.query(`INSERT INTO threads (thread_id,run_id,status,generation,answer,task_id,endpoint_a_member_id,endpoint_b_member_id,team_id,assignment_id)
  VALUES (:id,:run,'open',1,NULL,:task,:a,:b,:team,:assignment)`,{id,run:runId,task:taskId,a,b,team:teamId,assignment:assignmentId});
 return id;
}

export async function enqueueMessage(db,{eventId,runId,teamId,threadId,senderId,recipientId,body,kind,now}) {
 const messageId=identity('message',eventId),deliveryId=identity('delivery',eventId);
 // Preserve admission order even for events committed within one clock tick.
 const [latest]=await db.query('SELECT MAX(created_at_ms) AS newest FROM messages WHERE team_id=:team',{team:teamId});
 const createdAtMs=latest.newest===null?now:Math.max(now,nextInteger(databaseInteger(latest.newest,'message timestamp'),'message timestamp'));
 integer(createdAtMs,'message timestamp');
 await db.query(`INSERT INTO deliveries (delivery_id,run_id,consumer_generation,status,generation,team_id,message_id)
  SELECT :delivery,run_id,consumer_generation,'outstanding',1,:team,:message FROM runs WHERE run_id=:run`,{delivery:deliveryId,run:runId,team:teamId,message:messageId});
 await db.query(`INSERT INTO messages (message_id,delivery_id,team_id,thread_id,sender_member_id,recipient_member_id,body,kind,created_at_ms)
  VALUES (:message,:delivery,:team,:thread,:sender,:recipient,:body,:kind,:now)`,{message:messageId,delivery:deliveryId,team:teamId,thread:threadId,sender:senderId,recipient:recipientId,body,kind,now:createdAtMs});
 return {messageId,deliveryId,threadId};
}

export async function settleAssignmentThread(db,assignmentId,decision,reason) {
 const threads=await db.query('SELECT * FROM threads WHERE assignment_id=:id',{id:assignmentId});
 // Older admitted assignments predate the mailbox. Do not fabricate history.
 for(const thread of threads) {
 if(thread.status!=='open')continue;
 const id=thread.thread_id;
 const generation=nextInteger(databaseInteger(thread.generation,'thread generation'),'thread generation');
 await db.query(`UPDATE threads SET status=:status,answer=:answer,generation=:generation
  WHERE thread_id=:id AND status='open'`,{id,status:decision==='accepted'?'answered':'fenced',answer:decision==='accepted'?reason:null,generation});
 }
 await db.query(`UPDATE deliveries SET status='fenced',generation=generation+1 WHERE status='outstanding'
  AND message_id IN (SELECT m.message_id FROM messages m JOIN threads t ON t.thread_id=m.thread_id WHERE t.assignment_id=:id)`,{id:assignmentId});
}

export async function expirePickups(db,teamId,now) {
 const expired=await db.query(`SELECT a.*,t.run_id FROM assignments a JOIN tasks t ON t.task_id=a.task_id JOIN assignment_attempts x ON x.assignment_id=a.assignment_id
  JOIN runs r ON r.run_id=t.run_id WHERE r.team_id=:team AND t.status IN ('open','blocked') AND x.outcome IS NULL
  AND NOT EXISTS (SELECT 1 FROM assignment_returns z WHERE z.assignment_id=a.assignment_id)
  AND NOT EXISTS (SELECT 1 FROM assignments n WHERE n.previous_assignment_id=a.assignment_id)
  AND ((a.pickup_observed_at_ms IS NULL AND a.pickup_expired_at_ms IS NULL AND a.pickup_deadline_ms<=:now)
   OR (a.pickup_observed_at_ms IS NOT NULL AND a.task_deadline_ms IS NOT NULL AND a.task_deadline_ms<=:now))
  ORDER BY a.admitted_at_ms,a.assignment_id`,{team:teamId,now});
 const returned=[];
 for(const a of expired) {
  const taskExpired=a.pickup_observed_at_ms!==null;
  const changed=await db.query(`UPDATE assignments SET pickup_expired_at_ms=:now,returned_to_member_id=assigned_by_member_id
   WHERE assignment_id=:id AND returned_to_member_id IS NULL RETURNING assignment_id`,{id:a.assignment_id,now:taskExpired?null:now});
  if(!changed.length)continue;
  await db.query('INSERT INTO assignment_returns (assignment_id,returned_to_member_id,reason,returned_at_ms) VALUES (:id,:head,:reason,:now)',{id:a.assignment_id,head:a.assigned_by_member_id,now,reason:taskExpired?'task_expired':'pickup_expired'});
  if(taskExpired)await db.query("UPDATE tasks SET status='blocked' WHERE task_id=:id",{id:a.task_id});
  await db.query('UPDATE assignment_attempts SET generation=generation+1 WHERE assignment_id=:id',{id:a.assignment_id});
  await settleAssignmentThread(db,a.assignment_id,'expired',taskExpired?'Task deadline expired':'Pickup deadline expired');
  await db.query('INSERT INTO deadline_notices (notice_id,team_id,recipient_member_id,event_json,created_at_ms) VALUES (:id,:team,:recipient,:event,:now)',{id:`assignment-return:${a.assignment_id}`,team:teamId,recipient:a.assigned_by_member_id,event:JSON.stringify({event:taskExpired?'task_expired':'pickup_expired',assignmentId:a.assignment_id}),now});
  // The shared assignment is the return receipt. Do not forge a message from
  // the worker (or invent a synthetic team member) for an observer's event.
  returned.push({assignmentId:a.assignment_id,returnedToMemberId:a.assigned_by_member_id,...(taskExpired?{taskExpiredAtMs:now}:{pickupExpiredAtMs:now})});
 }
 return {returned};
}
