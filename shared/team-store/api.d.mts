export interface VerifiedActor {
  projectRoot: string; machineId: string; provider: string; conversationId: string;
  executionHostId: string; contextId: string; terminalHandle: string; incarnationId: string;
}
export interface Settings {
  autoClose: boolean; idleMinutes: number; reopen: 'resume'|'fresh'; maxOpen: number;
  launch: 'demand'|'all'; batch: number; autoScratch: boolean; assumptions: boolean; scratchDir: string;
  pickupWindowMinutes: number; answerWindowMinutes: number; taskWindowMinutes: number|null;
  replayIntervalMs: number; exemptMemberIds: string[];
}
interface MemberAuthority { teamId:string; expectedConfigVersion:number; expectedMemberGeneration:number; expectedBindingGeneration:number }
interface AttemptAuthority extends MemberAuthority { assignmentId:string; expectedAttemptGeneration:number }
interface MeetingAuthority extends MemberAuthority {meetingId:string;expectedMeetingGeneration:number}
export type Command =
  | {type:'inspectMeeting';teamId:string;meetingId:string}
  | (MemberAuthority & {type:'createMeeting';meetingId:string;title:string;startPolicy:'all'|'joined';participantIds:string[];topics:{title:string;requiredMemberIds:string[]}[];lineLimit:number;roundLimit:number})
  | (MeetingAuthority & {type:'respondMeeting';response:'joined'|'declined';checkpoint:string})
  | (MeetingAuthority & {type:'startMeeting'|'extendMeeting'|'closeMeeting'|'cancelMeeting'})
  | (MeetingAuthority & {type:'contributeMeeting';contributionId:string;body:string})
  | (MeetingAuthority & {type:'advanceMeeting';disposition:'discussed'|'deferred';resolution:string})
  | (MeetingAuthority & {type:'proposeMeetingOutput';outputId:string;ownerMemberId:string;outputKind:'minutes'|'action'|'profile'|'handbook'|'role';body:string})
  | (MeetingAuthority & {type:'reviewMeetingOutput';outputId:string;decision:'accepted'|'rejected';note:string})
  | (MeetingAuthority & {type:'acknowledgeMeetingNotification';notificationGeneration:number})
  | (MemberAuthority & {type:'askQuestion';threadId:string;runId:string;assignmentId:string|null;recipientMemberId:string;question:string})
  | (MemberAuthority & {type:'answerQuestion';threadId:string;answer:string;expectedThreadGeneration:number})
  | {type:'inspectQuestion';teamId:string;threadId:string}
  | (MemberAuthority & {type:'observeDeadlines'})
  | (MemberAuthority & {type:'acknowledgeNotice';noticeId:string})
  | (AttemptAuthority & {type:'openGate';gateId:string;question:string;options:string[]})
  | (MemberAuthority & {type:'replaceGate';gateId:string;newGateId:string;expectedGateGeneration:number;question:string;options:string[]})
  | (MemberAuthority & {type:'resolveGate';gateId:string;expectedGateGeneration:number;choice:string;note?:string})
  | {type:'inspectCaller'|'inspectController'}
  | {type:'inspectConfiguration';teamId:string}
  | {type:'inspectTeam';teamId:string}
  | {type:'inspectAssignment';teamId:string;assignmentId:string}
  | {type:'inspectInbox';teamId:string;recipientMemberId:string}
  | {type:'inspectDelivery';teamId:string;deliveryId:string}
  | (MemberAuthority & {type:'readInbox';deliveryId:string;expectedDeliveryGeneration:number})
  | (MemberAuthority & {type:'prepareDeliveries'})
  | (MemberAuthority & {type:'observePickupDeadlines'})
  | (AttemptAuthority & {type:'retryAssignment';newAssignmentId:string;memberId:string;expectedTargetGeneration:number;expectedTargetBindingGeneration:number})
  | {type:'createFreshTeam';teamId:string;name:string;functionText:string;settings:Settings;expectedControllerGeneration:number;members:{memberId:string;name:string;bossMemberId:string|null;role:string;officialText:string;cli?:'claude'|'codex'}[]}
  | (MemberAuthority & {type:'bindMember';memberId:string;expectedControllerGeneration:number})
  | (MemberAuthority & {type:'admitAssignment';runId:string;taskId:string;assignmentId:string;memberId:string;instructions:string;expectedResult:string;expectedTargetGeneration:number;expectedTargetBindingGeneration:number})
  | (AttemptAuthority & {type:'verifyAssignment'})
  | (AttemptAuthority & {type:'reportOutcome';outcome:'succeeded'|'failed';summary:string;evidence:string})
  | (AttemptAuthority & {type:'acceptTask';decision:'accepted'|'rejected';reason:string})
  | {type:'revokeController';controllerId:string;expectedControllerGeneration:number};
export type TeamEdit =
 | {type:'updateTeam';name:string;functionText:string}
 | {type:'saveSettings';settings:Settings}
 | {type:'addMember';memberId:string;name:string;bossMemberId:string;role:string;officialText:string;cli:'claude'|'codex'}
 | {type:'updateMember';memberId:string;expectedMemberGeneration:number;patch:{name?:string;role?:string;officialText?:string;advisoryNotes?:string;model?:string;effort?:string;allowWrite?:boolean;allowAgent?:boolean}};
export interface EditTeam {type:'editTeam';teamId:string;expectedConfigVersion:number;expectedControllerGeneration:number;changes:TeamEdit[]}
export interface Request { operationId:string;command:Command;target?:unknown }
export interface Receipt { operationId:string;kind:'api';result:Readonly<Record<string,unknown>> }
export interface TeamApi {
 execute(request:Request):Promise<Receipt>;
 reconcile(request:Request):Promise<Receipt|{status:'unknown';operationId:string}>;
 /** Trusted UI only; this is not a model-facing command. */
 approveController(request:{operationId:string;approval?:unknown}):Promise<Receipt>;
 /** Trusted native confirmation path; absent from normal model execute. */
 manageTeam(request:{operationId:string;command:EditTeam|Extract<Command,{type:'createFreshTeam'|'bindMember'}>;target?:unknown}):Promise<Receipt>;
 reconcileManagement(request:{operationId:string;command:EditTeam|Command|{type:'approveController'};target?:unknown}):Promise<Receipt|{status:'unknown';operationId:string}>;
 close():Promise<void>;
}
/** All options are supplied by trusted client code, never tool request JSON. */
export function createTeamApi(options:{projectRoot:string;machineId:string;writer:{client:'team-orchestrator'|'team-orchestrator-orca';version:string;protocol?:number};postgres?:{connectionString:string};holderToken?:string;authenticate:()=>Promise<VerifiedActor>;verifyTarget?:(reference:unknown)=>Promise<VerifiedActor>;confirmManagement?:(value:{actor:VerifiedActor;command:EditTeam})=>boolean|Promise<boolean>;confirmController?:(value:{actor:VerifiedActor;approval:unknown})=>boolean|Promise<boolean>}):Promise<TeamApi>;
