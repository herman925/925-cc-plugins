// Current shared-state check for private transport adapters. This returns no
// message body, grants no authority and never acknowledges a delivery.
import {inspectInbox} from './mailbox.mjs';
import {databaseInteger} from './validation.mjs';
import {randomUUID} from 'node:crypto';
export async function inspectWakeEligibility(db,c,member,now){
 const no=reason=>({eligible:false,reason,checkedAt:now});
 const [recipient]=await db.query('SELECT * FROM members WHERE member_id=:id AND team_id=:team',{id:c.recipientMemberId,team:c.teamId});
 if(!recipient||recipient.membership_state!=='active')return no('recipient-inactive');
 const [binding]=await db.query('SELECT * FROM member_bindings WHERE member_id=:id',{id:c.recipientMemberId});
 if(!binding||binding.provider!==recipient.cli)return no('recipient-unbound');
 if(c.kind==='delivery'){
  const [message]=await db.query('SELECT * FROM messages WHERE delivery_id=:id AND team_id=:team AND recipient_member_id=:recipient',{id:c.pointerId,team:c.teamId,recipient:c.recipientMemberId});
  if(!message)return no('delivery-missing');
  if(member.boss_member_id!==null&&message.sender_member_id!==member.member_id&&message.recipient_member_id!==member.member_id)return no('outside-sender-scope');
  const [next]=await inspectInbox(db,c.teamId,c.recipientMemberId);
  if(next?.delivery_id!==c.pointerId)return no('read-fenced-or-not-next');
  if(next.assignment_id){
   const [a]=await db.query('SELECT * FROM assignments WHERE assignment_id=:id',{id:next.assignment_id});
   if(!a||a.returned_to_member_id!==null||a.pickup_expired_at_ms!==null)return no('assignment-returned');
   if(a.pickup_observed_at_ms===null&&databaseInteger(a.pickup_deadline_ms,'pickup deadline')<=now)return no('pickup-expired');
   if(a.pickup_observed_at_ms!==null&&a.task_deadline_ms!==null&&databaseInteger(a.task_deadline_ms,'task deadline')<=now)return no('task-expired');
   const newer=await db.query('SELECT 1 FROM assignments WHERE previous_assignment_id=:id',{id:a.assignment_id});
   if(newer.length)return no('assignment-superseded');
  }
 }else if(c.kind==='notice'){
  const [notice]=await db.query('SELECT * FROM deadline_notices WHERE notice_id=:id AND team_id=:team AND recipient_member_id=:recipient AND read_at_ms IS NULL',{id:c.pointerId,team:c.teamId,recipient:c.recipientMemberId});
  if(!notice)return no('notice-read-or-missing');
 }else if(c.kind==='meeting'){
  const [notice]=await db.query('SELECT n.* FROM meeting_notifications n JOIN meetings m ON m.meeting_id=n.meeting_id WHERE n.meeting_id=:id AND m.team_id=:team AND n.recipient_member_id=:recipient AND n.generation=:generation AND n.read_at_ms IS NULL AND NOT EXISTS (SELECT 1 FROM meeting_notifications newer WHERE newer.meeting_id=n.meeting_id AND newer.recipient_member_id=n.recipient_member_id AND newer.generation>n.generation)',{id:c.pointerId,team:c.teamId,recipient:c.recipientMemberId,generation:c.pointerGeneration});
  if(!notice)return no('meeting-notification-read-or-superseded');
 }else return no('unsupported-pointer');
 return {eligible:true,binding,checkedAt:now};
}
export async function currentWakeEligibility(api,teamId,delivery){
 const kind=delivery.meetingId?'meeting':delivery.noticeId?'notice':'delivery';
 const command={type:'inspectWake',teamId,recipientMemberId:delivery.recipient.member_id,kind,pointerId:delivery.meetingId??delivery.noticeId??delivery.deliveryId,pointerGeneration:delivery.notificationGeneration??1};
 const receipt=await api.inspectWake({operationId:`wake-check-${randomUUID()}`,command});
 const result=receipt.result;
 if(result.eligible){
  const before=delivery.recipient,after=result.binding;
  if(Object.keys(before).some(k=>before[k]!==after[k]))return {eligible:false,reason:'binding-changed',checkedAt:result.checkedAt};
 }
 return result;
}
