import {API_COMMAND_FIELDS} from './api-catalogue.mjs';
const stringField={type:'string'}
const versionField={type:'integer',minimum:1}
export const commandSchema={type:'object',additionalProperties:false,properties:{
 type:{type:'string',enum:Object.keys(API_COMMAND_FIELDS).filter(t=>!['approveController','reserveLaunch','claimLaunch','attachLaunch'].includes(t))},
 ...Object.fromEntries(['teamId','name','functionText','memberId','runId','taskId','assignmentId','newAssignmentId','deliveryId','recipientMemberId','instructions','expectedResult','summary','evidence','reason','controllerId','gateId','newGateId','question','choice','note','threadId','answer','noticeId','meetingId','title','startPolicy','response','checkpoint','contributionId','body','disposition','resolution','outputId','ownerMemberId','outputKind'].map(k=>[k,stringField])),
 ...Object.fromEntries(['expectedConfigVersion','expectedMemberGeneration','expectedControllerGeneration','expectedTargetGeneration','expectedTargetBindingGeneration','expectedAttemptGeneration','expectedDeliveryGeneration','expectedGateGeneration','expectedThreadGeneration','expectedMeetingGeneration','notificationGeneration'].map(k=>[k,versionField])),
 participantIds:{type:'array',minItems:1,maxItems:30,uniqueItems:true,items:stringField},
 topics:{type:'array',minItems:1,maxItems:30,items:{type:'object',additionalProperties:false,properties:{title:stringField,requiredMemberIds:{type:'array',uniqueItems:true,items:stringField}},required:['title','requiredMemberIds']}},
 lineLimit:{type:'integer',minimum:1,maximum:100},roundLimit:{type:'integer',minimum:1,maximum:5},
 assignmentId:{type:['string','null']},
 options:{type:'array',minItems:2,uniqueItems:true,items:stringField},
 expectedBindingGeneration:{type:'integer',minimum:0},outcome:{type:'string',enum:['succeeded','failed']},decision:{type:'string',enum:['accepted','rejected']},
 members:{type:'array',items:{type:'object',additionalProperties:false,properties:{memberId:stringField,name:stringField,bossMemberId:{type:['string','null']},role:stringField,officialText:stringField,cli:{type:'string',enum:['claude','codex']}},required:['memberId','name','bossMemberId','role','officialText']}},
 settings:{type:'object',additionalProperties:false,properties:{autoClose:{type:'boolean'},idleMinutes:{type:'integer',minimum:0},reopen:{type:'string',enum:['resume','fresh']},maxOpen:{type:'integer',minimum:0},launch:{type:'string',enum:['demand','all']},batch:versionField,autoScratch:{type:'boolean'},assumptions:{type:'boolean'},scratchDir:stringField,pickupWindowMinutes:versionField,answerWindowMinutes:versionField,taskWindowMinutes:{type:['integer','null'],minimum:1},replayIntervalMs:versionField,exemptMemberIds:{type:'array',items:stringField}},required:['autoClose','idleMinutes','reopen','maxOpen','launch','batch','autoScratch','assumptions','scratchDir','pickupWindowMinutes','answerWindowMinutes','taskWindowMinutes','replayIntervalMs','exemptMemberIds']}
},required:['type']}
