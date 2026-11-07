import {refusal} from './errors.mjs';
export const HUMAN_REVIEW_FLOOR_MS=1000;
// Timing qualifies diagnostics only. It neither proves form delivery nor
// authorizes a change, and acceptance is not timing-gated.
export function nativeReviewRefusal(elapsedMs,message){
 if(elapsedMs>=HUMAN_REVIEW_FLOOR_MS)return refusal('API_APPROVAL_REQUIRED',message);
 return refusal('API_APPROVAL_UNVERIFIED','Approval not obtained; delivery unverified. No changes made.',{elapsedMs,reviewFloorMs:HUMAN_REVIEW_FLOOR_MS,hint:'An automatic decline by the client is one possible cause. Check that MCP confirmation prompts are enabled for this project, then try again.'});
}
