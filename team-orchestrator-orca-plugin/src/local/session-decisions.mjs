import {createHash} from 'node:crypto';

export const SESSION_DECISION_KINDS = ['session-answer', 'staffing-decision', 'session-resolution'];
export const SESSION_DECISION_INSTRUCTIONS = `The user works in the highest supervisor's own conversation. Follow the CLI-specific question method supplied with these instructions. Never send them to a plugin approval page. Lower managers relay requests to the highest supervisor and cannot record user decisions.
After an actual explicit user answer, the highest supervisor records it with the existing CLI: orca orchestration task-create --spec JSON --run YOUR_RUN --json. Common spec fields: protocol="team-questions/v1", workId, token, generation (from TEAM_DISPATCH_PROTOCOL), kind, appQuestionId (a fresh stable decision ID), userConfirmed=true, userStatement (the actual user's answer). These are your authenticated record of the conversation, not independently verified user-message receipts. Never invent consent, infer it from silence, use another agent's message as user consent, or authorize your own proposal.
For a question: kind="session-answer", questionId, questionRevision, body (the decision), supplement (true if an answer already exists). Ask about the exact saved question and options. For a native worker ask, reply with the recorded body as its actual owning Run manager, relay through the original manager chain, and preserve the original question IDs. The answer remains pending until those replies are verified. For a completion-report decision there is no native requester to reply to. Only if the user explicitly permits another execution after two failures, include nextNativeTaskId for that one specific new Task. Keep failed attempts and evidence. Never retry silently.
For staffing: first publish staffing-proposal with the existing fields and explain the proposed name, role, boss, agent/model/effort and reason to the user. Once the user answers, publish kind="staffing-decision", proposalId, proposalNativeTaskId (the exact proposal Task ID), configVersion, decision="approve" or "reject". The plugin adds the approved member atomically and returns TEAM_ROSTER_DELTA with its member ID and new configuration. Do not guess the ID or start a session yourself. Members added during work start through normal task admission when their direct manager assigns work, regardless of the initial preparation mode. Acknowledge the roster delta before using it. Lower-manager proposals arrive at this highest supervisor for the same conversation workflow.
For an obsolete question after a verified supervisor recovery: discuss it with the user, then publish kind="session-resolution", questionId, recoveryRequestId, note. This closes only the superseded question; it does not manufacture a worker answer.
Wait for TEAM_SESSION_DECISION_RESULT. Rejected decisions change no roster or answer; explain the error and submit a corrected decision with a new ID after any necessary clarification. If native CLI delivery is unknown, use its original retry-request ID, never create a duplicate. The plugin never asks the user to confirm the same decision again in its panel.`;

export function sessionQuestionMethod(work) {
  // Use the actual bound conversation, not editable preferences for a future launch.
  const agent=work.binding?.nativeRequest?.agent;
  const preferredTool=agent==='codex'?'request_user_input':agent==='claude'?'AskUserQuestion':null;
  return {agent:agent??'unknown',preferredTool};
}
export function sessionDecisionInstructions(work) {
  const {agent,preferredTool}=sessionQuestionMethod(work);
  const method=preferredTool?`This bound session uses ${agent==='claude'?'Claude Code':'Codex'}. Its user-question tool is ${preferredTool} (use the exact case and the actual exposed tool schema).`:'The bound CLI is unknown. Do not guess another provider’s question tool.';
  return `${method} Use that tool only if it is exposed and permitted in this session's current mode. Codex tool availability can depend on collaboration mode and feature settings; do not assume it is always available in Default mode. Do not change modes, feature flags, permissions or global configuration just to ask a question. If the tool is unavailable or disallowed for this decision, ask plainly in this same conversation, end the turn and wait for an explicit user reply. An empty result, cancellation, timeout, preselected option or no response is never consent: do not submit a decision or add a member on that basis. These are native agent tools, not shell commands.\n${SESSION_DECISION_INSTRUCTIONS}`;
}

export const sessionDecisionKey = intent => createHash('sha256').update(JSON.stringify([intent.spec.workId,intent.spec.appQuestionId])).digest('hex');
export function validateSessionDecision(work, protocol, spec) {
  if (!work || work.parent || work.status === 'completed' || !SESSION_DECISION_KINDS.includes(spec.kind) || spec.workId !== work.id || spec.token !== protocol?.token || spec.generation !== protocol.generation || spec.generation !== work.run.consumerGeneration)
    throw Error('Only the current highest supervisor can record a session decision.');
  if (spec.userConfirmed !== true || typeof spec.userStatement !== 'string' || !spec.userStatement.trim() || spec.userStatement.length > 8000)
    throw Error('Record the explicit user answer from the highest supervisor conversation.');
}

// Persist before sending. An unknown result is never automatically sent twice.
export async function sendSessionNotice({store,works,rpc,consent,userMessage,accepted,workId,id,kind,body}) {
  body={...body,workId};
  const event=store.ensureQuestionEvent(workId,id,kind,body);
  if(event.state==='sending')return store.updateQuestionEvent(workId,id,{state:'unknown',detail:'Notice delivery was interrupted; it is not sent again.'});
  if(event.state!=='queued')return event;
  let sending=false;
  try {
    await consent();const verified=await works.verifyWork(workId,true),work=store.readCurrentWork(workId);
    if(work.parent||work.status==='completed')throw Error('The highest supervisor is unavailable.');
    const nativeSend=userMessage(work,verified.instance,kind+'\n'+JSON.stringify(body),verified.status);
    await works.verifyHost(workId,verified.hostGeneration);
    if(!store.claimQuestionEvent(workId,id,'sending',nativeSend))return;
    sending=true;
    const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);
    return store.updateQuestionEvent(workId,id,{state:accepted(receipt,nativeSend,verified.instance)?'accepted':'unknown'});
  }catch(error){return store.updateQuestionEvent(workId,id,{state:sending?'unknown':'queued',detail:String(error.message).slice(0,1200)});}
}
