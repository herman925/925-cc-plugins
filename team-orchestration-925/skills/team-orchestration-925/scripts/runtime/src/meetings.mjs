import {refusal} from './errors.mjs';
import {text,integer,databaseInteger} from './validation.mjs';
import {reference} from './writers.mjs';

const fail=(code,message)=>{throw refusal(`API_MEETING_${code}`,message);};
import {meetingFields} from './meeting-schema.mjs';
export {meetingFields};
export function normalizeMeeting(input) {
 const out={};
 if(input.type==='createMeeting') {
  if(!['all','joined'].includes(input.startPolicy))fail('INPUT','Choose an explicit start policy.');
  if(!Array.isArray(input.participantIds)||!input.participantIds.length||input.participantIds.length>30)fail('INPUT','Invite 1–30 members.');
  out.participantIds=input.participantIds.map(v=>text(v,'participantId'));
  if(new Set(out.participantIds).size!==out.participantIds.length)fail('INPUT','Participants must be unique.');
  if(!Array.isArray(input.topics)||!input.topics.length||input.topics.length>30)fail('INPUT','Supply 1–30 agenda topics.');
  out.topics=input.topics.map(t=>{
   if(!t||Object.keys(t).some(k=>!['title','requiredMemberIds'].includes(k))||!Array.isArray(t.requiredMemberIds))fail('INPUT','A topic needs a title and required member ids.');
   const requiredMemberIds=t.requiredMemberIds.map(v=>text(v,'requiredMemberId'));
   if(new Set(requiredMemberIds).size!==requiredMemberIds.length||requiredMemberIds.some(id=>!out.participantIds.includes(id)))fail('INPUT','Required members must be distinct invitees.');
   return {title:text(t.title,'topic title'),requiredMemberIds};
  });
  out.lineLimit=integer(input.lineLimit,'lineLimit',{min:1,max:100});
  out.roundLimit=integer(input.roundLimit,'roundLimit',{min:1,max:5});
 }
 return out;
}
export async function meetingAccess(db,command,memberId) {
 const meeting=await reference(db,'meetings','meeting_id',command.meetingId);
 if(meeting.team_id!==command.teamId)fail('SCOPE','Meeting belongs to another team.');
 if(!(await db.query('SELECT 1 FROM meeting_participants WHERE meeting_id=:id AND member_id=:member',{id:meeting.meeting_id,member:memberId})).length)fail('PARTICIPANT_REQUIRED','Only an invited member may read this meeting.');
 return meeting;
}
export async function inspectMeeting(db,command,memberId) {
 const meeting=await meetingAccess(db,command,memberId),p={id:command.meetingId};
 return {meeting,participants:await db.query('SELECT * FROM meeting_participants WHERE meeting_id=:id ORDER BY member_id',p),
  topics:await db.query('SELECT * FROM meeting_topics WHERE meeting_id=:id ORDER BY topic_index',p),
  required:await db.query('SELECT * FROM meeting_required WHERE meeting_id=:id ORDER BY topic_index,member_id',p),
  contributions:await db.query('SELECT * FROM meeting_contributions WHERE meeting_id=:id ORDER BY topic_index,round_number,created_at_ms,contribution_id',p),
  outputs:await db.query('SELECT * FROM meeting_outputs WHERE meeting_id=:id ORDER BY created_at_ms,output_id',p)};
}
export async function applyMeeting(db,c,member,now) {
 const id=c.meetingId,who=member.member_id,p={id,who,now};
 let terminal=null;
 const notify=async(generation,event)=>{for(const row of await db.query('SELECT member_id FROM meeting_participants WHERE meeting_id=:id AND member_id<>:who',p))await db.query('INSERT INTO meeting_notifications VALUES (:id,:generation,:recipient,:event,:now,NULL,NULL)',{id,generation,recipient:row.member_id,event,now});};
 if(c.type==='createMeeting') {
  if(member.boss_member_id!==null)fail('CHAIR_REQUIRED','Only the top head calls a meeting.');
  if(!c.participantIds.includes(who))fail('INPUT','Include the chair in the attendees.');
  for(const memberId of c.participantIds){const m=await reference(db,'members','member_id',memberId);if(m.team_id!==c.teamId||m.membership_state!=='active')fail('SCOPE','Invite only active members of this team.');}
  await db.query(`INSERT INTO meetings VALUES (:id,:team,:who,:title,:policy,'inviting',1,0,:lines,:rounds,0,:now,NULL)`,{...p,team:c.teamId,title:c.title,policy:c.startPolicy,lines:c.lineLimit,rounds:c.roundLimit});
  for(const memberId of c.participantIds)await db.query("INSERT INTO meeting_participants VALUES (:id,:member,'invited',NULL,NULL)",{id,member:memberId});
  for(const [index,t] of c.topics.entries()){
   await db.query("INSERT INTO meeting_topics VALUES (:id,:idx,:title,'pending',NULL)",{id,idx:index,title:t.title});
   for(const memberId of t.requiredMemberIds)await db.query('INSERT INTO meeting_required VALUES (:id,:idx,:member)',{id,idx:index,member:memberId});
  }
  await notify(1,'invitation');
  return inspectMeeting(db,c,who);
 }
 const m=await meetingAccess(db,c,who);
 if(databaseInteger(m.generation,'meeting generation')!==c.expectedMeetingGeneration)fail('STALE','The meeting changed. Refresh before making a new operation.');
 const chair=()=>{if(m.chair_member_id!==who||member.boss_member_id!==null)fail('CHAIR_REQUIRED','Only the current top head who called this meeting may chair it.');};
 const open=()=>{if(['closed','cancelled'].includes(m.status))fail('CLOSED','The meeting has ended. Its record is retained.');};
 if(c.type==='acknowledgeMeetingNotification'){await db.query('UPDATE meeting_notifications SET read_at_ms=:now WHERE meeting_id=:id AND generation=:generation AND recipient_member_id=:who AND read_at_ms IS NULL',{...p,generation:c.notificationGeneration});return inspectMeeting(db,c,who);}
 if(c.type==='respondMeeting') {
  open();if(!['joined','declined'].includes(c.response))fail('INPUT','Join at a safe checkpoint or decline.');
  const rows=await db.query("UPDATE meeting_participants SET state=:state,checkpoint=:checkpoint,responded_at_ms=:now WHERE meeting_id=:id AND member_id=:who AND state='invited' RETURNING member_id",{...p,state:c.response,checkpoint:c.checkpoint});
  if(!rows.length)fail('RESPONSE_RECORDED','Your participation response is already recorded.');
 } else if(c.type==='startMeeting') {
  chair();if(m.status!=='inviting')fail('STATE','Only an inviting meeting can start.');
  const attendees=await db.query('SELECT * FROM meeting_participants WHERE meeting_id=:id',{id});
  if(attendees.find(a=>a.member_id===who)?.state!=='joined')fail('CHECKPOINT_REQUIRED','The chair must join at its own checkpoint.');
  if(m.start_policy==='all'&&attendees.some(a=>a.state!=='joined'))fail('WAITING','The selected policy requires every invitee to join. Cancel or wait; no attendee is impersonated.');
  await db.query("UPDATE meetings SET status='active' WHERE meeting_id=:id",{id});
 } else if(c.type==='contributeMeeting') {
  if(m.status!=='active')fail('STATE','Contribute only to an active meeting.');
  if(!(await db.query("SELECT 1 FROM meeting_topics WHERE meeting_id=:id AND topic_index=:idx AND state='pending'",{id,idx:m.current_topic})).length)fail('STATE','There is no current agenda topic.');
  const [joined]=await db.query('SELECT state FROM meeting_participants WHERE meeting_id=:id AND member_id=:who',p);
  if(joined.state!=='joined')fail('CHECKPOINT_REQUIRED','Finish your current step and join before contributing.');
  const previous=await db.query('SELECT body FROM meeting_contributions WHERE meeting_id=:id AND member_id=:who',p);
  const used=previous.reduce((total,row)=>total+row.body.split(/\r\n|\r|\n/).length,0);
  if(used+c.body.split(/\r\n|\r|\n/).length>Number(m.line_limit))fail('LIMIT','Your contributions exceed the meeting line budget.');
  const [count]=await db.query('SELECT COUNT(*) AS n FROM meeting_contributions WHERE meeting_id=:id AND topic_index=:idx AND member_id=:who',{...p,idx:m.current_topic});
  const round=Number(count.n)+1;
  if(round>Number(m.round_limit))fail('LIMIT','Your contribution rounds are complete. Only the chair can extend once.');
  await db.query('INSERT INTO meeting_contributions VALUES (:cid,:id,:idx,:who,:round,:body,:now)',{...p,cid:c.contributionId,idx:m.current_topic,round,body:c.body});
 } else if(c.type==='advanceMeeting') {
  chair();if(m.status!=='active')fail('STATE','Only an active topic can advance.');
  if(!['discussed','deferred'].includes(c.disposition))fail('INPUT','Record a discussion resolution or an explicit deferral.');
  if(c.disposition==='discussed'){
   const missing=await db.query(`SELECT r.member_id FROM meeting_required r WHERE r.meeting_id=:id AND r.topic_index=:idx AND NOT EXISTS (SELECT 1 FROM meeting_contributions c WHERE c.meeting_id=r.meeting_id AND c.topic_index=r.topic_index AND c.member_id=r.member_id)`,{id,idx:m.current_topic});
   if(missing.length)fail('INPUT_REQUIRED','Required participants have not contributed. Wait or explicitly defer this topic.');
  }
  const changed=await db.query("UPDATE meeting_topics SET state=:state,resolution=:resolution WHERE meeting_id=:id AND topic_index=:idx AND state='pending' RETURNING topic_index",{id,idx:m.current_topic,state:c.disposition,resolution:c.resolution});
  if(!changed.length)fail('STATE','No pending topic remains.');
  await db.query('UPDATE meetings SET current_topic=current_topic+1 WHERE meeting_id=:id',{id});
 } else if(c.type==='extendMeeting') {
  chair();if(m.status!=='active'||Number(m.extended))fail('LIMIT','The chair may extend an active meeting once.');
  await db.query('UPDATE meetings SET round_limit=round_limit+1,extended=1 WHERE meeting_id=:id',{id});
 } else if(c.type==='closeMeeting'||c.type==='cancelMeeting') {
  chair();open();
  if(c.type==='closeMeeting'){
   if(m.status!=='active'||(await db.query("SELECT 1 FROM meeting_topics WHERE meeting_id=:id AND state='pending'",{id})).length)fail('UNFINISHED','Discuss or explicitly defer every agenda topic before closing.');
   if(!(await db.query("SELECT 1 FROM meeting_outputs WHERE meeting_id=:id AND kind='minutes' AND state='accepted'",{id})).length)fail('MINUTES_REQUIRED','Review and accept durable minutes before closing.');
  }
  terminal=c.type==='closeMeeting'?'closed':'cancelled';
 } else if(c.type==='proposeMeetingOutput') {
  open();if(m.status!=='active')fail('STATE','Propose outputs during the meeting.');
  const [participant]=await db.query('SELECT state FROM meeting_participants WHERE meeting_id=:id AND member_id=:who',p);
  if(participant.state!=='joined')fail('CHECKPOINT_REQUIRED','Join before proposing an output.');
  if(!['minutes','action','profile','handbook','role'].includes(c.outputKind))fail('INPUT','Unknown output kind.');
  if(!(await db.query('SELECT 1 FROM meeting_participants WHERE meeting_id=:id AND member_id=:owner',{id,owner:c.ownerMemberId})).length)fail('SCOPE','An output must have an invited owner.');
  await db.query("INSERT INTO meeting_outputs VALUES (:oid,:id,:who,:owner,:kind,:body,'proposed',NULL,NULL,NULL,:now)",{...p,oid:c.outputId,owner:c.ownerMemberId,kind:c.outputKind,body:c.body});
 } else if(c.type==='reviewMeetingOutput') {
  chair();open();if(!['accepted','rejected'].includes(c.decision))fail('INPUT','Accept or reject the proposal.');
  const rows=await db.query("UPDATE meeting_outputs SET state=:state,reviewed_by_member_id=:who,review_note=:note,reviewed_at_ms=:now WHERE meeting_id=:id AND output_id=:oid AND state='proposed' RETURNING output_id",{...p,state:c.decision,note:c.note,oid:c.outputId});
  if(!rows.length)fail('REVIEW_RECORDED','Only an unreviewed proposal in this meeting can be reviewed.');
 }
 // The store serializes this compare-and-set with all other project writes.
 const changed=await db.query('UPDATE meetings SET generation=generation+1,status=COALESCE(:terminal,status),ended_at_ms=CASE WHEN :terminal IS NULL THEN ended_at_ms ELSE :now END WHERE meeting_id=:id AND generation=:generation RETURNING generation',{id,generation:c.expectedMeetingGeneration,terminal,now});
 if(changed.length!==1)fail('STALE','Another meeting operation won. Refresh the record.');
 // One unread pointer per recipient is sufficient: it always points to the durable current record.
 await db.query('UPDATE meeting_notifications SET read_at_ms=:now WHERE meeting_id=:id AND recipient_member_id=:who AND read_at_ms IS NULL',p);
 await notify(c.expectedMeetingGeneration+1,terminal?'ended':'updated');
 return inspectMeeting(db,c,who);
}
