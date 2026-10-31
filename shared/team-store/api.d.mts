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
export type Command =
  | {type:'inspectCaller'}
  | {type:'inspectTeam';teamId:string}
  | {type:'inspectAssignment';teamId:string;assignmentId:string}
  | {type:'createFreshTeam';teamId:string;name:string;functionText:string;settings:Settings;expectedControllerGeneration:number;members:{memberId:string;name:string;bossMemberId:string|null;role:string;officialText:string}[]}
  | (MemberAuthority & {type:'bindMember';memberId:string;expectedControllerGeneration:number})
  | (MemberAuthority & {type:'admitAssignment';runId:string;taskId:string;assignmentId:string;memberId:string;instructions:string;expectedResult:string;expectedTargetGeneration:number;expectedTargetBindingGeneration:number})
  | (AttemptAuthority & {type:'verifyAssignment'})
  | (AttemptAuthority & {type:'reportOutcome';outcome:'succeeded'|'failed';summary:string;evidence:string})
  | (AttemptAuthority & {type:'acceptTask';decision:'accepted'|'rejected';reason:string})
  | {type:'revokeController';controllerId:string;expectedControllerGeneration:number};
export interface Request { operationId:string;command:Command;target?:unknown }
export interface Receipt { operationId:string;kind:'api';result:Readonly<Record<string,unknown>> }
export interface TeamApi {
 execute(request:Request):Promise<Receipt>;
 reconcile(request:Request):Promise<Receipt|{status:'unknown';operationId:string}>;
 /** Trusted UI only; this is not a model-facing command. */
 approveController(request:{operationId:string;approval:unknown}):Promise<Receipt>;
 close():Promise<void>;
}
/** All options are supplied by trusted client code, never tool request JSON. */
export function createTeamApi(options:{projectRoot:string;machineId:string;writer:{client:'team-orchestrator'|'team-orchestrator-orca';version:string;protocol?:number};postgres?:{connectionString:string};holderToken?:string;authenticate:()=>Promise<VerifiedActor>;verifyTarget?:(reference:unknown)=>Promise<VerifiedActor>;confirmController?:(value:{actor:VerifiedActor;approval:unknown})=>boolean|Promise<boolean>}):Promise<TeamApi>;
