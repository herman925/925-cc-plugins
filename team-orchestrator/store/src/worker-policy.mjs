// This bundle is reviewed explicitly; it is never inferred from controller or
// process-start approval. The shared API still authorizes every role operation.
import {refusal} from './errors.mjs';
export const WORKER_TOOL_POLICY='team-worker-v1';
export const WORKER_TEAM_TOOLS=Object.freeze(['shared_team_status','shared_team','shared_inbox_read','shared_inbox_seen']);
export const WORKER_TOOL_BUNDLE_JSON=JSON.stringify(WORKER_TEAM_TOOLS);
export const WORKER_RUNTIME_TYPES=Object.freeze(['beginWorkerRuntime','observeWorkerRuntime','closeWorkerRuntime']);
export function requireWorkerToolPolicy(value){
 if(value!==WORKER_TOOL_POLICY)throw refusal('API_WORKER_ACCESS_REQUIRED','Review the listed worker and its current Team Orchestrator tool-access bundle before starting it. An older launch approval grants no new tool access.');
 return value;
}
export function workerToolReview(){return {policy:WORKER_TOOL_POLICY,scope:'Only the workers listed in this launch plan, at their verified project/machine home.',allows:'Use Team Orchestrator inbox, task and meeting workflows within each worker’s assigned role.',tools:[...WORKER_TEAM_TOOLS],managementApproval:false,filesystemOrSandboxChange:false,subagentGrant:false,unrelatedMcpServersChanged:false};}
