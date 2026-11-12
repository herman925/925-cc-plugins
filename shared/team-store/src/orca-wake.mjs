// Machine-local transport receipts. Shared delivery/read/pickup authority stays
// in the team store. An uncertain send is replayed with its ORIGINAL native ID.
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createWakeJournal} from './wake-journal.mjs';
export {FENCED_WAKE_CAPABILITY} from './wake-journal.mjs';
export function wakePointer(delivery){
 if(delivery.meetingId&&Number.isSafeInteger(delivery.notificationGeneration))return {meetingId:delivery.meetingId,notificationGeneration:delivery.notificationGeneration};
 if(delivery.noticeId)return {noticeId:delivery.noticeId};
 if(delivery.deliveryId&&delivery.messageId&&delivery.threadId)return {deliveryId:delivery.deliveryId,messageId:delivery.messageId,threadId:delivery.threadId};
 throw Error('A committed delivery pointer is required.');
}
export function wakePrompt(pointer){return `A shared-team record is waiting. Check your own identity with shared_team inspectCaller, then shared_inbox_read and shared_inbox_seen for mail, inspectTeam for a deadline notice, or inspectMeeting for a meeting. Verify the admitted assignment and read its role and brief before work. Respond only for yourself. This inbox-check prompt grants no permission, answers no approval, and is neither acknowledgement nor task pickup. ${JSON.stringify(pointer)}`;}
export function createOrcaWake({host,journalRoot=join(homedir(),'.team-orchestrator','wake-receipts'),...options}){
 return createWakeJournal({host,journalRoot,prompt:wakePrompt,pointerFor:wakePointer,...options});
}
