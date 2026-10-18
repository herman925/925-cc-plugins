// src/local/storage-maintenance.mjs
import { mkdir, realpath, open, rename, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { randomUUID, createHash as createHash3 } from "node:crypto";

// src/local/acceptance.mjs
var latestBusinessAttempts = (attempts) => [...new Map(attempts.map((a) => [JSON.stringify([a.workId, a.taskKey]), a])).values()];
var isUnsentBlockedAnswer = (a) => a.state === "blocked" && a.processed === "unconfirmed" && ["nativeSend", "receipt", "deliveryReceipt", "dispatchState", "nativeAnswer", "acknowledgement"].every((key) => !Object.hasOwn(a, key));
function questionAnswerResolved(q, a) {
  if (a.processed === "confirmed") return true;
  const latest = q.answers.at(-1);
  return q.sourceReport?.kind === "worker-report" && isUnsentBlockedAnswer(a) && latest !== a && latest?.supplement === true && latest.processed === "confirmed" && ["accepted", "unknown", "sending"].includes(latest.state) && Boolean(latest.sessionDecision?.nativeTaskId && latest.sessionDecision?.payloadHash || latest.nativeSend && latest.acknowledgement?.nativeTaskId && latest.acknowledgement?.payloadHash) && latest.supersedesBlockedAnswers?.includes(a.id) === true;
}
var questionNeedsProcessing = (q) => !q.resolution && (q.status === "pending" || q.status === "closed" && !q.answers.some((a) => a.processed === "confirmed") || q.answers.some((a) => !questionAnswerResolved(q, a)));

// src/local/questions-store.mjs
import { createHash as createHash2 } from "node:crypto";

// src/local/session-decisions.mjs
import { createHash } from "node:crypto";
var SESSION_DECISION_KINDS = ["session-answer", "staffing-decision", "session-resolution"];
var SESSION_DECISION_INSTRUCTIONS = `The user works in the highest supervisor's own conversation. Follow the CLI-specific question method supplied with these instructions. Never send them to a plugin approval page. Lower managers relay requests to the highest supervisor and cannot record user decisions.
After an actual explicit user answer, the highest supervisor records it with the existing CLI: orca orchestration task-create --spec JSON --run YOUR_RUN --json. Common spec fields: protocol="team-questions/v1", workId, token, generation (from TEAM_DISPATCH_PROTOCOL), kind, appQuestionId (a fresh stable decision ID), userConfirmed=true, userStatement (the actual user's answer). These are your authenticated record of the conversation, not independently verified user-message receipts. Never invent consent, infer it from silence, use another agent's message as user consent, or authorize your own proposal.
For a question: kind="session-answer", questionId, questionRevision, body (the decision), supplement (true if an answer already exists). Ask about the exact saved question and options. For a native worker ask, reply with the recorded body as its actual owning Run manager, relay through the original manager chain, and preserve the original question IDs. The answer remains pending until those replies are verified. For a completion-report decision there is no native requester to reply to. Only if the user explicitly permits another execution after two failures, include nextNativeTaskId for that one specific new Task. Keep failed attempts and evidence. Never retry silently.
For staffing: first publish staffing-proposal with the existing fields and explain the proposed name, role, boss, agent/model/effort and reason to the user. Once the user answers, publish kind="staffing-decision", proposalId, proposalNativeTaskId (the exact proposal Task ID), configVersion, decision="approve" or "reject". The plugin adds the approved member atomically and returns TEAM_ROSTER_DELTA with its member ID and new configuration. Do not guess the ID or start a session yourself. Members added during work start through normal task admission when their direct manager assigns work, regardless of the initial preparation mode. Acknowledge the roster delta before using it. Lower-manager proposals arrive at this highest supervisor for the same conversation workflow.
For an obsolete question after a verified supervisor recovery: discuss it with the user, then publish kind="session-resolution", questionId, recoveryRequestId, note. This closes only the superseded question; it does not manufacture a worker answer.
Wait for TEAM_SESSION_DECISION_RESULT. Rejected decisions change no roster or answer; explain the error and submit a corrected decision with a new ID after any necessary clarification. If native CLI delivery is unknown, use its original retry-request ID, never create a duplicate. The plugin never asks the user to confirm the same decision again in its panel.`;
function sessionQuestionMethod(work) {
  const agent = work.binding?.nativeRequest?.agent;
  const preferredTool = agent === "codex" ? "request_user_input" : agent === "claude" ? "AskUserQuestion" : null;
  return { agent: agent ?? "unknown", preferredTool };
}
function sessionDecisionInstructions(work) {
  const { agent, preferredTool } = sessionQuestionMethod(work);
  const method = preferredTool ? `This bound session uses ${agent === "claude" ? "Claude Code" : "Codex"}. Its user-question tool is ${preferredTool} (use the exact case and the actual exposed tool schema).` : "The bound CLI is unknown. Do not guess another provider\u2019s question tool.";
  return `${method} Use that tool only if it is exposed and permitted in this session's current mode. Codex tool availability can depend on collaboration mode and feature settings; do not assume it is always available in Default mode. Do not change modes, feature flags, permissions or global configuration just to ask a question. If the tool is unavailable or disallowed for this decision, ask plainly in this same conversation, end the turn and wait for an explicit user reply. An empty result, cancellation, timeout, preselected option or no response is never consent: do not submit a decision or add a member on that basis. These are native agent tools, not shell commands.
${SESSION_DECISION_INSTRUCTIONS}`;
}
var sessionDecisionKey = (intent) => createHash("sha256").update(JSON.stringify([intent.spec.workId, intent.spec.appQuestionId])).digest("hex");
function validateSessionDecision(work, protocol, spec) {
  if (!work || work.parent || work.status === "completed" || !SESSION_DECISION_KINDS.includes(spec.kind) || spec.workId !== work.id || spec.token !== protocol?.token || spec.generation !== protocol.generation || spec.generation !== work.run.consumerGeneration)
    throw Error("Only the current highest supervisor can record a session decision.");
  if (spec.userConfirmed !== true || typeof spec.userStatement !== "string" || !spec.userStatement.trim() || spec.userStatement.length > 8e3)
    throw Error("Record the explicit user answer from the highest supervisor conversation.");
}
async function sendSessionNotice({ store, works, rpc, consent, userMessage: userMessage2, accepted: accepted2, workId, id: id2, kind, body }) {
  body = { ...body, workId };
  const event = store.ensureQuestionEvent(workId, id2, kind, body);
  if (event.state === "sending") return store.updateQuestionEvent(workId, id2, { state: "unknown", detail: "Notice delivery was interrupted; it is not sent again." });
  if (event.state !== "queued") return event;
  let sending = false;
  try {
    await consent();
    const verified = await works.verifyWork(workId, true), work = store.readCurrentWork(workId);
    if (work.parent || work.status === "completed") throw Error("The highest supervisor is unavailable.");
    const nativeSend = userMessage2(work, verified.instance, kind + "\n" + JSON.stringify(body), verified.status);
    await works.verifyHost(workId, verified.hostGeneration);
    if (!store.claimQuestionEvent(workId, id2, "sending", nativeSend)) return;
    sending = true;
    const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
    return store.updateQuestionEvent(workId, id2, { state: accepted2(receipt, nativeSend, verified.instance) ? "accepted" : "unknown" });
  } catch (error) {
    return store.updateQuestionEvent(workId, id2, { state: sending ? "unknown" : "queued", detail: String(error.message).slice(0, 1200) });
  }
}

// src/local/questions-store.mjs
var hash = (v) => createHash2("sha256").update(JSON.stringify(v)).digest("hex");
var text = (v, n = 8e3) => typeof v === "string" && v.trim().length > 0 && v.length <= n;
function questionStore({ db, readPrivate, putPrivate, readWork, listDispatches, effectiveTeamForWork, atomic }) {
  const list = (workId) => db.prepare("SELECT json FROM receipts WHERE id LIKE 'question:%'").all().map((r) => {
    const q = JSON.parse(r.json);
    if (q.format !== "team-question-v1" || !["id", "workId", "teamId", "fromMemberId", "runId", "summary"].every((k) => text(q[k])) || !Number.isSafeInteger(q.revision) || q.revision < 1 || !Number.isSafeInteger(q.generation) || q.generation < 1 || !["options", "blockingTaskKeys", "evidence", "answers"].every((k) => Array.isArray(q[k])) || q.options.some((v) => !text(v, 2e3)) || q.blockingTaskKeys.some((v) => !text(v, 120)) || q.evidence.some((v) => !text(v, 2e3)) || !["queued", "attempted", "delivered", "unconfirmed", "unavailable"].includes(q.notification?.state) || q.answers.some((a) => !text(a.id, 120) || !text(a.body) || !["queued", "sending", "accepted", "unknown", "blocked"].includes(a.state) || !["unconfirmed", "confirmed"].includes(a.processed) || a.revision !== q.revision || a.from !== "user" || a.toMemberId !== q.fromMemberId || a.supplement !== void 0 && typeof a.supplement !== "boolean" || a.supersedesBlockedAnswers !== void 0 && (!Array.isArray(a.supersedesBlockedAnswers) || a.supplement !== true || a.supersedesBlockedAnswers.some((id2) => !text(id2, 120)) || new Set(a.supersedesBlockedAnswers).size !== a.supersedesBlockedAnswers.length)) || new Set(q.answers.map((a) => a.id)).size !== q.answers.length || !["pending", "answered", "closed"].includes(q.status)) throw Error("Saved pending question is damaged; preserve original data.");
    return q;
  }).filter((q) => q.workId === workId);
  const api = {
    listQuestions: list,
    readQuestionEvent: (workId, id2) => readPrivate(`question-event:${workId}:${id2}`),
    claimQuestionAnswer(workId, id2, answerId, nativeSend, supersedesBlockedAnswers = []) {
      return atomic(() => {
        if (readWork(workId)?.status === "completed") throw Error("Completed TeamWork is sealed.");
        const key = `question:${workId}:${id2}`, q = readPrivate(key), a = q?.answers.find((a2) => a2.id === answerId);
        if (!a || a.state !== "queued") return false;
        if (supersedesBlockedAnswers.length) {
          const expected = q.answers.slice(0, q.answers.indexOf(a)).filter(isUnsentBlockedAnswer).map((row) => row.id);
          if (!q.sourceReport || a.supplement !== true || JSON.stringify(expected) !== JSON.stringify(supersedesBlockedAnswers)) throw Error("Explicit report supplement supersession changed.");
          a.supersedesBlockedAnswers = supersedesBlockedAnswers;
        }
        Object.assign(a, { state: "sending", nativeSend });
        putPrivate(key, q);
        return true;
      });
    },
    claimQuestionNotification(workId, id2) {
      return atomic(() => {
        if (readWork(workId)?.status === "completed") throw Error("Completed TeamWork is sealed.");
        const key = `question:${workId}:${id2}`, q = readPrivate(key);
        if (q?.notification.state !== "queued") return false;
        q.notification = { state: "attempted" };
        putPrivate(key, q);
        return true;
      });
    },
    claimQuestionEvent(workId, id2, state, nativeSend) {
      return atomic(() => {
        const key = `question-event:${workId}:${id2}`, e = readPrivate(key);
        if (e?.state !== "queued") return false;
        Object.assign(e, { state, ...nativeSend ? { nativeSend } : {} });
        putPrivate(key, e);
        return true;
      });
    },
    listTeamMessages(workId) {
      return db.prepare("SELECT json FROM receipts WHERE id LIKE 'team-message:%'").all().map((r) => JSON.parse(r.json)).filter((r) => r.workId === workId);
    },
    ingestTeamMessage(workId, message) {
      return atomic(() => {
        const a = listDispatches(workId).find((a2) => a2.id === message.attemptId);
        if (!a || a.memberId !== message.fromMemberId) throw Error("Message sender is not an admitted member.");
        const work = readWork(workId), team = effectiveTeamForWork?.(workId) ?? JSON.parse(db.prepare("SELECT json FROM team_versions WHERE team_id=? AND version=?").get(work.teamId, work.configVersion)?.json ?? "null"), managers = team?.members.filter((m) => ["head", "lead", "ceo"].includes(m.role)).map((m) => m.id) ?? [];
        const managerPeer = managers.includes(message.fromMemberId) && managers.includes(message.toMemberId);
        if (message.toMemberId !== a.supervisorMemberId && !managerPeer && !api.listCollaborations(workId).some((d) => d.fromAttemptId === a.id && d.toAttemptId === message.toAttemptId && d.toMemberId === message.toMemberId)) throw Error("Worker collaboration requires its supervisor directive.");
        const key = `team-message:${workId}:${message.id}`, prior = readPrivate(key);
        if (prior) {
          if (hash(prior) !== hash(message)) throw Error("Native message identity conflicts.");
          return prior;
        }
        putPrivate(key, message);
        return message;
      });
    },
    listCollaborations(workId) {
      return db.prepare("SELECT json FROM receipts WHERE id LIKE 'collaboration:%'").all().map((r) => JSON.parse(r.json)).filter((r) => r.workId === workId);
    },
    ingestCollaboration(workId, intent) {
      return atomic(() => {
        const s = intent.spec, work = readWork(workId), attempts = listDispatches(workId), from = attempts.find((a) => a.id === s.fromAttemptId), to = attempts.find((a) => a.id === s.toAttemptId);
        if (!from || !to || from.id === to.id || from.memberId !== s.fromMemberId || to.memberId !== s.toMemberId || from.supervisorMemberId !== work.supervisorMemberId || to.supervisorMemberId !== work.supervisorMemberId || !from.binding || !to.binding || from.status !== "running" || to.status !== "running") throw Error("Collaboration must name two current admitted direct children of this supervisor.");
        const key = `collaboration:${workId}:${s.appQuestionId}`, fingerprint2 = hash(intent), prior = readPrivate(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint2) throw Error("Collaboration identity conflicts.");
          return prior;
        }
        const row = { id: s.appQuestionId, workId, fromMemberId: from.memberId, toMemberId: to.memberId, fromAttemptId: from.id, toAttemptId: to.id, fromDispatchId: from.dispatchId, toDispatchId: to.dispatchId, reportToMemberId: from.supervisorMemberId, configVersion: effectiveTeamForWork?.(workId)?.configVersion ?? work.configVersion, fromConfigVersion: from.configVersion, toConfigVersion: to.configVersion, fromRoleVersion: from.roleVersion, toRoleVersion: to.roleVersion, processing: "unconfirmed", fingerprint: fingerprint2, nativeTaskId: intent.nativeTaskId, payloadHash: intent.payloadHash };
        putPrivate(key, row);
        return row;
      });
    },
    ensureQuestionEvent(workId, id2, kind, data) {
      return atomic(() => {
        const key = `question-event:${workId}:${id2}`, prior = readPrivate(key);
        if (prior) return prior;
        const event = { id: id2, workId, kind, data, state: "queued" };
        putPrivate(key, event);
        return event;
      });
    },
    updateQuestionEvent(workId, id2, patch) {
      return atomic(() => {
        const key = `question-event:${workId}:${id2}`, event = readPrivate(key);
        if (!event) throw Error("Question event missing.");
        Object.assign(event, patch);
        putPrivate(key, event);
        return event;
      });
    },
    questionProjection: (workId) => ({ messages: api.listTeamMessages(workId).map(({ payloadHash, controlProof: controlProof2, ...row }) => row), collaborations: api.listCollaborations(workId).map(({ fingerprint: fingerprint2, payloadHash, ...row }) => row), questions: list(workId).map(({ fingerprint: fingerprint2, proof, ...q }) => ({ ...q, supersedableBlockedAnswers: q.sourceReport ? q.answers.filter(isUnsentBlockedAnswer).map((a) => a.id) : [], origin: q.sourceReport ? null : q.origin ? Object.fromEntries(Object.entries(q.origin).filter(([k]) => k !== "askParams")) : null, resolution: q.resolution ? (({ sessionDecision, ...r }) => r)(q.resolution) : void 0, answers: q.answers.map(({ nativeSend, fingerprint: fingerprint3, sessionDecision, ...a }) => a) })), failureStreaks: api.failureStreaks(workId) }),
    ingestQuestion(workId, intent) {
      return atomic(() => {
        const work = readWork(workId), s = intent.spec, key = `question:${workId}:${s.appQuestionId}`, fingerprint2 = hash(intent), prior = readPrivate(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint2) throw Error("Question ID conflicts with existing immutable question.");
          return prior;
        }
        if (work.parent ? s.kind !== "relay-question" : s.kind !== "user-question") throw Error("Only the highest supervisor asks the user; lower managers relay.");
        if (s.relay) {
          const child = readWork(s.relay.workId), q2 = list(s.relay.workId).find((q3) => q3.id === s.relay.appQuestionId);
          if (!child?.parent || child.parent.workId !== workId || !q2 || !s.origin || s.origin.attemptId !== child.parent.attemptId) throw Error("Relay must preserve the actual direct manager and its original parent question.");
        }
        const q = { format: "team-question-v1", id: s.appQuestionId, workId, teamId: work.teamId, fromMemberId: work.supervisorMemberId, to: work.parent ? "manager" : "user", ...s.relay ? { relay: s.relay } : {}, runId: work.run.id, generation: work.run.consumerGeneration, epoch: work.epoch ?? 0, revision: 1, status: "pending", summary: s.summary, options: s.options, blockingTaskKeys: s.blockingTaskKeys, origin: s.origin ?? null, evidence: s.evidence ?? [], proof: intent, fingerprint: fingerprint2, answers: [], createdAt: (/* @__PURE__ */ new Date()).toISOString(), notification: { state: "queued" } };
        putPrivate(key, q);
        return q;
      });
    },
    queueQuestionAnswer(input) {
      return atomic(() => {
        if (readWork(input?.workId)?.status === "completed") throw Error("Completed TeamWork is sealed.");
        if (!input || !text(input.answerId, 120) || !/^[a-zA-Z0-9-]+$/.test(input.answerId) || !text(input.body) || typeof input.supplement !== "boolean") throw Error("Invalid user answer.");
        if (readWork(input.workId)?.parent) throw Error("Only the highest supervisor receives user answers.");
        const q = readPrivate(`question:${input.workId}:${input.questionId}`);
        if (!q) throw Error("Saved question is unavailable.");
        const fingerprint2 = hash(input), global = readPrivate(`question-answer:${input.answerId}`);
        if (global && global.fingerprint !== fingerprint2) throw Error("Answer identity conflicts with another question.");
        const old = q.answers.find((a2) => a2.id === input.answerId);
        if (old) {
          if (old.fingerprint !== fingerprint2) throw Error("Answer identity conflicts; submit an explicit supplement.");
          return old;
        }
        if (q.revision !== input.questionRevision || q.status === "closed") throw Error("Question changed or closed; reopen its saved evidence.");
        if (q.answers.length && !input.supplement) throw Error("An answer already exists; submit an explicit supplement.");
        const a = { id: input.answerId, body: input.body, supplement: input.supplement, revision: q.revision, from: "user", toMemberId: q.fromMemberId, state: "queued", processed: "unconfirmed", fingerprint: fingerprint2, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        q.answers.push(a);
        q.status = "pending";
        putPrivate(`question:${q.workId}:${q.id}`, q);
        putPrivate(`question-answer:${a.id}`, { workId: q.workId, questionId: q.id, fingerprint: fingerprint2 });
        return a;
      });
    },
    recordSessionAnswer(workId, intent) {
      return atomic(() => {
        const s = intent.spec, work = readWork(workId);
        validateSessionDecision(work, readPrivate(`dispatch-protocol:${workId}`), s);
        const q = readPrivate(`question:${workId}:${s.questionId}`);
        if (s.kind !== "session-answer" || !q || q.to !== "user" || q.runId !== work.run.id || q.generation !== work.run.consumerGeneration || (q.epoch ?? 0) !== (work.epoch ?? 0) || q.revision !== s.questionRevision || q.status === "closed" || !text(s.body) || typeof s.supplement !== "boolean" || s.nextNativeTaskId !== void 0 && !text(s.nextNativeTaskId, 120)) throw Error("Choose the exact current question and record the user answer.");
        const input = { workId, questionId: q.id, questionRevision: q.revision, answerId: s.appQuestionId, body: s.body, supplement: s.supplement }, fingerprint2 = hash({ input, intent }), global = readPrivate(`question-answer:${input.answerId}`);
        if (global && global.fingerprint !== fingerprint2) throw Error("Session answer identity conflicts.");
        const prior = q.answers.find((a2) => a2.id === input.answerId);
        if (prior) return prior;
        if (q.answers.length && !s.supplement) throw Error("An answer already exists; record an explicit user supplement.");
        const supersedesBlockedAnswers = q.sourceReport && s.supplement ? q.answers.filter(isUnsentBlockedAnswer).map((a2) => a2.id) : [];
        const a = { id: input.answerId, body: s.body, supplement: s.supplement, revision: q.revision, from: "user", toMemberId: q.fromMemberId, state: "accepted", processed: "unconfirmed", source: "supervisor-session", recordedBy: work.supervisorMemberId, sessionDecision: intent, fingerprint: fingerprint2, createdAt: (/* @__PURE__ */ new Date()).toISOString(), ...supersedesBlockedAnswers.length ? { supersedesBlockedAnswers } : {}, ...s.nextNativeTaskId ? { nextNativeTaskId: s.nextNativeTaskId } : {} };
        q.answers.push(a);
        q.status = "pending";
        putPrivate(`question:${workId}:${q.id}`, q);
        putPrivate(`question-answer:${a.id}`, { workId, questionId: q.id, fingerprint: fingerprint2 });
        return a;
      });
    },
    resolveSessionQuestion(workId, intent) {
      return atomic(() => {
        const s = intent.spec, work = readWork(workId);
        validateSessionDecision(work, readPrivate(`dispatch-protocol:${workId}`), s);
        const q = readPrivate(`question:${workId}:${s.questionId}`), wake = readPrivate(`wake:${s.recoveryRequestId}`);
        if (s.kind !== "session-resolution" || !q || q.to !== "user" || (q.epoch ?? 0) >= (work.epoch ?? 0) || wake?.state !== "bound" || wake.newInstance?.workId !== workId || work.recoveryRequestId !== wake.requestId || !text(s.note, 4e3)) throw Error("Only a reviewed superseded question can be resolved after verified recovery.");
        if (q.resolution) {
          if (hash(q.resolution.sessionDecision) !== hash(intent)) throw Error("Question resolution is immutable.");
          return q.resolution;
        }
        q.status = "closed";
        q.resolution = { kind: "superseded-by-recovery", by: "user", source: "supervisor-session", recordedBy: work.supervisorMemberId, recoveryRequestId: wake.requestId, note: s.note, sessionDecision: intent, recordedAt: (/* @__PURE__ */ new Date()).toISOString() };
        putPrivate(`question:${workId}:${q.id}`, q);
        return q.resolution;
      });
    },
    updateQuestion(workId, id2, change) {
      return atomic(() => {
        if (readWork(workId)?.status === "completed") throw Error("Completed TeamWork is sealed.");
        const key = `question:${workId}:${id2}`, q = readPrivate(key);
        if (!q) throw Error("Question missing.");
        change(q);
        putPrivate(key, q);
        return q;
      });
    },
    failureStreaks(workId) {
      const groups = /* @__PURE__ */ new Map();
      for (const a of listDispatches(workId)) {
        const key = a.businessTaskKey ?? a.taskKey;
        const rows = groups.get(key) ?? [];
        rows.push(a);
        groups.set(key, rows);
      }
      return [...groups].map(([taskKey, rows]) => {
        let failures = [];
        const seen = /* @__PURE__ */ new Set(), seenEvidence = /* @__PURE__ */ new Set();
        for (const a of rows.sort((a2, b) => a2.createdAt.localeCompare(b.createdAt))) {
          if (a.admission !== "committed" || !a.evidenceId?.startsWith("worker_report:") || seen.has(a.id) || seenEvidence.has(a.evidenceId) || !["failed", "succeeded"].includes(a.outcome)) continue;
          seen.add(a.id);
          seenEvidence.add(a.evidenceId);
          if (a.outcome === "succeeded") failures = [];
          else failures.push({ attemptId: a.id, evidenceId: a.evidenceId, dispatchId: a.dispatchId, nativeTaskId: a.nativeTaskId });
        }
        return { taskKey, count: failures.length, evidence: failures, escalationNeeded: failures.length >= 2 };
      });
    },
    questionTaskGate(workId, taskKey, nativeTaskId) {
      const q = list(workId).find((q2) => q2.status === "pending" && q2.blockingTaskKeys.includes(taskKey));
      if (q) throw Error("This task is waiting for a user decision; independent tasks may continue.");
      const streak = api.failureStreaks(workId).find((s) => s.taskKey === taskKey && s.escalationNeeded);
      if (streak && !list(workId).some((q2) => q2.blockingTaskKeys.includes(taskKey) && q2.answers.some((a) => a.processed === "confirmed" && a.nextNativeTaskId === nativeTaskId) && streak.evidence.slice(-2).every((e) => q2.evidence.includes(e.evidenceId)))) throw Error("Two proven execution failures require the highest supervisor summary and a user decision before another attempt.");
    }
  };
  return api;
}

// src/team.mjs
var PRESETS = [
  { label: "Squad", sketch: "\u25CF\u252C\u25CB\u25CB\u25CB", hint: "Head + 3 workers", form: { name: "Squad", structure: "team", levels: 2, fan: 3, groups: "" } },
  { label: "All-Purpose Team", sketch: "\u25A0\u252C\u25CF\u25CF", hint: "CEO + 2 heads, 4 workers each", form: { name: "All-Purpose-Team", structure: "organisation", levels: 3, fan: 4, groups: "Team 1, Team 2" } },
  { label: "Tech Team", sketch: "\u25A0\u252C\u25CF\u25CF\u25CF\u25CF", hint: "CEO + 4 heads, 4 workers each", form: { name: "Tech-Team", structure: "organisation", levels: 3, fan: 4, groups: "Dev Team, UI Team, Test Team, Security Team" } }
];
var DEFAULT_FORM = { ...PRESETS[0].form, purpose: "", launchMode: "on-demand", agents: ["codex", "codex", "codex"], models: ["default", "default", "default"], efforts: ["default", "default", "default"] };
var SETTINGS = { chart: true, layout: "stacked" };
var GLYPHS = { ceo: "\u25A0", head: "\u25CF", lead: "\u25C7", worker: "\u25CB" };
function cleanName(value) {
  return value.trim().replace(/\s+/g, "-");
}
function nameValid(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}
function planTeam(form) {
  if (form.launchMode !== void 0 && !["on-demand", "all"].includes(form.launchMode)) throw Error("Choose a supported launch mode.");
  const name = cleanName(form.name);
  if (!nameValid(name)) throw new Error("Use a team name of 1\u201364 letters, numbers, underscores or dashes, starting with a letter or number.");
  if (!["team", "organisation"].includes(form.structure)) throw new Error("Choose a team structure.");
  if (![1, 2, 3].includes(form.levels) || ![1, 2, 3, 4, 5].includes(form.fan)) throw new Error("Choose 1\u20133 levels and 1\u20135 reports per manager.");
  if (typeof form.purpose !== "string" || form.purpose.length > 500) throw new Error("Keep the team function under 500 characters.");
  for (const values of [form.models, form.efforts]) {
    if (!Array.isArray(values) || values.length !== 3 || values.some((value) => typeof value !== "string" || !value || value.length > 120)) throw new Error("Invalid model or effort selection.");
  }
  if (form.models.some((model, i) => model === "default" && form.efforts[i] !== "default")) throw new Error("Choose a model before overriding its effort.");
  const agents = form.agents ?? ["codex", "codex", "codex"];
  if (!Array.isArray(agents) || agents.length !== 3 || agents.some((agent) => !["codex", "claude"].includes(agent))) throw new Error("Choose Codex or Claude Code for each level.");
  const members = [];
  const add = (memberName, team, role, level, boss) => {
    const id2 = `member-${members.length + 1}`;
    const purpose = form.purpose.trim() || "the team goal";
    const brief = role === "worker" ? `Execute tasks from ${boss.name} and report back.` : `Own ${purpose}; plan, delegate to direct reports, review results and report to ${boss?.name || "the user"}.`;
    const member = { id: id2, name: memberName, team, role, level, boss: boss?.id || null, model: form.models[level - 1], effort: form.efforts[level - 1], agent: agents[level - 1], state: "unassigned", brief };
    members.push(member);
    return member;
  };
  if (form.structure === "organisation") {
    const groups = form.groups.split(",").map(cleanName);
    if (!groups.length || groups.length > 8 || groups.some((group) => !nameValid(group))) throw new Error("Enter 1\u20138 team names separated by commas.");
    if (new Set(groups.map((group) => group.toLowerCase())).size !== groups.length) throw new Error("Team names must be unique.");
    if (groups.some((group) => group.toLowerCase() === name.toLowerCase())) throw new Error("Give the organisation and its teams different names.");
    const ceo = add("CEO", name, "ceo", 1, null);
    for (const group of groups) {
      const head = add(`${group}-Head`, group, "head", 2, ceo);
      for (let i = 1; i <= form.fan; i++) add(`${group}-Worker-${i}`, group, "worker", 3, head);
    }
  } else {
    let tier = [add("Head", name, "head", 1, null)];
    for (let level = 2; level <= form.levels; level++) {
      const next = [];
      tier.forEach((boss, index) => {
        for (let i = 1; i <= form.fan; i++) {
          const role = level === form.levels ? "worker" : "lead";
          const suffix = form.levels === 2 ? `${i}` : `${index + 1}-${i}`;
          next.push(add(`${role === "worker" ? "Worker" : "Lead"}-${suffix}`, name, role, level, boss));
        }
      });
      tier = next;
    }
  }
  return { name, purpose: form.purpose.trim(), structure: form.structure, members, configuration: { ...form, agents } };
}
function addTeam(state, team) {
  const incoming = new Set([team.name, ...team.members.map((member) => member.team)].map((name) => name.toLowerCase()));
  if (state.teams.some((existing) => [existing.name, ...existing.members.map((member) => member.team)].some((name) => incoming.has(name.toLowerCase())))) throw new Error("A team with this name already exists. Choose a different name; existing teams are never replaced.");
  return { ...state, teams: [...state.teams, team] };
}
function validateState(value) {
  if (value === null) return { version: 1, teams: [], settings: { ...SETTINGS } };
  if (!value || value.version !== 1 || !Array.isArray(value.teams) || value.teams.length > 100) throw new Error("Saved team data has an unsupported format. It has been left untouched.");
  const string = (s, max = 120) => typeof s === "string" && s.length > 0 && s.length <= max;
  let validated = { version: 1, teams: [], settings: { ...SETTINGS } };
  for (const team of value.teams) {
    if (!team || !nameValid(team.name) || typeof team.purpose !== "string" || team.purpose.length > 500 || !["team", "organisation"].includes(team.structure) || !Array.isArray(team.members) || !team.members.length || team.members.length > 49) throw new Error("Saved team data is invalid. It has been left untouched.");
    const ids = /* @__PURE__ */ new Set();
    const names = /* @__PURE__ */ new Set();
    for (const member of team.members) {
      if (!member || !string(member.id) || !string(member.name) || !nameValid(member.team) || !Object.hasOwn(GLYPHS, member.role) || ![1, 2, 3].includes(member.level) || !["codex", "claude"].includes(member.agent) || member.state !== "unassigned" || !string(member.model) || !string(member.effort) || !string(member.brief, 1500) || ids.has(member.id) || names.has(member.name.toLowerCase())) throw new Error("Saved member data is invalid. It has been left untouched.");
      if (member.boss !== null && !ids.has(member.boss)) throw new Error("Saved reporting relationships are invalid. It has been left untouched.");
      if (member.boss === null && ids.size !== 0) throw new Error("Saved team has multiple roots. It has been left untouched.");
      if (member.boss === null && member.level !== 1 || member.boss !== null && team.members.find((boss) => boss.id === member.boss)?.level !== member.level - 1) throw new Error("Saved hierarchy levels are invalid. It has been left untouched.");
      ids.add(member.id);
      names.add(member.name.toLowerCase());
    }
    if (team.configuration) {
      const planned = planTeam(team.configuration);
      if (JSON.stringify(planned.members) !== JSON.stringify(team.members) || planned.name !== team.name || planned.purpose !== team.purpose || planned.structure !== team.structure) throw new Error("Saved launch configuration does not match its roster. It has been left untouched.");
    }
    if (team.launch) {
      const request = team.launch;
      if (!["sending", "accepted", "rejected", "unknown"].includes(request.status) || !["on-demand", "all"].includes(request.mode)) throw new Error("Saved launch request is invalid. It has been left untouched.");
      if (request.native === true) {
        if (!/^[a-f0-9]{64}$/.test(request.workspaceKey) || !request.members || typeof request.members !== "object" || Array.isArray(request.members)) throw new Error("Saved native launch is invalid. It has been left untouched.");
        for (const [id2, receipt] of Object.entries(request.members)) {
          if (!ids.has(id2) || !receipt || !["starting", "created", "unknown"].includes(receipt.status) || receipt.error !== void 0 && !string(receipt.error, 1500) || receipt.status === "created" && (!string(receipt.terminalId, 1024) || !string(receipt.title, 512) || typeof receipt.briefAccepted !== "boolean" || receipt.executionHostId !== null && !string(receipt.executionHostId, 256))) throw new Error("Saved launch receipt is invalid. It has been left untouched.");
        }
      } else if (!string(request.terminalId, 1024)) throw new Error("Saved launch request is invalid. It has been left untouched.");
    }
    validated = addTeam(validated, team);
  }
  if (value.settings && typeof value.settings.chart === "boolean" && ["stacked", "columns"].includes(value.settings.layout)) validated.settings = { chart: value.settings.chart, layout: value.settings.layout };
  return validated;
}
function validatePersistentState(value) {
  if (!value || value.format !== "orca-team-store" || value.version !== 2 || !Number.isInteger(value.revision) || value.revision < 0 || !Array.isArray(value.teams) || value.teams.length > 100) throw new Error("Saved team data has an unsupported format. It has been left untouched.");
  const teamIds = /* @__PURE__ */ new Set(), memberIds = /* @__PURE__ */ new Set();
  for (const team of value.teams) {
    const uuid = (id2) => typeof id2 === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id2);
    if (!uuid(team.id) || teamIds.has(team.id) || !Number.isInteger(team.configVersion) || team.configVersion < 1 || !team.scope || !["git", "folder"].includes(team.scope.kind) || !/^(local|ssh:[^\s|]+)$/.test(team.scope.executionHostId) || !/^[a-f0-9]{64}$/.test(team.scope.workspaceKey) || typeof team.scope.displayName !== "string") throw new Error("Saved team identity or project binding is invalid. It has been left untouched.");
    const { configuration, scope, ...roster } = team;
    validateState({ version: 1, teams: [roster] });
    for (const member of team.members) {
      if (member.preferenceOverride !== void 0 && typeof member.preferenceOverride !== "boolean" || !uuid(member.id) || memberIds.has(member.id) || !Number.isInteger(member.roleVersion) || member.roleVersion < 1 || [member.habits, member.collaboration].some((text8) => typeof text8 !== "string" || text8.length > 1500)) throw new Error("Saved role identity/version is invalid. It has been left untouched.");
      memberIds.add(member.id);
    }
    teamIds.add(team.id);
  }
  if (typeof value.settings?.chart !== "boolean" || !["stacked", "columns"].includes(value.settings.layout)) throw new Error("Saved display settings are invalid. It has been left untouched.");
  return value;
}

// src/work.mjs
function workInput(input) {
  if (!input || Object.keys(input).some((key) => !["teamId", "requestId", "expectedRevision", "objective"].includes(key)) || typeof input.teamId !== "string" || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || typeof input.objective !== "string" || !input.objective.trim() || input.objective.length > 8e3) throw Error("Choose a saved team and a total objective of 1\u20138000 characters.");
  return input;
}
function validateWork(work) {
  const text8 = (value, max = 4096) => typeof value === "string" && value.length > 0 && value.length <= max;
  const fail4 = () => {
    throw Error("Saved TeamWork evidence is damaged; existing data was preserved.");
  };
  if (!work || work.format !== "team-work-v1" || !text8(work.id, 120) || !text8(work.teamId, 120) || !text8(work.requestId, 120) || !text8(work.supervisorMemberId, 120) || !text8(work.objective, 8e3) || !text8(work.protocolToken, 120) || !Number.isSafeInteger(work.version) || work.version < 1 || !Number.isSafeInteger(work.configVersion) || work.configVersion < 1 || !Number.isSafeInteger(work.roleVersion) || work.roleVersion < 1 || !["preparing", "awaiting_input", "awaiting_run", "active", "needs_attention", "awaiting_acceptance", "completed"].includes(work.status)) fail4();
  if (work.parent && (!text8(work.teamWorkId, 120) || work.teamWorkId === work.id || !["workId", "runId", "taskId", "dispatchId", "attemptId"].every((k) => text8(work.parent[k], 256)) || !Number.isSafeInteger(work.parent.generation) || work.parent.generation < 1 || (work.binding?.sourceAttemptId ?? work.binding?.originAttemptId) !== work.parent.attemptId)) fail4();
  const scope = work.scope, binding = work.binding;
  if (!scope || !text8(scope.workspaceId) || !text8(scope.displayName) || !["git", "folder"].includes(scope.kind) || !/^(local|ssh:[^\s|]+)$/.test(scope.executionHostId) || !/^[a-f0-9]{64}$/.test(scope.workspaceKey) || !binding || binding.status !== "created" || binding.teamId !== work.teamId || binding.memberId !== work.supervisorMemberId || !text8(binding.requestId, 120) || !text8(binding.runtimeId, 256) || !["structured", "terminal"].includes(binding.kind) || !text8(binding.handle) || binding.scope?.workspaceId !== scope.workspaceId || binding.scope?.executionHostId !== scope.executionHostId || binding.scope?.workspaceKey !== scope.workspaceKey || binding.kind === "structured" && !text8(binding.sessionId)) fail4();
  if (work.nativeObjective !== `TeamWork ${work.id} ${work.protocolToken}
${work.objective}` || !["not_sent", "sending", "accepted", "queued", "unknown", "rejected"].includes(work.input?.state) || !["unknown", "observed"].includes(work.processing?.state) || !["unverified", "verified", "fenced"].includes(work.run?.state)) fail4();
  if (work.run.state === "verified" && (!text8(work.run.id, 256) || !Number.isSafeInteger(work.run.consumerGeneration) || work.run.consumerGeneration < 1)) fail4();
  if (work.input.state !== "not_sent" && (!work.nativeSend || !["agentSession.send", "terminal.send"].includes(work.nativeSend.method) || !work.nativeSend.params)) fail4();
  if (work.nativeSend) {
    const request = work.nativeSend.params, instance = work.instance;
    if (!instance || instance.kind !== binding.kind) fail4();
    if (binding.kind === "structured") {
      if (work.nativeSend.method !== "agentSession.send" || request.envelope?.sessionId !== binding.sessionId || instance.liveSessionId !== binding.sessionId || !text8(instance.sessionId) || request.envelope?.expectedRuntimeFence !== instance.fence || !Number.isSafeInteger(instance.fence) || instance.fence < 1 || !/^[0-9]{13}-[0-9a-f]{32}$/.test(request.envelope?.clientOperationId) || !/^[a-f0-9]{64}$/.test(request.envelope?.payloadFingerprint) || request.body?.kind !== "message" || request.body?.role !== "user" || !Array.isArray(request.body.blocks) || request.body.blocks.length !== 1 || request.body.blocks[0].type !== "text" || !text8(request.body.blocks[0].text, 3e4)) fail4();
    } else if (work.nativeSend.method !== "terminal.send" || request.terminal !== binding.handle || instance.handle !== binding.handle || instance.paneKey !== binding.paneKey || !text8(instance.incarnationId) || request.agentPrompt !== true || request.enter !== true || !text8(request.text, 3e4) || !/^[0-9a-f-]{36}$/.test(work.nativeSend.envelope?.orchestrationRequestId)) fail4();
  }
  if (work.currentSupervisor) {
    const current = work.currentSupervisor;
    if (!Number.isSafeInteger(current.epoch) || current.epoch < 1 || !text8(current.recoveryRequestId, 120)) fail4();
    validateWork({ ...work, ...current, currentSupervisor: void 0, nativeSend: current.nativeSend });
  }
  return work;
}
function publicWork(work) {
  validateWork(work);
  const fields2 = ["id", "teamId", "supervisorMemberId", "objective", "configVersion", "roleVersion", "createdAt", "version", "epoch", "recoveryRequestId", "status", "processing", "run", "snapshot", "error", "closedAt", "handoff", "historyPruned"];
  return { ...work.run.id && work.run.state === "unverified" && work.input.state === "accepted" && work.scope.executionHostId === "local" && work.binding.kind === "terminal" && !work.parent && !work.recoveryRequestId && work.status !== "completed" ? { canReconnectRuntime: true } : {}, ...work.runtimeControl ? { runtimeRecovery: { state: "reconnected", requestId: work.runtimeControl.requestId, reconnectedAt: work.runtimeControl.createdAt } } : {}, ...Object.fromEntries(fields2.filter((key) => work[key] !== void 0).map((key) => [key, work[key]])), scope: { displayName: work.scope.displayName, kind: work.scope.kind, executionHostId: work.scope.executionHostId }, input: { state: work.input.state, ...work.input.source ? { source: work.input.source } : {}, ...work.input.dispatchState ? { dispatchState: work.input.dispatchState } : {}, ...work.input.queued ? { queued: work.input.queued } : {}, ...work.input.messageId ? { messageId: work.input.messageId } : {}, ...work.input.detail ? { detail: work.input.detail } : {} } };
}

// src/scheduling.mjs
function declaredWriteScope(value) {
  if (!Array.isArray(value) || value.length > 100) throw Error("Declare writeScope as an array of file/directory paths; [] explicitly declares no writes.");
  return value.map((entry) => {
    if (!entry || Object.keys(entry).some((key) => !["path", "kind"].includes(key)) || !["file", "directory"].includes(entry.kind) || typeof entry.path !== "string" || !entry.path || entry.path.length > 2048) throw Error("Invalid declared write scope.");
    const path = entry.path.replaceAll("\\", "/").replace(/\/+$/, "").normalize("NFC");
    if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || /[\x00-\x1f*?]/.test(path) || path.split("/").some((part) => !part || part === ".." || part === "." && path !== ".") || path === "." && entry.kind !== "directory") throw Error("Write scope must use relative files or directories within the shared workspace.");
    return { path, kind: entry.kind };
  });
}
function scopeConflict(left, right) {
  const covers = (a, b) => a.path === b.path || a.kind === "directory" && (a.path === "." || b.path.startsWith(a.path + "/"));
  return left.some((a) => right.some((b) => {
    a = { ...a, path: a.path.toLowerCase() };
    b = { ...b, path: b.path.toLowerCase() };
    return covers(a, b) || covers(b, a);
  }));
}
function scopeBlocker(history, taskKey, scope) {
  const latest = new Map(history.map((row) => [row.taskKey, row]));
  return [...latest.values()].find((row) => row.taskKey !== taskKey && !["accepted", "rejected"].includes(row.status) && scopeConflict(scope, row.writeScope ?? [{ path: ".", kind: "directory" }]));
}

// src/dispatch.mjs
var DISPATCH_OBSERVATION_CHANGED = "Dispatch attempt changed while observing evidence.";
var WORKER_RULES = "Use only approved roster members through admitted native Orca dispatch. Do not self-create provider-native subagents. Report results and questions to your original direct manager; assigned collaboration does not transfer acceptance. These are cooperative role instructions, not global provider tool interception.";
var DISPATCH_STATUSES = ["admitted", "awaiting_start", "running", "unknown", "pending_acceptance", "accepted", "rework", "rejected"];
var text2 = (value, limit = 4096) => typeof value === "string" && value.length > 0 && value.length <= limit;
function validateDispatch(row) {
  if (!row || row.format !== "team-dispatch-v1" || !["id", "workId", "teamId", "memberId", "supervisorMemberId", "nativeTaskId", "taskKey", "attemptId"].every((key) => text2(row[key], 256)) || !DISPATCH_STATUSES.includes(row.status) || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isSafeInteger(row.configVersion) || !Number.isSafeInteger(row.roleVersion) || !text2(row.instruction, 8e3) || !text2(row.token, 256) || !Number.isSafeInteger(row.generation) || row.generation < 1 || !row.startParams || !["not_sent", "sending", "accepted", "unknown"].includes(row.permit?.state)) throw Error("Saved Dispatch evidence is damaged; preserve the original data.");
  if (!["committed", "unadmitted"].includes(row.admission) || row.startParams.task !== row.nativeTaskId || row.startParams.run !== row.runId || !text2(row.runId, 256) || !row.scope?.workspaceId) throw Error("Saved Dispatch evidence is damaged; preserve the original data.");
  if (Object.keys(row.startParams).some((key) => !["task", "run", "worktree", "agent", "model", "effort", "terminal"].includes(key)) || (row.startParams.terminal ? !row.reuse || row.reuse.terminal !== row.startParams.terminal || ["agent", "model", "effort"].some((key) => row.startParams[key] !== void 0) : !["codex", "claude"].includes(row.startParams.agent)) || row.startParams.worktree !== (row.scope.workspaceId.startsWith("folder:") ? row.scope.workspaceId : `id:${row.scope.workspaceId}`)) throw Error("Saved Dispatch launch input is damaged; preserve the original data.");
  if (["running", "pending_acceptance", "accepted", "rework"].includes(row.status) && (!text2(row.dispatchId, 256) || !row.binding || !text2(row.binding.handle) || !text2(row.binding.incarnationId) && !(row.binding.kind === "structured" && text2(row.binding.sessionId) && Number.isSafeInteger(row.binding.sessionFence) && row.binding.sessionFence > 0))) throw Error("Saved Dispatch binding is damaged; preserve the original data.");
  if (["pending_acceptance", "accepted", "rework"].includes(row.status) && (!["succeeded", "failed"].includes(row.outcome) || !text2(row.evidenceId, 256) || typeof row.result !== "string")) throw Error("Saved Dispatch completion evidence is damaged; preserve the original data.");
  if (row.dependencies !== void 0 && (!Array.isArray(row.dependencies) || row.dependencies.some((key) => !text2(key, 120)))) throw Error("Saved task dependencies are damaged; preserve the original data.");
  if (["accepted", "rework"].includes(row.status) && (!row.review || row.review.decision !== (row.status === "accepted" ? "accept" : "rework") || !text2(row.review.requestId) || !text2(row.review.payloadHash) || !text2(row.review.recordedAt) || row.review.reviewerMemberId !== row.supervisorMemberId || !Array.isArray(row.review.evidenceRefs) || !row.review.evidenceRefs?.includes(row.evidenceId) || !text2(row.review.summary, 8e3))) throw Error("Saved supervisor review is damaged; preserve the original data.");
  if (row.writeScope !== void 0) declaredWriteScope(row.writeScope);
  return row;
}
function validateDispatchProtocol(row) {
  if (!row || row.format !== "team-dispatch-protocol-v1" || !text2(row.workId, 120) || !text2(row.token, 120) || !Number.isSafeInteger(row.generation) || row.generation < 1 || !Number.isSafeInteger(row.version) || row.version < 1 || !["not_sent", "sending", "accepted", "unknown", "fenced"].includes(row.state) || row.state === "not_sent" && row.nativeSend || ["sending", "accepted", "unknown"].includes(row.state) && !row.nativeSend) throw Error("Saved dispatch protocol is damaged; preserve the original data.");
  return row;
}
function publicDispatch(row) {
  validateDispatch(row);
  const keys = ["workId", "teamWorkId", "runId", "creatorDispatchId", "depth", "id", "nativeTaskId", "taskKey", "memberId", "memberName", "supervisorMemberId", "configVersion", "roleVersion", "attemptId", "instanceGeneration", "status", "admission", "instruction", "dispatchId", "outcome", "result", "evidenceId", "detail", "createdAt", "review", "dependencies", "writeScope", "previousAttemptId", "recovery", "sidebarNaming"];
  return Object.fromEntries(keys.filter((key) => row[key] !== void 0).map((key) => [key, row[key]]));
}
function publicDispatchProtocol(row, completed = false) {
  const superseded = completed && row?.state === "accepted" && row.detail === DISPATCH_OBSERVATION_CHANGED;
  return row ? { state: row.state, generation: row.generation, ...row.detail && !superseded ? { detail: row.detail } : {} } : void 0;
}

// src/local/storage-maintenance.mjs
var STORAGE_SCHEMA = 2;
var MAINTENANCE_DDL = "CREATE TABLE maintenance (id TEXT PRIMARY KEY, json TEXT NOT NULL)";
var hash2 = (value) => createHash3("sha256").update(value).digest("hex");
var quote = (id2) => '"' + id2.replaceAll('"', '""') + '"';
function storageDigest(db) {
  const tables = db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  return hash2(JSON.stringify(tables.map((t) => [t, t.type === "table" ? db.prepare(`SELECT * FROM ${quote(t.name)}`).all().map((r) => JSON.stringify(r)).sort() : null])));
}
function validateDatabase(db) {
  if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw Error("Damaged SQLite integrity");
  const schema = db.prepare("PRAGMA user_version").get().user_version;
  if (![1, STORAGE_SCHEMA].includes(schema)) throw Error(`Unsupported team database schema ${schema}; supported schemas 1\u2013${STORAGE_SCHEMA}. Use a compatible plugin; never downgrade or initialise this file.`);
  if (db.prepare("SELECT format FROM metadata").get()?.format !== "orca-team-store") throw Error("Unrecognized team database format");
  const snapshot = JSON.parse(db.prepare("SELECT json FROM snapshot WHERE id=1").get()?.json ?? "null");
  validatePersistentState(snapshot);
  for (const table of ["scopes", "team_versions", "role_versions", "receipts"]) for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
    const v = JSON.parse(row.json);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Damaged stored JSON object");
    if (table === "team_versions") {
      validatePersistentState({ ...snapshot, teams: [v] });
      if (v.id !== row.team_id || v.configVersion !== row.version) throw Error("Archived configuration identity mismatch");
    }
    if (table === "receipts") {
      if (row.id.startsWith("work:") || row.id.startsWith("native-run-binding:")) {
        validateWork(v);
        if (!db.prepare("SELECT 1 FROM team_versions WHERE team_id=? AND version=?").get(v.teamId, v.configVersion)) throw Error("Missing archived Work configuration");
      }
      if (row.id.startsWith("dispatch:")) {
        validateDispatch(v);
        if (!db.prepare("SELECT 1 FROM receipts WHERE id IN (?,?)").get(`work:${v.workId}`, `native-run-binding:${v.workId}`) || !db.prepare("SELECT 1 FROM team_versions WHERE team_id=? AND version=?").get(v.teamId, v.configVersion) || !db.prepare("SELECT 1 FROM role_versions WHERE member_id=? AND version=?").get(v.memberId, v.roleVersion)) throw Error("Missing Dispatch identity or archived configuration");
      }
      if (row.id.startsWith("wake:") && (!v.oldBinding || typeof v.oldBinding.requestId !== "string")) throw Error("Damaged recovery binding");
      if (row.id.startsWith("stop:") && (!v.target || typeof v.target.teamId !== "string" || typeof v.target.memberId !== "string")) throw Error("Damaged stop target");
      if (row.id.startsWith("dispatch-protocol:")) validateDispatchProtocol(v);
    }
  }
  for (const team of snapshot.teams) {
    const scope = JSON.parse(db.prepare("SELECT json FROM scopes WHERE team_id=?").get(team.id)?.json ?? "null");
    if (!scope || scope.workspaceKey !== team.scope.workspaceKey || scope.executionHostId !== team.scope.executionHostId || typeof scope.workspaceId !== "string") throw Error("Missing saved project identity");
    if (!db.prepare("SELECT 1 FROM team_versions WHERE team_id=? AND version=?").get(team.id, team.configVersion)) throw Error("Missing current archived configuration");
    for (const member of team.members) if (!db.prepare("SELECT 1 FROM role_versions WHERE member_id=? AND version=?").get(member.id, member.roleVersion)) throw Error("Missing current archived role");
  }
  questionStore({ db }).listQuestions("preflight");
  for (const row of db.prepare("SELECT result FROM requests").all()) {
    const v = JSON.parse(row.result);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Damaged saved request result");
    if (v.format === "orca-team-store") validatePersistentState(v);
  }
  if (schema === STORAGE_SCHEMA) for (const row of db.prepare("SELECT json FROM maintenance").all()) JSON.parse(row.json);
  return { schema, revision: snapshot.revision, digest: storageDigest(db) };
}
async function syncFile(path) {
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function privateDirectory(path, parent) {
  try {
    await mkdir(path, { mode: 448 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const real = await realpath(path), rel = relative(parent, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error("Backup directory escapes plugin storage");
  if ((await stat(real)).mode & 63) throw Error("Backup directory must be private (owner access only)");
  return real;
}
async function prepareStorage({ path, directory, DatabaseSync, backup }) {
  let source;
  try {
    source = new DatabaseSync(path, { readOnly: true });
    const original = validateDatabase(source);
    if (original.schema === STORAGE_SCHEMA) return { expected: original };
    if (typeof backup !== "function") throw Error("This worker lacks module-level node:sqlite backup; upgrade is blocked");
    const backups = await privateDirectory(join(directory, "backups"), directory), id2 = randomUUID(), partial = join(backups, `${id2}.partial`), final = join(backups, id2);
    await mkdir(partial, { mode: 448 });
    const destination = join(partial, "database.sqlite");
    const file = await open(destination, "wx", 384);
    await file.close();
    await backup(source, destination);
    const check = new DatabaseSync(destination, { readOnly: true });
    let verified;
    try {
      verified = validateDatabase(check);
    } finally {
      check.close();
    }
    if (verified.digest !== original.digest || storageDigest(source) !== original.digest) throw Error("Storage changed during backup; reopen to create a fresh backup before migration");
    await syncFile(destination);
    const manifest = { id: id2, createdAt: (/* @__PURE__ */ new Date()).toISOString(), sourceSchema: original.schema, format: "orca-team-store", sourceRevision: original.revision, pluginBuild: true ? "0.1.12" : "unbundled-development", sha256: hash2(await readFile(destination)), verified: true };
    const mf = await open(join(partial, "manifest.json"), "wx", 384);
    try {
      await mf.writeFile(JSON.stringify(manifest, null, 2));
      await mf.sync();
    } finally {
      await mf.close();
    }
    await syncFile(partial);
    await rename(partial, final);
    await syncFile(backups);
    return { expected: original, backupId: id2 };
  } finally {
    source?.close();
  }
}
function migrateStorage(db, prepared) {
  if (prepared.expected.schema === STORAGE_SCHEMA) {
    if (validateDatabase(db).schema !== STORAGE_SCHEMA) throw Error("Storage schema changed after preflight; reopen with a compatible plugin.");
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = validateDatabase(db);
    if (current.schema !== prepared.expected.schema || current.digest !== prepared.expected.digest) throw Error("Storage changed after backup; migration refused. Reopen for a fresh verified backup.");
    db.exec(MAINTENANCE_DDL);
    db.prepare("INSERT INTO maintenance VALUES(?,?)").run("migration:2", JSON.stringify({ from: 1, to: 2, backupId: prepared.backupId, recordedAt: (/* @__PURE__ */ new Date()).toISOString() }));
    db.exec(`PRAGMA user_version=${STORAGE_SCHEMA}`);
    validateDatabase(db);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw error;
  }
}
async function recoveryInventory(directory, DatabaseSync) {
  const rows = [];
  let names;
  const root = join(directory, "backups");
  try {
    const resolved = await realpath(root), rel = relative(directory, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) return rows;
    names = await readdir(root);
  } catch {
    return rows;
  }
  for (const id2 of names.filter((n) => /^[a-f0-9-]{36}(\.partial)?$/.test(n))) {
    if (id2.endsWith(".partial")) {
      rows.push({ id: id2, status: "incomplete-not-recoverable" });
      continue;
    }
    let check;
    try {
      const base = await realpath(join(root, id2)), rel = relative(root, base);
      if (rel.startsWith("..") || isAbsolute(rel)) continue;
      for (const file of ["manifest.json", "database.sqlite"]) {
        const path = await realpath(join(base, file));
        if (relative(base, path).startsWith("..")) throw Error("Escaping backup file");
      }
      const m = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
      if (!m.verified || m.id !== id2 || hash2(await readFile(join(base, "database.sqlite"))) !== m.sha256) throw Error("Backup hash mismatch");
      if (DatabaseSync) {
        check = new DatabaseSync(join(base, "database.sqlite"), { readOnly: true });
        const v = validateDatabase(check);
        if (v.schema !== m.sourceSchema || v.revision !== m.sourceRevision) throw Error("Backup manifest mismatch");
      }
      rows.push({ id: id2, createdAt: m.createdAt, sourceSchema: m.sourceSchema, status: "verified-backup" });
    } catch {
      rows.push({ id: id2, status: "invalid-not-recoverable" });
    } finally {
      check?.close();
    }
  }
  return rows;
}
async function inspectTeamStorage({ userData, sqlite = () => import("node:sqlite") } = {}) {
  const guidance = "Preserve the current database and its WAL/SHM/journal sidecars. Stop the plugin before taking a recovery copy. Use a compatible plugin for a newer schema. Restore only a verified backup with all writers stopped, then manually reconcile native effects after its cutoff before admitting work. Never reset storage or automatically relaunch missing operations.";
  try {
    if (typeof userData !== "string" || !isAbsolute(userData)) throw Error("Verified profile unavailable");
    const profile = await realpath(userData), directory = await realpath(join(profile, "plugins-data/herman925.team-orchestrator")), rel = relative(profile, directory);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error("Plugin directory escapes verified profile");
    const path = await realpath(join(directory, "team-orchestrator.sqlite")), fileRel = relative(directory, path);
    if (fileRel.startsWith("..") || isAbsolute(fileRel)) throw Error("Database path escapes plugin directory");
    const { DatabaseSync } = await sqlite();
    let db, foundSchema = null, status = "unavailable";
    try {
      db = new DatabaseSync(path, { readOnly: true });
      foundSchema = db.prepare("PRAGMA user_version").get().user_version;
      validateDatabase(db);
      status = "available";
    } catch {
      status = foundSchema !== null && ![1, STORAGE_SCHEMA].includes(foundSchema) ? "unsupported-schema" : "damaged-or-unrecognized";
    } finally {
      db?.close();
    }
    return { status, foundSchema, supportedSchema: STORAGE_SCHEMA, location: directory, backups: await recoveryInventory(directory, DatabaseSync), guidance };
  } catch {
    return { status: "unavailable", foundSchema: null, supportedSchema: STORAGE_SCHEMA, backups: [], guidance };
  }
}

// src/worker.mjs
import { randomBytes as randomBytes4 } from "node:crypto";

// src/local/bootstrap.mjs
import { readFile as readFile3, realpath as realpath4 } from "node:fs/promises";
import { join as join4 } from "node:path";
import { createHash as createHash4 } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createConnection as createConnection2 } from "node:net";

// src/local/runtime-contract.mjs
function validateRuntime(runtime) {
  const reject2 = (code, message) => {
    throw Object.assign(new Error(message), { code });
  };
  if (runtime.platform === "win32") reject2("platform_unverified", "Windows build is unverified. Capture its package/runtime contract before enabling this compatibility layer.");
  const build = runtime.build;
  const commits = {
    "1.4.222": "9fdd90ffa7721e145f1353ad9fb9df2f70c31f43",
    "1.4.223": "ff4a51c872e723d87ab141044814301ea5a78634"
  };
  commits["1.4.229"] = "37c314bcc96063c42c468e564df2c34bac8ef8a1";
  if (runtime.appName?.toLowerCase() !== "orca") reject2("runtime_identity_mismatch", "The inspected process is not Orca.");
  if (runtime.platform !== "darwin" || runtime.arch !== "arm64") reject2("platform_unverified", "This operating system or architecture has no verified adapter yet.");
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(runtime.appVersion) || !runtime.electron || !runtime.node) reject2("runtime_identity_mismatch", "Orca runtime identity is incomplete.");
  if (build && (build.version !== runtime.appVersion || build.platform !== runtime.platform || build.architecture !== runtime.arch))
    reject2("runtime_identity_mismatch", "Application metadata does not match the running Orca process.");
  if (!runtime.sqlite) reject2("node_capability_missing", "The parent runtime does not provide Node SQLite DatabaseSync.");
  return { verification: "runtime-prerequisites", testedBuild: Object.hasOwn(commits, runtime.appVersion) && build?.commit === commits[runtime.appVersion], buildId: build?.buildId ?? null, electron: runtime.electron, node: runtime.node, sqlite: true, liveProviderVerified: false };
}

// src/local/inspector.mjs
async function connectInspector(url, timeoutMs = 4e3) {
  const address = new URL(url);
  if (address.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)) throw new Error("Inspector must be loopback-only.");
  const socket = new WebSocket(url);
  await new Promise((resolve, reject2) => {
    const timer = setTimeout(() => {
      socket.close();
      reject2(new Error("Inspector connection timed out."));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject2(new Error("Inspector connection failed."));
    }, { once: true });
  });
  let sequence = 0;
  const pending = /* @__PURE__ */ new Map();
  const fail4 = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  socket.addEventListener("close", () => fail4(new Error("Inspector disconnected.")));
  socket.addEventListener("error", () => fail4(new Error("Inspector transport failed.")));
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  return {
    async evaluate(expression) {
      const id2 = ++sequence;
      const result = await new Promise((resolve, reject2) => {
        const timer = setTimeout(() => {
          pending.delete(id2);
          reject2(new Error("Inspector evaluation timed out."));
        }, timeoutMs);
        pending.set(id2, { resolve, reject: reject2, timer });
        socket.send(JSON.stringify({ id: id2, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    },
    close() {
      fail4(new Error("Inspector session closed."));
      socket.close();
    }
  };
}

// src/local/native-runtime.mjs
import { AsyncLocalStorage } from "node:async_hooks";
import { createConnection } from "node:net";
import { randomUUID as randomUUID2 } from "node:crypto";
import { realpath as realpath2, readFile as readFile2 } from "node:fs/promises";
import { join as join2, relative as relative2, isAbsolute as isAbsolute2, sep as sep2 } from "node:path";
var METHODS = /* @__PURE__ */ new Set(["status.get", "settings.get", "preflight.detectAgents", "preflight.detectRemoteAgents", "agentSession.agents", "agentSession.createSupport", "agentSession.modelCatalog", "worktree.show", "ssh.getState", "terminal.show", "terminal.rename", "terminal.agentStatus", "terminal.wait", "terminal.send", "agentSession.history", "agentSession.restartResumable", "agentSession.restartContinue", "terminal.ensureAgentSession", "agentSession.send", "orchestration.sessionAddress", "orchestration.partyLocation", "orchestration.runShow", "orchestration.taskList", "orchestration.workerList", "orchestration.dispatchShow", "orchestration.workerShow", "orchestration.workerRead", "orchestration.workerStop", "terminal.stopExact", "agentSession.close"]);
function createNativeRpc({ userData, parentPid, consent, timeoutMs = 15e3, maxBytes = 2 * 1024 * 1024 }) {
  const context = new AsyncLocalStorage();
  const rpc = async (method, params, envelope = {}) => {
    if (!METHODS.has(method)) throw Error("Native method is not allowed for team work.");
    if (Object.keys(envelope).some((key) => !["orchestrationRequestId"].includes(key))) throw Error("Native caller overrides are not allowed.");
    await consent();
    let metadata, transport, profile;
    try {
      if (!isAbsolute2(userData || "")) throw Error();
      profile = await realpath2(userData);
      const path = await realpath2(join2(profile, "orca-runtime.json")), rel = relative2(profile, path);
      if (rel === ".." || rel.startsWith(`..${sep2}`) || isAbsolute2(rel)) throw Error();
      const content = await readFile2(path, "utf8");
      if (Buffer.byteLength(content) > 65536) throw Error();
      metadata = JSON.parse(content);
      transport = (metadata.transports ?? [metadata.transport]).find((item) => ["unix", "named-pipe"].includes(item?.kind));
      if (metadata.pid !== parentPid || typeof metadata.runtimeId !== "string" || !metadata.runtimeId || typeof metadata.authToken !== "string" || !metadata.authToken || !transport || typeof transport.endpoint !== "string" || (transport.kind === "unix" ? !isAbsolute2(transport.endpoint) : !transport.endpoint.startsWith("\\\\.\\pipe\\"))) throw Error();
    } catch {
      throw Error("Verified Orca runtime metadata is unavailable or belongs to another process. Reconnect the plugin.");
    }
    const expectedRuntimeId = context.getStore();
    if (expectedRuntimeId && metadata.runtimeId !== expectedRuntimeId) throw Error("Native runtime epoch changed during observation; intent remains reserved.");
    const verifyMetadata = async () => {
      const current = JSON.parse(await readFile2(join2(profile, "orca-runtime.json"), "utf8"));
      if (current.runtimeId !== metadata.runtimeId || current.pid !== parentPid || current.authToken !== metadata.authToken) throw Error("Native runtime epoch changed before effect or observation settlement.");
    };
    await consent();
    return new Promise((resolve, reject2) => {
      const id2 = randomUUID2(), socket = createConnection(transport.endpoint);
      let buffer = "", finished = false, validating = false;
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        error ? reject2(error) : resolve(result);
      };
      const timer = setTimeout(() => finish(Error("Native runtime timed out; any submitted objective remains unconfirmed.")), timeoutMs);
      socket.setEncoding("utf8");
      socket.on("connect", async () => {
        try {
          await consent();
          await verifyMetadata();
          if (!finished) socket.write(JSON.stringify({ id: id2, authToken: metadata.authToken, method, ...params === void 0 ? {} : { params }, ...envelope, ...method.startsWith("orchestration.") ? { orchestrationContractVersion: 1 } : {} }) + "\n");
        } catch (error) {
          finish(error);
        }
      });
      socket.on("error", () => finish(Error("Native runtime connection failed; delivery is unconfirmed.")));
      socket.on("close", () => {
        if (!validating) finish(Error("Native runtime closed before a receipt; delivery is unconfirmed."));
      });
      const publicError = (value) => [metadata.authToken, transport.endpoint, profile, userData].reduce((message, secret) => secret ? message.split(secret).join("[private runtime data]") : message, String(value || "Native operation refused")).slice(0, 1500);
      socket.on("data", async (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > maxBytes) return finish(Error("Native runtime response exceeded its bounded limit."));
        for (let index; (index = buffer.indexOf("\n")) >= 0; ) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          let response;
          try {
            response = JSON.parse(line);
          } catch {
            return finish(Error("Native runtime returned malformed evidence."));
          }
          if (response?._keepalive === true) continue;
          if (response?.id !== id2 || response?._meta?.runtimeId !== metadata.runtimeId) return finish(Error("Native response identity or runtime changed; evidence is unverified."));
          if (response.ok !== true) return finish(Object.assign(Error(publicError(response.error?.message)), { code: response.error?.code, native: true }));
          validating = true;
          try {
            await verifyMetadata();
            finish(null, response.result);
          } catch (error) {
            finish(error);
          }
          return;
        }
      });
    });
  };
  rpc.withRuntime = (runtimeId, action) => {
    if (typeof runtimeId !== "string" || !runtimeId) throw Error("Expected native runtime identity is required.");
    const prior = context.getStore();
    if (prior && prior !== runtimeId) throw Error("Native runtime epoch changed inside observation.");
    return context.run(runtimeId, action);
  };
  return rpc;
}
var withNativeRuntime = (rpc, runtimeId, action) => rpc.withRuntime ? rpc.withRuntime(runtimeId, action) : action();

// src/local/host-compatibility.mjs
import { realpath as realpath3, stat as stat2 } from "node:fs/promises";
import { join as join3, relative as relative3, isAbsolute as isAbsolute3, sep as sep3 } from "node:path";
var REQUIRED_HOST_CAPABILITIES = Object.freeze([
  "orchestration.contract.v1",
  "agent.launch.v2",
  "agent.launch.replay-required.v1",
  "agent-session.structured.v1",
  "terminal.prompt-delivery.v1"
]);
var reject = (code, message) => {
  throw Object.assign(Error(message), { code });
};
function validateHostCapabilities(status, settings, appVersion) {
  if (!status || typeof status.runtimeId !== "string" || !status.runtimeId || !Array.isArray(status.capabilities) || status.capabilities.some((v) => typeof v !== "string"))
    reject("runtime_contract_incompatible", "Orca returned an unsupported runtime status format.");
  if (status.appVersion && status.appVersion !== appVersion) reject("runtime_identity_mismatch", "The native runtime belongs to a different Orca version.");
  const missing = REQUIRED_HOST_CAPABILITIES.filter((capability) => !status.capabilities.includes(capability));
  if (missing.length) reject("runtime_capability_missing", `Orca is missing required interfaces: ${missing.join(", ")}.`);
  if (!settings?.settings || typeof settings.settings !== "object" || Array.isArray(settings.settings))
    reject("runtime_contract_incompatible", "Orca returned an unsupported settings response.");
  return { runtimeId: status.runtimeId, capabilities: [...REQUIRED_HOST_CAPABILITIES] };
}
var DATABASES = [
  { file: "orchestration.db", version: 43, tables: {
    runs: ["id", "objective", "home_database", "legacy", "consumer_generation", "coordinator_handle", "coordinator_pane_key", "coordinator_orca_session_id", "coordinator_orca_session_id_generation"],
    tasks: ["id", "run_id", "spec", "status", "result", "created_by_terminal_handle", "created_by_pane_key", "created_by_process_incarnation", "created_by_run_generation"],
    mutation_receipts: ["caller_fingerprint", "request_id", "method", "payload_hash", "state", "receipt"],
    mutation_caller_identities: ["transport", "caller_fingerprint"],
    dispatch_contexts: ["id", "run_id", "task_id", "assignee_handle", "assignee_pane_key", "process_incarnation", "host_scope"],
    worker_dispatches: ["dispatch_id", "worktree_id", "agent_terminal_handle", "state", "runtime_epoch", "start_options"],
    attempt_observation_facts: ["id", "dispatch_id", "task_id", "authority_id", "facet", "payload"],
    messages: ["id", "run_id", "from_handle", "sender_pane_key", "type", "body", "payload"]
  } },
  { file: "agent-session-journal.db", version: 4, tables: { agent_session_operations: ["operation_key", "row_json"] } }
];
async function inspectEvidenceSchemas(userData) {
  if (!isAbsolute3(userData || "")) reject("profile_missing", "Orca did not supply an absolute profile directory.");
  const profile = await realpath3(userData), { DatabaseSync } = await import("node:sqlite"), results = [];
  for (const spec of DATABASES) {
    const requested = join3(profile, spec.file);
    let path;
    try {
      await stat2(requested);
      path = await realpath3(requested);
    } catch (error) {
      if (error.code === "ENOENT") {
        results.push({ file: spec.file, state: "not-created", expectedVersion: spec.version });
        continue;
      }
      reject("evidence_unavailable", `Cannot inspect ${spec.file}; existing data was preserved.`);
    }
    const rel = relative3(profile, path);
    if (rel === ".." || rel.startsWith(`..${sep3}`) || isAbsolute3(rel)) reject("profile_mismatch", "Evidence database is outside the verified Orca profile.");
    let db;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      db.exec("BEGIN");
      const version = db.prepare("PRAGMA user_version").get().user_version;
      if (version !== spec.version) reject("evidence_schema_incompatible", `${spec.file} uses schema ${version}; this plugin reads schema ${spec.version}. Update the plugin; do not reset the database.`);
      for (const [table, required] of Object.entries(spec.tables)) {
        const columns2 = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        if (required.some((column) => !columns2.includes(column))) reject("evidence_schema_incompatible", `${spec.file} has an incompatible ${table} table. Existing data was preserved.`);
      }
      results.push({ file: spec.file, state: "verified", version });
    } catch (error) {
      if (error.code?.startsWith("evidence_")) throw error;
      reject("evidence_unavailable", `Cannot read the ${spec.file} evidence format. Existing data was preserved.`);
    } finally {
      if (db) {
        try {
          db.exec("ROLLBACK");
        } catch {
        }
        db.close();
      }
    }
  }
  return results;
}
async function probeHostCompatibility({ rpc, userData, appVersion }) {
  const status = await rpc("status.get"), settings = await rpc("settings.get");
  const host = validateHostCapabilities(status, settings, appVersion);
  const schemas = await inspectEvidenceSchemas(userData);
  return { verification: "runtime-contract", ...host, schemas, liveProviderVerified: false };
}

// src/local/bootstrap.mjs
var execute = promisify(execFile);
var activateParent = (pid) => execute(process.execPath, ["-e", "process._debugProcess(Number(process.argv[1]))", String(pid)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 4e3, windowsHide: true });
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
var occupied = (port) => new Promise((resolve) => {
  const socket = createConnection2({ host: "127.0.0.1", port });
  const finish = (value) => {
    socket.destroy();
    resolve(value);
  };
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
  socket.setTimeout(700, () => finish(true));
});
function inspectorFuse(bytes) {
  let cursor = 0;
  let count = 0;
  for (; ; ) {
    const index = bytes.indexOf(SENTINEL, cursor);
    if (index < 0) break;
    const offset = index + SENTINEL.length;
    if (bytes[offset] !== 1 || bytes[offset + 1] < 4 || bytes[offset + 5] !== 49) return false;
    count++;
    cursor = offset + 6;
  }
  return count > 0;
}
function packageType(platform, executable, entry) {
  if (platform === "darwin") return executable.includes(".app/") ? "macOS app bundle" : "development";
  if (platform === "win32") return /app\.asar\.unpacked/i.test(entry) ? "Windows installed app" : "development";
  if (executable.includes("/.mount_") || executable.includes("/tmp/.mount")) return "Linux AppImage";
  return /app\.asar\.unpacked/.test(entry) ? "Linux installed app" : "development";
}
async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(700) });
    const items = await response.json();
    return Array.isArray(items) ? items.filter((item) => item.type === "node" && item.webSocketDebuggerUrl) : [];
  } catch {
    return [];
  }
}
var failure = (code, message) => Object.assign(new Error(message), { code });
async function bootstrap({ platform = process.platform, parentPid = process.ppid, executable = process.execPath, entry = process.argv[1] ?? "", port = 9229, activate: activate2 = activateParent, adapterPath = fileURLToPath(new URL("./runtime-adapter.cjs", import.meta.url)), version = "0.1.12", internalKey, consent = async () => {
} } = {}) {
  const report = { platform, packageType: packageType(platform, executable, entry), parentPid, ready: false };
  let client;
  let owned = false;
  try {
    await consent();
    if (!Number.isInteger(parentPid) || parentPid < 2 || parentPid === process.pid) throw failure("invalid_parent_pid", "Invalid Orca parent process.");
    let binary;
    try {
      const path = platform === "darwin" && executable.includes(".app/Contents/") ? join4(executable.slice(0, executable.indexOf(".app/Contents/") + ".app/Contents/".length), "Frameworks/Electron Framework.framework/Electron Framework") : executable;
      binary = await readFile3(await realpath4(path));
    } catch {
      throw failure("fuse_file_missing", "Cannot locate/read the Electron fuse binary in this application package. No injection attempted.");
    }
    if (!inspectorFuse(binary)) throw failure("fuse_disabled", "Electron inspector fuse is disabled, absent or malformed. This build cannot use the compatibility layer.");
    let available = await targets(port);
    if (!available.length) {
      if (await occupied(port)) throw failure("port_conflict", "Loopback inspector port is occupied by an incompatible endpoint. Nothing was injected.");
      if (typeof process._debugProcess !== "function") throw failure("node_capability_missing", "This Node runtime cannot activate the parent inspector.");
      await activate2(parentPid);
      owned = true;
      for (let attempt = 0; attempt < 20 && !available.length; attempt++) {
        await delay(100);
        available = await targets(port);
      }
    }
    if (!available.length) throw new Error(`Orca did not expose its main-process inspector on loopback port ${port}; inspector activation was attempted but cleanup could not be verified.`);
    if (available.length !== 1) throw new Error("Inspector target is ambiguous; nothing was injected.");
    client = await connectInspector(available[0].webSocketDebuggerUrl);
    const identity = await client.evaluate("({pid:process.pid,electron:process.versions.electron})");
    if (identity?.pid !== parentPid || !identity.electron) {
      owned = false;
      throw failure("parent_pid_mismatch", "Inspector belongs to another process; nothing was injected.");
    }
    const runtime = await client.evaluate(`(()=>{if(typeof process.getBuiltinModule!=='function')throw Error('Node getBuiltinModule is unavailable');const req=process.getBuiltinModule('module').createRequire(process.execPath);const {app}=req('electron');const fs=req('node:fs');const path=req('node:path');let build=null;try{build=JSON.parse(fs.readFileSync(path.join(app.isPackaged?process.resourcesPath:app.getAppPath(),'orca-local-build.json'),'utf8'))}catch{};let sqlite=false;try{sqlite=typeof req('node:sqlite').DatabaseSync==='function'}catch{};return {appName:app.getName(),appVersion:app.getVersion(),platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node,sqlite,build,cliPaths:{appData:app.getPath('appData'),userData:app.getPath('userData')}}})()`);
    Object.assign(report, { appVersion: runtime.appVersion }, validateRuntime(runtime));
    if (!runtime.cliPaths?.appData || !runtime.cliPaths?.userData) throw failure("profile_missing", "Orca did not resolve its actual runtime profile.");
    const rpc = createNativeRpc({ userData: runtime.cliPaths.userData, parentPid, consent });
    Object.assign(report, await probeHostCompatibility({ rpc, userData: runtime.cliPaths.userData, appVersion: runtime.appVersion }));
    const source = await readFile3(adapterPath, "utf8");
    const digest5 = createHash4("sha256").update(source).digest("hex");
    const expression = `(async()=>{const req=process.getBuiltinModule('module').createRequire(process.execPath);const electron=req('electron');const m={exports:{}};new Function('require','module','exports',${JSON.stringify(source)})(req,m,m.exports);const transport=m.exports.inspectAdapterContract(electron);return {...await m.exports.installAdapter(electron,{version:${JSON.stringify(version)},identity:${JSON.stringify(digest5)},internalKey:${JSON.stringify(internalKey)}}),transport};})()`;
    await consent();
    Object.assign(report, await client.evaluate(expression), { cliPaths: runtime.cliPaths });
    report.detail = "Orca runtime capabilities, evidence formats and plugin transport verified. Panel connection is available.";
  } catch (error) {
    report.code = error.code ?? "initialisation_failed";
    report.detail = error.message;
  } finally {
    if (client && owned) {
      try {
        await client.evaluate("setTimeout(()=>process.getBuiltinModule('inspector').close(),500);true");
      } catch {
      }
    }
    client?.close();
  }
  return report;
}

// src/local/cli.mjs
import { execFile as execFile2 } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join as join5 } from "node:path";
import { promisify as promisify2 } from "node:util";
var execute2 = promisify2(execFile2);
function cliEnvironment(paths, base = process.env, platform = process.platform) {
  if (typeof paths?.userData !== "string" || !paths.userData || paths.userData.includes("\0") || typeof paths.appData !== "string" || !paths.appData || paths.appData.includes("\0")) throw new Error("The running Orca desktop did not provide its runtime data paths.");
  const env = { ...base, ELECTRON_RUN_AS_NODE: "1" };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "ORCA_USER_DATA_PATH" || platform === "win32" && key.toUpperCase() === "APPDATA") delete env[key];
  env.ORCA_USER_DATA_PATH = paths.userData;
  if (platform === "win32") env.APPDATA = paths.appData;
  return env;
}
async function locateCli(entry = process.argv[1], executable = process.execPath, paths) {
  if (entry) {
    const candidate = join5(dirname(entry), "..", "cli", "index.js");
    try {
      await access(candidate);
    } catch {
      throw new Error("The installed Orca CLI entry was not found beside its plugin worker.");
    }
    return { executable, prefix: [candidate], env: paths ? cliEnvironment(paths) : { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
  }
  throw new Error("The installed Orca CLI entry was not found beside its plugin worker.");
}
function createCliRunner(command) {
  return async (args) => {
    let stdout;
    try {
      ({ stdout } = await execute2(command.executable, [...command.prefix, ...args, "--json"], { env: command.env, timeout: 9e4, maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false }));
    } catch (error) {
      try {
        const response2 = JSON.parse(error.stdout);
        if (response2.ok === false && typeof response2.error?.message === "string") throw Object.assign(new Error(response2.error.message), { parsed: true });
      } catch (parsed) {
        if (parsed.parsed) throw parsed;
      }
      throw new Error(error.killed ? "Local Orca CLI timed out; outcome is unknown." : "Local Orca CLI failed; outcome is unknown.");
    }
    let response;
    try {
      response = JSON.parse(stdout.trim());
    } catch {
      throw new Error("Orca CLI returned invalid JSON.");
    }
    if (args[0] === "agent-context" && Array.isArray(response.commands)) return response;
    if (response.ok !== true) throw new Error(response.error?.message ?? "Orca CLI rejected the operation.");
    return response.result;
  };
}

// src/local/runtime-control.mjs
var controlRuntime = (work) => work?.runtimeControl?.runtimeId ?? work?.binding?.runtimeId;
function memberControlRuntime(work, operation) {
  const control = work?.runtimeControl;
  const recorded = control?.members?.find(
    (row) => row.requestId === operation.requestId && row.memberId === operation.memberId && row.instanceGeneration === (operation.instanceGeneration ?? 1)
  );
  if (!recorded) return operation.runtimeId;
  const proof = control.proof.members.find(
    (row) => row.requestId === operation.requestId && row.memberId === operation.memberId
  );
  if (!proof || operation.runtimeId !== work.binding.runtimeId || operation.kind !== "terminal" || operation.handle !== proof.handle || operation.paneKey !== proof.paneKey || operation.nativeRequest.agent !== proof.agent || ["ptyId", "incarnationId", "processIncarnation"].some(
    (key) => operation.observation?.[key] !== proof[key]
  )) {
    throw Error(
      "The prepared member changed after reconnect. Its earlier control proof cannot redirect a new assignment."
    );
  }
  return control.runtimeId;
}

// src/local/keyed-serializer.mjs
function createKeyedSerializer() {
  const queues = /* @__PURE__ */ new Map();
  return (key, action) => {
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => {
    }).then(action);
    queues.set(key, pending);
    pending.finally(() => {
      if (queues.get(key) === pending) queues.delete(key);
    }).catch(() => {
    });
    return pending;
  };
}

// src/local/native-worker-report.mjs
var parse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
function verifiedWorkerReport(fact, message, dispatch, worker) {
  const report = parse(fact?.payload), payload = parse(message?.payload);
  if (!fact || !dispatch || !worker || fact.facet !== "worker_report" || fact.dispatch_id !== dispatch.id || fact.task_id !== dispatch.task_id || fact.authority_id !== `run_home:${dispatch.run_id}` || !fact.id.startsWith("worker_report:") || report?.status !== "accepted" || report.reportId !== fact.id || !["succeeded", "failed"].includes(report.outcome)) return null;
  if (!message || message.id !== fact.id.slice("worker_report:".length) || message.run_id !== dispatch.run_id || message.type !== "worker_done" || message.from_handle !== dispatch.assignee_handle || message.sender_pane_key !== dispatch.assignee_pane_key || payload?.dispatchId !== dispatch.id || payload.taskId !== dispatch.task_id || payload.outcome !== report.outcome) return null;
  if (dispatch.status !== (report.outcome === "succeeded" ? "completed" : "failed") || worker.state !== report.outcome) return null;
  return { outcome: report.outcome, result: String(message.body ?? "").slice(0, 16e3), evidenceId: fact.id };
}

// src/local/native-mutation.mjs
import { createHash as createHash5 } from "node:crypto";
var canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== void 0).map((key) => [key, canonical(value[key])])) : value;
var nativeMutationFingerprint = (method, params, owner, target) => {
  const stable = { ...params };
  delete stable.waitSubmitMs;
  if (owner.kind === "structured") stable.__orcaCallerOrcaSessionId = owner.sessionId;
  if (typeof stable.terminal === "string" && target?.kind === "terminal" && target.paneKey) {
    const parts = target.paneKey.split(":");
    stable.terminal = parts.length === 2 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parts[1]) ? { paneLeafId: parts[1] } : { paneKey: target.paneKey };
  }
  for (const key of ["from", "callerTerminalHandle"]) if (typeof stable[key] === "string" && owner.paneKey) {
    const parts = owner.paneKey.split(":"), leaf = parts[1];
    stable[key] = parts.length === 2 && parts[0] && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(leaf) ? { paneLeafId: leaf } : { paneKey: owner.paneKey };
  }
  return createHash5("sha256").update(JSON.stringify(canonical({ method, params: stable }))).digest("hex");
};

// src/local/native-question-origin.mjs
var parse2 = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
var text3 = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
var reportKeys = ["attemptId", "dispatchId", "nativeTaskId", "messageId"];
function questionOriginKind(origin) {
  if (!origin || typeof origin !== "object" || Array.isArray(origin) || reportKeys.some((key) => !text3(origin[key]))) return null;
  const keys = Object.keys(origin);
  if (keys.length === 4 && keys.every((key) => reportKeys.includes(key))) return "report";
  if (keys.length === 6 && keys.every((key) => [...reportKeys, "askRequestId", "askParams"].includes(key)) && text3(origin.askRequestId) && origin.askParams && typeof origin.askParams === "object" && !Array.isArray(origin.askParams)) return "ask";
  return null;
}
function verifiedReportOrigin(db, { work, attempts, spec }) {
  if (work.parent || spec.kind !== "user-question" || spec.relay || questionOriginKind(spec.origin) !== "report") return null;
  const o = spec.origin, a = attempts.find((row) => row.id === o.attemptId), b = a?.binding, evidenceId = `worker_report:${o.messageId}`;
  if (!a || a.admission !== "committed" || a.supervisorMemberId !== work.supervisorMemberId || a.runId !== work.run.id || a.dispatchId !== o.dispatchId || a.nativeTaskId !== o.nativeTaskId || a.evidenceId !== evidenceId || !["failed", "succeeded"].includes(a.outcome) || !spec.evidence?.includes(evidenceId) || !b || !["terminal", "structured"].includes(b.kind) || a.scope?.workspaceId !== work.scope.workspaceId || a.scope?.executionHostId !== work.scope.executionHostId || b.workspaceId !== work.scope.workspaceId || b.executionHostId !== work.scope.executionHostId) return null;
  const owner = a.originalSupervisorInstance ?? work.instance, identity = db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
  if (!owner || !identity?.caller_fingerprint || !a.startRequestId || !a.startPayloadHash) return null;
  const starts = db.prepare("SELECT * FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.workerStart' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.taskId')=?").all(identity.caller_fingerprint, a.nativeTaskId), start = starts[0], value = parse2(start?.receipt), caller4 = owner.kind === "structured" ? `orca_session_id:${owner.sessionId}` : owner.handle;
  if (starts.length !== 1 || start.request_id !== a.startRequestId || start.payload_hash !== a.startPayloadHash || start.payload_hash !== nativeMutationFingerprint("orchestration.workerStart", { ...a.startParams, from: caller4, devMode: false }, owner, a.reuse?.binding) || value?.runId !== a.runId || value.dispatchId !== o.dispatchId) return null;
  const d = db.prepare("SELECT * FROM dispatch_contexts WHERE id=?").get(o.dispatchId), w = db.prepare("SELECT * FROM worker_dispatches WHERE dispatch_id=?").get(o.dispatchId), h = parse2(d?.host_scope);
  const host = work.scope.executionHostId === "local" ? h?.kind === "local" && h.hostId === "local" : h?.kind === "ssh" && `ssh:${encodeURIComponent(h.targetId)}` === work.scope.executionHostId;
  if (!d || (owner.kind === "structured" ? d.creator_orca_session_id !== owner.sessionId : d.creator_handle !== owner.handle || d.creator_pane_key !== owner.paneKey) || d.run_id !== a.runId || d.task_id !== a.nativeTaskId || d.assignee_handle !== b.handle || d.assignee_pane_key !== b.paneKey || d.process_incarnation !== b.incarnationId || (b.kind === "structured" ? d.assignee_orca_session_id !== b.sessionId : Boolean(d.assignee_orca_session_id)) || !host || !w || w.agent_terminal_handle !== b.handle || w.worktree_id !== b.workspaceId || w.runtime_epoch !== b.runtimeId || w.state !== a.outcome || d.status !== (a.outcome === "failed" ? "failed" : "completed")) return null;
  const fact = db.prepare("SELECT * FROM attempt_observation_facts WHERE id=? AND dispatch_id=? AND facet='worker_report'").get(evidenceId, d.id), message = db.prepare("SELECT * FROM messages WHERE id=?").get(o.messageId), completion = verifiedWorkerReport(fact, message, d, w);
  if (!completion || completion.evidenceId !== a.evidenceId || completion.outcome !== a.outcome) return null;
  return { kind: "worker-report", attemptId: a.id, dispatchId: d.id, nativeTaskId: a.nativeTaskId, messageId: message.id, evidenceId, runId: a.runId, memberId: a.memberId, supervisorMemberId: a.supervisorMemberId, outcome: a.outcome };
}

// src/local/questions.mjs
import { createHash as createHash9 } from "node:crypto";

// src/local/orchestration-snapshot.mjs
import { realpath as realpath5 } from "node:fs/promises";
import { join as join6, relative as relative4, isAbsolute as isAbsolute4, sep as sep4 } from "node:path";
async function withOrchestrationSnapshot(userData, { pathError, schemaError }, read) {
  let db;
  try {
    const root = await realpath5(userData), file = await realpath5(join6(root, "orchestration.db")), rel = relative4(root, file);
    if (rel === ".." || rel.startsWith(`..${sep4}`) || isAbsolute4(rel)) throw Error(pathError);
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(file, { readOnly: true });
    db.exec("BEGIN");
    if (db.prepare("PRAGMA user_version").get().user_version !== 43) throw Error(schemaError);
    return await read(db);
  } finally {
    if (db) {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
      db.close();
    }
  }
}

// src/local/native-history.mjs
import { createHash as createHash6 } from "node:crypto";
var parse3 = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var digest = (value) => createHash6("sha256").update(JSON.stringify(value)).digest("hex");
var caller = (owner) => owner.kind === "structured" ? `orca_session_id:${owner.sessionId}` : owner.handle;
var authority = (history, spec, epoch) => history.authorities.filter((h) => (epoch === void 0 || h.epoch === epoch) && h.protocol.token === spec.token && h.protocol.generation === spec.generation);
function controlProof(entry) {
  const r = entry.record;
  return entry.kind === "delivery" ? { ...r.proof, nativeTaskId: r.id } : entry.kind === "answer-ack" ? entry.answer.acknowledgement : entry.kind === "roster-ack" ? r.acknowledgement : entry.kind === "message-evidence" ? r.controlProof : r.proof ?? r;
}
function savedControl(entry, spec, task, receipt) {
  const r = entry.record, proof = controlProof(entry);
  if (proof?.nativeTaskId !== task.id || proof.payloadHash !== receipt.payload_hash || proof.requestId && proof.requestId !== receipt.request_id) return false;
  const intent = { spec, nativeTaskId: task.id, requestId: receipt.request_id, payloadHash: receipt.payload_hash };
  if (proof.spec && !same(proof.spec, spec) || ["question", "staffing-proposal", "collaboration-directive"].includes(entry.kind) && r.fingerprint && r.fingerprint !== digest(entry.kind === "staffing-proposal" ? canonical(intent) : intent)) return false;
  switch (entry.kind) {
    case "session-answer":
    case "session-resolution":
    case "staffing-decision":
      return spec.kind === entry.kind && same(proof.spec, spec);
    case "question":
      return spec.kind === (r.to === "manager" ? "relay-question" : "user-question") && spec.appQuestionId === r.id && spec.generation === r.generation && r.runId === task.run_id;
    case "delivery":
      return spec.protocol === "team-delivery/v1" && spec.generation === r.generation && spec.token === r.protocolToken && spec.supervisorMemberId === r.supervisorMemberId && same(spec.previousDeliveryId ?? null, r.previousDeliveryId ?? null) && same(spec.summary, r.summary) && same(spec.attemptIds, r.attemptIds) && same(spec.evidenceRefs, r.evidenceRefs);
    case "staffing-proposal":
      return spec.kind === entry.kind && spec.appQuestionId === r.id && spec.proposingManagerId === r.proposingManagerId && r.runId === task.run_id && spec.generation === r.generation;
    case "roster-ack":
      return spec.kind === entry.kind && spec.deltaId === r.id && spec.configVersion === r.configVersion && spec.generation === r.generation && r.runId === task.run_id;
    case "answer-ack":
      return spec.kind === entry.kind && spec.appQuestionId === r.id && spec.answerId === entry.answer.id;
    case "collaboration-directive":
      return spec.kind === entry.kind && spec.appQuestionId === r.id && spec.fromAttemptId === r.fromAttemptId && spec.toAttemptId === r.toAttemptId && spec.fromMemberId === r.fromMemberId && spec.toMemberId === r.toMemberId;
    case "message-evidence":
      return spec.kind === entry.kind && spec.nativeMessage?.messageId === r.id && spec.fromAttemptId === r.attemptId;
    case "recovery-handoff":
      return spec.kind === entry.kind && spec.oldRequestId === r.oldRequestId && spec.decision === r.decision && spec.summary === r.summary && same(spec.evidence, r.evidenceRefs) && spec.generation === r.generation && r.runId === task.run_id;
    default:
      return false;
  }
}
function isHistoricalControl(db, work, task, history, attempts = []) {
  const spec = parse3(task.spec);
  if (!spec || spec.workId !== work.id || task.run_id !== work.run.id || !["team-questions/v1", "team-delivery/v1"].includes(spec.protocol) || db.prepare("SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1").get(task.id)) return false;
  const identity = db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
  if (!identity?.caller_fingerprint) return false;
  const receipts = db.prepare("SELECT request_id,payload_hash,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.taskCreate' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.task.id')=?").all(identity.caller_fingerprint, task.id), receipt = receipts[0], value = parse3(receipt?.receipt);
  if (receipts.length !== 1 || value?.task?.spec !== task.spec || value.task.run_id !== task.run_id) return false;
  const reportValid = (entry) => {
    if (entry.kind !== "question" || !entry.record.sourceReport && questionOriginKind(spec.origin) !== "report") return true;
    const report = verifiedReportOrigin(db, { work, attempts, spec });
    return Boolean(report && (!entry.record.sourceReport || same(entry.record.sourceReport, report)));
  };
  return history.controls.some((entry) => savedControl(entry, spec, task, receipt) && reportValid(entry) && authority(history, spec, entry.epoch).some(({ owner, protocol }) => receipt.payload_hash === nativeMutationFingerprint("orchestration.taskCreate", { spec: task.spec, run: work.run.id, callerTerminalHandle: caller(owner) }, owner) && (owner.kind === "structured" || owner.kind === "terminal" && task.created_by_terminal_handle === owner.handle && task.created_by_pane_key === owner.paneKey && task.created_by_process_incarnation === owner.processIncarnation && task.created_by_run_generation === protocol.generation)));
}
function isHistoricalReview(work, attempt, proof, task, review, history) {
  const saved = attempt.review, status = attempt.outcome === "succeeded" ? "completed" : "failed";
  if (!saved || !["accepted", "rework"].includes(attempt.status) || saved.requestId !== proof.request_id || saved.payloadHash !== proof.payload_hash || task.run_id !== work.run.id || task.status !== status || review.workId !== work.id || review.attemptId !== attempt.id || review.nativeTaskId !== attempt.nativeTaskId || review.dispatchId !== attempt.dispatchId || review.taskKey !== attempt.taskKey || review.generation !== saved.generation || review.token !== saved.protocolToken || review.reviewToken !== saved.reviewToken || review.reviewerMemberId !== saved.reviewerMemberId || review.decision !== saved.decision || !same(review.evidenceRefs, saved.evidenceRefs) || review.summary !== saved.summary) return false;
  return authority(history, review).some(({ owner }) => proof.payload_hash === nativeMutationFingerprint("orchestration.taskUpdate", { id: attempt.nativeTaskId, status, result: task.result, run: work.run.id, callerTerminalHandle: caller(owner) }, owner));
}
function changedRecordedControls(db, work, history) {
  const identity = db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
  return history.controls.flatMap((entry) => {
    const id2 = controlProof(entry)?.nativeTaskId;
    if (!id2) return [];
    const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(id2), spec = parse3(task?.spec);
    const receipts = identity ? db.prepare("SELECT request_id,payload_hash,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.taskCreate' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.task.id')=?").all(identity.caller_fingerprint, id2) : [], receipt = receipts[0], value = parse3(receipt?.receipt);
    return task?.run_id === work.run.id && spec?.workId === work.id && receipts.length === 1 && value?.task?.spec === task.spec && value.task.run_id === work.run.id && savedControl(entry, spec, task, receipt) ? [] : [{ nativeTaskId: id2, detail: "Recorded native control evidence is missing or changed." }];
  });
}

// src/local/native-questions.mjs
var parse4 = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
var text4 = (v, n = 8e3) => typeof v === "string" && v.trim().length > 0 && v.length <= n;
async function readNativeQuestionEvidence(userData, { work, protocol, owner, attempts = [], nativeHistory = { authorities: [], controls: [] } }) {
  try {
    return await withOrchestrationSnapshot(userData, { pathError: "Invalid native evidence path.", schemaError: "Unsupported native question schema." }, (db) => {
      const run = db.prepare("SELECT * FROM runs WHERE id=?").get(work.run.id);
      if (!run || run.objective !== work.nativeObjective || run.home_database !== "this_database" || run.legacy !== 0 || run.consumer_generation !== protocol.generation || work.run.consumerGeneration !== protocol.generation) throw Error("Question authority changed.");
      if (owner.kind === "structured" ? run.coordinator_orca_session_id !== owner.sessionId || run.coordinator_orca_session_id_generation !== protocol.generation : run.coordinator_handle !== owner.handle || run.coordinator_pane_key !== owner.paneKey) throw Error("Question supervisor changed.");
      const identity = db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
      if (!identity?.caller_fingerprint) throw Error("Native author proof unavailable.");
      const intents = [], rejected = [], threads = [], sourceReports = [], verifiedAsks = /* @__PURE__ */ new Set();
      for (const task of db.prepare("SELECT * FROM tasks WHERE run_id=?").all(work.run.id)) {
        const spec = parse4(task.spec);
        if (spec?.protocol !== "team-questions/v1" || spec.workId !== work.id) continue;
        if (isHistoricalControl(db, work, task, nativeHistory, attempts)) continue;
        try {
          if (spec.token !== protocol.token || spec.generation !== protocol.generation || !text4(spec.appQuestionId, 120) || !/^[a-zA-Z0-9-]+$/.test(spec.appQuestionId) || !["user-question", "relay-question", "answer-ack", "collaboration-directive", "message-evidence", "recovery-handoff", "staffing-proposal", "roster-ack", ...SESSION_DECISION_KINDS].includes(spec.kind)) throw Error("Question intent identity invalid.");
          const receipts = db.prepare("SELECT * FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.taskCreate' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.task.id')=?").all(identity.caller_fingerprint, task.id);
          const receipt = receipts[0], value = parse4(receipt?.receipt), caller4 = owner.kind === "structured" ? `orca_session_id:${owner.sessionId}` : owner.handle;
          if (receipts.length !== 1 || receipt.payload_hash !== nativeMutationFingerprint("orchestration.taskCreate", { spec: task.spec, run: work.run.id, callerTerminalHandle: caller4 }, owner) || value?.task?.spec !== task.spec || value.task.run_id !== work.run.id) throw Error("Question author proof unavailable.");
          if (owner.kind === "terminal" && (task.created_by_terminal_handle !== owner.handle || task.created_by_pane_key !== owner.paneKey || task.created_by_process_incarnation !== owner.processIncarnation || task.created_by_run_generation !== protocol.generation)) throw Error("Question terminal creator unverified.");
          if (SESSION_DECISION_KINDS.includes(spec.kind)) validateSessionDecision(work, protocol, spec);
          if (spec.kind === "user-question" && work.parent || spec.kind === "relay-question" && !work.parent) throw Error("Only the highest supervisor asks the user; lower managers relay.");
          if (["user-question", "relay-question"].includes(spec.kind) && (spec.evidence !== void 0 && (!Array.isArray(spec.evidence) || spec.evidence.length > 100 || spec.evidence.some((v) => !text4(v, 2e3))) || !text4(spec.summary) || !Array.isArray(spec.options) || spec.options.length > 20 || spec.options.some((v) => !text4(v, 2e3)) || !Array.isArray(spec.blockingTaskKeys) || spec.blockingTaskKeys.some((v) => !text4(v, 120)))) throw Error("Invalid question text or blocking scope.");
          if (["user-question", "relay-question"].includes(spec.kind)) {
            const hasOrigin = spec.origin !== void 0 && spec.origin !== null, kind = hasOrigin && questionOriginKind(spec.origin);
            if (hasOrigin && !kind || (spec.kind === "relay-question" || spec.relay) && kind !== "ask" || kind === "report" && (work.parent || spec.kind !== "user-question" || spec.relay)) throw Error("Question origin must be an exact native ask or highest-Head completion reference.");
          }
          if (spec.origin) {
            const a = attempts.find((a2) => a2.id === spec.origin.attemptId);
            if (!a || a.admission !== "committed" || !a.binding || a.dispatchId !== spec.origin.dispatchId || a.nativeTaskId !== spec.origin.nativeTaskId || a.runId !== work.run.id) throw Error("Question origin does not match an admitted attempt.");
          }
          intents.push({ spec, nativeTaskId: task.id, requestId: receipt.request_id, payloadHash: receipt.payload_hash });
        } catch (error) {
          rejected.push({ id: task.id, detail: error.message });
        }
      }
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='question_threads'").get()) for (const a of attempts.filter((a2) => a2.binding && a2.dispatchId && a2.admission === "committed")) {
        const d = db.prepare("SELECT * FROM dispatch_contexts WHERE id=?").get(a.dispatchId);
        if (!d || d.run_id !== a.runId || d.task_id !== a.nativeTaskId || d.assignee_handle !== a.binding.handle || d.assignee_pane_key !== a.binding.paneKey || d.process_incarnation !== a.binding.incarnationId || parse4(d.host_scope)?.kind !== "local" || work.scope.executionHostId !== "local") continue;
        for (const q of db.prepare("SELECT * FROM question_threads WHERE dispatch_id=? AND run_id=?").all(a.dispatchId, a.runId)) {
          const m = db.prepare("SELECT * FROM messages WHERE id=?").get(q.message_id), p = parse4(m?.payload);
          if (!m || m.run_id !== a.runId || m.from_handle !== `dispatch:${a.dispatchId}` || m.to_handle !== `run:${a.runId}` || m.type !== "question" || m.thread_id !== q.message_id || p?.dispatchId !== a.dispatchId || p.taskId !== a.nativeTaskId || q.asker_handle !== a.binding.handle) continue;
          const candidates = intents.filter((i) => questionOriginKind(i.spec.origin) === "ask" && i.spec.origin.messageId === q.message_id && i.spec.origin.attemptId === a.id && i.spec.origin.dispatchId === a.dispatchId && i.spec.origin.nativeTaskId === a.nativeTaskId);
          let authenticated = false;
          for (const candidate of candidates) {
            const origin = candidate.spec.origin, r = db.prepare("SELECT * FROM mutation_receipts WHERE caller_fingerprint=? AND request_id=? AND method='orchestration.ask' AND state='completed'").get(identity.caller_fingerprint, origin.askRequestId), v = parse4(r?.receipt);
            if (!r || origin.askParams.question !== m.body || origin.askParams.run !== a.runId || origin.askParams.resume || v?.messageId !== q.message_id || r.payload_hash !== nativeMutationFingerprint("orchestration.ask", origin.askParams, a.binding)) continue;
            verifiedAsks.add(candidate.nativeTaskId);
            authenticated = true;
          }
          if (!authenticated) continue;
          let answer;
          if (q.status === "answered" && q.answered_by_generation === protocol.generation) {
            const am = db.prepare("SELECT * FROM messages WHERE id=?").get(q.answer_message_id);
            if (am?.run_id === a.runId && am.from_handle === `run:${a.runId}` && am.to_handle === `dispatch:${a.dispatchId}` && am.body === q.answer_body) answer = { messageId: am.id, body: am.body, generation: q.answered_by_generation };
          }
          threads.push({ messageId: q.message_id, attemptId: a.id, dispatchId: a.dispatchId, nativeTaskId: a.nativeTaskId, runId: a.runId, fromMemberId: a.memberId, toMemberId: a.supervisorMemberId, status: q.status, body: m.body, ...answer ? { answer } : {} });
        }
      }
      for (let index = intents.length - 1; index >= 0; index--) {
        const intent = intents[index], spec = intent.spec;
        if (!["user-question", "relay-question"].includes(spec.kind) || !spec.origin) continue;
        if (questionOriginKind(spec.origin) === "report") {
          const sourceReport = verifiedReportOrigin(db, { work, attempts, spec });
          if (sourceReport) {
            sourceReports.push({ nativeTaskId: intent.nativeTaskId, appQuestionId: spec.appQuestionId, sourceReport });
            continue;
          }
        } else if (verifiedAsks.has(intent.nativeTaskId)) continue;
        rejected.push({ id: intent.nativeTaskId, detail: "Question origin lacks exact authenticated native ask or completion evidence." });
        intents.splice(index, 1);
      }
      const messages = [];
      for (const intent of intents.filter((i) => i.spec.kind === "message-evidence")) {
        const s = intent.spec, n = s.nativeMessage, a = attempts.find((a2) => a2.id === s.fromAttemptId);
        if (!a || a.admission !== "committed" || a.binding?.kind !== "structured" || !n?.params || n.params.body?.length > 16e3) continue;
        const d = db.prepare("SELECT * FROM dispatch_contexts WHERE id=?").get(a.dispatchId);
        if (!d || d.assignee_orca_session_id !== a.binding.sessionId || d.run_id !== a.runId || d.task_id !== a.nativeTaskId || d.assignee_handle !== a.binding.handle || d.process_incarnation !== a.binding.incarnationId) continue;
        const r = db.prepare("SELECT * FROM mutation_receipts WHERE caller_fingerprint=? AND request_id=? AND method='orchestration.send' AND state='completed'").get(identity.caller_fingerprint, n.requestId), m = db.prepare("SELECT * FROM messages WHERE id=?").get(n.messageId);
        if (!r || !m || parse4(r.receipt)?.message?.id !== m.id || r.payload_hash !== nativeMutationFingerprint("orchestration.send", n.params, a.binding) || m.run_id !== a.runId || m.from_handle !== a.binding.handle || m.sender_pane_key !== a.binding.paneKey || m.body !== n.params.body || m.type !== n.params.type || m.to_handle !== n.params.to) continue;
        const target = attempts.find((b) => b.memberId === s.toMemberId && b.id === s.toAttemptId);
        if (s.toMemberId === a.supervisorMemberId ? n.params.to !== `run:${a.runId}` : !target || n.params.to !== target.binding?.handle) continue;
        messages.push({ controlProof: intent, id: m.id, workId: work.id, fromMemberId: a.memberId, toMemberId: s.toMemberId, attemptId: a.id, toAttemptId: target?.id, dispatchId: a.dispatchId, nativeTaskId: a.nativeTaskId, runId: a.runId, body: m.body, type: m.type, requestId: r.request_id, payloadHash: r.payload_hash, state: "native_committed", processing: "unconfirmed" });
      }
      return { state: "verified", intents, rejected, threads, messages, sourceReports };
    });
  } catch (error) {
    return { state: "unverified", detail: error.code ? "Native question evidence is unavailable. Preserve pending answers and reconnect the owning runtime." : error.message, intents: [], rejected: [], threads: [] };
  }
}

// src/local/terminal-identity.mjs
function terminalIdentity(terminal) {
  const { ptyId, incarnationId } = terminal ?? {};
  if (typeof ptyId !== "string" || !ptyId || typeof incarnationId !== "string" || !incarnationId) throw Error("Exact native terminal PTY and incarnation are unverified.");
  return { ptyId, incarnationId, processIncarnation: `${ptyId}:${incarnationId}` };
}
function matchesTerminalObservation(terminal, saved) {
  if (!saved || !saved.incarnationId && !saved.processIncarnation) return false;
  const actual = terminalIdentity(terminal);
  return (!saved.incarnationId || saved.incarnationId === actual.incarnationId) && (!saved.ptyId || saved.ptyId === actual.ptyId) && (!saved.processIncarnation || saved.processIncarnation === actual.processIncarnation);
}

// src/local/member-names.mjs
async function nameDispatchedMember({ store, rpc, consent, work, attempt, team }) {
  const binding = attempt?.binding;
  if (binding?.kind !== "terminal" || attempt.reuse || attempt.sidebarNaming || attempt.admission !== "committed") return;
  const member = team.members.find((row) => row.id === attempt.memberId);
  if (!member || store.readMemberDispatch(member.id)?.id !== attempt.id || store.readMemberOperation(member.id)) return;
  const current = () => {
    const saved = store.readMemberDispatch(member.id), active = store.readCurrentWork(work.id);
    return saved?.id === attempt.id && saved.version === attempt.version && !store.readMemberOperation(member.id) && active?.status !== "completed" && active?.version === work.version && controlRuntime(active) === controlRuntime(work);
  };
  try {
    await consent();
    if ((await rpc("status.get"))?.runtimeId !== controlRuntime(work)) return;
    const shown = (await rpc("terminal.show", { terminal: binding.handle }))?.terminal;
    if (shown?.handle !== binding.handle || shown.worktreeId !== binding.workspaceId || shown.executionHostId !== binding.executionHostId || `${shown.tabId}:${shown.leafId}` !== binding.paneKey || terminalIdentity(shown).processIncarnation !== binding.incarnationId || shown.agentIdentity !== member.agent || shown.connected !== true || shown.writable !== true || !current()) return;
    const title = `${team.name}/${member.name}`, at = (/* @__PURE__ */ new Date()).toISOString();
    attempt = store.recordDispatchName(attempt.id, attempt.version, { title, outcome: "attempted", at });
    let naming;
    try {
      const receipt = (await rpc("terminal.rename", { terminal: binding.handle, title }))?.rename;
      if (receipt?.handle !== binding.handle || receipt.tabId !== shown.tabId || receipt.title !== title) throw Error("Native sidebar rename was not confirmed.");
      naming = { title, outcome: "confirmed", at };
    } catch (error) {
      naming = { title, outcome: "unconfirmed", at, detail: String(error.message).slice(0, 1200) };
    }
    store.recordDispatchName(attempt.id, attempt.version, naming);
  } catch {
  }
}

// src/local/dispatch.mjs
import { createHash as createHash8, randomBytes as randomBytes2, randomUUID as randomUUID4 } from "node:crypto";

// src/local/runtime-reconnect.mjs
var same2 = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
var terminalControlIdentity = (terminal) => [
  "handle",
  "worktreeId",
  "executionHostId",
  "connected",
  "writable",
  "agentIdentity",
  "tabId",
  "leafId",
  "ptyId",
  "incarnationId"
].map((key) => terminal[key]);
async function nativeRun(userData, work, operations, settle = (value) => value) {
  return withOrchestrationSnapshot(
    userData,
    {
      pathError: "The native evidence is outside this Orca profile.",
      schemaError: "The native evidence format is unsupported."
    },
    (db) => {
      const run = db.prepare(
        "SELECT id,objective,home_database,legacy,consumer_generation,coordinator_handle,coordinator_pane_key,coordinator_orca_session_id,coordinator_orca_session_id_generation FROM runs WHERE id=?"
      ).get(work.run.id);
      if (!run || run.objective !== work.nativeObjective || run.home_database !== "this_database" || run.legacy !== 0 || run.consumer_generation !== work.run.consumerGeneration || run.coordinator_handle !== work.instance.handle || run.coordinator_pane_key !== work.instance.paneKey || run.coordinator_orca_session_id)
        throw Error("The original native Run owner or generation changed.");
      if (db.prepare("SELECT id FROM tasks WHERE run_id=? LIMIT 1").get(run.id) || db.prepare("SELECT id FROM dispatch_contexts WHERE run_id=? LIMIT 1").get(run.id))
        throw Error(
          "This Run has native Task or Dispatch work. Reconnect requires a quiet original Run."
        );
      for (const op of operations)
        if (db.prepare(
          "SELECT id FROM dispatch_contexts WHERE assignee_handle=? AND status IN ('pending','dispatched') LIMIT 1"
        ).get(op.handle))
          throw Error("A prepared member has an active native assignment.");
      return settle({ ...run });
    }
  );
}
async function reconnectRuntime({ store, rpc, userData, consent }, input) {
  if (!input || Object.keys(input).some(
    (k) => !["requestId", "workId", "expectedRevision", "expectedWorkVersion"].includes(k)
  ) || !/^[A-Za-z0-9-]{1,120}$/.test(input.requestId ?? "") || typeof input.workId !== "string" || !Number.isSafeInteger(input.expectedRevision) || !Number.isSafeInteger(input.expectedWorkVersion))
    throw Error("Choose the saved work and reload its current team before reconnecting.");
  await consent();
  const prior = store.replayRuntimeReconnect(input);
  if (prior) return store.readCurrentWork(input.workId);
  const before = store.runtimeReconnectSnapshot(input), work = before.work, initial = await rpc("status.get");
  if (typeof initial?.runtimeId !== "string" || !initial.runtimeId || initial.runtimeId === controlRuntime({ ...work, runtimeControl: before.control }))
    throw Error("These sessions already belong to the current Orca runtime.");
  return withNativeRuntime(rpc, initial.runtimeId, async () => {
    const read = async () => {
      await consent();
      const status = await rpc("status.get");
      if (status?.runtimeId !== initial.runtimeId || !["orchestration.contract.v1", "terminal.prompt-delivery.v1"].every(
        (c) => status.capabilities?.includes(c)
      ))
        throw Error("Orca changed or the required native contract is unavailable.");
      const project = (await rpc("worktree.show", {
        worktree: work.scope.workspaceId.startsWith("folder:") ? work.scope.workspaceId : `id:${work.scope.workspaceId}`
      }))?.worktree;
      if (project?.id !== work.scope.workspaceId || (project.hostId ?? project.identity?.executionHostId) !== "local")
        throw Error("The saved project or local host changed.");
      const members = [];
      for (const op of before.operations) {
        const shown2 = (await rpc("terminal.show", { terminal: op.handle }))?.terminal;
        if (shown2?.handle !== op.handle || shown2.worktreeId !== work.scope.workspaceId || shown2.executionHostId !== "local" || shown2.connected !== true || shown2.writable !== true || shown2.agentIdentity !== op.nativeRequest.agent || `${shown2.tabId}:${shown2.leafId}` !== op.paneKey || /placeholder/.test(`${shown2.tabId}:${shown2.leafId}`) || !same2(terminalIdentity(shown2), {
          ptyId: op.observation.ptyId,
          incarnationId: op.observation.incarnationId,
          processIncarnation: op.observation.processIncarnation
        }))
          throw Error(
            "An original prepared session changed or is not connected. No session was replaced."
          );
        if (op.requestId === work.binding.requestId && !same2(
          {
            kind: "terminal",
            handle: shown2.handle,
            paneKey: op.paneKey,
            ...terminalIdentity(shown2)
          },
          work.instance
        ))
          throw Error("The original supervisor execution identity changed.");
        const activity = (await rpc("terminal.agentStatus", { terminal: op.handle }))?.agentStatus;
        if (activity?.handle !== op.handle || activity.isRunningAgent !== true || !["idle", null].includes(activity.status))
          throw Error(
            "A prepared agent is busy, waiting for permission, or has no verified idle status. Finish its current turn before reconnecting."
          );
        const wait = (await rpc("terminal.wait", { terminal: op.handle, for: "tui-idle", timeoutMs: 1e3 }))?.wait;
        if (wait?.handle !== op.handle || wait.condition !== "tui-idle" || wait.satisfied !== true || wait.status !== "running" || wait.blockedReason || wait.exitCode !== null)
          throw Error(
            "The native idle check did not confirm this exact agent is ready. Keep its session and finish the pending turn or permission prompt."
          );
        const after = (await rpc("terminal.show", { terminal: op.handle }))?.terminal, afterActivity = (await rpc("terminal.agentStatus", { terminal: op.handle }))?.agentStatus;
        if (!after || !same2(terminalControlIdentity(shown2), terminalControlIdentity(after)) || afterActivity?.handle !== op.handle || afterActivity.isRunningAgent !== true || !["idle", null].includes(afterActivity.status))
          throw Error("The original agent changed or became busy during its idle check.");
        members.push({
          requestId: op.requestId,
          memberId: op.memberId,
          handle: shown2.handle,
          paneKey: op.paneKey,
          ...terminalIdentity(shown2),
          agent: shown2.agentIdentity,
          activity: "native-tui-idle",
          idleEvidence: {
            condition: wait.condition,
            satisfied: wait.satisfied,
            status: wait.status
          }
        });
      }
      const run = await nativeRun(userData, work, before.operations), shown = (await rpc("orchestration.runShow", { id: work.run.id }))?.run;
      if (shown?.id !== run.id || shown.objective !== run.objective || shown.consumer_generation !== run.consumer_generation)
        throw Error("Native Run changed during reconnect.");
      const tasks = await rpc("orchestration.taskList", { run: work.run.id, brief: true });
      if (!Array.isArray(tasks?.tasks) || tasks.tasks.length)
        throw Error("Native Task work appeared during reconnect.");
      return { runtimeId: status.runtimeId, run, members };
    };
    const first = await read(), second = await read();
    if (!same2(first, second))
      throw Error("Native identities changed during reconnect. No control binding was changed.");
    await consent();
    if ((await rpc("status.get"))?.runtimeId !== initial.runtimeId)
      throw Error("Orca restarted again during reconnect.");
    await nativeRun(userData, work, before.operations, (run) => {
      if (!same2(second.run, run)) throw Error("Native Run changed before reconnect settlement.");
      store.commitRuntimeReconnect(input, before, { ...second, reads: 2 });
    });
    return store.readCurrentWork(work.id);
  });
}

// src/local/native-hierarchy.mjs
async function readNativeParentEvidence(userData, { parentWork, attempt, active = true }) {
  try {
    return await withOrchestrationSnapshot(userData, { pathError: "Parent evidence path is unverified.", schemaError: "Native parent schema is unsupported." }, (db) => {
      const run = db.prepare("SELECT * FROM runs WHERE id=?").get(parentWork.run.id), owner = parentWork.instance;
      if (!run || run.objective !== parentWork.nativeObjective || run.home_database !== "this_database" || run.legacy !== 0 || run.consumer_generation !== parentWork.run.consumerGeneration || (attempt.reviewAuthority?.generation ?? attempt.generation) !== run.consumer_generation || !owner || (owner.kind === "structured" ? run.coordinator_orca_session_id !== owner.sessionId || run.coordinator_orca_session_id_generation !== run.consumer_generation : run.coordinator_handle !== owner.handle || run.coordinator_pane_key !== owner.paneKey)) throw Error("Parent Run owner or generation changed.");
      const d = db.prepare("SELECT * FROM dispatch_contexts WHERE id=?").get(attempt.dispatchId), b = attempt.binding, w = db.prepare("SELECT * FROM worker_dispatches WHERE dispatch_id=?").get(attempt.dispatchId);
      if (!d || !b || d.run_id !== run.id || d.task_id !== attempt.nativeTaskId || d.assignee_handle !== b.handle || d.assignee_pane_key !== b.paneKey || d.process_incarnation !== b.incarnationId || b.sessionId && d.assignee_orca_session_id !== b.sessionId || !w || w.worktree_id !== parentWork.scope.workspaceId || w.runtime_epoch !== b.runtimeId || !Number.isSafeInteger(d.depth) || d.depth < 1) throw Error("Parent Dispatch assignee or actual native depth is unverified.");
      const creator = attempt.originalSupervisorInstance ?? owner;
      if (creator.kind === "structured" ? d.creator_orca_session_id !== creator.sessionId : d.creator_handle !== creator.handle || d.creator_pane_key !== creator.paneKey) throw Error("Original parent Dispatch creator no longer matches its admitted supervisor.");
      const host = JSON.parse(d.host_scope ?? "null");
      if (parentWork.scope.executionHostId !== "local" || host?.kind !== "local" || host.hostId !== "local") throw Error("Nested manager parent requires its verified local owning host; remote ancestry remains unverified.");
      if (active && (!["pending", "dispatched"].includes(d.status) || !["starting", "ready"].includes(w.state) || attempt.status !== "running" || attempt.evidenceId)) throw Error("Parent Dispatch is no longer active; descendant admission is fenced.");
      return { state: "verified", depth: d.depth, dispatchId: d.id, status: d.status, assignee: { sessionId: d.assignee_orca_session_id, handle: d.assignee_handle, paneKey: d.assignee_pane_key, incarnationId: d.process_incarnation } };
    });
  } catch (error) {
    return { state: "unverified", detail: error.code ? "Native parent evidence is unavailable; preserve the Run binding." : error.message };
  }
}

// src/local/teamwork.mjs
import { createHash as createHash7, randomBytes, randomUUID as randomUUID3 } from "node:crypto";

// src/local/native-run.mjs
import { isAbsolute as isAbsolute5 } from "node:path";
var columns = ["id", "objective", "home_database", "coordinator_handle", "coordinator_pane_key", "coordinator_orca_session_id", "coordinator_orca_session_id_generation", "consumer_generation", "legacy"];
async function readNativeRunEvidence(userData, { objective, owner, runId } = {}) {
  const unknown = (detail2) => ({ state: "unverified", detail: detail2 });
  try {
    if (!isAbsolute5(userData || "") || typeof objective !== "string" || !owner) throw Error();
    return await withOrchestrationSnapshot(userData, { pathError: "", schemaError: "" }, (db) => {
      const names = new Set(db.prepare("PRAGMA table_info(runs)").all().map((row) => row.name));
      if (columns.some((name) => !names.has(name))) throw Error();
      const rows = runId ? db.prepare(`SELECT ${columns.join(",")} FROM runs WHERE id=? LIMIT 2`).all(runId) : db.prepare(`SELECT ${columns.join(",")} FROM runs WHERE objective=? LIMIT 2`).all(objective);
      if (rows.length !== 1) return unknown("No unambiguous native Run matches this TeamWork yet. The supervisor must create its own Run.");
      const run = rows[0];
      if (run.objective !== objective || run.legacy !== 0 || run.home_database !== "this_database" || !Number.isSafeInteger(run.consumer_generation) || run.consumer_generation < 1) return unknown("Native Run scope or generation is unverified.");
      if (owner.kind === "structured") {
        if (run.coordinator_orca_session_id !== owner.sessionId || run.coordinator_orca_session_id_generation !== run.consumer_generation) return unknown("Native Run is not bound to this supervisor at its current consumer generation.");
      } else if (owner.kind !== "terminal" || !owner.paneKey || run.coordinator_pane_key !== owner.paneKey || run.coordinator_handle !== owner.handle) return unknown("Native Run terminal owner does not match this supervisor.");
      return { state: "verified", id: run.id, consumerGeneration: run.consumer_generation, observedAt: (/* @__PURE__ */ new Date()).toISOString(), detail: "Native owner and generation observed; process liveness is separate." };
    });
  } catch {
    return unknown("Native Run evidence is unavailable or incompatible. Preserve the work and reconnect its owning Orca host.");
  }
}

// src/local/teamwork.mjs
var canonical2 = (value) => value === null || typeof value !== "object" ? JSON.stringify(value ?? null) : Array.isArray(value) ? `[${value.map(canonical2).join(",")}]` : `{${Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical2(v)}`).join(",")}}`;
var sendFingerprint = (sessionId, body, delivery) => createHash7("sha256").update(canonical2({ method: "agentSession.send", sessionId, fields: { body, ...delivery ? { delivery } : {} } })).digest("hex");
function objectiveInstructions(work, team) {
  if (work.parent) return `TEAM_MANAGER_RUN
${JSON.stringify({ teamWorkId: work.teamWorkId, runBindingId: work.id, parent: work.parent, objective: work.nativeObjective, instruction: "You are the actual assigned manager of the original parent Dispatch. Keep that umbrella Dispatch active while delegating and reviewing. Using your own inherited native identity create exactly one Run with this exact objective. This message is JSON: decode its objective string, including escaped newlines, before passing it as one CLI argument; verify the actual stored objective string; do not fabricate --from. Never pass a parent Run Task as native --parent in this Run. Wait for the versioned child admission protocol. Native depth is inherited from your active parent Dispatch across Runs; if nested_worker_depth_exceeded, report that refusal and ask the highest supervisor to request Settings \u2192 Orchestration \u2192 Nested worker depth at least 2 (or the required deeper level). Never change the setting or launch a standalone replacement to bypass it. Accept only direct reports. When every descendant is accepted and questions resolved, send your own native worker_done for the ORIGINAL parent Dispatch/Task and original parent Run using the installed guide; do not stamp the child Run onto the upward report. Only the highest supervisor asks/delivers to the user. Relay questions through your real parent manager, preserving their original native question IDs. Do not self-create provider-native subagents; only approved roster members via admitted native Orca dispatch. This is a cooperative instruction and admission policy, not global provider tool interception." })}`;
  const head = team.members.find((row) => row.id === work.supervisorMemberId);
  return `Team Orchestrator work protocol v1. TeamWork ${work.id}; team ${work.teamId}; supervisor member ${work.supervisorMemberId}; configuration ${work.configVersion}; role ${work.roleVersion}.
Your saved role: ${head.brief}
Work habits: ${head.habits}
Collaboration: ${head.collaboration}
Project: ${work.scope.workspaceId}; execution host: ${work.scope.executionHostId}.
Approved prior-work handoff: ${work.handoff ? JSON.stringify(work.handoff) : "None"}.
Total objective: ${work.objective}
Use your own inherited Orca session identity and the matching installed Orca CLI. Read its skills get orchestration --full guide. Create your own native Run exactly once with this exact objective string: ${JSON.stringify(work.nativeObjective)}. This shown string is JSON-encoded: decode it, including escaped newlines, before passing it as one CLI argument. Verify the actual stored objective string. If that exact Run already exists for this work, inspect it and continue it; do not create another. Never override --from with another session or fabricate caller/consumer credentials. Return the Run ID as a lookup hint; the plugin verifies native owner evidence. Report exact CLI/runtime/authentication prerequisites when unavailable. Do not dispatch roster workers yet; wait for the plugin's versioned admission protocol. Session creation, input acceptance and delivery of the total result are distinct. The user must accept the completed total objective.`;
}
function createWorkService({ store, rpc, userData, consent }) {
  const serialize = createKeyedSerializer();
  const serial = (id2, fn) => serialize(id2, () => withNativeRuntime(rpc, controlRuntime(store.readCurrentWork(id2)), fn));
  const save = (work, patch) => store.updateWork(work.id, work.version, patch);
  async function verifyHost(work, expected = work.binding.hostGeneration) {
    if (!work.scope.executionHostId.startsWith("ssh:")) return null;
    const state = (await rpc("ssh.getState", { targetId: decodeURIComponent(work.scope.executionHostId.slice(4)) }))?.state;
    if (state?.status !== "connected" || !Number.isSafeInteger(state.connectionGeneration) || expected != null && state.connectionGeneration !== expected) throw Error("Saved SSH host disconnected or changed generation; existing intent remains reserved.");
    return state.connectionGeneration;
  }
  async function verify(work, forSend = false, { allowSettledParent = false, retirementRequestId } = {}) {
    if (work.status === "completed") throw Error("Completed TeamWork is sealed.");
    await consent();
    const binding = work.parent && !work.recoveryRequestId ? work.binding : store.readOperation(work.binding.requestId);
    let parentAssignee;
    const pendingIdle = store.listWakes().find((r) => r.mode === "idle-replacement" && r.memberId === work.supervisorMemberId && ["approved", "replacing"].includes(r.state));
    if (pendingIdle && (forSend || retirementRequestId !== pendingIdle.requestId)) throw Error("Saved supervisor binding changed: idle replacement is reserved; normal input and admission are paused.");
    if (work.parent) {
      const parentWork = (store.readCurrentWork ?? store.readWork)(work.parent.workId), attempt = store.listDispatches(work.parent.workId).find((a) => a.id === work.parent.attemptId);
      if (!parentWork || !attempt || attempt.dispatchId !== work.parent.dispatchId || store.listDispatches(parentWork.id).filter((a) => a.taskKey === attempt.taskKey).at(-1)?.id !== attempt.id) throw Error("Parent manager attempt changed.");
      await verify(parentWork, false, { allowSettledParent, retirementRequestId });
      const proof = await readNativeParentEvidence(userData, { parentWork, attempt, active: !allowSettledParent });
      if (proof.state !== "verified") throw Error(proof.detail);
      parentAssignee = proof.assignee;
    }
    const retirement = retirementRequestId && store.readWake(retirementRequestId), reserved = retirement?.mode === "idle-replacement" && retirement.state === "replacing" && retirement.oldBinding.requestId === binding?.requestId && store.readMemberOperation(retirement.memberId)?.requestId === retirement.newInstance?.requestId;
    if (reserved) {
      if (forSend) throw Error("Retired supervisor cannot receive input.");
      store.assertReplacementIdle(retirement.memberId);
    }
    if (!binding || (!work.parent || work.recoveryRequestId) && !store.isActiveOperation(binding) && !reserved || binding.status !== "created" || ["memberId", "teamId", "kind", "handle", "sessionId", "runtimeId"].some((key) => binding[key] !== work.binding[key]) || binding.scope?.workspaceKey !== work.scope.workspaceKey) throw Error("Saved supervisor binding changed; no objective can be redirected.");
    const status = await rpc("status.get");
    if (status?.runtimeId !== controlRuntime(work) || !status.capabilities?.includes("orchestration.contract.v1")) throw Error("The bound Orca runtime or orchestration contract is unavailable. Open its Orchestration setup and read the matching installed CLI guide.");
    const selected = (await rpc("worktree.show", { worktree: work.scope.workspaceId.startsWith("folder:") ? work.scope.workspaceId : `id:${work.scope.workspaceId}` }))?.worktree;
    if (selected?.id !== work.scope.workspaceId || (selected.hostId ?? selected.identity?.executionHostId) !== work.scope.executionHostId) throw Error("The saved project or execution host is no longer verified.");
    const hostGeneration = await verifyHost(work);
    if (binding.kind === "structured") {
      if (!status.capabilities.includes("agent-session.structured.v1")) throw Error("This runtime cannot accept structured user messages.");
      const address = (await rpc("orchestration.sessionAddress", { sessionId: binding.sessionId }))?.orcaSessionId;
      const location = address && (await rpc("orchestration.partyLocation", { address }))?.location;
      if (!address?.startsWith("orca_session_id:") || location?.kind !== "chat" || location.sessionId !== binding.sessionId || location.worktreeId !== work.scope.workspaceId) throw Error("The prepared supervisor session lineage or project changed.");
      const history = await rpc("agentSession.history", { sessionId: binding.sessionId, direction: "tail", limit: 40 });
      if (history?.ok !== true || history.page?.sessionId !== binding.sessionId || !Number.isSafeInteger(history.page.fence) || history.page.fence < 1) throw Error("A verified native session fence is unavailable. Open the supervisor session and resolve its native error.");
      const instance2 = { kind: "structured", sessionId: address.slice("orca_session_id:".length), liveSessionId: binding.sessionId, fence: history.page.fence };
      if (parentAssignee && parentAssignee.sessionId !== instance2.sessionId) throw Error("Recovered manager is not the actual original parent Dispatch assignee; a genuine parent assignment is required.");
      if (work.instance && ["sessionId", "liveSessionId", "fence"].some((key) => work.instance[key] !== instance2[key])) throw Error("Supervisor execution fence changed; the existing work remains reserved.");
      await verifyHost(work, hostGeneration);
      return { instance: instance2, history: history.page, status, hostGeneration };
    }
    const shown = (await rpc("terminal.show", { terminal: binding.handle }))?.terminal;
    if (shown?.handle !== binding.handle || shown.worktreeId !== work.scope.workspaceId || shown.executionHostId !== work.scope.executionHostId || !shown.connected || !shown.writable || !shown.incarnationId || shown.agentIdentity !== binding.nativeRequest.agent || `${shown.tabId}:${shown.leafId}` !== binding.paneKey) throw Error("The prepared terminal agent, host or execution instance is unverified. Open its native session and resolve login or permission issues.");
    if (binding.observation && (binding.observation.incarnationId || binding.observation.processIncarnation) && !matchesTerminalObservation(shown, binding.observation)) throw Error("Prepared terminal PTY or incarnation changed.");
    if (forSend) {
      const activity = (await rpc("terminal.agentStatus", { terminal: binding.handle }))?.agentStatus;
      if (activity?.handle !== binding.handle || activity.isRunningAgent !== true || activity.status === "permission") throw Error("The supervisor is not ready for user input or is waiting for permission. Resolve its native session first.");
    }
    const instance = { kind: "terminal", handle: binding.handle, paneKey: binding.paneKey, ...terminalIdentity(shown) };
    if (parentAssignee && (parentAssignee.handle !== instance.handle || parentAssignee.paneKey !== instance.paneKey || parentAssignee.incarnationId !== instance.processIncarnation)) throw Error("Recovered manager does not match the actual parent Dispatch execution instance.");
    if (work.instance && (["handle", "paneKey", "incarnationId"].some((key) => work.instance[key] !== instance[key]) || work.instance.ptyId && work.instance.ptyId !== instance.ptyId || work.instance.processIncarnation && work.instance.processIncarnation !== instance.processIncarnation)) throw Error("Supervisor terminal incarnation changed; the existing work remains reserved.");
    if (!status.capabilities.includes("terminal.prompt-delivery.v1")) throw Error("This host does not support durable terminal prompt delivery. Update the owning Orca host before submitting.");
    await verifyHost(work, hostGeneration);
    return { instance, status, hostGeneration };
  }
  async function observe(work, verified) {
    if (work.status === "completed" || work.run.state === "fenced") return work;
    verified ??= await verify(work);
    let input = work.input.state === "sending" ? { ...work.input, state: "unknown", detail: "The original submission has no settled receipt. Checking never sends it again." } : work.input, processing = work.processing;
    if (verified.history && work.nativeSend) {
      const submission = verified.history.submissions?.find((row) => row.clientMessageId === work.nativeSend.params.envelope.clientOperationId);
      if (submission) {
        if (submission.dispatchState === "accepted") input = { ...input, state: "accepted", source: "native-host-journal", dispatchState: "accepted", providerItemId: submission.providerItemId ?? null, messageId: submission.clientMessageId, detail: "Native provider accepted this exact user message; processing is separate." };
        if (submission.dispatchState === "rejected") input = { ...input, state: "rejected", source: "native-host-journal", dispatchState: "rejected", detail: "Native provider rejected the saved objective. Inspect the supervisor session." };
        const userItemId = `orca:${encodeURIComponent(submission.clientMessageId)}`;
        const turn = verified.history.latestTurn?.turn;
        if (submission.dispatchState === "accepted" && turn?.userItemId === userItemId && ["running", "completed", "interrupted"].includes(turn.state)) processing = { state: "observed", detail: "A native turn is linked to this exact objective message; total-work acceptance is separate.", turnId: turn.turnId };
      }
    }
    let run = await readNativeRunEvidence(userData, { objective: work.nativeObjective, owner: verified.instance, runId: work.run.id });
    if (work.run.consumerGeneration && run.state === "verified" && run.consumerGeneration !== work.run.consumerGeneration) return save(work, { run: { ...work.run, state: "fenced", detail: "Native Run consumer generation changed. Earlier work authority is not reused." }, status: "needs_attention" });
    if (run.state !== "verified" && work.run.id) run = { ...work.run, state: "unverified", detail: run.detail };
    let snapshot = work.snapshot ? { ...work.snapshot, stale: true } : void 0;
    if (run.state === "verified") {
      const current = (await rpc("orchestration.runShow", { id: run.id }))?.run;
      if (current?.id !== run.id || current.consumer_generation !== run.consumerGeneration || current.objective !== work.nativeObjective) throw Error("Native Run changed while observing its snapshot.");
      const result = await rpc("orchestration.taskList", { run: run.id, brief: true });
      if (!Array.isArray(result?.tasks) || result.tasks.some((task) => task.run_id !== run.id)) throw Error("Native Task snapshot does not match the confirmed Run.");
      const finalOwner = await readNativeRunEvidence(userData, { objective: work.nativeObjective, owner: verified.instance, runId: run.id });
      if (finalOwner.state !== "verified" || finalOwner.consumerGeneration !== run.consumerGeneration) throw Error("Native Run ownership changed during snapshot read; prior generation remains fenced.");
      snapshot = { stale: false, observedAt: (/* @__PURE__ */ new Date()).toISOString(), tasks: result.tasks.map((task) => ({ id: task.id, status: task.status, title: task.task_title ?? task.display_name ?? "Task", ...task.dispatch_id ? { dispatchId: task.dispatch_id } : {} })) };
    }
    await verifyHost(work, verified.hostGeneration);
    return save(work, { input, processing, run, ...snapshot ? { snapshot } : {}, instance: verified.instance, status: work.status === "awaiting_acceptance" ? "awaiting_acceptance" : run.state === "verified" ? "active" : input.state === "not_sent" || input.state === "rejected" ? "needs_attention" : "awaiting_run", error: void 0 });
  }
  async function deliver(work) {
    if (work.input.state !== "not_sent" || work.nativeSend) return work;
    let attempted = false;
    try {
      const verified = await verify(work, true), team = store.readTeamVersion(work.teamId, work.configVersion), body = { kind: "message", role: "user", blocks: [{ type: "text", text: objectiveInstructions(work, team) }] };
      let nativeSend;
      if (work.binding.kind === "structured") {
        const sessionId = work.binding.sessionId;
        nativeSend = { method: "agentSession.send", params: { envelope: { sessionId, clientOperationId: `${Date.now()}-${randomBytes(16).toString("hex")}`, expectedRuntimeFence: verified.instance.fence, payloadFingerprint: sendFingerprint(sessionId, body) }, body }, envelope: {} };
      } else nativeSend = { method: "terminal.send", params: { terminal: work.binding.handle, text: body.blocks[0].text, enter: true, agentPrompt: true, waitSubmitMs: 1e3, client: { id: "team-orchestrator", type: "desktop" } }, envelope: { orchestrationRequestId: randomUUID3() } };
      await consent();
      work = save(work, { nativeSend, instance: verified.instance, input: { state: "sending" }, status: "awaiting_input" });
      attempted = true;
      await verifyHost(work, verified.hostGeneration);
      const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
      let input, processing = { state: "unknown" };
      if (work.binding.kind === "structured") {
        if (receipt?.ok !== true) throw Error(`Native supervisor input refused: ${receipt?.refusal?.message ?? receipt?.refusal?.code ?? "unverified result"}`);
        const value = receipt.value;
        if (value?.clientMessageId !== nativeSend.params.envelope.clientOperationId || !Number.isSafeInteger(receipt.fence)) throw Error("Native objective message identity is unverified.");
        if (value.queued) {
          if (!["waiting", "dispatched", "returned", "withdrawn"].includes(value.queued.state) || typeof value.queued.messageId !== "string") throw Error("Native queued objective receipt is unverified.");
          input = { state: "queued", source: "native-queue", messageId: value.clientMessageId, queued: { messageId: value.queued.messageId, state: value.queued.state, position: value.queued.position }, detail: "Native host queued this user input; queueing is not provider processing." };
        } else {
          const submission = value.submission;
          if (submission?.clientMessageId !== value.clientMessageId || !["pending", "accepted", "rejected", "unknown"].includes(submission.dispatchState)) throw Error("Native objective dispatch evidence is unverified.");
          input = { state: submission.dispatchState === "unknown" ? "unknown" : submission.dispatchState === "rejected" ? "rejected" : "accepted", source: "native-host-journal", dispatchState: submission.dispatchState, messageId: value.clientMessageId, providerItemId: submission.providerItemId ?? null, fence: receipt.fence, ...submission.handedOverAt ? { handedOverAt: submission.handedOverAt } : {}, detail: `Native journal dispatch: ${submission.dispatchState}. Host acceptance and provider processing are separate.` };
        }
      } else {
        const send = receipt?.send;
        if (send?.handle !== work.binding.handle || send.accepted !== true || send.prompt?.requestId !== nativeSend.envelope.orchestrationRequestId || send.prompt.processIncarnation !== verified.instance.incarnationId) throw Error("Terminal objective receipt or execution instance is unconfirmed. Do not resend.");
        input = { state: "accepted", messageId: send.prompt.requestId, detail: "Native terminal accepted the objective input." };
        if (send.prompt.stages?.includes("turn_started") && send.prompt.observation === "supported") processing = { state: "observed", detail: "Native host observed the prompt start; total-work completion is separate." };
      }
      work = save(work, { input, processing, status: "awaiting_run" });
      return await observe(work, verified);
    } catch (error) {
      return save(work, { input: attempted && work.input.state === "sending" ? { ...work.input, state: "unknown", detail: "Input may have been delivered. Checking work never resends it." } : work.input, status: "needs_attention", error: String(error.message).slice(0, 1500) });
    }
  }
  return {
    async reconnect(input) {
      return serialize(input?.workId, async () => publicWork(await reconnectRuntime({ store, rpc, userData, consent }, input)));
    },
    async startManager(id2) {
      return serial(id2, async () => {
        const work = store.readCurrentWork(id2);
        if (!work?.parent) throw Error("Manager Run binding required.");
        return publicWork(await deliver(work));
      });
    },
    async verifyHost(id2, expected) {
      const work = store.readCurrentWork(id2);
      if (!work) throw Error("Saved work not found.");
      return verifyHost(work, expected);
    },
    async verifyWork(id2, forSend = false, options) {
      const work = store.readCurrentWork(id2);
      if (!work) throw Error("Saved work not found.");
      return withNativeRuntime(rpc, controlRuntime(work), () => verify(work, forSend, options));
    },
    async submit(input) {
      const prepared = store.prepareWork(input);
      return serial(prepared.work.id, async () => publicWork(prepared.fresh ? await deliver(store.readCurrentWork(prepared.work.id)) : store.readCurrentWork(prepared.work.id)));
    },
    async check(id2) {
      return serial(id2, async () => {
        let work = store.readCurrentWork(id2);
        if (!work) throw Error("Saved TeamWork was not found.");
        try {
          return publicWork(await observe(work));
        } catch (error) {
          return publicWork(save(work, { status: "needs_attention", run: { ...work.run, state: work.run.state === "fenced" ? "fenced" : "unverified", detail: "Current native Run authority is unverified; its saved generation is retained." }, ...work.snapshot ? { snapshot: { ...work.snapshot, stale: true } } : {}, error: String(error.message).slice(0, 1500) }));
        }
      });
    },
    async retry(id2) {
      return serial(id2, async () => {
        const work = store.readCurrentWork(id2);
        if (!work || work.recoveryRequestId || work.input.state !== "not_sent" || work.nativeSend) throw Error("This objective may have been submitted. Check its evidence instead of sending again.");
        return publicWork(await deliver(work));
      });
    },
    async reconcile() {
      for (const work of store.listCurrentWorks()) if (work.status !== "completed" && (work.recoveryRequestId || work.input.state !== "not_sent") && work.run.state !== "fenced") await this.check(work.id);
    }
  };
}

// src/local/native-intent-withdrawal.mjs
var parse5 = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
var same3 = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
var fields = ["protocol", "workId", "token", "generation", "supervisorMemberId", "nativeTaskId", "taskKey", "memberId", "replacementNativeTaskId", "reason"];
var caller2 = (owner) => owner.kind === "structured" ? `orca_session_id:${owner.sessionId}` : owner.handle;
function readIntentWithdrawals({ db, tasks, work, protocol, team, owner, admitted, identity, receipts, verifyIntent: verifyIntent2, history = [], historyContexts = [] }) {
  const withdrawn = [], rejected = [];
  if (!history.length && !tasks.some((task) => parse5(task.result)?.protocol === "team-intent-withdrawal/v1")) return { withdrawn, rejected };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const starts = db.prepare("SELECT state,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method IN ('orchestration.workerStart','orchestration.dispatch','orchestration.federationAttachStart')").all(identity.caller_fingerprint);
  for (const task of tasks) {
    const result = parse5(task.result), saved = history.find((row) => row.nativeTaskId === task.id);
    if (result?.protocol !== "team-intent-withdrawal/v1" && !saved) continue;
    try {
      const original = parse5(task.spec);
      let proofProtocol = protocol, proofTeam = team, proofOwner = owner, proofEpoch = work.epoch ?? 0;
      if (saved) {
        const contexts = historyContexts.filter((context2) => context2.nativeTaskId === task.id && context2.epoch === saved.epoch), context = contexts[0];
        if (contexts.length !== 1 || !context.team || context.team.id !== work.teamId) throw Error("Recorded withdrawal frozen configuration is unavailable.");
        proofTeam = context.team;
        if (saved.epoch !== proofEpoch) {
          if (!Number.isSafeInteger(saved.epoch) || saved.epoch < 0 || saved.epoch >= proofEpoch || context.authorities.length !== 1) throw Error("Recorded withdrawal archived authority is unavailable.");
          const authority2 = context.authorities[0];
          proofProtocol = authority2.protocol;
          proofOwner = authority2.owner;
          proofEpoch = authority2.epoch;
        }
      }
      if (!result || Object.keys(result).length !== fields.length || fields.some((key) => !Object.hasOwn(result, key)) || result.protocol !== "team-intent-withdrawal/v1" || result.reason !== "missing-worker-rules" || result.workId !== work.id || result.token !== proofProtocol.token || result.generation !== proofProtocol.generation || result.supervisorMemberId !== work.supervisorMemberId || result.nativeTaskId !== task.id || result.taskKey !== original?.taskKey || result.memberId !== original?.memberId || typeof result.replacementNativeTaskId !== "string" || result.replacementNativeTaskId.length > 120 || result.replacementNativeTaskId === task.id || task.status !== "failed" || task.result.length > 8e3) throw Error("Withdrawal does not match the current supervisor and failed original intent.");
      if (!original || Object.hasOwn(original, "workerRules") || admitted.some((row) => row.nativeTaskId === task.id) || db.prepare("SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1").get(task.id)) throw Error("Only a missing-rules intent with no admission or past Dispatch can be withdrawn.");
      for (const start of starts) {
        const value = parse5(start.receipt), taskId = value?.taskId ?? value?.task?.id;
        if (taskId === task.id || typeof taskId !== "string" || !taskId) throw Error("Native start evidence is present or unresolved; withdrawal is refused.");
      }
      const created = receipts("orchestration.taskCreate", task.id);
      if (created.length !== 1) throw Error("Original Task creation proof is missing or ambiguous.");
      verifyIntent2(task, { ...original, workerRules: WORKER_RULES }, work, proofProtocol, proofTeam, proofOwner, created[0]);
      const replacement = byId.get(result.replacementNativeTaskId), replacementSpec = parse5(replacement?.spec);
      if (!replacement || replacement.run_id !== task.run_id || !same3({ ...original, workerRules: WORKER_RULES }, replacementSpec)) throw Error("Replacement must preserve the exact business intent and add the approved workerRules.");
      const replacementCreated = receipts("orchestration.taskCreate", replacement.id);
      if (replacementCreated.length !== 1) throw Error("Replacement Task creation proof is missing or ambiguous.");
      verifyIntent2(replacement, replacementSpec, work, proofProtocol, proofTeam, proofOwner, replacementCreated[0]);
      const updates = receipts("orchestration.taskUpdate", task.id), update = updates[0];
      const expected = nativeMutationFingerprint("orchestration.taskUpdate", { id: task.id, status: "failed", result: task.result, run: work.run.id, callerTerminalHandle: caller2(proofOwner) }, proofOwner);
      if (updates.length !== 1 || update.payload_hash !== expected || update.value?.task?.id !== task.id || update.value.task.run_id !== work.run.id || update.value.task.status !== "failed" || update.value.task.spec !== task.spec || update.value.task.result !== task.result) throw Error("Withdrawal needs the exact authenticated owning supervisor Task update.");
      const record = { workId: work.id, nativeTaskId: task.id, replacementNativeTaskId: replacement.id, taskKey: original.taskKey, memberId: original.memberId, reason: result.reason, generation: proofProtocol.generation, epoch: proofEpoch, originalSpec: task.spec, replacementSpec: replacement.spec, result: task.result, createProof: { requestId: created[0].request_id, payloadHash: created[0].payload_hash }, replacementProof: { requestId: replacementCreated[0].request_id, payloadHash: replacementCreated[0].payload_hash }, updateProof: { requestId: update.request_id, payloadHash: update.payload_hash } };
      if (saved && !same3(saved, record)) throw Error("Recorded withdrawal evidence changed.");
      withdrawn.push(record);
    } catch (error) {
      rejected.push({ nativeTaskId: task.id, detail: error.message });
    }
  }
  const duplicates = new Set(withdrawn.filter((row) => withdrawn.some((other) => other.nativeTaskId !== row.nativeTaskId && other.replacementNativeTaskId === row.replacementNativeTaskId)).map((row) => row.nativeTaskId));
  for (const row of history) if (!byId.has(row.nativeTaskId)) rejected.push({ nativeTaskId: row.nativeTaskId, detail: "Recorded withdrawn Task is missing." });
  for (const id2 of duplicates) rejected.push({ nativeTaskId: id2, detail: "Multiple withdrawn intents cannot share a replacement." });
  return { withdrawn: withdrawn.filter((row) => !duplicates.has(row.nativeTaskId)), rejected };
}

// src/local/native-dispatch.mjs
var caller3 = (owner) => owner.kind === "structured" ? `orca_session_id:${owner.sessionId}` : owner.handle;
var same4 = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
var parse6 = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
function verifyIntent(task, spec, work, protocol, team, owner, receipt) {
  if (!spec || spec.protocol !== "team-dispatch/v1" || spec.workId !== work.id || spec.token !== protocol.token || spec.generation !== protocol.generation || spec.configVersion !== team.configVersion || typeof spec.taskKey !== "string" || !/^[A-Za-z0-9-]{1,120}$/.test(spec.taskKey) || typeof spec.instruction !== "string" || !spec.instruction.trim() || spec.instruction.length > 8e3) throw Error("Native task intent does not match this work admission protocol.");
  if (Object.keys(spec).some((key) => !["protocol", "workId", "token", "generation", "taskKey", "memberId", "configVersion", "roleVersion", "role", "instruction", "dependencies", "previousAttemptId", "writeScope", "workerRules"].includes(key))) throw Error("Native intent has unsupported fields.");
  if (spec.workerRules !== WORKER_RULES) throw Error("Actual worker Task must include the approved workerRules, including no provider-native subagents.");
  if (spec.dependencies !== void 0 && (!Array.isArray(spec.dependencies) || spec.dependencies.length > 100 || spec.dependencies.some((key) => typeof key !== "string" || !/^[A-Za-z0-9-]{1,120}$/.test(key) || key === spec.taskKey) || new Set(spec.dependencies).size !== spec.dependencies.length)) throw Error("Invalid application dependencies.");
  if (spec.writeScope !== void 0) declaredWriteScope(spec.writeScope);
  const member = team.members.find((row) => row.id === spec.memberId);
  if (!member || member.boss !== work.supervisorMemberId || member.roleVersion !== spec.roleVersion || !same4(spec.role, { brief: member.brief, habits: member.habits, collaboration: member.collaboration })) throw Error("Task member, direct supervisor or frozen role version does not match.");
  const expected = nativeMutationFingerprint("orchestration.taskCreate", { spec: task.spec, run: work.run.id, callerTerminalHandle: caller3(owner) }, owner);
  if (receipt.payload_hash !== expected || receipt.value?.task?.id !== task.id || receipt.value.task.spec !== task.spec || receipt.value.task.run_id !== work.run.id) throw Error("Native Task author proof is unavailable. Use the exact task-create protocol without extra flags.");
  if (owner.kind === "terminal" && (task.created_by_terminal_handle !== owner.handle || task.created_by_pane_key !== owner.paneKey || task.created_by_process_incarnation !== owner.processIncarnation || task.created_by_run_generation !== protocol.generation)) throw Error("Native terminal Task creator instance is unverified.");
  return { spec, member, nativeTaskId: task.id, taskSpec: task.spec, requestId: receipt.request_id, payloadHash: receipt.payload_hash };
}
async function readNativeDispatchEvidence(userData, { work, protocol, team, owner, admitted = [], allowSettledParent = false, nativeHistory = { authorities: [], controls: [] } }) {
  try {
    return await withOrchestrationSnapshot(userData, { pathError: "Native evidence path is outside the verified profile.", schemaError: "Native orchestration evidence schema is unsupported." }, (db) => {
      const run = db.prepare("SELECT id,objective,home_database,legacy,consumer_generation,coordinator_handle,coordinator_pane_key,coordinator_orca_session_id,coordinator_orca_session_id_generation FROM runs WHERE id=?").get(work.run.id);
      if (!run || run.objective !== work.nativeObjective || run.home_database !== "this_database" || run.legacy !== 0 || run.consumer_generation !== protocol.generation || work.run.consumerGeneration !== protocol.generation) throw Error("Native Run generation or work changed; admission is fenced.");
      if (owner.kind === "structured" ? run.coordinator_orca_session_id !== owner.sessionId || run.coordinator_orca_session_id_generation !== run.consumer_generation : run.coordinator_handle !== owner.handle || run.coordinator_pane_key !== owner.paneKey) throw Error("Native Run owner no longer matches its supervisor.");
      let parentDispatch;
      if (work.parent) {
        parentDispatch = db.prepare("SELECT * FROM dispatch_contexts WHERE id=?").get(work.parent.dispatchId);
        const p = parentDispatch;
        if (!p || p.run_id !== work.parent.runId || p.task_id !== work.parent.taskId || !Number.isSafeInteger(p.depth) || p.depth < 1 || (owner.kind === "structured" ? p.assignee_orca_session_id !== owner.sessionId : p.assignee_handle !== owner.handle || p.assignee_pane_key !== owner.paneKey || p.process_incarnation !== owner.processIncarnation) || !allowSettledParent && !["pending", "dispatched"].includes(p.status)) throw Error("Parent Dispatch is stale, settled or does not own this manager Run.");
        const parentRun = db.prepare("SELECT * FROM runs WHERE id=?").get(p.run_id);
        if (!parentRun || parentRun.consumer_generation !== (work.parentAuthority?.generation ?? work.parent.generation)) throw Error("Parent Run generation changed; child authority is fenced.");
      }
      const identity = db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
      if (!identity?.caller_fingerprint) throw Error("Native mutation author evidence is unavailable.");
      const receipts = (method, taskId, field = "task.id") => db.prepare(`SELECT request_id,payload_hash,state,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method=? AND state='completed' AND json_valid(receipt) AND json_extract(receipt,?)=? LIMIT 3`).all(identity.caller_fingerprint, method, `$.${field}`, taskId).map((row) => ({ ...row, value: parse6(row.receipt) }));
      const intents = [], rejected = [], observations = [], reviews = [], deliveries = [];
      const tasks = db.prepare("SELECT id,run_id,spec,status,result,created_by_terminal_handle,created_by_pane_key,created_by_process_incarnation,created_by_run_generation FROM tasks WHERE run_id=?").all(work.run.id);
      for (const task of tasks) {
        const spec = parse6(task.spec);
        if (spec?.protocol !== "team-delivery/v1" || spec.workId !== work.id) continue;
        const proof = receipts("orchestration.taskCreate", task.id);
        const expected = nativeMutationFingerprint("orchestration.taskCreate", { spec: task.spec, run: work.run.id, callerTerminalHandle: caller3(owner) }, owner);
        if (proof.length !== 1 || proof[0].payload_hash !== expected || proof[0].value?.task?.spec !== task.spec || proof[0].value.task.run_id !== work.run.id || spec.token !== protocol.token || spec.generation !== protocol.generation || spec.supervisorMemberId !== work.supervisorMemberId || !team.members.some((m) => m.id === spec.supervisorMemberId && m.boss === null) || typeof spec.summary !== "string" || !spec.summary.trim() || spec.summary.length > 8e3 || !Array.isArray(spec.evidenceRefs) || !spec.evidenceRefs.length || spec.evidenceRefs.length > 100 || spec.evidenceRefs.some((r) => typeof r !== "string" || !r.trim() || r.length > 2e3) || !Array.isArray(spec.attemptIds) || spec.attemptIds.length > 100 || spec.attemptIds.some((r) => typeof r !== "string" || r.length > 120) || owner.kind === "terminal" && (task.created_by_terminal_handle !== owner.handle || task.created_by_pane_key !== owner.paneKey || task.created_by_process_incarnation !== owner.processIncarnation || task.created_by_run_generation !== protocol.generation)) continue;
        deliveries.push({ id: task.id, epoch: work.epoch ?? 0, protocolToken: protocol.token, previousDeliveryId: spec.previousDeliveryId ?? null, summary: spec.summary, evidenceRefs: spec.evidenceRefs, attemptIds: spec.attemptIds, generation: spec.generation, supervisorMemberId: spec.supervisorMemberId, proof: { requestId: proof[0].request_id, payloadHash: proof[0].payload_hash } });
      }
      const withdrawal = readIntentWithdrawals({ db, tasks, work, protocol, team, owner, admitted, identity, receipts, verifyIntent, history: nativeHistory.withdrawals ?? [], historyContexts: nativeHistory.withdrawalContexts ?? [] });
      const withdrawnIds = new Set(withdrawal.withdrawn.map((row) => row.nativeTaskId));
      rejected.push(...withdrawal.rejected);
      for (const task of tasks) {
        if (withdrawnIds.has(task.id)) continue;
        const spec = parse6(task.spec);
        if (spec?.protocol !== "team-dispatch/v1" || spec.workId !== work.id || admitted.some((row) => row.nativeTaskId === task.id)) continue;
        try {
          const proof = receipts("orchestration.taskCreate", task.id);
          if (proof.length !== 1) throw Error("Native Task creation receipt is missing or ambiguous.");
          const intent = verifyIntent(task, spec, work, protocol, team, owner, proof[0]);
          intent.unadmitted = !["ready", "pending"].includes(task.status) || Boolean(db.prepare("SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1").get(task.id));
          intents.push(intent);
        } catch (error) {
          rejected.push({ nativeTaskId: task.id, detail: error.message });
        }
      }
      for (const attempt of admitted) {
        if (attempt.admission === "unadmitted") {
          observations.push({ id: attempt.id, state: "unverified", detail: "This native work began before app admission; its member remains reserved for reconciliation." });
          continue;
        }
        const starts = receipts("orchestration.workerStart", attempt.nativeTaskId, "taskId");
        if (starts.length !== 1) {
          const present = db.prepare("SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1").get(attempt.nativeTaskId);
          observations.push({ id: attempt.id, state: starts.length || present ? "unverified" : "absent", detail: starts.length ? "Native worker-start receipt is ambiguous." : present ? "Native worker effect exists without a completed author receipt; reconcile before any new attempt." : "Waiting for the real supervisor to start the admitted Task." });
          continue;
        }
        const attemptOwner = attempt.originalSupervisorInstance ?? owner;
        const start = starts[0], expected = nativeMutationFingerprint("orchestration.workerStart", { ...attempt.startParams, from: caller3(attemptOwner), devMode: false }, attemptOwner, attempt.reuse?.binding);
        if (start.payload_hash !== expected || start.value.runId !== work.run.id || typeof start.value.dispatchId !== "string") {
          observations.push({ id: attempt.id, state: "unverified", detail: "Native worker-start author or input does not match admission." });
          continue;
        }
        const d = db.prepare("SELECT * FROM dispatch_contexts WHERE id=?").get(start.value.dispatchId);
        if (parentDispatch && (!d || d.creator_dispatch_id !== parentDispatch.id || d.depth !== parentDispatch.depth + 1)) {
          observations.push({ id: attempt.id, state: "unverified", detail: "Native creator Dispatch or depth does not match the actual manager parent; a new Run cannot reset ancestry." });
          continue;
        }
        const worker = d && db.prepare("SELECT dispatch_id,worktree_id,agent_terminal_handle,state,runtime_epoch,start_options FROM worker_dispatches WHERE dispatch_id=?").get(d.id);
        const host = parse6(d?.host_scope), options = parse6(worker?.start_options), hostMatches = work.scope.executionHostId === "local" ? host?.kind === "local" && host.hostId === "local" : host?.kind === "ssh" && `ssh:${encodeURIComponent(host.targetId)}` === work.scope.executionHostId;
        if (!d || d.run_id !== work.run.id || d.task_id !== attempt.nativeTaskId || !worker || worker.worktree_id !== work.scope.workspaceId || worker.agent_terminal_handle !== d.assignee_handle || !hostMatches || (attempt.reuse ? d.assignee_orca_session_id ? d.assignee_orca_session_id !== attempt.reuse.binding.sessionId : d.assignee_handle !== attempt.reuse.binding.handle || d.process_incarnation !== attempt.reuse.binding.incarnationId : options?.agent !== attempt.startParams.agent) || (attemptOwner.kind === "structured" ? d.creator_orca_session_id !== attemptOwner.sessionId : d.creator_handle !== attemptOwner.handle || d.creator_pane_key !== attemptOwner.paneKey)) {
          observations.push({ id: attempt.id, state: "unverified", detail: "Native Dispatch creator, member instance or execution host is unverified." });
          continue;
        }
        const reusedChat = attempt.reuse?.terminal === `orca_session_id:${d.assignee_orca_session_id}` && d.assignee_handle === attempt.reuse.terminal && Number.isSafeInteger(attempt.reuse.sessionFence);
        if (!d.assignee_handle || !reusedChat && (!d.assignee_pane_key || !d.process_incarnation) || (owner.kind === "structured" ? d.assignee_orca_session_id === owner.sessionId : d.assignee_pane_key === owner.paneKey)) {
          observations.push({ id: attempt.id, state: "unverified", detail: "Native worker instance evidence is incomplete." });
          continue;
        }
        const binding = { kind: d.assignee_orca_session_id ? "structured" : "terminal", handle: d.assignee_handle, paneKey: d.assignee_pane_key, incarnationId: d.process_incarnation, ...reusedChat ? { sessionFence: attempt.reuse.sessionFence, ...attempt.reuse.binding.liveSessionId ? { liveSessionId: attempt.reuse.binding.liveSessionId } : {} } : {}, ...d.assignee_orca_session_id ? { sessionId: d.assignee_orca_session_id } : {}, workspaceId: worker.worktree_id, executionHostId: work.scope.executionHostId, runtimeId: worker.runtime_epoch };
        const facts = db.prepare("SELECT id,dispatch_id,task_id,authority_id,facet,payload FROM attempt_observation_facts WHERE dispatch_id=? AND facet='worker_report'").all(d.id);
        let completion;
        for (const fact of facts) {
          const message = db.prepare("SELECT id,run_id,from_handle,sender_pane_key,type,body,payload FROM messages WHERE id=?").get(fact.id.slice("worker_report:".length));
          completion = verifiedWorkerReport(fact, message, d, worker);
          if (completion) break;
        }
        observations.push({ id: attempt.id, state: "verified", dispatchId: d.id, creatorDispatchId: d.creator_dispatch_id, ...Number.isSafeInteger(d.depth) ? { depth: d.depth } : {}, binding, nativeState: worker.state, startRequestId: start.request_id, startPayloadHash: start.payload_hash, ...completion ? { completion } : {} });
      }
      for (const attempt of admitted) {
        if (!attempt.evidenceId || !attempt.reviewToken) continue;
        if (work.parent && !observations.some((o) => o.id === attempt.id && o.state === "verified" && o.completion?.evidenceId === attempt.evidenceId)) {
          rejected.push({ detail: "Descendant review requires unchanged native execution evidence." });
          continue;
        }
        const proofs = db.prepare("SELECT request_id,payload_hash,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.taskUpdate' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.task.id')=? ORDER BY rowid LIMIT 101").all(identity.caller_fingerprint, attempt.nativeTaskId);
        if (proofs.length > 100) {
          rejected.push({ detail: "Review receipt history exceeds the verification bound." });
          continue;
        }
        if (attempt.review && !proofs.some((p) => p.request_id === attempt.review.requestId && p.payload_hash === attempt.review.payloadHash)) rejected.push({ detail: "Recorded supervisor review evidence is missing or changed." });
        for (const proof of proofs) {
          const task = parse6(proof.receipt)?.task, review = parse6(task?.result);
          if (review?.protocol !== "team-review/v1") {
            if (attempt.review?.requestId === proof.request_id) rejected.push({ detail: "Recorded supervisor review evidence is malformed." });
            continue;
          }
          if (isHistoricalReview(work, attempt, proof, task, review, nativeHistory)) continue;
          const status = attempt.outcome === "succeeded" ? "completed" : "failed";
          const expected = nativeMutationFingerprint("orchestration.taskUpdate", { id: attempt.nativeTaskId, status, result: task.result, run: work.run.id, callerTerminalHandle: caller3(owner) }, owner);
          if (proof.payload_hash !== expected || task.run_id !== work.run.id || task.status !== status || review.workId !== work.id || review.token !== protocol.token || review.generation !== protocol.generation || review.taskKey !== attempt.taskKey || review.attemptId !== attempt.id || review.nativeTaskId !== attempt.nativeTaskId || review.dispatchId !== attempt.dispatchId || review.reviewToken !== (attempt.reviewAuthority?.reviewToken ?? attempt.reviewToken) || review.reviewerMemberId !== attempt.supervisorMemberId || !team.members.some((m) => m.id === attempt.memberId && m.boss === review.reviewerMemberId) || !["accept", "rework"].includes(review.decision) || !Array.isArray(review.evidenceRefs) || review.evidenceRefs.length > 100 || !review.evidenceRefs.includes(attempt.evidenceId) || review.evidenceRefs.some((ref) => typeof ref !== "string" || !ref || ref.length > 2e3) || typeof review.summary !== "string" || !review.summary.trim() || review.summary.length > 8e3) {
            rejected.push({ detail: "Supervisor review author, attempt or validation evidence is unverified." });
            continue;
          }
          reviews.push({ attemptId: attempt.id, reviewToken: review.reviewToken, protocolToken: protocol.token, requestId: proof.request_id, payloadHash: proof.payload_hash, reviewerMemberId: review.reviewerMemberId, decision: review.decision, evidenceRefs: review.evidenceRefs, summary: review.summary, generation: protocol.generation });
        }
      }
      const unmanaged = [];
      for (const task of tasks) {
        if (withdrawnIds.has(task.id) || admitted.some((a) => a.nativeTaskId === task.id) || isHistoricalControl(db, work, task, nativeHistory, admitted)) continue;
        const spec = parse6(task.spec), proof = receipts("orchestration.taskCreate", task.id);
        const expected = nativeMutationFingerprint("orchestration.taskCreate", { spec: task.spec, run: work.run.id, callerTerminalHandle: caller3(owner) }, owner);
        const control = (spec?.protocol === "team-delivery/v1" && !work.parent || spec?.protocol === "team-questions/v1" && ["answer-ack", "collaboration-directive", "message-evidence", "recovery-handoff", "staffing-proposal", "roster-ack", ...!work.parent ? SESSION_DECISION_KINDS : [], work.parent ? "relay-question" : "user-question"].includes(spec.kind)) && spec.workId === work.id && spec.token === protocol.token && spec.generation === protocol.generation && proof.length === 1 && proof[0].payload_hash === expected && proof[0].value?.task?.spec === task.spec && proof[0].value.task.run_id === work.run.id && (owner.kind !== "terminal" || task.created_by_terminal_handle === owner.handle && task.created_by_pane_key === owner.paneKey && task.created_by_process_incarnation === owner.processIncarnation && task.created_by_run_generation === protocol.generation) && !db.prepare("SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1").get(task.id);
        if (!control) unmanaged.push(task.id);
      }
      for (const d of db.prepare("SELECT id FROM dispatch_contexts WHERE run_id=?").all(work.run.id)) if (!admitted.some((a) => a.dispatchId === d.id)) unmanaged.push(d.id);
      rejected.push(...changedRecordedControls(db, work, nativeHistory));
      return { state: "verified", intents, rejected, observations, reviews, deliveries, unmanaged, withdrawnIntents: withdrawal.withdrawn };
    });
  } catch (error) {
    return { state: "unverified", detail: error.code ? "Native Task evidence is unavailable or incompatible. Preserve the work and reconnect its owning runtime." : String(error.message ?? "Native evidence unavailable").slice(0, 1200), intents: [], observations: [], rejected: [] };
  }
}

// src/capabilities.mjs
var AGENTS = ["codex", "claude"];
function preferenceIssue(preference, capabilities, { requireCore = false } = {}) {
  const { agent, model, effort } = preference;
  if (!AGENTS.includes(agent) || [model, effort].some((value) => typeof value !== "string" || !value.trim() || value.length > 120)) return "Choose a valid agent, model and effort.";
  if (model === "default" && effort !== "default") return "Choose a model before overriding effort.";
  const entry = capabilities?.agents?.[agent];
  if (entry?.availability === "unavailable") return `${agent} was not detected on this execution host. Check its installation in Orca.`;
  if (requireCore && (!capabilities?.launchSupported || capabilities.connection !== "connected" || Date.now() - capabilities.observedAt > 3e5)) return "This execution host has not confirmed the required launch capabilities and connection. Refresh capabilities.";
  if (model === "default") return "";
  if (!capabilities || Date.now() - capabilities.observedAt > 3e5) return "Model validation is unavailable or stale. Refresh host capabilities or choose Default.";
  if (entry?.catalogStatus !== "known") return "This host has not verified model and effort overrides. Choose Default to inherit Orca configuration, or refresh after the host can list models.";
  const listed = entry.models.find((row) => row.id === model);
  if (!listed) return `Model \u201C${model}\u201D is not supported by the observed host catalog. Choose an available model or Default.`;
  if (effort !== "default" && !listed.efforts.some((row) => row.value === effort)) return `Effort \u201C${effort}\u201D is not supported for ${model}. Choose an advertised effort or Default.`;
  return "";
}

// src/local/capabilities.mjs
var text5 = (value, limit = 120) => typeof value === "string" && value.trim() && value.length <= limit ? value : null;
var bounded = (value) => Array.isArray(value) ? value.slice(0, 256) : [];
function models(value) {
  const seen = /* @__PURE__ */ new Set();
  return bounded(value).flatMap((row) => {
    if (!text5(row?.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    return [{ id: row.id, label: text5(row.label) || row.id, isDefault: row.isDefault === true, efforts: bounded(row.efforts).flatMap((effort) => text5(effort?.value) ? [{ value: effort.value, label: text5(effort.label) || effort.value }] : []) }];
  });
}
async function discoverCapabilities(rpc, scope) {
  const read = async (method, params) => {
    try {
      return await rpc(method, params);
    } catch (error) {
      if (error.authority) throw error;
      return null;
    }
  };
  const status = await read("status.get");
  const settings = (await read("settings.get"))?.settings ?? {};
  let connection = "connected", targetId, before;
  if (scope.executionHostId !== "local") {
    const encoded = scope.executionHostId.slice(4);
    try {
      targetId = decodeURIComponent(encoded);
    } catch {
      throw Error("Invalid saved execution host identity.");
    }
    if (!scope.executionHostId.startsWith("ssh:") || !targetId || encoded.includes("|")) throw Error("Invalid saved execution host identity.");
    before = (await read("ssh.getState", { targetId }))?.state;
    if (before?.status !== "connected") connection = "unavailable";
  }
  const detected = connection === "connected" ? await read(targetId ? "preflight.detectRemoteAgents" : "preflight.detectAgents", targetId ? { connectionId: targetId } : void 0) : null;
  const registered = status?.capabilities?.includes("agent-session.structured.registered-agents.v1") ? await read("agentSession.agents", {}) : null;
  const result = { workspaceKey: scope.workspaceKey, executionHostId: scope.executionHostId, observedAt: Date.now(), runtimeId: text5(status?.runtimeId, 256), connection, defaultAgent: AGENTS.includes(settings.defaultTuiAgent) ? settings.defaultTuiAgent : null, launchSupported: status?.capabilities?.includes("agent.launch.v2") === true && status?.capabilities?.includes("agent.launch.replay-required.v1") === true, agents: {} };
  for (const agent of AGENTS) {
    const support = connection === "connected" ? await read("agentSession.createSupport", { worktree: scope.workspaceId.startsWith("folder:") ? scope.workspaceId : `id:${scope.workspaceId}`, agent }) : null;
    const catalog = !targetId && connection === "connected" ? await read("agentSession.modelCatalog", { agent, worktree: scope.workspaceId.startsWith("folder:") ? scope.workspaceId : `id:${scope.workspaceId}` }) : null;
    const configured = {};
    for (const field of ["model", "effort"]) if (text5(support?.seedOptions?.[field])) configured[field] = support.seedOptions[field];
    const customCommand = typeof settings.agentCmdOverrides?.[agent] === "string" && Boolean(settings.agentCmdOverrides[agent].trim());
    result.agents[agent] = {
      availability: !Array.isArray(detected) ? "unknown" : detected.includes(agent) ? "detected" : customCommand ? "unknown" : "unavailable",
      tuiPickerDisabled: Array.isArray(settings.disabledTuiAgents) && settings.disabledTuiAgents.includes(agent),
      customCommand,
      configured,
      configuredSource: "orca-saved-preference",
      effective: { model: null, effort: null, contextUsage: null },
      structuredSupported: typeof support?.supported === "boolean" ? support.supported : null,
      contextUsageSupported: registered?.agents?.find((row) => row.agent === agent)?.capabilities?.contextUsage === true,
      catalogStatus: ["probe", "live-session"].includes(catalog?.origin) && Array.isArray(catalog.models) ? "known" : "unknown",
      catalogSource: ["probe", "live-session"].includes(catalog?.origin) ? catalog.origin : null,
      fetchedAt: Number.isFinite(catalog?.fetchedAt) ? catalog.fetchedAt : null,
      models: models(catalog?.models),
      detail: targetId ? "Remote model catalog unavailable. Default inherits Orca; explicit overrides require host validation." : catalog?.listingInProgress ? "Orca is listing models. Refresh capabilities shortly." : catalog?.origin === "unknown" || !catalog ? "Model catalog unknown. Default inherits Orca configuration." : ""
    };
  }
  if (targetId) {
    const after = (await read("ssh.getState", { targetId }))?.state;
    if (after?.status !== "connected" || after?.providerEpoch !== before?.providerEpoch || after?.connectionGeneration !== before?.connectionGeneration) {
      result.connection = "unavailable";
      for (const entry of Object.values(result.agents)) entry.availability = "unknown";
    }
    result.hostGeneration = after?.connectionGeneration ?? null;
  }
  return result;
}

// src/local/dispatch.mjs
function dispatchInstructions(work, team, protocol, attempts = []) {
  const children = team.members.filter((row) => row.boss === work.supervisorMemberId).map((row) => ({ memberId: row.id, name: row.name, agent: row.agent, model: row.model, effort: row.effort, roleVersion: row.roleVersion, role: { brief: row.brief, habits: row.habits, collaboration: row.collaboration } }));
  return "TEAM_DISPATCH_PROTOCOL\n" + JSON.stringify({ protocol: "team-dispatch/v1", workId: work.id, token: protocol.token, generation: protocol.generation, configVersion: team.configVersion, runId: work.run.id, teamWorkId: work.teamWorkId ?? work.id, parent: work.parent, sessionDecisions: sessionDecisionInstructions(work), workerRules: WORKER_RULES, children, recoveryReviews: attempts.filter((a) => a.reviewAuthority).map((a) => ({ attemptId: a.id, nativeTaskId: a.nativeTaskId, dispatchId: a.dispatchId, taskKey: a.taskKey, reviewToken: a.reviewAuthority.reviewToken, evidenceId: a.evidenceId, recoveryRequestId: a.reviewAuthority.recoveryRequestId })), questions: { protocol: "team-questions/v1", instructions: "Members ask their direct owning Run using native orchestration ask, with inherited identity and the same message ID on resume. Ordinary messages follow direct reporting lines. Managers may coordinate explicit real Runs. Worker-to-worker collaboration requires your native Task kind=collaboration-directive with appQuestionId as stable directive ID, fromMemberId, toMemberId, fromAttemptId, toAttemptId, workId, token, generation; both must be your admitted direct children. They still report to their original supervisor. For recovery publish a genuine recovery-handoff Task with appQuestionId=recovery request ID,memberId,oldRequestId,decision=replace,checked summary,evidence[]. Only your actual direct child is eligible. Do not start another session before the plugin permit. To retain an ordinary structured native send as verified panel evidence, publish kind=message-evidence with appQuestionId, fromAttemptId, toMemberId, optional toAttemptId, and nativeMessage {messageId,requestId,params}; params must exactly match the original native parsed send. Terminal ordinary from labels remain unverified and cannot authorize application changes. Only the highest supervisor may publish user-question Task intents. Lower managers publish kind=relay-question with the same fields, escalate using native ask from their original parent Dispatch to the original parent Run, and give the parent their relay record {workId,appQuestionId}. The parent question includes relay {workId,appQuestionId}; repeat through each real manager. Never answer or ask as another manager. Highest supervisor user-question Task intents: use exactly task-create --spec JSON --run this Run --json with protocol,kind=user-question,workId,token,generation,appQuestionId,summary,options[],blockingTaskKeys[],evidence[]. Include origin {attemptId,dispatchId,nativeTaskId,messageId,askRequestId,askParams} for a native worker ask; askParams must be the exact native parsed input including from and compatibility CLI fields. For a highest-Head decision based on a native worker_done completion instead, origin may contain ONLY {attemptId,dispatchId,nativeTaskId,messageId} and evidence must include its exact worker_report:messageId. The plugin verifies this as sourceReport; it is not a native ask and requires no orchestration reply or requester resume. Ordinary message IDs are not completion proof. Keep every originating member and owning Run; never use ordinary message labels as proof. Ask the user in your own highest-supervisor session and record their answer with session-answer as described in sessionDecisions. Legacy saved panel answers may still arrive as TEAM_USER_ANSWER. Reply only as the actual native owning Run consumer, relay through actual lower managers for nested asks, then publish kind=answer-ack with appQuestionId,answerId and same protocol authority. An ack may include nextNativeTaskId to authorize exactly one next step after two failures. Only native execution success resets the consecutive failure count. Awaiting one question never pauses independent tasks. For staffing publish a native Task with protocol team-questions/v1, kind staffing-proposal, appQuestionId, workId, token, generation, proposingManagerId equal to your member ID, current configVersion, roleVersion 1 for the new role, member {name,boss,brief,habits,collaboration,agent,model,effort}, rationale and affectedTaskKeys. Lower managers relay this proposal to the highest supervisor. The highest supervisor asks the user in its own session, then records staffing-decision as described in sessionDecisions. Never allocate a member/session yourself. TEAM_ROSTER_DELTA carries user-approved effective configuration and current direct children; use its configVersion for future tasks and publish native kind roster-ack with appQuestionId, deltaId, configVersion and same protocol authority after incorporation." }, instructions: "You are the real supervisor. For a direct child create exactly one native Task with task-create --spec JSON --run this Run --json, no extra task flags or forged --from. Spec fields: protocol,workId,token,generation,taskKey (stable alphanumeric/hyphen ID),memberId,configVersion,roleVersion,role (exact saved role object),instruction,workerRules (copy the exact workerRules string above into the native Task spec so the actual worker receives it). Do not worker-start yet. Finish your turn and wait for TEAM_DISPATCH_PERMIT. Repeating an unknown request requires the native reported retry-request UUID, never a fresh creation. If you omitted workerRules from a never-admitted, never-dispatched Task, preserve that original. Create one corrected Task whose parsed spec is identical except for adding the exact workerRules. You may then task-update the original --status failed --result JSON --run this Run --json, with no forged --from. The exact result fields are protocol=team-intent-withdrawal/v1, workId, token, generation, supervisorMemberId (your member ID), nativeTaskId (original), taskKey, memberId, replacementNativeTaskId (corrected), reason=missing-worker-rules. Never use withdrawal for a Task with any admission, permit, Dispatch or uncertain execution; it is not a worker failure or a retry. Wait for normal permits for the corrected Task.  Only after the permit, execute worker-start with exactly the supplied startParams using your own inherited native identity. Record native Task/Dispatch receipts; never claim completion from accepted input. Tell each actual worker to use the native worker_done report with its real Task/Dispatch and succeeded/failed outcome. Members stay open while idle. Spec must include writeScope: an array of {path: relative file/directory path, kind: file or directory}; use [] for no writes. All members share the exact selected directory; do not create worktrees. Declared scopes are cooperative coordination, not tool-level isolation. Overlapping scopes wait until acceptance; unknown attempts retain their scope. Spec may include dependencies (application taskKey array). They wait for supervisor acceptance, not native completed. After a native worker_done result, inspect evidence and task-update that same native Task with its unchanged completed/failed status and exact JSON result: protocol team-review/v1, workId,token,generation,taskKey,attemptId,nativeTaskId,dispatchId,reviewToken (from permit),reviewerMemberId (your member),decision accept or rework,evidenceRefs (include worker_report:MESSAGE_ID, where MESSAGE_ID is the id of that attempt's actual native worker_done message, and validation references),summary. Use --run this Run, no extra flags or forged caller. The plugin verifies the native taskUpdate receipt; JSON alone is not acceptance. Rework creates a NEW native Task with the SAME taskKey and dependencies plus previousAttemptId equal to the rejected attempt. Wait for a fresh permit; never relaunch the member yourself. Lower managers must keep their original parent Dispatch active until all descendants are accepted and relay questions answered, then themselves report native worker_done for that original Dispatch and original parent Run. Do not create a total delivery from a child Run. Only the highest supervisor, when the overall objective is ready, creates a separate native Task using task-create --spec JSON --run this Run --json, no extra flags. Its exact spec: protocol team-delivery/v1,workId,token,generation,supervisorMemberId (your member ID),previousDeliveryId (null initially, then prior delivery Task ID),summary (overall result),evidenceRefs (validation/artifact references including every latest accepted attempt evidenceId),attemptIds (use the attemptId delivered in each latest TEAM_DISPATCH_PERMIT). The execution evidenceId for an accepted attempt is exactly worker_report:MESSAGE_ID for its actual native worker_done message; use the same reference you included in its native acceptance review. Never invent a message ID or include a superseded attempt. After completing your genuine native acceptance reviews for every latest required attempt, publish the delivery proposal using those IDs and real validation references. Do not wait for a separate plugin acceptance notification. The plugin independently verifies reviews and gates user acceptance; proposing a delivery does not assert plugin or user acceptance. Never approve the overall delivery as the user." });
}
function userMessage(work, instance, text8, status) {
  if (work.binding.kind === "structured") {
    const body = { kind: "message", role: "user", blocks: [{ type: "text", text: text8 }] }, sessionId = work.binding.sessionId, delivery = status?.capabilities?.includes("agent-session.queued-messages.v1") ? "queue-if-active" : void 0;
    return { method: "agentSession.send", params: { envelope: { sessionId, clientOperationId: `${Date.now()}-${randomBytes2(16).toString("hex")}`, expectedRuntimeFence: instance.fence, payloadFingerprint: sendFingerprint(sessionId, body, delivery) }, body, ...delivery ? { delivery } : {} }, envelope: {} };
  }
  return { method: "terminal.send", params: { terminal: work.binding.handle, text: text8, enter: true, agentPrompt: true, waitSubmitMs: 1e3, client: { id: "team-orchestrator", type: "desktop" } }, envelope: { orchestrationRequestId: randomUUID4() } };
}
function accepted(receipt, send, instance) {
  if (send.method === "agentSession.send") return receipt?.ok === true && receipt.value?.clientMessageId === send.params.envelope.clientOperationId && (receipt.value.queued ? send.params.delivery === "queue-if-active" && typeof receipt.value.queued.messageId === "string" && ["waiting", "dispatched"].includes(receipt.value.queued.state) : ["pending", "accepted"].includes(receipt.value.submission?.dispatchState));
  return receipt?.send?.accepted === true && receipt.send.handle === instance.handle && receipt.send.prompt?.requestId === send.envelope.orchestrationRequestId && receipt.send.prompt.processIncarnation === instance.incarnationId;
}
function createDispatchService({ store, rpc, userData, consent, works, beforeAdmission, onNativeWait, onClosedMember }) {
  const serialize = createKeyedSerializer();
  const serial = (id2, fn) => serialize(id2, () => withNativeRuntime(rpc, controlRuntime(store.readCurrentWork(id2)), fn));
  const project = (id2) => store.dispatchProjection(id2);
  const teamFor = (work) => store.effectiveTeamForWork?.(work.id) ?? store.readTeamVersion(work.teamId, work.configVersion);
  async function evidence(work, protocol, team, verified) {
    return readNativeDispatchEvidence(userData, { work, protocol, team, owner: verified.instance, admitted: store.listDispatches(work.id), nativeHistory: store.readNativeHistory(work.id) });
  }
  async function sendProtocol(work, team, protocol, verified) {
    if (protocol.state !== "not_sent") return protocol;
    const nativeSend = userMessage(work, verified.instance, dispatchInstructions(work, team, protocol, store.listDispatches(work.id)), verified.status);
    await consent();
    protocol = store.updateDispatchProtocol(work.id, protocol.version, { state: "sending", nativeSend });
    try {
      await works.verifyHost(work.id, verified.hostGeneration);
      const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
      if (!accepted(receipt, nativeSend, verified.instance)) throw Error("Protocol input was not confirmed; no automatic resend.");
      return store.updateDispatchProtocol(work.id, protocol.version, { state: "accepted", detail: receipt.value?.queued ? "Native host queued dispatch instructions; waiting for the real supervisor to create Task intents." : "Native host accepted dispatch instructions; the real supervisor must create Task intents." });
    } catch (error) {
      return store.updateDispatchProtocol(work.id, protocol.version, { state: "unknown", detail: String(error.message).slice(0, 1200) });
    }
  }
  async function preparedSession(work, member, saved) {
    if (!saved || !store.isActiveOperation(saved) || saved.status !== "created" || saved.teamId !== work.teamId || saved.memberId !== member.id || saved.scope?.workspaceKey !== work.scope.workspaceKey || saved.roleVersion !== member.roleVersion || memberControlRuntime(work, saved) !== controlRuntime(work)) throw Error("Prepared member is unknown, stale or belongs to another scope; no replacement was launched.");
    const preferences = { agent: saved.nativeRequest.agent, model: saved.nativeRequest.sessionOptions?.model ?? "default", effort: saved.nativeRequest.sessionOptions?.effort ?? "default" };
    if (Object.keys(preferences).some((key) => preferences[key] !== member[key])) throw Error("Prepared session preferences differ; reuse cannot override model or effort.");
    let terminal, binding, sessionFence;
    if (saved.kind === "structured") {
      if (work.scope.executionHostId !== "local") throw Error("Prepared structured session requires its owning runtime.");
      terminal = (await rpc("orchestration.sessionAddress", { sessionId: saved.sessionId }))?.orcaSessionId;
      if (!terminal?.startsWith("orca_session_id:") || terminal === `orca_session_id:${work.instance.sessionId}`) throw Error("Prepared member canonical target is missing or is the supervisor itself.");
      const location = (await rpc("orchestration.partyLocation", { address: terminal }))?.location;
      if (location?.kind !== "chat" || location.sessionId !== saved.sessionId || location.worktreeId !== work.scope.workspaceId) throw Error("Prepared member session is closed, moved or unverified.");
      const history = await rpc("agentSession.history", { sessionId: saved.sessionId, direction: "tail", limit: 1 });
      sessionFence = history?.page?.fence;
      if (history?.ok !== true || history.page?.sessionId !== saved.sessionId || !Number.isSafeInteger(sessionFence) || sessionFence < 1) throw Error("Prepared member session fence is unavailable.");
      binding = { kind: "structured", handle: terminal, sessionId: terminal.slice("orca_session_id:".length), liveSessionId: saved.sessionId, paneKey: null, incarnationId: null, sessionFence, workspaceId: work.scope.workspaceId, executionHostId: work.scope.executionHostId, runtimeId: saved.runtimeId };
    } else {
      const live = (await rpc("terminal.show", { terminal: saved.handle }))?.terminal;
      if (live?.handle !== saved.handle || !matchesTerminalObservation(live, saved.observation) || `${live.tabId}:${live.leafId}` !== saved.paneKey || live.worktreeId !== work.scope.workspaceId || live.executionHostId !== work.scope.executionHostId || live.agentIdentity !== member.agent || !live.connected || !live.writable || saved.handle === work.binding.handle) throw Error("Prepared member terminal is unverified; no replacement was launched.");
      terminal = saved.handle;
      binding = { kind: "terminal", handle: terminal, paneKey: saved.paneKey, incarnationId: terminalIdentity(live).processIncarnation, workspaceId: work.scope.workspaceId, executionHostId: work.scope.executionHostId, runtimeId: saved.runtimeId };
    }
    if (!store.isActiveOperation(saved)) throw Error("Prepared member generation changed during verification.");
    return { kind: "prepared", requestId: saved.requestId, ...saved.wakeRequestId ? { recoveryRequestId: saved.wakeRequestId } : {}, ...saved.instanceGeneration ? { instanceGeneration: saved.instanceGeneration } : {}, binding, terminal, ...sessionFence ? { sessionFence } : {}, preferences };
  }
  async function retainedSession(work, member, prior) {
    if (!prior?.binding || !["accepted", "rework"].includes(prior.status) || prior.workId !== work.id || prior.roleVersion !== member.roleVersion) throw Error("Member has an unresolved reservation; do not launch another session.");
    const saved = prior.binding, shown = await rpc("orchestration.workerShow", { dispatch: prior.dispatchId });
    if (shown?.dispatch?.id !== prior.dispatchId || shown.dispatch.assigneeHandle !== saved.handle || shown.worker?.worktreeId !== work.scope.workspaceId || shown.worker.runtimeEpoch !== saved.runtimeId || shown.observation?.exactWorker !== true || shown.observation.status !== "live" || shown.observation.agentWait) throw Error("Retained member session is not verified live; no replacement was launched.");
    let terminal, sessionFence;
    if (saved.kind === "structured") {
      if (work.scope.executionHostId !== "local") throw Error("Retained structured session requires its owning runtime.");
      terminal = (await rpc("orchestration.sessionAddress", { sessionId: saved.liveSessionId ?? saved.sessionId }))?.orcaSessionId;
      if (terminal !== `orca_session_id:${saved.sessionId}`) throw Error("Retained member canonical identity changed.");
      const location = (await rpc("orchestration.partyLocation", { address: terminal }))?.location;
      if (location?.kind !== "chat" || location.sessionId !== (saved.liveSessionId ?? saved.sessionId) || location.worktreeId !== work.scope.workspaceId) throw Error("Retained member session is closed, moved or has unverified lineage.");
      const history = await rpc("agentSession.history", { sessionId: location.sessionId, direction: "tail", limit: 1 });
      sessionFence = history?.page?.fence;
      if (history?.ok !== true || history.page?.sessionId !== location.sessionId || !Number.isSafeInteger(sessionFence) || sessionFence < 1 || saved.sessionFence !== void 0 && saved.sessionFence !== sessionFence) throw Error("Retained member session fence is unavailable.");
    } else {
      const live = (await rpc("terminal.show", { terminal: saved.handle }))?.terminal;
      if (live?.handle !== saved.handle || terminalIdentity(live).processIncarnation !== saved.incarnationId || `${live.tabId}:${live.leafId}` !== saved.paneKey || live.worktreeId !== work.scope.workspaceId || live.executionHostId !== work.scope.executionHostId || live.agentIdentity !== member.agent || !live.connected || !live.writable) throw Error("Retained member terminal instance is unverified.");
      terminal = saved.handle;
    }
    const original = prior.reuse?.preferences ?? { agent: prior.startParams.agent, model: prior.startParams.model ?? "default", effort: prior.startParams.effort ?? "default" };
    if (original.agent !== member.agent || original.model !== member.model || original.effort !== member.effort) throw Error("Retained session preferences differ; no second session was launched.");
    return { attemptId: prior.id, binding: saved, terminal, ...sessionFence ? { sessionFence } : {}, preferences: original };
  }
  async function permit(work, attempt) {
    store.assertAdmission(work.teamId, attempt.memberId);
    if (attempt.permit.state !== "not_sent") return;
    const verified = await works.verifyWork(work.id, true), protocol = store.readDispatchProtocol(work.id), team = store.readTeamVersion(work.teamId, attempt.configVersion);
    if (attempt.token !== protocol.token || attempt.generation !== protocol.generation) throw Error("This permit belongs to an earlier supervisor epoch; preserve its original attempt.");
    const member = team.members.find((row) => row.id === attempt.memberId);
    if (!member || member.boss !== work.supervisorMemberId || member.roleVersion !== attempt.roleVersion || !attempt.reuse && (attempt.startParams.agent !== member.agent || (attempt.startParams.model ?? "default") !== member.model || (attempt.startParams.effort ?? "default") !== member.effort)) throw Error("Saved permit preferences or direct supervisor do not match the frozen member.");
    if (attempt.reuse) {
      const prior = store.listDispatches(work.id).find((row) => row.id === attempt.reuse.attemptId), prepared = store.readMemberOperation(member.id), current = attempt.reuse.kind === "prepared" ? await preparedSession(work, member, prepared) : await retainedSession(work, member, prior);
      if (JSON.stringify(current) !== JSON.stringify(attempt.reuse)) throw Error("Retained member changed before permit; reservation preserved.");
    }
    const checked = await evidence(store.readCurrentWork(work.id), protocol, team, verified);
    if (checked.state !== "verified") throw Error(checked.detail);
    const existing = checked.observations.find((row) => row.id === attempt.id);
    if (existing?.state !== "absent") {
      store.updateDispatch(attempt.id, attempt.version, { admission: "unadmitted", status: "unknown", permit: { state: "unknown" }, detail: "Native work appeared before the user-input permit. It is retained unadmitted; no permit or replacement was sent." });
      return;
    }
    const text8 = "TEAM_DISPATCH_PERMIT\n" + JSON.stringify({ workId: work.id, attemptId: attempt.id, memberId: attempt.memberId, roleVersion: attempt.roleVersion, configVersion: attempt.configVersion, nativeTaskId: attempt.nativeTaskId, generation: attempt.generation, reviewToken: attempt.reviewToken, reviewProtocol: "team-review/v1", startParams: attempt.startParams, instruction: "Admission was committed. Execute this native worker-start once as your own supervisor identity. Never override from/devMode. Preserve reported request/Dispatch IDs; uncertain delivery is not permission for another worker." });
    const nativeSend = userMessage(work, verified.instance, text8, verified.status);
    await consent();
    store.assertAdmission(work.teamId, attempt.memberId);
    attempt = store.updateDispatch(attempt.id, attempt.version, { permit: { state: "sending", nativeSend } });
    try {
      await works.verifyHost(work.id, verified.hostGeneration);
      store.assertAdmission(work.teamId, attempt.memberId);
      const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
      if (!accepted(receipt, nativeSend, verified.instance)) throw Error("Native permit delivery is unconfirmed; do not resend.");
      store.updateDispatch(attempt.id, attempt.version, { status: "awaiting_start", permit: { state: "accepted", nativeSend }, detail: receipt.value?.queued ? "Native host queued the permit for the busy supervisor; waiting for genuine worker-start evidence." : "Input accepted; waiting for genuine supervisor worker-start evidence." });
    } catch (error) {
      store.updateDispatch(attempt.id, attempt.version, { status: "unknown", permit: { state: "unknown", nativeSend }, detail: String(error.message).slice(0, 1200) });
    }
  }
  async function check(workId) {
    const work = store.readCurrentWork(workId);
    if (!work || work.status === "completed" || work.run.state !== "verified") return project(workId);
    try {
      const verified = await works.verifyWork(workId), team = teamFor(work);
      let checkIssue = false;
      let protocol = store.ensureDispatchProtocol(workId);
      let native = await evidence(work, protocol, team, verified);
      if (native.state !== "verified") throw Error(native.detail);
      if (protocol.state === "sending") protocol = store.updateDispatchProtocol(workId, protocol.version, { state: "unknown", detail: "Protocol submission was interrupted; it is not automatically sent again." });
      if (protocol.state === "unknown" && native.intents.length) protocol = store.updateDispatchProtocol(workId, protocol.version, { state: "accepted", detail: "Native supervisor-authored Task proves receipt of this exact admission protocol." });
      protocol = await sendProtocol(work, team, protocol, verified);
      if (protocol.state !== "accepted") return project(workId);
      native = await evidence(work, protocol, team, verified);
      if (native.state !== "verified") throw Error(native.detail);
      await beforeAdmission?.(workId);
      for (const intent of native.intents) {
        try {
          if (!intent.unadmitted) {
            const caps = await discoverCapabilities(rpc, work.scope), issue = preferenceIssue(intent.member, caps, { requireCore: true });
            if (issue) throw Error(issue);
          }
          const current = await works.verifyWork(workId), fresh = await evidence(store.readCurrentWork(workId), protocol, team, current);
          const currentIntent = fresh.intents.find((row) => row.nativeTaskId === intent.nativeTaskId && row.payloadHash === intent.payloadHash);
          if (fresh.state !== "verified" || !currentIntent) throw Error("Native intent changed during admission.");
          const prior = store.listDispatches(workId).filter((row) => row.memberId === intent.member.id).at(-1);
          const prepared = store.readMemberOperation(intent.member.id), recovery = prepared?.wakeRequestId && store.readWake(prepared.wakeRequestId);
          const recovered = prior && recovery && recovery.newInstance?.requestId === prepared.requestId && (recovery.oldBinding.sourceAttemptId === prior.id || prior.reuse?.requestId === recovery.oldBinding.requestId);
          let reuse;
          try {
            reuse = recovered ? await preparedSession(work, intent.member, prepared) : prior ? await retainedSession(work, intent.member, prior) : prepared ? await preparedSession(work, intent.member, prepared) : void 0;
          } catch (error) {
            const bindingRequestId = prior?.id ?? prepared?.requestId;
            if (bindingRequestId && onClosedMember) await onClosedMember({ teamId: work.teamId, memberId: intent.member.id, bindingRequestId, requestId: "taskwake-" + createHash8("sha256").update(JSON.stringify([work.id, intent.member.id, bindingRequestId])).digest("hex").slice(0, 48) });
            throw error;
          }
          const startParams = { task: intent.nativeTaskId, worktree: work.scope.workspaceId.startsWith("folder:") ? work.scope.workspaceId : `id:${work.scope.workspaceId}`, agent: intent.member.agent, run: work.run.id, ...intent.member.model !== "default" ? { model: intent.member.model } : {}, ...intent.member.effort !== "default" ? { effort: intent.member.effort } : {} };
          if (reuse) {
            delete startParams.agent;
            delete startParams.model;
            delete startParams.effort;
            startParams.terminal = reuse.terminal;
          }
          const admitted = store.prepareDispatch(workId, currentIntent, startParams, reuse);
          if (admitted.fresh && !currentIntent.unadmitted) await permit(work, admitted.attempt);
        } catch (error) {
          checkIssue = true;
          store.queueDispatch(workId, intent, error.message);
          protocol = store.updateDispatchProtocol(workId, store.readDispatchProtocol(workId).version, { detail: String(error.message).slice(0, 1200) });
        }
      }
      for (const attempt of store.listDispatches(workId)) if (attempt.permit.state === "not_sent") try {
        await permit(work, attempt);
      } catch (error) {
        checkIssue = true;
        store.updateDispatch(attempt.id, attempt.version, { detail: String(error.message).slice(0, 1200) });
      }
      native = await evidence(store.readCurrentWork(workId), protocol, team, await works.verifyWork(workId));
      if (native.state !== "verified") throw Error(native.detail);
      for (const observed of native.observations) {
        let attempt = store.listDispatches(workId).find((row) => row.id === observed.id);
        try {
          if (attempt.evidenceId) {
            await nameDispatchedMember({ store, rpc, consent, work, attempt, team });
            continue;
          }
          if (observed.state !== "verified") {
            if (attempt.permit.state === "sending") attempt = store.updateDispatch(attempt.id, attempt.version, { status: "unknown", permit: { ...attempt.permit, state: "unknown" }, detail: "Permit delivery interrupted; reconciliation never resends." });
            else if (observed.state === "unverified") store.updateDispatch(attempt.id, attempt.version, { status: "unknown", detail: observed.detail });
            continue;
          }
          const shown = await rpc("orchestration.workerShow", { dispatch: observed.dispatchId });
          if (shown?.dispatch?.id !== observed.dispatchId || shown.dispatch.runId !== work.run.id || shown.dispatch.taskId !== attempt.nativeTaskId || shown.dispatch.assigneeHandle !== observed.binding.handle || shown.worker?.worktreeId !== work.scope.workspaceId) throw Error("Native worker projection does not match admitted member identity.");
          await onNativeWait?.(workId, { ...attempt, binding: observed.binding, dispatchId: observed.dispatchId }, shown);
          const final = await evidence(store.readCurrentWork(workId), protocol, team, await works.verifyWork(workId)), settled = final.observations.find((row) => row.id === attempt.id);
          if (final.state !== "verified" || settled?.state !== "verified" || settled.dispatchId !== observed.dispatchId || JSON.stringify(settled.binding) !== JSON.stringify(observed.binding)) throw Error("Native Dispatch changed during observation.");
          if (store.listDispatches(workId).find((row) => row.id === attempt.id)?.version !== attempt.version) {
            checkIssue = true;
            continue;
          }
          store.updateDispatch(attempt.id, attempt.version, { dispatchId: settled.dispatchId, creatorDispatchId: settled.creatorDispatchId, ...settled.depth ? { depth: settled.depth } : {}, binding: settled.binding, permit: { ...attempt.permit, state: "accepted", source: "native-worker-start" }, nativeState: settled.nativeState, startRequestId: settled.startRequestId, startPayloadHash: settled.startPayloadHash, ...settled.completion ? { status: "pending_acceptance", ...settled.completion, detail: "Native execution report recorded. Direct supervisor acceptance is still required." } : { status: settled.nativeState === "ready" && shown.observation?.exactWorker === true && shown.observation.status === "live" && !shown.observation.agentWait ? "running" : "unknown", detail: shown.observation?.agentWait ? "Native session is waiting for input or authorization. Resolve its native tab; no replacement was started." : shown.observation?.exactWorker === true && shown.observation.status === "live" ? "Native assignment observed; execution result is not yet proven." : "Native worker observation is unverified; its saved identity remains reserved." } });
          await nameDispatchedMember({ store, rpc, consent, work, attempt: store.readMemberDispatch(attempt.memberId), team });
        } catch (error) {
          checkIssue = true;
          const failed = store.listDispatches(workId).find((row) => row.id === observed.id);
          if (failed && !failed.evidenceId && failed.version === attempt.version) store.updateDispatch(failed.id, failed.version, { status: "unknown", detail: String(error.message).slice(0, 1200) });
        }
      }
      const reviewEvidence = await evidence(store.readCurrentWork(workId), protocol, team, await works.verifyWork(workId));
      if (reviewEvidence.state !== "verified") throw Error(reviewEvidence.detail);
      store.recordIntentWithdrawals(workId, reviewEvidence.withdrawnIntents ?? []);
      for (const review of reviewEvidence.reviews ?? []) try {
        store.recordDispatchReview(review.attemptId, review);
      } catch (error) {
        checkIssue = true;
        store.updateDispatchProtocol(workId, store.readDispatchProtocol(workId).version, { detail: String(error.message).slice(0, 1200) });
      }
      if (reviewEvidence.rejected.length) native.rejected = reviewEvidence.rejected;
      if (native.rejected.length) store.updateDispatchProtocol(workId, store.readDispatchProtocol(workId).version, { detail: native.rejected[0].detail });
      const attempts = store.listDispatches(workId), currentProtocol = store.readDispatchProtocol(workId);
      const detail2 = "Native supervisor protocol and current Dispatch evidence verified.";
      if (!checkIssue && !native.rejected.length && !reviewEvidence.rejected.length && !reviewEvidence.intents.length && !reviewEvidence.unmanaged.length && attempts.length && attempts.every((attempt) => ["running", "pending_acceptance", "accepted", "rework"].includes(attempt.status) && reviewEvidence.observations.some((row) => row.id === attempt.id && row.state === "verified" && row.dispatchId === attempt.dispatchId && JSON.stringify(row.binding) === JSON.stringify(attempt.binding))) && currentProtocol.version === protocol.version && currentProtocol.detail !== detail2) store.updateDispatchProtocol(workId, currentProtocol.version, { detail: detail2 });
    } catch (error) {
      const protocol = store.readDispatchProtocol(workId);
      if (protocol) store.updateDispatchProtocol(workId, protocol.version, { detail: String(error.message).slice(0, 1200) });
    }
    return project(workId);
  }
  return { check: (id2) => serial(id2, () => check(id2)), async reconcile() {
    for (const work of store.listCurrentWorks().flatMap((w) => store.listRunWorks(w.id))) if (work.run.state === "verified") await this.check(work.id);
  } };
}

// src/local/questions.mjs
async function notifyQuestionEvent(store, notify, { workId, id: id2, kind, title, body }) {
  if (!["decision", "native-fault", "goal-delivery"].includes(kind)) throw Error("Routine progress is not a critical notification.");
  const event = store.ensureQuestionEvent(workId, id2, kind, { title, body });
  if (event.state !== "queued") return event;
  if (!store.claimQuestionEvent(workId, id2, "attempted")) return event;
  let state = "unavailable";
  try {
    if (notify) state = (await notify({ title: title.slice(0, 120), body: body.slice(0, 1e3) }))?.delivered === true ? "delivered" : "unconfirmed";
  } catch {
  }
  return store.updateQuestionEvent(workId, id2, { state });
}
function createQuestionService({ store, rpc, userData, consent, works, notify }) {
  const serialize = createKeyedSerializer();
  const serial = (id2, fn) => serialize(id2, () => withNativeRuntime(rpc, controlRuntime(store.readCurrentWork(id2)), fn));
  const matchingIntent = (question, native) => native.intents.find((intent) => intent.nativeTaskId === question.proof?.nativeTaskId && JSON.stringify(intent) === JSON.stringify(question.proof) && JSON.stringify(intent.spec.origin ?? null) === JSON.stringify(question.origin ?? null));
  const reportFor = (question, native) => {
    const intent = matchingIntent(question, native), source = intent && (native.sourceReports ?? []).find((row) => row.nativeTaskId === intent.nativeTaskId && row.appQuestionId === question.id)?.sourceReport;
    return source && (!question.sourceReport || JSON.stringify(question.sourceReport) === JSON.stringify(source)) ? source : null;
  };
  const recordReport = (question, sourceReport) => {
    if (sourceReport && !question.sourceReport) store.updateQuestion(question.workId, question.id, (saved) => {
      saved.sourceReport = sourceReport;
    });
  };
  const updateAnswer = (workId, id2, answerId, patch) => store.updateQuestion(workId, id2, (q) => {
    const a = q.answers.find((a2) => a2.id === answerId);
    if (!a) throw Error("Answer missing.");
    if (patch.state === "blocked" && a.state !== "queued") return;
    Object.assign(a, patch);
  });
  async function evidence(workId) {
    const { instance: owner, hostGeneration } = await works.verifyWork(workId, true), work = store.readCurrentWork(workId), protocol = store.readDispatchProtocol(workId);
    if (!protocol || work.run.consumerGeneration !== protocol.generation) throw Error("Saved supervisor generation is stale.");
    const native = await readNativeQuestionEvidence(userData, { work, protocol, owner, attempts: store.listDispatches(workId), nativeHistory: store.readNativeHistory(workId) });
    if (native.state !== "verified") throw Error(native.detail);
    return { work, owner, native, hostGeneration };
  }
  async function relayResolved(question, seen = /* @__PURE__ */ new Set()) {
    if (!question.relay) return true;
    const key = question.relay.workId + ":" + question.relay.appQuestionId;
    if (seen.has(key)) return false;
    seen.add(key);
    const child = store.readWork(question.relay.workId), saved = store.listQuestions(child?.id).find((q) => q.id === question.relay.appQuestionId);
    if (!child?.parent || child.parent.workId !== question.workId || !saved?.origin) return false;
    try {
      const current = await evidence(child.id), thread = current.native.threads.find((t) => t.messageId === saved.origin.messageId);
      return Boolean(thread?.answer) && await relayResolved(saved, seen);
    } catch {
      return false;
    }
  }
  async function deliver(workId, id2, answerId) {
    let question = store.listQuestions(workId).find((q) => q.id === id2), a = question.answers.find((a2) => a2.id === answerId);
    if (a.state !== "queued") return;
    let sending = false;
    try {
      await consent();
      const { work, owner, native, hostGeneration } = await evidence(workId);
      if ((question.epoch ?? 0) !== (work.epoch ?? 0) || question.generation !== work.run.consumerGeneration || question.runId !== work.run.id) throw Error("Answer target is stale. Preserve it and request a new supervisor decision.");
      const sourceReport = reportFor(question, native), reportReference = questionOriginKind(question.origin) === "report" || Boolean(question.sourceReport);
      if (reportReference && !sourceReport) throw Error("Completion report or question authority is unverified; this answer was not sent.");
      if (question.origin && !matchingIntent(question, native)) throw Error("Original question proof changed; this answer was not sent.");
      recordReport(question, sourceReport);
      const nativeOrigin = sourceReport ? void 0 : question.origin;
      const supersedesBlockedAnswers = sourceReport && a.supplement === true ? question.answers.slice(0, question.answers.indexOf(a)).filter(isUnsentBlockedAnswer).map((row) => row.id) : [];
      if (nativeOrigin) {
        const thread = native.threads.find((t) => t.messageId === question.origin.messageId);
        if (!thread || thread.status !== "pending") throw Error("Original native question is closed, answered or unverified; this answer cannot resume it.");
      }
      const text8 = "TEAM_USER_ANSWER\n" + JSON.stringify({ protocol: "team-questions/v1", workId, appQuestionId: id2, questionRevision: a.revision, answerId: a.id, body: a.body, origin: nativeOrigin, ...sourceReport ? { sourceReport } : {}, ...supersedesBlockedAnswers.length ? { supersedesBlockedAnswers } : {}, relay: question.relay, instruction: "This is a saved user answer. Process it once using answerId. " + (sourceReport ? "This is the highest Head decision based on the verified sourceReport completion. Do not call orchestration.reply or resume a native requester for this completion report. If supersedesBlockedAnswers is present, this explicit supplement replaces only those earlier unsent blocked answer IDs; do not acknowledge those old IDs. " : nativeOrigin ? "Reply to the original native question ONLY as its actual owning Run manager (orca orchestration reply --id MESSAGE --body ANSWER --run OWNING_RUN --json). For a lower manager, send the decision to that real manager; do not impersonate them. Preserve the origin chain. " : "This is the Head decision; no native requester reply is required. ") + "Then publish a Head-authored team-questions/v1 Task kind=answer-ack with appQuestionId, answerId, token and generation. Only when the user authorizes another execution after two failures, include nextNativeTaskId of that specific permitted next Task; a decision to accept expected negative QA does not authorize or require a new Task. An input receipt is not an acknowledgement." });
      const nativeSend = userMessage(work, owner, text8);
      if (!store.claimQuestionAnswer(workId, id2, answerId, nativeSend, supersedesBlockedAnswers)) return;
      sending = true;
      await works.verifyHost(workId, hostGeneration);
      const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
      if (!accepted(receipt, nativeSend, owner)) throw Error("Native input receipt is unconfirmed.");
      updateAnswer(workId, id2, answerId, { state: "accepted", dispatchState: receipt.value?.submission?.dispatchState ?? "input_accepted", detail: sourceReport ? "Native input accepted by the Head; processing awaits its authenticated answer acknowledgement. No native requester reply is needed." : "Native input accepted; manager processing and native reply remain unconfirmed." });
    } catch (error) {
      updateAnswer(workId, id2, answerId, { state: sending ? "unknown" : "blocked", detail: sending ? "Answer delivery is unknown; it will not be automatically sent again." : String(error.message).slice(0, 1200) });
    }
  }
  async function check(workId) {
    const work = store.readCurrentWork(workId), protocol = store.readDispatchProtocol(workId);
    if (work?.status === "completed" || !protocol || work?.run.state !== "verified") return;
    let native;
    try {
      ({ native } = await evidence(workId));
    } catch {
      return;
    }
    const notice = (id2, kind, body) => sendSessionNotice({ store, works, rpc, consent, userMessage, accepted, workId, id: id2, kind, body });
    if (!work.parent) await notice(`session-guide-v2-${work.epoch ?? 0}-${protocol.generation}`, "TEAM_SESSION_DECISIONS", { instructions: sessionDecisionInstructions(work), questionMethod: sessionQuestionMethod(work), workId, runId: work.run.id, token: protocol.token, generation: protocol.generation });
    for (const streak of store.failureStreaks(workId).filter((s) => s.escalationNeeded)) {
      const evidenceIds = streak.evidence.slice(-2).map((e) => e.evidenceId);
      if (store.listQuestions(workId).some((q) => q.evidence?.length && evidenceIds.every((id3) => q.evidence.includes(id3)))) continue;
      const id2 = "failure-" + createHash9("sha256").update(JSON.stringify([streak.taskKey, evidenceIds])).digest("hex");
      const event = store.ensureQuestionEvent(workId, id2, "failure-summary", { taskKey: streak.taskKey, evidence: streak.evidence.slice(-2) });
      if (event.state === "sending") {
        store.updateQuestionEvent(workId, id2, { state: "unknown" });
        continue;
      }
      if (event.state !== "queued") continue;
      try {
        await consent();
        const current = await evidence(workId);
        const text8 = "TEAM_FAILURE_SUMMARY_NEEDED\n" + JSON.stringify({ workId, taskKey: streak.taskKey, evidence: event.data.evidence, instruction: "Two consecutive proven execution attempts failed. This task is blocked; independent tasks may continue. If you are highest supervisor publish a native team-questions/v1 user-question Task; otherwise publish relay-question and ask your real parent manager to escalate it, preserving relay {workId,appQuestionId}. Include a Task with your causes, options, the exact two evidence IDs, and this blockingTaskKeys entry. Do not invent success or silently retry. The user decision must identify the intended next step." });
        const nativeSend = userMessage(current.work, current.owner, text8);
        if (!store.claimQuestionEvent(workId, id2, "sending", nativeSend)) continue;
        await works.verifyHost(workId, current.hostGeneration);
        const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
        store.updateQuestionEvent(workId, id2, { state: accepted(receipt, nativeSend, current.owner) ? "accepted" : "unknown" });
      } catch {
        store.updateQuestionEvent(workId, id2, { state: "unknown" });
      }
    }
    for (const intent of native.intents) if (["user-question", "relay-question"].includes(intent.spec.kind)) try {
      if ((intent.spec.kind === "relay-question" || intent.spec.relay) && (!intent.spec.origin || !native.threads.some((t) => t.messageId === intent.spec.origin.messageId))) continue;
      const question = store.ingestQuestion(workId, intent);
      recordReport(question, reportFor(question, native));
    } catch {
    }
    for (const intent of native.intents) if (intent.spec.kind === "collaboration-directive") try {
      store.ingestCollaboration(workId, intent);
    } catch {
    }
    for (const message of native.messages || []) try {
      store.ingestTeamMessage(workId, message);
    } catch {
    }
    for (const intent of native.intents.filter((i) => ["session-answer", "session-resolution"].includes(i.spec.kind))) {
      const s = intent.spec;
      if (store.readQuestionEvent(workId, "result-" + sessionDecisionKey(intent))?.data.status === "rejected") continue;
      try {
        if (s.kind === "session-resolution") store.resolveSessionQuestion(workId, intent);
        else {
          const q = store.listQuestions(workId).find((q2) => q2.id === s.questionId);
          if (!q) throw Error("The saved question is unavailable.");
          if ((questionOriginKind(q.origin) === "report" || q.sourceReport) && !reportFor(q, native)) throw Error("Original completion report evidence is unverified.");
          const answer = store.recordSessionAnswer(workId, intent), thread = q.origin && native.threads.find((t) => t.messageId === q.origin.messageId);
          if ((!q.origin || q.sourceReport || thread?.answer?.body === answer.body) && await relayResolved(q)) store.updateQuestion(workId, q.id, (saved) => {
            const a = saved.answers.find((a2) => a2.id === answer.id);
            a.processed = "confirmed";
            if (thread?.answer) a.nativeAnswer = thread.answer;
            if (saved.answers.at(-1).id === a.id) saved.status = "answered";
          });
        }
        await notice("result-" + sessionDecisionKey(intent), "TEAM_SESSION_DECISION_RESULT", { decisionId: s.appQuestionId, kind: s.kind, status: "recorded", questionId: s.questionId, detail: s.kind === "session-answer" ? "Answer recorded in this conversation. Any native worker question still requires its owning manager reply; no panel confirmation is needed." : "Superseded question resolved." });
      } catch (error) {
        await notice("result-" + sessionDecisionKey(intent), "TEAM_SESSION_DECISION_RESULT", { decisionId: s.appQuestionId, kind: s.kind, status: "rejected", detail: error.message, proof: intent });
      }
    }
    for (const intent of native.intents) if (intent.spec.kind === "answer-ack") {
      const s = intent.spec, q = store.listQuestions(workId).find((q2) => q2.id === s.appQuestionId), a = q?.answers.find((a2) => a2.id === s.answerId);
      if (!a || !["accepted", "unknown", "sending"].includes(a.state) || !await relayResolved(q)) continue;
      const current = store.readCurrentWork(workId);
      if ((q.epoch ?? 0) !== (current.epoch ?? 0) || q.generation !== current.run.consumerGeneration || q.runId !== current.run.id) continue;
      if ((questionOriginKind(q.origin) === "report" || q.sourceReport) && !reportFor(q, native)) continue;
      store.updateQuestion(workId, q.id, (saved) => {
        const answer = saved.answers.find((a2) => a2.id === s.answerId);
        answer.processed = "confirmed";
        answer.acknowledgement = { nativeTaskId: intent.nativeTaskId, payloadHash: intent.payloadHash };
        if (typeof s.nextNativeTaskId === "string") answer.nextNativeTaskId = s.nextNativeTaskId;
        if (saved.answers.at(-1).id === answer.id) saved.status = "answered";
      });
    }
    for (const q of store.listQuestions(workId)) {
      const thread = q.origin && native.threads.find((t) => t.messageId === q.origin.messageId);
      const relayReady = await relayResolved(q);
      if (thread) store.updateQuestion(workId, q.id, (saved) => {
        saved.nativeQuestion = { ...thread, requesterResumed: "unconfirmed" };
        if (thread.status === "closed") {
          saved.status = "closed";
          for (const a of saved.answers) if (a.state === "queued") Object.assign(a, { state: "blocked", detail: "The original Dispatch question closed. A new decision is required." });
        }
        if (thread.answer && relayReady) {
          if (saved.to === "manager") saved.status = "answered";
          for (const a of saved.answers) if (["accepted", "unknown", "sending"].includes(a.state) && a.body === thread.answer.body) {
            a.nativeAnswer = thread.answer;
            a.processed = "confirmed";
            if (saved.answers.at(-1).id === a.id) saved.status = "answered";
          }
        }
      });
      for (const a of q.answers) {
        if (a.state === "sending") updateAnswer(workId, q.id, a.id, { state: "unknown", detail: "Worker restarted during answer submission; no automatic resend." });
        else if (a.state === "queued") await deliver(workId, q.id, a.id);
      }
      if (q.to === "user" && (q.status === "pending" || (q.epoch ?? 0) < (work.epoch ?? 0) && !q.resolution)) await notice(`session-question-${q.id}-${work.epoch ?? 0}`, "TEAM_SESSION_QUESTION", { questionId: q.id, questionRevision: q.revision, summary: q.summary, options: q.options, blockingTaskKeys: q.blockingTaskKeys, origin: q.origin, relay: q.relay, sourceReport: q.sourceReport, previousAnswers: q.answers.map((a) => ({ id: a.id, body: a.body, state: a.state, processed: a.processed })), ...(q.epoch ?? 0) < (work.epoch ?? 0) ? { superseded: true, recoveryRequestId: work.recoveryRequestId } : {}, instruction: "Discuss this with the user here, in the highest supervisor conversation. Record their explicit answer using session-answer, or session-resolution for a superseded question. Do not ask for a second confirmation in the panel." });
      if (q.to === "user" && q.notification.state === "queued") {
        if (!store.claimQuestionNotification(workId, q.id)) continue;
        let state = "unavailable";
        try {
          if (notify) state = (await notify({ title: "Team decision needs your attention", body: q.summary.slice(0, 1e3) }))?.delivered === true ? "delivered" : "unconfirmed";
        } catch {
        }
        store.updateQuestion(workId, q.id, (saved) => {
          saved.notification = { state };
        });
      }
    }
  }
  async function nativeWait(workId, attempt, shown) {
    const wait = shown?.observation?.agentWait;
    if (shown?.observation?.exactWorker !== true || shown.observation.status !== "live" || shown.dispatch?.id !== attempt.dispatchId || shown.dispatch.assigneeHandle !== attempt.binding?.handle || !wait || !["agent-approval-prompt", "agent-trust-workspace", "agent-hooks-review-prompt", "agent-interactive-prompt", "codex-trust-workspace", "codex-hooks-review-prompt", "codex-interactive-prompt"].includes(wait.reason)) return;
    return notifyQuestionEvent(store, notify, { workId, id: `wait-${attempt.id}-${wait.reason}`, kind: "native-fault", title: "Team member needs native input", body: `${attempt.memberName}: ${wait.reason}. Open its original Orca/provider session to handle login or permission. Execution outcome remains unconfirmed.` });
  }
  return { nativeWait, check: (id2) => serial(id2, () => check(id2)), answer: (input) => serial(input.workId, async () => {
    store.queueQuestionAnswer(input);
    await deliver(input.workId, input.questionId, input.answerId);
    return store.readSnapshot();
  }), async reconcile() {
    for (const w of store.listCurrentWorks().flatMap((w2) => store.listRunWorks(w2.id).reverse())) if (w.status !== "completed") await this.check(w.id);
  } };
}

// src/local/staffing.mjs
function createStaffingService({ store, rpc, userData, works, consent, notify }) {
  const current = (id2) => store.readCurrentWork?.(id2) ?? store.readWork(id2);
  const serialize = createKeyedSerializer();
  const serial = (id2, fn) => serialize(id2, () => withNativeRuntime(rpc, controlRuntime(current(id2)), fn));
  async function check(id2) {
    const root = current(id2);
    if (!root || root.status === "completed") return;
    const notice = (noticeId, kind, body) => sendSessionNotice({ store, works, rpc, consent, userMessage, accepted, workId: root.id, id: noticeId, kind, body });
    for (const work of store.listRunWorks?.(id2) ?? [root]) {
      try {
        await consent();
        const verified = await works.verifyWork(work.id, true), protocol = store.readDispatchProtocol(work.id);
        if (!protocol) continue;
        const native = await readNativeQuestionEvidence(userData, { work: current(work.id), protocol, owner: verified.instance, attempts: store.listDispatches(work.id) });
        if (native.state !== "verified") continue;
        for (const intent of native.intents) if (intent.spec.kind === "staffing-proposal") try {
          store.ingestStaffingProposal(work.id, intent);
        } catch {
        }
        for (const intent of native.intents) if (intent.spec.kind === "roster-ack") try {
          store.acknowledgeRosterDelta(work.id, intent);
        } catch {
        }
      } catch {
      }
    }
    if (!root.parent) {
      const protocol = store.readDispatchProtocol(root.id);
      if (protocol && root.run.state === "verified") {
        const verified = await works.verifyWork(root.id, true);
        const native = await readNativeQuestionEvidence(userData, { work: current(root.id), protocol, owner: verified.instance, attempts: store.listDispatches(root.id), nativeHistory: store.readNativeHistory(root.id) });
        for (const intent of (native.intents ?? []).filter((i) => i.spec.kind === "staffing-decision")) {
          if (store.readQuestionEvent(root.id, "result-" + sessionDecisionKey(intent))?.data.status === "rejected") continue;
          try {
            const proposal = store.listStaffingProposals(root.id).find((p) => p.id === intent.spec.proposalId);
            if (proposal?.status === "pending") {
              const context = current(proposal.contextId), author = await works.verifyWork(context.id, true), proof = await readNativeQuestionEvidence(userData, { work: context, protocol: store.readDispatchProtocol(context.id), owner: author.instance, attempts: store.listDispatches(context.id), nativeHistory: store.readNativeHistory(context.id) });
              if (proof.state !== "verified" || !proof.intents.some((i) => i.nativeTaskId === proposal.proof.nativeTaskId && i.payloadHash === proposal.proof.payloadHash && JSON.stringify(i.spec) === JSON.stringify(proposal.proof.spec))) throw Error("The original staffing proposal evidence changed; request a fresh proposal.");
            }
            if (intent.spec.decision === "approve" && proposal?.status === "pending") {
              const caps = await discoverCapabilities(rpc, root.scope), issue = preferenceIssue(proposal.member, caps, { requireCore: true });
              if (issue) throw Error(issue);
            }
            await consent();
            await works.verifyHost(root.id, verified.hostGeneration);
            const latest = await works.verifyWork(root.id, true), fresh = await readNativeQuestionEvidence(userData, { work: current(root.id), protocol: store.readDispatchProtocol(root.id), owner: latest.instance, attempts: store.listDispatches(root.id), nativeHistory: store.readNativeHistory(root.id) });
            if (fresh.state !== "verified" || !fresh.intents.some((i) => i.nativeTaskId === intent.nativeTaskId && i.payloadHash === intent.payloadHash)) throw Error("Supervisor decision changed before staffing was saved.");
            const result = store.saveSessionStaffing(root.id, intent);
            await notice("result-" + sessionDecisionKey(intent), "TEAM_SESSION_DECISION_RESULT", { decisionId: intent.spec.appQuestionId, kind: "staffing-decision", status: result.decision, ...result, instruction: "Use the forthcoming roster delta and normal direct-parent task admission. No panel approval is needed." });
          } catch (error) {
            await notice("result-" + sessionDecisionKey(intent), "TEAM_SESSION_DECISION_RESULT", { decisionId: intent.spec.appQuestionId, kind: "staffing-decision", status: "rejected", detail: error.message, proof: intent });
          }
        }
      }
    }
    for (const proposal of store.listStaffingProposals(id2)) if (proposal.status === "pending") await notice(`session-staffing-${proposal.id}-${root.epoch ?? 0}`, "TEAM_STAFFING_PROPOSAL", { proposalId: proposal.id, proposalNativeTaskId: proposal.proof.nativeTaskId, configVersion: proposal.configVersion, proposingManagerId: proposal.proposingManagerId, member: proposal.member, rationale: proposal.rationale, affectedTaskKeys: proposal.affectedTaskKeys, instruction: "Explain this exact proposal to the user in your own conversation, wait for their explicit answer, then record staffing-decision. Lower-manager proposals require this same highest-supervisor process." });
    for (const proposal of store.listStaffingProposals(id2)) if (proposal.status === "pending") await notifyQuestionEvent(store, notify, { workId: proposal.workId, id: "staffing-" + proposal.id, kind: "decision", title: "Staffing request in supervisor session", body: proposal.rationale });
    for (const delta of store.listRosterDeltas(id2)) {
      if (delta.state === "sending") {
        store.updateRosterDelta(delta.id, { state: "unknown", detail: "Delivery interrupted; preserve its native request identity. No automatic resend." });
        continue;
      }
      if (delta.state !== "queued") continue;
      try {
        const contexts = store.listRunWorks?.(id2) ?? [current(id2)], target = contexts.findLast((w) => w.supervisorMemberId === delta.supervisorMemberId && (!w.parent || store.listDispatches(w.parent.workId).find((a) => a.id === w.parent.attemptId)?.status === "running"));
        if (!target) continue;
        await consent();
        const verified = await works.verifyWork(target.id, true), work = current(target.id), protocol = store.readDispatchProtocol(work.id);
        if (!protocol || protocol.generation !== work.run.consumerGeneration) continue;
        const team = store.readTeamVersion(work.teamId, delta.configVersion), children = team.members.filter((m) => m.boss === delta.supervisorMemberId).map((m) => ({ memberId: m.id, name: m.name, agent: m.agent, model: m.model, effort: m.effort, roleVersion: m.roleVersion, role: { brief: m.brief, habits: m.habits, collaboration: m.collaboration } }));
        const text8 = "TEAM_ROSTER_DELTA\n" + JSON.stringify({ protocol: "team-questions/v1", kind: "roster-delta", workId: work.id, teamWorkId: delta.workId, deltaId: delta.id, configVersion: delta.configVersion, supervisorMemberId: delta.supervisorMemberId, memberIds: delta.memberIds, children, token: protocol.token, generation: protocol.generation, instruction: "The user saved this configuration. Use registered direct children and this configVersion for future task-create admission. Prior Tasks retain their versions. Do not create sessions or bypass dependencies, write scopes, host checks or TEAM_DISPATCH_PERMIT. Confirm incorporation with native task-create --spec JSON --run your actual Run --json, protocol team-questions/v1, kind roster-ack, workId, token, generation, appQuestionId, deltaId and configVersion. Native input acceptance alone is not your acknowledgement." });
        const nativeSend = userMessage(work, verified.instance, text8, verified.status);
        if (!store.claimRosterDelta(delta.id, { nativeSend, contextId: work.id, runId: work.run.id, generation: work.run.consumerGeneration, supervisorMemberId: work.supervisorMemberId })) continue;
        await works.verifyHost(work.id, verified.hostGeneration);
        await consent();
        const latest = current(work.id);
        if (latest.run.id !== work.run.id || latest.run.consumerGeneration !== work.run.consumerGeneration || latest.status === "completed") throw Error("Roster supervisor changed before delivery.");
        const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
        store.updateRosterDelta(delta.id, { state: accepted(receipt, nativeSend, verified.instance) ? "accepted" : "unknown" });
      } catch (error) {
        const row = store.listRosterDeltas(id2).find((r) => r.id === delta.id);
        if (row?.state === "sending") store.updateRosterDelta(delta.id, { state: "unknown", detail: String(error.message).slice(0, 1200) });
      }
    }
  }
  return { check: (id2) => serial(id2, () => check(id2)), async reconcile() {
    for (const work of store.listWorks()) if (work.status !== "completed") await this.check(work.id);
  } };
}

// src/local/hierarchy.mjs
function createHierarchyService({ store, userData, works }) {
  const serialize = createKeyedSerializer();
  async function check(id2) {
    const root = (store.readCurrentWork ?? store.readWork)(id2);
    if (!root || root.status === "completed") return;
    const team = store.effectiveTeamForWork?.(root.id) ?? store.readTeamVersion(root.teamId, root.configVersion);
    for (const parentWork of store.listRunWorks(root.teamWorkId ?? id2)) {
      if (parentWork.run.state !== "verified") continue;
      for (const attempt of store.listDispatches(parentWork.id)) {
        if (attempt.status !== "running" || !team.members.some((m) => m.boss === attempt.memberId)) continue;
        try {
          await works.verifyWork(parentWork.id);
          const proof = await readNativeParentEvidence(userData, { parentWork: (store.readCurrentWork ?? store.readWork)(parentWork.id), attempt });
          if (proof.state !== "verified") continue;
          const binding = store.prepareManagerRun(parentWork.id, attempt.id);
          if (binding.input.state === "not_sent") await works.startManager(binding.id);
          else await works.check(binding.id);
        } catch {
        }
      }
    }
  }
  return { check: (id2) => serialize(id2, () => check(id2)), async reconcile() {
    for (const w of store.listWorks()) await this.check(w.id);
  } };
}

// src/local/stop-store.mjs
import { randomUUID as randomUUID5, createHash as createHash10 } from "node:crypto";
var canonical3 = (v) => Array.isArray(v) ? v.map(canonical3) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== void 0).map((k) => [k, canonical3(v[k])])) : v;
var sameStopIdentity = (a, b) => JSON.stringify(canonical3(a)) === JSON.stringify(canonical3(b));
function stopStore({ db, readPrivate, putPrivate, atomic }) {
  const listStops = () => db.prepare("SELECT json FROM receipts WHERE id LIKE 'stop:%' ORDER BY rowid").all().map((row) => JSON.parse(row.json));
  const readStop = (id2) => readPrivate(`stop:${id2}`);
  const recoveryInput = (input) => {
    if (!input || Object.keys(input).some((k) => !["requestId", "stopRequestId", "version"].includes(k)) || typeof input.requestId !== "string" || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || typeof input.stopRequestId !== "string" || !Number.isSafeInteger(input.version) || input.version < 1) throw Error("Choose a saved unknown stop and its current version.");
    return createHash10("sha256").update(JSON.stringify(canonical3(input))).digest("hex");
  };
  const readStopRecovery = (input) => {
    const fingerprint2 = recoveryInput(input), prior = readPrivate(`stop-recovery:${input.requestId}`);
    if (prior && prior.fingerprint !== fingerprint2) throw Error("Stop recovery identity conflicts with another input.");
    return prior;
  };
  return {
    listStops,
    readStop,
    readStopRecovery,
    claimStopRecovery(input, plan) {
      return atomic(() => {
        if (readStopRecovery(input)) return false;
        const row = readStop(input.stopRequestId);
        if (!row || row.version !== input.version || row.state !== "unknown" || row.plan?.method !== "orchestration.workerStop") throw Error("Stop recovery was superseded or is unavailable.");
        const { exitedProof, ...effectPlan } = plan;
        if (!sameStopIdentity(effectPlan, row.plan)) throw Error("Stop recovery must preserve the original native request and execution plan.");
        const now = (/* @__PURE__ */ new Date()).toISOString();
        putPrivate(`stop-recovery:${input.requestId}`, { requestId: input.requestId, stopRequestId: row.requestId, fingerprint: recoveryInput(input), previous: row, createdAt: now });
        putPrivate(`stop:${row.requestId}`, { ...row, state: exitedProof ? "stopped" : "submitted", ...exitedProof ? { proof: exitedProof, confirmedAt: now } : {}, recoveryRequestId: input.requestId, version: row.version + 1, detail: exitedProof ? "Exact native worker observation confirms the original execution already exited." : "Explicit recovery of the same native stop request submitted; exit remains unconfirmed." });
        return true;
      });
    },
    prepareStop(input, target) {
      return atomic(() => {
        if (typeof input.requestId !== "string" || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId)) throw Error("A stable stop request identity is required.");
        const fingerprint2 = createHash10("sha256").update(JSON.stringify(canonical3(input))).digest("hex"), prior = readStop(input.requestId);
        if (prior) {
          if (prior.fingerprint !== fingerprint2) throw Error("Stop identity conflicts with another input.");
          return prior;
        }
        const duplicate = listStops().findLast((row2) => sameStopIdentity(row2.target, target));
        if (duplicate) return duplicate;
        const row = { requestId: input.requestId, nativeRequestId: randomUUID5(), fingerprint: fingerprint2, target, state: "intent", version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        putPrivate(`stop:${row.requestId}`, row);
        return row;
      });
    },
    settleStop(id2, version, patch) {
      return atomic(() => {
        const row = readStop(id2);
        if (!row || row.version !== version) throw Error("Stop observation was superseded.");
        const next = { ...row, ...patch, version: version + 1 };
        putPrivate(`stop:${id2}`, next);
        return next;
      });
    },
    readStopProof({ memberId, requestId, instanceGeneration, attemptId, binding }) {
      const row = listStops().findLast((row2) => row2.state === "stopped" && row2.target.memberId === memberId && (attemptId ? row2.target.attemptId === attemptId : row2.target.operationRequestId === requestId && row2.target.instanceGeneration === instanceGeneration) && (!binding || sameStopIdentity(row2.target.binding, binding)));
      return row ? { ...row.proof, binding: row.target.binding, requestId: row.target.operationRequestId, instanceGeneration: row.target.instanceGeneration, attemptId: row.target.attemptId, stopRequestId: row.requestId } : null;
    },
    stopProjection: () => listStops().map(({ requestId, target, state, detail: detail2, submittedAt, confirmedAt, version, plan }) => ({ requestId, version, recoverable: state === "unknown" && plan?.method === "orchestration.workerStop", teamId: target.teamId, memberId: target.memberId, workId: target.workId, attemptId: target.attemptId, state, detail: detail2, submittedAt, confirmedAt }))
  };
}

// src/local/wake-evidence.mjs
import { realpath as realpath6 } from "node:fs/promises";
import { join as join7, relative as relative5, isAbsolute as isAbsolute6, sep as sep5 } from "node:path";
async function resumedOwner(userData, operation, oldFence) {
  let db;
  try {
    const root = await realpath6(userData), path = await realpath6(join7(root, "agent-session-journal.db")), rel = relative5(root, path);
    if (rel === ".." || rel.startsWith(`..${sep5}`) || isAbsolute6(rel)) return null;
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(path, { readOnly: true });
    if (db.prepare("PRAGMA user_version").get().user_version !== 4) return null;
    const raw = db.prepare("SELECT record_json FROM agent_session_records WHERE session_id=?").get(operation.sessionId)?.record_json;
    if (typeof raw !== "string" || raw.length > 262144) return null;
    const record = JSON.parse(raw), lease = record.lease;
    if (record.schemaVersion !== 2 || record.sessionId !== operation.sessionId || record.provider !== operation.nativeRequest.agent || record.location?.workspaceId !== operation.scope.workspaceId || record.location.executionHostId !== operation.scope.executionHostId || lease?.sessionId !== operation.sessionId || lease.claimStatus !== "live" || lease.unreconciled || lease.handoffStage || !lease.ownerProcess || !Number.isSafeInteger(lease.ownerProcess.pid) || lease.ownerProcess.pid < 1 || typeof lease.ownerProcess.hostId !== "string" || !lease.ownerProcess.hostId || typeof lease.ownerProcess.spawnToken !== "string" || !lease.ownerProcess.spawnToken || !Number.isSafeInteger(lease.runtimeFence) || lease.runtimeFence <= oldFence) return null;
    return { fence: lease.runtimeFence };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
async function readNativeWorkerExit({ store, rpc, userData, operation: op }) {
  try {
    if (op.kind !== "terminal" || !op.sourceAttemptId || !op.sourceDispatchId || !op.sourceWorkId) return null;
    const work = store.readCurrentWork(op.sourceWorkId), attempt = store.listDispatches(op.sourceWorkId).find((a) => a.id === op.sourceAttemptId), binding = attempt?.binding;
    const current = () => {
      const saved = store.listDispatches(op.sourceWorkId).find((a) => a.id === op.sourceAttemptId);
      return store.readMemberDispatch(op.memberId)?.id === op.sourceAttemptId && saved?.dispatchId === op.sourceDispatchId && saved.runId === attempt.runId && saved.nativeTaskId === attempt.nativeTaskId && sameStopIdentity(saved.binding, binding);
    };
    if (!work || !attempt || !binding || binding.kind !== "terminal" || attempt.memberId !== op.memberId || attempt.teamId !== op.teamId || attempt.workId !== op.sourceWorkId || attempt.runId !== work.run.id || attempt.dispatchId !== op.sourceDispatchId || binding.handle !== op.handle || binding.paneKey !== op.paneKey || binding.incarnationId !== op.observation?.processIncarnation || binding.runtimeId !== op.runtimeId || binding.workspaceId !== op.scope.workspaceId || binding.executionHostId !== op.scope.executionHostId || work.scope.workspaceKey !== op.scope.workspaceKey || work.scope.workspaceId !== op.scope.workspaceId || work.scope.executionHostId !== op.scope.executionHostId || attempt.scope.workspaceId !== op.scope.workspaceId || attempt.scope.executionHostId !== op.scope.executionHostId || !current()) return null;
    if ((await rpc("status.get"))?.runtimeId !== binding.runtimeId) return null;
    const protocol = store.readDispatchProtocol(work.id), team = store.effectiveTeamForWork?.(work.id) ?? store.readTeamVersion(work.teamId, work.configVersion);
    const evidence = () => readNativeDispatchEvidence(userData, { work, protocol, team, owner: work.instance, admitted: [attempt], allowSettledParent: true });
    const match = (native) => {
      const found2 = native.observations?.find((row) => row.id === attempt.id);
      return native.state === "verified" && found2?.state === "verified" && found2.dispatchId === op.sourceDispatchId && sameStopIdentity(found2.binding, binding) && (found2.creatorDispatchId ?? null) === (attempt.creatorDispatchId ?? null) ? found2 : null;
    };
    const found = match(await evidence());
    if (!found) return null;
    const shown = await rpc("orchestration.workerShow", { dispatch: op.sourceDispatchId }), d = shown?.dispatch, w = shown?.worker, h = d?.hostScope;
    const host = op.scope.executionHostId === "local" ? h?.kind === "local" && h.hostId === "local" : h?.kind === "ssh" && `ssh:${encodeURIComponent(h.targetId)}` === op.scope.executionHostId;
    if (shown?.observation?.status !== "exited" || shown.observation.exactWorker !== true || !host || d?.id !== op.sourceDispatchId || d.runId !== attempt.runId || d.taskId !== attempt.nativeTaskId || d.assigneeHandle !== binding.handle || d.assigneePaneKey !== binding.paneKey || d.processIncarnation !== binding.incarnationId || (d.creatorDispatchId ?? null) !== (found.creatorDispatchId ?? null) || w?.dispatchId !== op.sourceDispatchId || w.agentTerminalHandle !== binding.handle || w.worktreeId !== binding.workspaceId || w.runtimeEpoch !== binding.runtimeId) return null;
    if (!match(await evidence()) || !current() || (await rpc("status.get"))?.runtimeId !== binding.runtimeId) return null;
    return { kind: "native-worker-exit", source: "native-worker-show", dispatchId: op.sourceDispatchId, attemptId: attempt.id, runId: attempt.runId, nativeTaskId: attempt.nativeTaskId, binding, observedAt: Date.now() };
  } catch {
    return null;
  }
}

// src/local/idle-replacement.mjs
async function verifyIdleReplacement({ store, rpc, userData, works, operation, retirementRequestId }) {
  const op = operation, root = store.listCurrentWorks().find((w) => w.teamId === op.teamId && w.status !== "completed"), contexts = root ? store.listRunWorks?.(root.id) ?? [root] : [];
  store.assertReplacementIdle(op.memberId);
  for (const context of contexts) {
    if (!works) throw Error("Current native execution evidence is required before idle replacement.");
    const verified = await works.verifyWork(context.id, false, { allowSettledParent: true, retirementRequestId }), team = store.effectiveTeamForWork?.(context.id) ?? store.readTeamVersion(context.teamId, context.configVersion), attempts = store.listDispatches(context.id);
    const evidence = await readNativeDispatchEvidence(userData, { work: context, protocol: store.readDispatchProtocol(context.id), team, owner: verified.instance, admitted: attempts, allowSettledParent: true, nativeHistory: store.readNativeHistory(context.id) });
    if (evidence.state !== "verified" || evidence.unmanaged?.length || evidence.rejected.length || evidence.intents.some((i) => i.spec.memberId === op.memberId || context.supervisorMemberId === op.memberId)) throw Error("Native unadmitted or unknown execution prevents idle replacement.");
    for (const a of attempts.filter((a2) => a2.memberId === op.memberId || a2.supervisorMemberId === op.memberId)) if (!evidence.observations.some((o) => o.id === a.id && o.state === "verified" && o.completion?.evidenceId === a.evidenceId)) throw Error("Accepted execution evidence changed; idle replacement is blocked.");
    const questions = await readNativeQuestionEvidence(userData, { work: context, protocol: store.readDispatchProtocol(context.id), owner: verified.instance, attempts, nativeHistory: store.readNativeHistory(context.id) });
    if (questions.state !== "verified" || questions.rejected.length || questions.threads.some((q) => q.status !== "answered" || !q.answer) || questions.intents.some((i) => ["user-question", "relay-question"].includes(i.spec.kind) && !store.listQuestions(context.id).some((q) => q.id === i.spec.appQuestionId))) throw Error("Native question or decision remains unresolved before idle replacement.");
    await works.verifyHost(context.id, verified.hostGeneration);
  }
  if (op.kind === "structured") {
    const fence = contexts.find((w) => w.supervisorMemberId === op.memberId && w.binding.requestId === op.requestId)?.instance?.fence ?? op.observation?.ownerFence;
    const owner = await resumedOwner(userData, op, 0), history = await rpc("agentSession.history", { sessionId: op.sessionId, direction: "tail", limit: 1 }), p = history?.page;
    if (!Number.isSafeInteger(fence) || owner?.fence !== fence || history?.ok !== true || p?.sessionId !== op.sessionId || p.fence !== fence || p.latestTurn?.turn?.state !== "completed" || typeof p.latestTurn.itemId !== "string" || !p.latestTurn.itemId || p.backgroundTasks !== null || !Array.isArray(p.queuedMessages) || p.queuedMessages.length || !Array.isArray(p.submissions) || p.submissions.some((s) => !["accepted", "rejected"].includes(s.dispatchState)) || (await resumedOwner(userData, op, 0))?.fence !== fence) throw Error("Current native idle turn, empty queue and owner fence are required; unknown execution needs exact stop.");
    return { kind: "confirmed-idle-app-retirement", ownerFence: fence, turnId: p.latestTurn.itemId };
  }
  const shown = (await rpc("terminal.show", { terminal: op.handle }))?.terminal, status = (await rpc("terminal.agentStatus", { terminal: op.handle }))?.agentStatus;
  if (!matchesTerminalObservation(shown, op.observation) || shown?.handle !== op.handle || `${shown.tabId}:${shown.leafId}` !== op.paneKey || shown.worktreeId !== op.scope.workspaceId || shown.executionHostId !== op.scope.executionHostId || shown.connected !== true || shown.writable !== true || status?.handle !== op.handle || status.isRunningAgent !== true || status.status !== "idle") throw Error("Current native idle terminal identity is required; unknown execution needs exact stop.");
  return { kind: "confirmed-idle-app-retirement", incarnationId: shown.incarnationId };
}

// src/local/native-launch.mjs
import { randomBytes as randomBytes3 } from "node:crypto";

// src/launch.mjs
function initialMembers(team, mode = team.configuration?.launchMode ?? "on-demand") {
  if (!["on-demand", "all"].includes(mode)) throw Error("Choose a supported launch mode.");
  return team.members.filter((member) => mode === "all" || !member.boss || team.members.some((child) => child.boss === member.id));
}
function memberLaunch(team, member, workspaceKey) {
  if (!team.id || !/^[a-z0-9-]{1,80}$/i.test(team.id)) throw new Error("Missing launch request identity.");
  const boss = team.members.find((row) => row.id === member.boss);
  const reports = team.members.filter((row) => row.boss === member.id);
  const roster = team.members.map((row) => `${row.id}: ${row.name} (${row.role}, ${row.agent}), boss=${row.boss ?? "user"}`).join("\n");
  return {
    requestId: `${team.id}-${member.id}`,
    teamId: team.id,
    memberId: member.id,
    workspaceKey,
    title: `${team.name}/${member.name}`,
    agent: member.agent,
    ...member.model !== "default" ? { model: member.model } : {},
    ...member.effort !== "default" ? { effort: member.effort } : {},
    brief: `You are ${member.name}, the ${member.role} of @${team.name}. Your session name is ${team.name}/${member.name}.
Team purpose/function: ${team.purpose || "Use the saved project; wait for a total objective."}
Report to: ${boss?.name ?? "the user"}. Direct reports: ${reports.map((row) => row.name).join(", ") || "none"}.
${member.brief}
Work habits: ${member.habits || "None specified"}.
Collaboration rules: ${member.collaboration || "None specified"}.
Role version: ${member.roleVersion ?? 1}; configuration version: ${team.configVersion ?? 1}.
This roster contains exactly ${team.members.length} members. The user is outside the roster; do not create extra members or launch teammates.
Roster:
${roster}
The plugin has saved your role and roster; do not claim to persist or change their authoritative versions. This launch is preparation only, not an assigned objective. Acknowledge your role, report any login or access blockers, and wait for a separate TeamWork goal; do not begin project work yet. Managers will use Orca's version-matched orchestration skill for later supervised work; report access blockers rather than inventing results.`
  };
}

// src/local/native-launch.mjs
var text6 = (value, limit = 2048) => typeof value === "string" && value.length > 0 && value.length <= limit;
function launchInput(input) {
  if (!input || Object.keys(input).some((key) => !["teamId", "memberId", "requestId", "configVersion"].includes(key)) || !text6(input.teamId, 120) || !text6(input.memberId, 120) || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || !Number.isInteger(input.configVersion)) throw Error("Invalid saved supervisor launch request.");
  return input;
}
function nativeLaunchIntent(team, member, scope) {
  const description = memberLaunch(team, member, scope.workspaceKey);
  const sessionOptions = {};
  if (member.model !== "default") sessionOptions.model = member.model;
  if (member.effort !== "default") sessionOptions.effort = member.effort;
  return {
    operationId: `${Date.now()}-${randomBytes3(16).toString("hex")}`,
    agent: member.agent,
    target: { kind: "existing", worktree: scope.workspaceId.startsWith("folder:") ? scope.workspaceId : `id:${scope.workspaceId}` },
    prompt: { text: description.brief, delivery: "submit" },
    ...Object.keys(sessionOptions).length ? { sessionOptions } : {},
    ...member.agentArgs !== void 0 ? { agentArgs: member.agentArgs } : {}
  };
}
function launchReceipt(result, operation) {
  const outcome = result?.outcome, prompt = result?.prompt, mode = result?.receipt;
  if (!text6(result?.worktreeId, 4096) || result.worktreeId !== operation.scope.workspaceId || !["terminal", "structured"].includes(outcome?.kind) || !text6(outcome.handle) || outcome.kind === "structured" && !text6(outcome.sessionId) || outcome.paneKey !== void 0 && !text6(outcome.paneKey) || outcome.tabId !== void 0 && !text6(outcome.tabId) || mode?.mode !== outcome.kind || !["terminal", "structured"].includes(mode.preferred) || !text6(mode.reason) || !text6(mode.detail) || prompt && (!["submit", "draft"].includes(prompt.delivery) || !["journaled", "handed-to-terminal", "not-delivered", "unconfirmed"].includes(prompt.outcome) || prompt.outcome === "journaled" && !text6(prompt.messageId))) throw Error("Native launch identity, scope or receipt is unverified. Inspect Orca before retrying.");
  return {
    status: "created",
    handle: outcome.handle,
    kind: outcome.kind,
    ...outcome.sessionId ? { sessionId: outcome.sessionId } : {},
    ...outcome.paneKey ? { paneKey: outcome.paneKey } : {},
    ...outcome.tabId ? { tabId: outcome.tabId } : {},
    mode: { mode: mode.mode, preferred: mode.preferred, reason: mode.reason, detail: mode.detail },
    prompt: prompt ? { delivery: prompt.delivery, outcome: prompt.outcome, ...prompt.messageId ? { messageId: prompt.messageId } : {} } : null,
    briefAccepted: ["journaled", "handed-to-terminal"].includes(prompt?.outcome),
    observation: { state: "unknown", detail: "Session created; provider start and login are not yet observed." },
    ...text6(result.warning, 1500) ? { warning: result.warning } : {}
  };
}
function publicOperation(operation) {
  if (!operation) return null;
  const keys = ["requestId", "memberId", "teamId", "status", "title", "handle", "kind", "sessionId", "paneKey", "tabId", "mode", "prompt", "briefAccepted", "observation", "warning", "error", "executionHostId", "configVersion", "roleVersion", "instanceGeneration", "recovery"];
  const value = Object.fromEntries(keys.filter((key) => operation[key] !== void 0).map((key) => [key, operation[key]]));
  if (value.observation) {
    const { ptyId, processIncarnation, ...observation } = value.observation;
    value.observation = observation;
  }
  return value;
}

// src/local/wake-store.mjs
import { randomUUID as randomUUID6, createHash as createHash11 } from "node:crypto";
var digest2 = (v) => createHash11("sha256").update(JSON.stringify(v)).digest("hex");
var publicWake = (row) => {
  if (!row) return null;
  const { oldBinding, nativeAction, fingerprint: fingerprint2, managerRequest, ...value } = row;
  return { ...value, ...managerRequest ? { managerRequest: { state: managerRequest.state, reviewer: managerRequest.reviewer } } : {}, oldRequestId: oldBinding.requestId, oldInstanceGeneration: oldBinding.instanceGeneration ?? 1 };
};
function wakeStore({ db, readPrivate, putPrivate, atomic, readOperation, persistOperation, readWork, persistWork, readCurrentWork, replacementTeam, assertReplacementIdle }) {
  function currentPointer(old) {
    const pointer = readPrivate(`binding:${old.memberId}`);
    if (!old.sourceAttemptId) return pointer;
    if (pointer?.requestId !== old.sourceOperationRequestId) return null;
    return { requestId: readPrivate(`dispatch-member:${old.memberId}`)?.id, instanceGeneration: old.instanceGeneration };
  }
  function updateRecipients(old, operation) {
    for (const saved of db.prepare("SELECT json FROM receipts WHERE id LIKE 'work:%'").all()) {
      const work = JSON.parse(saved.json);
      if (work.teamId !== old.teamId || work.status === "completed") continue;
      const rows = work.currentRecipientBindings ?? work.recipientBindings ?? [work.binding], prior = rows.find((r) => r.memberId === old.memberId);
      if (prior && prior.requestId !== old.requestId && prior.requestId !== old.sourceOperationRequestId) continue;
      work.currentRecipientBindings = rows.filter((r) => r.memberId !== old.memberId).concat(operation);
      work.version++;
      persistWork(work);
    }
  }
  const readWake = (id2) => readPrivate(`wake:${id2}`);
  return {
    readWake,
    listWakes: () => db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().map((r) => JSON.parse(r.json)),
    prepareWake(input, operation, proof, nativeAction) {
      return atomic(() => {
        const prior = readWake(input.requestId), fingerprint2 = digest2(input);
        if (prior) {
          if (prior.fingerprint !== fingerprint2) throw Error("Recovery request conflicts with saved input.");
          return { row: prior, fresh: false };
        }
        const current = operation.sourceAttemptId ? readPrivate(`dispatch:${operation.sourceAttemptId}`) : readOperation(operation.requestId), pointer = currentPointer(operation);
        if (current?.version !== operation.version || pointer?.requestId !== operation.requestId || (pointer.instanceGeneration ?? 1) !== (operation.instanceGeneration ?? 1)) throw Error("Member binding changed during recovery.");
        if (readPrivate(`wake-member:${operation.memberId}`)) throw Error("This member already has an unresolved recovery. Check its saved result.");
        const row = { ...input, fingerprint: fingerprint2, oldBinding: operation, proof, nativeAction, state: nativeAction ? "reserved" : "needs_decision", version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        putPrivate(`wake:${input.requestId}`, row);
        putPrivate(`wake-member:${operation.memberId}`, { requestId: input.requestId });
        return { row, fresh: true };
      });
    },
    rebindWake(id2, version, workId, instance, run) {
      return atomic(() => {
        const row = readWake(id2), raw = readWork(workId), work = readCurrentWork(workId), binding = row?.newInstance && readOperation(row.newInstance.requestId);
        if (!row || row.version !== version || !["resumed", "replacing"].includes(row.state) || !binding || binding.status !== "created" || work?.supervisorMemberId !== row.memberId || work.binding.requestId !== row.oldBinding.requestId || work.status === "completed" || run.state !== "verified" || work.run.id && run.id !== work.run.id) throw Error("Recovery does not match this ongoing supervisor epoch.");
        raw.supervisorHistory ??= [];
        raw.supervisorHistory.push({ binding: work.binding, instance: work.instance, run: work.run, recoveryRequestId: id2, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
        for (const saved of db.prepare("SELECT id,json FROM receipts WHERE id LIKE 'dispatch:%'").all()) {
          const attempt = JSON.parse(saved.json);
          if (attempt.workId !== workId || attempt.supervisorMemberId !== row.memberId) continue;
          if (attempt.review && attempt.originalSupervisorInstance) continue;
          attempt.originalSupervisorInstance ??= work.instance;
          if (!attempt.review) attempt.reviewAuthority = { recoveryRequestId: id2, reviewerMemberId: row.memberId, generation: run.consumerGeneration, reviewToken: randomUUID6(), previousGeneration: attempt.generation, handoff: row.handoff ?? { decision: "native-resume", death: row.proof.death } };
          attempt.version++;
          putPrivate(saved.id, attempt);
        }
        raw.currentSupervisor = { binding, instance, run, status: "active", input: { state: "not_sent" }, processing: { state: "unknown" }, nativeSend: void 0, error: void 0, recoveryRequestId: id2, epoch: (work.epoch ?? 0) + 1 };
        raw.version++;
        persistWork(raw);
        for (const saved of db.prepare("SELECT id,json FROM receipts WHERE id LIKE 'delivery:%'").all()) {
          const delivery = JSON.parse(saved.json);
          if (delivery.workId === workId && delivery.status === "pending") {
            delivery.status = "superseded";
            delivery.recoveryRequestId = id2;
            putPrivate(saved.id, delivery);
          }
        }
        const protocol = readPrivate(`dispatch-protocol:${workId}`);
        if (protocol) {
          putPrivate(`dispatch-protocol-history:${workId}:${protocol.token}`, protocol);
          db.prepare("DELETE FROM receipts WHERE id=?").run(`dispatch-protocol:${workId}`);
        }
        row.state = "bound";
        row.newInstance = { ...row.newInstance, workId, runId: run.id, consumerGeneration: run.consumerGeneration };
        row.version++;
        putPrivate(`wake:${id2}`, row);
        db.prepare("DELETE FROM receipts WHERE id=?").run(`wake-member:${row.memberId}`);
        return row;
      });
    },
    finishIdleReplacement(id2) {
      return atomic(() => {
        const row = readWake(id2), op = row?.newInstance && readOperation(row.newInstance.requestId);
        if (row?.mode !== "idle-replacement" || row.state !== "replacing" || op?.status !== "created") return row;
        const pointer = readPrivate(`binding:${row.memberId}`);
        if (pointer?.requestId !== op.requestId) throw Error("Current replacement binding changed.");
        assertReplacementIdle(row.memberId);
        row.state = "bound";
        row.version++;
        putPrivate(`wake:${id2}`, row);
        db.prepare("DELETE FROM receipts WHERE id=?").run(`wake-member:${row.memberId}`);
        return row;
      });
    },
    prepareWakeReplacement(id2, version, intent) {
      return atomic(() => {
        const row = readWake(id2);
        if (!row || row.version !== version || row.state !== "approved" || !row.handoff) throw Error("A checked handoff decision is required.");
        const old = row.oldBinding, pointer = currentPointer(old);
        if (pointer?.requestId !== old.requestId || (pointer.instanceGeneration ?? 1) !== (old.instanceGeneration ?? 1)) throw Error("Member binding changed before replacement.");
        if (row.mode === "idle-replacement") assertReplacementIdle(old.memberId);
        const team = replacementTeam(old.teamId), member = team?.members.find((m) => m.id === old.memberId);
        if (!member || intent.configVersion !== team.configVersion || intent.roleVersion !== member.roleVersion) throw Error("Replacement configuration changed; review the saved handoff again.");
        const operation = { ...intent, requestId: `replace-${id2}`, memberId: old.memberId, teamId: old.teamId, configVersion: intent.configVersion, status: "unknown", effectState: "intent", instanceGeneration: (old.instanceGeneration ?? 1) + 1, version: 1, replaces: old.requestId, wakeRequestId: id2, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        operation.public = publicOperation(operation);
        putPrivate(`binding-generation:${old.memberId}`, { generation: operation.instanceGeneration });
        putPrivate(`binding:${old.memberId}`, { requestId: operation.requestId, instanceGeneration: operation.instanceGeneration });
        persistOperation(operation);
        updateRecipients(old, operation);
        row.state = "replacing";
        row.newInstance = { requestId: operation.requestId, instanceGeneration: operation.instanceGeneration };
        row.version++;
        putPrivate(`wake:${id2}`, row);
        return { operation, fresh: true };
      });
    },
    publishWake(id2, version, instance) {
      return atomic(() => {
        const row = readWake(id2), old = row?.oldBinding, pointer = old && currentPointer(old);
        if (!row || row.version !== version || !["accepted", "unknown"].includes(row.state) || pointer?.requestId !== old.requestId || (pointer.instanceGeneration ?? 1) !== (old.instanceGeneration ?? 1)) throw Error("Recovery member instance changed.");
        const operation = { ...old, requestId: `wake-${id2}`, instanceGeneration: (old.instanceGeneration ?? 1) + 1, version: 1, runtimeId: row.proof.runtimeId, wakeRequestId: id2, resumedFrom: old.requestId, recovery: void 0, observation: { state: "observed", ownerFence: instance.fence, detail: "Native owner acquired a newer execution fence after the exact prior owner stopped." } };
        if (operation.sourceAttemptId) {
          operation.originAttemptId = operation.sourceAttemptId;
          delete operation.sourceAttemptId;
          delete operation.sourceDispatchId;
          delete operation.sourceWorkId;
        }
        operation.public = publicOperation(operation);
        putPrivate(`binding-generation:${old.memberId}`, { generation: operation.instanceGeneration });
        putPrivate(`binding:${old.memberId}`, { requestId: operation.requestId, instanceGeneration: operation.instanceGeneration });
        persistOperation(operation);
        updateRecipients(old, operation);
        row.state = "resumed";
        row.newInstance = { requestId: operation.requestId, instanceGeneration: operation.instanceGeneration, ...instance };
        row.version++;
        putPrivate(`wake:${id2}`, row);
        db.prepare("DELETE FROM receipts WHERE id=?").run(`wake-member:${old.memberId}`);
        return row;
      });
    },
    claimWake(id2) {
      return atomic(() => {
        const row = readWake(id2);
        if (row?.state !== "reserved") return false;
        row.state = "submitted";
        row.version++;
        putPrivate(`wake:${id2}`, row);
        return true;
      });
    },
    updateWake(id2, version, patch) {
      return atomic(() => {
        const row = readWake(id2);
        if (!row || row.version !== version) throw Error("Recovery changed; reload saved evidence.");
        if (Object.keys(patch).some((k) => !["state", "detail", "receipt", "newInstance", "handoff", "decision", "nativeAction", "notification", "managerRequest"].includes(k))) throw Error("Immutable recovery identity cannot change.");
        Object.assign(row, patch, { version: version + 1 });
        putPrivate(`wake:${id2}`, row);
        return row;
      });
    }
  };
}

// src/local/recovery.mjs
import { realpath as realpath8 } from "node:fs/promises";
import { join as join9, relative as relative7, isAbsolute as isAbsolute8, sep as sep7 } from "node:path";

// src/local/native-launch-ledger.mjs
import { createHash as createHash12 } from "node:crypto";
import { realpath as realpath7 } from "node:fs/promises";
import { join as join8, relative as relative6, isAbsolute as isAbsolute7, sep as sep6 } from "node:path";
var LAUNCH_LEDGER_ABSENT = "Original native launch ledger row is absent; no launch was retried.";
var canonical4 = (value) => value === null || typeof value !== "object" ? JSON.stringify(value ?? null) : Array.isArray(value) ? `[${value.map(canonical4).join(",")}]` : `{${Object.entries(value).filter(([, entry]) => entry !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical4(entry)}`).join(",")}}`;
function nativeLaunchFingerprint(input) {
  return createHash12("sha256").update(canonical4(Object.fromEntries([["method", "agent.launch"], ...["agent", "target", "prompt", "sessionOptions", "reuseTerminal", "agentArgs", "cwd", "paneKey", "sessionId"].map((key) => [key, input[key]])]))).digest("hex");
}
async function readNativeLaunchLedger(userData, request) {
  let db;
  try {
    if (!isAbsolute7(userData || "")) throw Error();
    const profile = await realpath7(userData), file = await realpath7(join8(profile, "agent-session-journal.db"));
    const rel = relative6(profile, file);
    if (rel === ".." || rel.startsWith(`..${sep6}`) || isAbsolute7(rel)) throw Error();
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(file, { readOnly: true });
    if (db.prepare("PRAGMA user_version").get().user_version !== 4) throw Error();
    const callerKey = "trusted-local:desktop";
    const stored = db.prepare("SELECT row_json FROM agent_session_operations WHERE operation_key=?").get(`${callerKey}\0${request.operationId}`);
    if (!stored) return { state: "unknown", detail: LAUNCH_LEDGER_ABSENT };
    if (typeof stored.row_json !== "string" || stored.row_json.length > 262144) throw Error();
    const row = JSON.parse(stored.row_json), now = Date.now();
    if (row.callerKey !== callerKey || row.operationId !== request.operationId || row.fingerprint !== nativeLaunchFingerprint(request) || row.operationTimestamp !== Number(request.operationId.split("-")[0]) || !Number.isSafeInteger(row.recordedAt) || !Number.isSafeInteger(row.expiresAt) || row.recordedAt > now + 3e5 || row.expiresAt <= now || row.expiresAt <= row.recordedAt) throw Error();
    if (row.outcome?.status === "succeeded" && row.outcome.launch) return { state: "succeeded", result: row.outcome.launch };
    if (row.outcome?.status === "failed" && typeof row.outcome.code === "string") return { state: "failed", detail: `Native launch failed: ${row.outcome.code.slice(0, 200)}. The member remains reserved for explicit recovery.` };
    return { state: "unknown", detail: "Native launch remains pending or unknown; checking its ledger never starts another session." };
  } catch {
    return { state: "unknown", detail: "Original native launch ledger is unavailable, expired or incompatible; no launch was retried." };
  } finally {
    db?.close();
  }
}

// src/local/recovery.mjs
var stamp = () => (/* @__PURE__ */ new Date()).toISOString();
var detail = (error) => String(error?.message ?? error).slice(0, 1200);
async function readSessionDeath(userData, sessionId, ownerFence, scope) {
  let db;
  try {
    if (!Number.isSafeInteger(ownerFence) || ownerFence < 1 || !isAbsolute8(userData || "")) return null;
    const profile = await realpath8(userData), path = await realpath8(join9(profile, "agent-session-journal.db")), rel = relative7(profile, path);
    if (rel === ".." || rel.startsWith(`..${sep7}`) || isAbsolute8(rel)) return null;
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(path, { readOnly: true });
    if (db.prepare("PRAGMA user_version").get().user_version !== 4) return null;
    const raw = db.prepare("SELECT record_json FROM agent_session_records WHERE session_id=?").get(sessionId)?.record_json;
    if (typeof raw !== "string" || raw.length > 262144) return null;
    const record = JSON.parse(raw), lease = record.lease, death = lease?.deathEvidence;
    if (record.schemaVersion !== 2 || record.location?.workspaceId !== scope?.workspaceId || record.location?.executionHostId !== scope?.executionHostId || record.sessionId !== sessionId || lease?.sessionId !== sessionId || (!Number.isSafeInteger(lease.runtimeFence) || lease.runtimeFence < ownerFence) || lease.claimStatus !== "released" || lease.handoffStage || lease.handoffOperationId || lease.ownerProcess || lease.reservedSpawnToken || lease.unreconciled === true || death?.ownerFence !== ownerFence || !["exit-observed", "pid-absent", "identity-mismatch"].includes(death.kind) || !Number.isSafeInteger(death.observedAt) || death.observedAt > Date.now() + 3e5) return null;
    return { kind: death.kind, ownerFence, observedAt: death.observedAt, ...record.provider ? { provider: record.provider } : {} };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
function createRecoveryService({ store, rpc, userData, consent }) {
  const serialize = createKeyedSerializer();
  const serial = serialize;
  async function host(scope) {
    if (!scope.executionHostId.startsWith("ssh:")) return null;
    const state = (await rpc("ssh.getState", { targetId: decodeURIComponent(scope.executionHostId.slice(4)) }))?.state;
    if (state?.status !== "connected" || !Number.isSafeInteger(state.connectionGeneration)) throw Error("Saved SSH host is disconnected or its generation is unknown; remote output is incomplete.");
    return state.connectionGeneration;
  }
  async function checkOperation(requestId) {
    const operation = store.readOperation(requestId);
    if (!operation) return null;
    let patch = {}, recovery = { state: operation.status === "created" ? "confirmed_effect" : "unknown", liveness: "unknown", source: "saved-operation", observedAt: stamp(), detail: "Persisted intent retained. Missing evidence never authorizes a second launch." };
    try {
      await consent();
      if (operation.status === "unknown" && operation.effectState === "intent") {
        recovery = { ...recovery, state: "intent", detail: "Launch intent is durable but has not passed the native submission boundary. Its member remains reserved; checking does not launch it." };
      } else if (operation.status === "unknown") {
        const ledger = await readNativeLaunchLedger(userData, operation.nativeRequest);
        if (ledger.state === "succeeded") {
          patch = { ...launchReceipt(ledger.result, operation), error: void 0 };
          recovery = { ...recovery, state: "confirmed_effect", source: "native-launch-ledger", detail: "Original native launch receipt recovered; current execution is separate." };
        } else {
          recovery.detail = ledger.detail;
          patch.error = ledger.detail;
        }
      }
      const saved = { ...operation, ...patch };
      if (saved.status === "created") {
        recovery.detail = "Native session creation is confirmed; current execution remains unverified.";
        const status = await rpc("status.get");
        let terminalObservation;
        await withNativeRuntime(rpc, status?.runtimeId, async () => {
          const generation = await host(saved.scope);
          if (generation !== null && saved.hostGeneration != null && generation !== saved.hostGeneration) throw Error("Saved SSH connection generation changed; observations remain incomplete.");
          const selected = (await rpc("worktree.show", { worktree: saved.scope.workspaceId.startsWith("folder:") ? saved.scope.workspaceId : `id:${saved.scope.workspaceId}` }))?.worktree;
          if (selected?.id !== saved.scope.workspaceId || (selected.hostId ?? selected.identity?.executionHostId) !== saved.scope.executionHostId) throw Error("Saved member project or execution host changed.");
          if (saved.kind === "structured") {
            const instance = store.listCurrentWorks().find((work) => work.binding.requestId === requestId)?.instance;
            const death = await readSessionDeath(userData, saved.sessionId, instance?.fence ?? saved.observation?.ownerFence, saved.scope);
            if (death) recovery = { ...recovery, state: "stopped", liveness: "stopped", source: "native-owner-death", death, detail: "Native death evidence names the exact saved owner fence. The member reservation remains until an authorized lifecycle action." };
          } else {
            const instance = store.listCurrentWorks().find((work) => work.binding.requestId === requestId)?.instance;
            const expected = instance ?? saved.observation;
            const shown = (await rpc("terminal.show", { terminal: saved.handle }))?.terminal;
            if (!matchesTerminalObservation(shown, expected) || (saved.observation?.incarnationId || saved.observation?.processIncarnation) && !matchesTerminalObservation(shown, saved.observation) || shown.handle !== saved.handle || shown.worktreeId !== saved.scope.workspaceId || shown.executionHostId !== saved.scope.executionHostId || `${shown.tabId}:${shown.leafId}` !== saved.paneKey) throw Error("Exact saved terminal incarnation is unverified. Inspect its native session; absence does not prove stopped.");
            terminalObservation = { ...saved.observation, ...terminalIdentity(shown) };
            if (shown.connected === true) {
              recovery = { ...recovery, liveness: "live", source: "native-terminal", detail: "Exact terminal instance is connected. Provider readiness and task acceptance are separate." };
            }
          }
          if (await host(saved.scope) !== generation) throw Error("SSH generation changed during observation; output is incomplete.");
          const final = await rpc("status.get");
          if (final?.runtimeId !== status.runtimeId) throw Error("Native runtime changed during reconciliation.");
        });
        if (terminalObservation) {
          patch.observation = terminalObservation;
          if (recovery.liveness === "live" && operation.error === LAUNCH_LEDGER_ABSENT) patch.error = void 0;
        }
      }
    } catch (error) {
      recovery = { ...recovery, state: (patch.status ?? operation.status) === "created" ? "confirmed_effect" : "unknown", liveness: "unknown", incomplete: true, detail: detail(error) };
    }
    patch.recovery = recovery;
    patch.public = publicOperation({ ...operation, ...patch });
    try {
      return store.settleOperation(requestId, operation.nativeRequest.operationId, patch, operation.version ?? 1);
    } catch {
      return store.readOperation(requestId);
    }
  }
  async function checkWork(workId) {
    const work = store.readCurrentWork(workId), protocol = store.readDispatchProtocol(workId);
    if (work?.status === "completed" || !work || !protocol || !work.instance || !work.run.id) return store.dispatchProjection(workId);
    const attempts = store.listDispatches(workId), team = store.readTeamVersion(work.teamId, work.configVersion);
    const evidence = () => readNativeDispatchEvidence(userData, { work, protocol, team, owner: work.instance, admitted: attempts });
    const observations = /* @__PURE__ */ new Map();
    try {
      await consent();
      const status = await rpc("status.get");
      await withNativeRuntime(rpc, status?.runtimeId, async () => {
        const generation = await host(work.scope);
        if (generation !== null && work.binding.hostGeneration != null && generation !== work.binding.hostGeneration) throw Error("Saved SSH connection generation changed; observations remain incomplete.");
        const native = await evidence();
        if (native.state !== "verified") throw Error(native.detail);
        const run = (await rpc("orchestration.runShow", { id: work.run.id }))?.run;
        if (run?.id !== work.run.id || run.consumer_generation !== work.run.consumerGeneration || run.objective !== work.nativeObjective) throw Error("Saved Run owner generation changed; current authority is unverified.");
        const tasks = await rpc("orchestration.taskList", { run: work.run.id, brief: true });
        if (!Array.isArray(tasks?.tasks) || tasks.tasks.some((task) => task.run_id !== work.run.id)) throw Error("Native Task evidence is not scoped to the saved Run.");
        for (const attempt of attempts) {
          const found = native.observations.find((row) => row.id === attempt.id);
          let recovery = { state: "unknown", liveness: "unknown", observedAt: stamp(), source: "native-dispatch-ledger", detail: found?.detail ?? "Native execution evidence is unavailable; the member remains reserved." };
          if (!tasks.tasks.some((task) => task.id === attempt.nativeTaskId)) {
            observations.set(attempt.id, { recovery: { ...recovery, detail: "Saved native Task is absent from this Run snapshot. Its execution and reservation remain unresolved." } });
            continue;
          }
          if (found?.state !== "verified") {
            if (found?.state === "absent" && attempt.permit.state === "not_sent") recovery = { ...recovery, state: "intent", detail: "Permit intent has not been sent. Native absence is not proof that an older execution stopped." };
            observations.set(attempt.id, { recovery });
            continue;
          }
          if (attempt.binding && ["kind", "handle", "sessionId", "paneKey", "incarnationId", "runtimeId", "workspaceId", "executionHostId"].some((key) => attempt.binding[key] !== found.binding[key])) throw Error("Saved member execution instance changed; prior binding remains reserved.");
          const hostMatches = (host2) => work.scope.executionHostId === "local" ? host2?.kind === "local" && host2.hostId === "local" : host2?.kind === "ssh" && `ssh:${encodeURIComponent(host2.targetId)}` === work.scope.executionHostId;
          const matches = (shown2) => hostMatches(shown2?.dispatch?.hostScope) && (shown2.dispatch.creatorDispatchId ?? null) === (found.creatorDispatchId ?? null) && shown2?.dispatch?.id === found.dispatchId && shown2.dispatch.runId === work.run.id && shown2.dispatch.taskId === attempt.nativeTaskId && shown2.dispatch.assigneeHandle === found.binding.handle && shown2.dispatch.assigneePaneKey === found.binding.paneKey && shown2.dispatch.processIncarnation === found.binding.incarnationId && shown2.worker?.dispatchId === found.dispatchId && shown2.worker.worktreeId === work.scope.workspaceId && shown2.worker.runtimeEpoch === found.binding.runtimeId;
          let shown = await rpc("orchestration.workerShow", { dispatch: found.dispatchId });
          if (!matches(shown)) throw Error("Native worker identity changed; the saved attempt remains reserved.");
          let output = { incomplete: true, warnings: ["Current output is unavailable."] };
          try {
            const read = await rpc("orchestration.workerRead", { dispatch: found.dispatchId, source: "auto", limit: 40 });
            if (read?.dispatchId !== found.dispatchId) throw Error("Native output belongs to another Dispatch.");
            output = { source: read.source, sourceIdentity: typeof read.sourceIdentity === "string" ? read.sourceIdentity.slice(0, 512) : void 0, archived: read.archived === true, incomplete: read.sourceExact !== true || read.contentComplete !== true || Boolean(read.fallbackReason) || Boolean(read.clipping?.length) || Boolean(read.warnings?.length) || read.transcript?.limited === true, warnings: (Array.isArray(read.warnings) ? read.warnings : []).slice(0, 8).map((value) => String(value).slice(0, 500)), ...read.fallbackReason ? { fallbackReason: String(read.fallbackReason).slice(0, 200) } : {} };
          } catch (error) {
            output.warnings = [detail(error)];
          }
          shown = await rpc("orchestration.workerShow", { dispatch: found.dispatchId });
          if (!matches(shown)) throw Error("Native worker changed during output read.");
          const exact = shown.observation?.exactWorker === true, liveness = exact && ["live", "exited"].includes(shown.observation.status) ? shown.observation.status === "exited" ? "stopped" : "live" : "unknown";
          recovery = { ...recovery, state: liveness === "stopped" ? "stopped" : "confirmed_effect", liveness, incomplete: output.incomplete, output, runtimeId: status.runtimeId, hostGeneration: generation, detail: liveness === "stopped" ? "Exact native worker observation confirms this execution exited. Its reservation is retained for authorized lifecycle handling." : liveness === "live" ? "Exact native worker is live. Provider readiness and direct-supervisor acceptance remain separate." : "Native Dispatch effect is confirmed; current execution is unknown. Missing or changed identity never proves death." };
          observations.set(attempt.id, { recovery, dispatchId: found.dispatchId, binding: found.binding });
        }
        const final = await evidence();
        if (final.state !== "verified") throw Error(final.detail);
        for (const [id2, patch] of observations) if (patch.binding) {
          const latest = final.observations.find((row) => row.id === id2);
          if (latest?.state !== "verified" || latest.dispatchId !== patch.dispatchId || JSON.stringify(latest.binding) !== JSON.stringify(patch.binding)) throw Error("Native Dispatch evidence changed during recovery.");
        }
        if (await host(work.scope) !== generation) throw Error("SSH disconnected or changed generation during read; output is incomplete.");
        if ((await rpc("status.get"))?.runtimeId !== status.runtimeId) throw Error("Native runtime epoch changed during recovery.");
      });
    } catch (error) {
      observations.clear();
      for (const attempt of attempts) observations.set(attempt.id, { recovery: { state: "unknown", liveness: "unknown", source: "reconciliation", observedAt: stamp(), incomplete: true, detail: detail(error) } });
    }
    for (const attempt of attempts) {
      const patch = observations.get(attempt.id);
      if (patch) try {
        store.updateDispatch(attempt.id, attempt.version, patch, work.version);
      } catch {
      }
    }
    return store.dispatchProjection(workId);
  }
  return {
    checkWork: (id2) => serial(`work:${id2}`, () => checkWork(id2)),
    checkOperation: (id2) => serial(`operation:${id2}`, () => checkOperation(id2)),
    async reconcile() {
      for (const operation of store.listOperations()) if (store.isActiveOperation(operation)) await this.checkOperation(operation.requestId);
      for (const work of store.listCurrentWorks()) if (work.status !== "completed") await this.checkWork(work.id);
    }
  };
}

// src/local/wake.mjs
function createWakeService({ store, rpc, userData, consent, works, notify }) {
  const allWorks = () => store.listCurrentWorks().flatMap((w) => store.listRunWorks(w.id));
  const bindingFor = (input) => {
    const op = store.readOperation(input.bindingRequestId);
    if (op) return op;
    const attempt = store.listDispatches().find((a) => a.id === input.bindingRequestId && a.teamId === input.teamId && a.memberId === input.memberId), b = attempt?.binding, team = attempt && store.readTeamVersion(attempt.teamId, attempt.configVersion), member = team?.members.find((m) => m.id === input.memberId);
    if (!b || !member) return null;
    const prepared = store.readMemberOperation(input.memberId);
    if (prepared && (b.kind === "structured" ? (b.liveSessionId ?? b.sessionId) !== prepared.sessionId : b.handle !== prepared.handle || b.incarnationId !== prepared.observation?.processIncarnation)) return null;
    return { ...prepared ? { sourceOperationRequestId: prepared.requestId } : {}, requestId: input.bindingRequestId, sourceAttemptId: attempt.id, sourceDispatchId: attempt.dispatchId, sourceWorkId: attempt.workId, teamId: attempt.teamId, memberId: attempt.memberId, configVersion: attempt.configVersion, roleVersion: attempt.roleVersion, version: attempt.version, instanceGeneration: attempt.instanceGeneration ?? 1, status: "created", kind: b.kind, handle: b.handle, sessionId: b.liveSessionId ?? b.sessionId, paneKey: b.paneKey, scope: attempt.scope, runtimeId: b.runtimeId, executionHostId: b.executionHostId, title: member.name, nativeRequest: { agent: member.agent, sessionOptions: { model: member.model, effort: member.effort } }, observation: { ownerFence: b.sessionFence, ...b.kind === "terminal" ? { processIncarnation: b.incarnationId } : {} }, recovery: attempt.recovery };
  };
  const active = (op) => op.sourceAttemptId ? store.readMemberDispatch?.(op.memberId)?.id === op.sourceAttemptId : store.isActiveOperation(op);
  async function hostGeneration(scope, expected) {
    if (!scope.executionHostId.startsWith("ssh:")) return null;
    const state = (await rpc("ssh.getState", { targetId: decodeURIComponent(scope.executionHostId.slice(4)) }))?.state;
    if (state?.status !== "connected" || !Number.isSafeInteger(state.connectionGeneration) || expected != null && state.connectionGeneration !== expected) throw Error("Saved recovery host disconnected or changed generation.");
    return state.connectionGeneration;
  }
  const memberFor = (row) => store.readSnapshot().teams.find((t) => t.id === row.teamId)?.members.find((m) => m.id === row.memberId);
  async function stopped(row) {
    const op = row.oldBinding;
    if (op.kind === "structured") {
      const stop = store.readStopProof?.({ memberId: op.memberId, requestId: op.sourceAttemptId ? void 0 : op.requestId, instanceGeneration: op.sourceAttemptId ? void 0 : op.instanceGeneration, attemptId: op.sourceAttemptId });
      return readSessionDeath(userData, op.sessionId, row.proof.death?.ownerFence ?? op.observation?.ownerFence ?? stop?.death?.ownerFence, op.scope);
    }
    let observedGeneration;
    let proof = store.readStopProof?.({ memberId: op.memberId, requestId: op.sourceAttemptId ? void 0 : op.requestId, instanceGeneration: op.sourceAttemptId ? void 0 : op.instanceGeneration, attemptId: op.sourceAttemptId });
    if (!proof && op.sourceAttemptId) {
      const generation = observedGeneration = await hostGeneration(op.scope, row.proof.hostGeneration ?? op.hostGeneration);
      proof = await readNativeWorkerExit({ store, rpc, userData, operation: op });
      if (!proof || await hostGeneration(op.scope, generation) !== generation) return null;
    }
    if (!proof || !["native-exact-stop", "native-pty-exit", "native-worker-exit"].includes(proof.kind)) return null;
    try {
      const shown = (await rpc("terminal.show", { terminal: op.handle }))?.terminal;
      if (shown?.connected === true) return null;
    } catch (error) {
      if (!error.native && !/not found|missing|not_found/i.test(error.message)) return null;
    }
    if (proof.source === "native-worker-show" && (await hostGeneration(op.scope, observedGeneration) !== observedGeneration || (await rpc("status.get"))?.runtimeId !== op.runtimeId)) return null;
    return proof;
  }
  async function requestDecision(row) {
    if (row.state !== "needs_decision") return row;
    const member = memberFor(row), root = store.listCurrentWorks().find((w) => w.teamId === row.teamId && w.status !== "completed"), work = (root && store.readOwningWork?.(root.id, row.memberId)) ?? store.readCurrentWork(row.oldBinding.sourceWorkId) ?? root;
    if (!member?.boss) {
      await notifyQuestionEvent(store, notify, { workId: work?.id ?? row.teamId, id: `wake-${row.requestId}`, kind: "decision", title: "Supervisor recovery needs your decision", body: "Native continuation is unavailable. Review the saved handoff before creating a replacement conversation." });
      return row;
    }
    if (!works || !work || work.supervisorMemberId !== member.boss || row.managerRequest) return row;
    try {
      const verified = await works.verifyWork(work.id, true), nativeSend = userMessage(work, verified.instance, "TEAM_MEMBER_RECOVERY_REQUEST\n" + JSON.stringify({ requestId: row.requestId, memberId: row.memberId, oldRequestId: row.oldBinding.requestId, attemptId: row.oldBinding.sourceAttemptId, dispatchId: row.oldBinding.sourceDispatchId, proof: row.proof, reason: row.detail, instruction: "Review the original task, attempt, result and available evidence. If replacement is appropriate publish a genuine team-questions/v1 recovery-handoff Task with appQuestionId=requestId, memberId, oldRequestId, decision=replace, checked summary and evidence[]. Use your own current Run and identity; do not start a replacement yourself." }), verified.status);
      row = store.updateWake(row.requestId, row.version, { managerRequest: { state: "submitted", nativeSend, workId: work.id, reviewer: member.boss } });
      await works.verifyHost(work.id, verified.hostGeneration);
      const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
      row = store.updateWake(row.requestId, row.version, { managerRequest: { ...row.managerRequest, state: accepted(receipt, nativeSend, verified.instance) ? "accepted" : "unknown" } });
    } catch (error) {
      const current = store.readWake(row.requestId);
      if (current.managerRequest?.state === "submitted") row = store.updateWake(row.requestId, current.version, { managerRequest: { ...current.managerRequest, state: "unknown" } });
    }
    return row;
  }
  const verifyIdle = (op, retirementRequestId) => verifyIdleReplacement({ store, rpc, userData, works, operation: op, retirementRequestId });
  return {
    async requestReplacement(input) {
      if (!input || Object.keys(input).some((k) => !["requestId", "teamId", "memberId", "bindingRequestId", "expectedRevision", "agent", "model", "effort", "summary", "evidenceRefs"].includes(k)) || typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 4e3 || !Array.isArray(input.evidenceRefs) || !input.evidenceRefs.length || input.evidenceRefs.length > 100 || input.evidenceRefs.some((v) => typeof v !== "string" || !v || v.length > 1e3)) throw Error("An explicit replacement decision, handoff summary and evidence references are required.");
      const prior = store.readWake(input.requestId);
      if (prior) {
        if (prior.mode !== "idle-replacement" || !store.replay("reserveIdleReplacement", input)) throw Error("Replacement request conflicts with saved input.");
        return publicWake(prior);
      }
      const op = bindingFor(input);
      if (!op || op.teamId !== input.teamId || op.memberId !== input.memberId || op.status !== "created" || !active(op)) throw Error("Choose the current exact member binding.");
      await consent();
      return withNativeRuntime(rpc, op.runtimeId, async () => {
        if ((await rpc("status.get"))?.runtimeId !== op.runtimeId) throw Error("Replacement runtime changed.");
        const generation = await hostGeneration(op.scope, op.hostGeneration), idle = await verifyIdle(op);
        await consent();
        store.reserveIdleReplacement(input, op, { idle, runtimeId: op.runtimeId, hostGeneration: generation });
        return publicWake(store.readWake(input.requestId));
      });
    },
    async validateFresh(id2) {
      const row = store.readWake(id2);
      if (row?.state !== "replacing") throw Error("Replacement reservation changed.");
      return withNativeRuntime(rpc, row.proof.runtimeId, async () => {
        if (!(row.mode === "idle-replacement" ? await verifyIdle(row.oldBinding, row.requestId) : await stopped(row))) throw Error("Previous execution proof changed before fresh replacement.");
        await hostGeneration(row.oldBinding.scope, row.proof.hostGeneration);
      });
    },
    async resolveQuestion(input) {
      const row = store.readWake(input?.requestId), work = store.readCurrentWork(input?.workId), question = work && store.listQuestions(work.id).find((q) => q.id === input.questionId);
      if (row?.state !== "bound" || row.newInstance?.workId !== work?.id || work.recoveryRequestId !== row.requestId || !question || (question.epoch ?? 0) >= (work.epoch ?? 0) || typeof input.note !== "string" || !input.note.trim() || input.note.length > 4e3) throw Error("Review the exact superseded question and provide a resolution note.");
      await consent();
      return store.updateQuestion(work.id, question.id, (q) => {
        if (q.resolution) {
          if (q.resolution.recoveryRequestId !== row.requestId || q.resolution.note !== input.note) throw Error("Question already has an immutable user resolution.");
          return;
        }
        q.status = "closed";
        q.resolution = { kind: "superseded-by-recovery", by: "user", recoveryRequestId: row.requestId, note: input.note, recordedAt: (/* @__PURE__ */ new Date()).toISOString() };
      });
    },
    async bind(id2) {
      const row = store.readWake(id2);
      if (!row || !["resumed", "replacing"].includes(row.state)) return publicWake(row);
      const binding = store.readOperation(row.newInstance.requestId), work = allWorks().find((w) => w.binding.requestId === row.oldBinding.requestId && w.supervisorMemberId === row.memberId && w.status !== "completed");
      if (!work || binding?.status !== "created") return publicWake(!work && row.mode === "idle-replacement" ? store.finishIdleReplacement(id2) : row);
      if (row.mode === "idle-replacement" && work.parent && ["accepted", "rework"].includes(store.listDispatches(work.parent.workId).find((a) => a.id === work.parent.attemptId)?.status)) return publicWake(store.finishIdleReplacement(id2));
      await consent();
      return withNativeRuntime(rpc, binding.runtimeId, async () => {
        await hostGeneration(binding.scope, row.proof.hostGeneration);
        if ((await rpc("status.get"))?.runtimeId !== binding.runtimeId || !store.isActiveOperation(binding)) throw Error("Recovered supervisor runtime or recipient changed.");
        let instance;
        if (binding.kind === "structured") {
          const address = (await rpc("orchestration.sessionAddress", { sessionId: binding.sessionId }))?.orcaSessionId, location = address && (await rpc("orchestration.partyLocation", { address }))?.location;
          const owner = await resumedOwner(userData, binding, row.state === "resumed" ? row.proof.death.ownerFence : 0);
          if (!owner || !address?.startsWith("orca_session_id:") || location?.kind !== "chat" || location.sessionId !== binding.sessionId || location.worktreeId !== work.scope.workspaceId) return publicWake(row);
          instance = { kind: "structured", sessionId: address.slice("orca_session_id:".length), liveSessionId: binding.sessionId, fence: owner.fence };
        } else {
          const shown2 = (await rpc("terminal.show", { terminal: binding.handle }))?.terminal;
          if (shown2?.handle !== binding.handle || shown2.worktreeId !== work.scope.workspaceId || shown2.executionHostId !== work.scope.executionHostId || !matchesTerminalObservation(shown2, binding.observation) || !shown2.connected || !shown2.writable) return publicWake(row);
          instance = { kind: "terminal", handle: binding.handle, paneKey: binding.paneKey, ...terminalIdentity(shown2) };
        }
        const run = await readNativeRunEvidence(userData, { objective: work.nativeObjective, owner: instance, runId: work.run.id });
        if (run.state !== "verified" || row.state === "replacing" && run.consumerGeneration <= (work.run.consumerGeneration ?? 0)) return publicWake(row);
        const shown = (await rpc("orchestration.runShow", { id: run.id }))?.run;
        if (shown?.id !== run.id || shown.consumer_generation !== run.consumerGeneration || shown.objective !== work.nativeObjective) return publicWake(row);
        const final = await readNativeRunEvidence(userData, { objective: work.nativeObjective, owner: instance, runId: run.id });
        if (final.state !== "verified" || final.consumerGeneration !== run.consumerGeneration) return publicWake(row);
        if (work.parent) {
          const parentWork = store.readCurrentWork(work.parent.workId), attempt = store.listDispatches(parentWork.id).find((a) => a.id === work.parent.attemptId);
          if (!attempt) return publicWake(row);
          const parent = await readNativeParentEvidence(userData, { parentWork, attempt });
          if (parent.state !== "verified" || (instance.kind === "structured" ? parent.assignee.sessionId !== instance.sessionId : parent.assignee.handle !== instance.handle || parent.assignee.paneKey !== instance.paneKey || parent.assignee.incarnationId !== instance.processIncarnation)) return publicWake(row);
        }
        return publicWake(store.rebindWake(id2, row.version, work.id, instance, run));
      });
    },
    async handoff(id2) {
      const row = store.readWake(id2), member = row && memberFor(row);
      if (!row || row.state !== "needs_decision" || !member?.boss) throw Error("A subordinate pending handoff is required.");
      const root = store.listCurrentWorks().find((w) => w.teamId === row.teamId && w.status !== "completed"), work = store.readOwningWork?.(root?.id, row.memberId) ?? store.readCurrentWork(row.oldBinding.sourceWorkId) ?? root;
      if (!work || work.supervisorMemberId !== member.boss || !works) throw Error("The actual direct manager Run must be verified before this handoff.");
      const verified = await works.verifyWork(work.id), protocol = store.readDispatchProtocol(work.id), native = await readNativeQuestionEvidence(userData, { work, protocol, owner: verified.instance, attempts: store.listDispatches(work.id) });
      const intent = native.state === "verified" && native.intents.find((i) => i.spec.kind === "recovery-handoff" && i.spec.appQuestionId === id2 && i.spec.memberId === member.id && i.spec.oldRequestId === row.oldBinding.requestId && i.spec.decision === "replace" && typeof i.spec.summary === "string" && i.spec.summary.trim() && i.spec.summary.length <= 4e3 && Array.isArray(i.spec.evidence) && i.spec.evidence.length && i.spec.evidence.every((v) => typeof v === "string" && v.length <= 1e3));
      if (!intent) throw Error("A genuine direct manager checked handoff Task is still required.");
      return publicWake(store.updateWake(id2, row.version, { state: "approved", handoff: { reviewer: member.boss, decision: "replace", summary: intent.spec.summary, evidenceRefs: intent.spec.evidence, oldRequestId: row.oldBinding.requestId, workId: work.id, runId: work.run.id, generation: work.run.consumerGeneration, nativeTaskId: intent.nativeTaskId, requestId: intent.requestId, payloadHash: intent.payloadHash, recordedAt: (/* @__PURE__ */ new Date()).toISOString() } }));
    },
    async decide(input) {
      const row = store.readWake(input?.requestId), member = row && memberFor(row);
      if (!member || member.boss) throw Error("Only the highest supervisor replacement is decided here by the user. A subordinate needs its actual direct manager handoff.");
      if (row.state !== "needs_decision" || input.version !== row.version) throw Error("Recovery decision changed; reopen pending evidence.");
      if (!["replace", "wait"].includes(input.decision) || typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 4e3 || !Array.isArray(input.evidenceRefs) || !input.evidenceRefs.length || input.evidenceRefs.length > 100 || input.evidenceRefs.some((v) => typeof v !== "string" || !v || v.length > 1e3)) throw Error("A bounded handoff summary and evidence references are required.");
      await consent();
      return publicWake(store.updateWake(row.requestId, row.version, { state: input.decision === "replace" ? "approved" : "needs_decision", handoff: { reviewer: "user", decision: input.decision, summary: input.summary, evidenceRefs: input.evidenceRefs, oldRequestId: row.oldBinding.requestId, recordedAt: (/* @__PURE__ */ new Date()).toISOString() } }));
    },
    async prepareFresh(id2) {
      const row = store.readWake(id2);
      if (row?.newInstance?.requestId) return { operation: store.readOperation(row.newInstance.requestId), fresh: false };
      if (row?.state !== "approved" || row.handoff?.decision !== "replace") throw Error("A checked handoff decision is required before fresh replacement.");
      await consent();
      return withNativeRuntime(rpc, row.proof.runtimeId, async () => {
        if ((await rpc("status.get"))?.runtimeId !== row.proof.runtimeId || !(row.mode === "idle-replacement" ? await verifyIdle(row.oldBinding, row.requestId) : await stopped(row))) throw Error("Previous execution is not proven stopped in this recovery runtime.");
        await hostGeneration(row.oldBinding.scope, row.proof.hostGeneration);
        const root = store.listCurrentWorks().find((w) => w.teamId === row.teamId && w.status !== "completed"), team = root && store.effectiveTeamForWork ? store.effectiveTeamForWork(root.id) : store.readSnapshot().teams.find((t) => t.id === row.teamId), member = team?.members.find((m) => m.id === row.memberId);
        if (!member) throw Error("Saved recovery member configuration changed.");
        const nativeRequest = nativeLaunchIntent(team, member, row.oldBinding.scope);
        const work = allWorks().find((w) => w.binding.requestId === row.oldBinding.requestId && w.status !== "completed" && !(row.mode === "idle-replacement" && w.parent && ["accepted", "rework"].includes(store.listDispatches(w.parent.workId).find((a) => a.id === w.parent.attemptId)?.status)));
        nativeRequest.prompt.text += `
TEAM_RECOVERY_HANDOFF
Original member ${row.memberId}; original instance ${row.oldBinding.requestId}.
${row.handoff.summary}
Evidence: ${row.handoff.evidenceRefs.join(", ")}
Preserve all original Task/Dispatch identities. ${work ? `As your own native identity, run-use ${work.run.id} with the installed Orca CLI; the exact objective remains ${JSON.stringify(work.nativeObjective)}. Never impersonate the old supervisor.` : ""} Await verified Run ownership and admission before work.`;
        return store.prepareWakeReplacement(id2, row.version, { scope: row.oldBinding.scope, nativeRequest, configVersion: team.configVersion, roleVersion: member.roleVersion, title: `${team.name}/${member.name}`, executionHostId: row.oldBinding.executionHostId, runtimeId: row.proof.runtimeId, hostGeneration: row.proof.hostGeneration ?? null });
      });
    },
    async check(id2) {
      let row = store.readWake(id2);
      if (row?.state === "submitted") row = store.updateWake(id2, row.version, { state: "unknown", detail: "Continuation receipt was lost. Reconciliation never submits it again." });
      if (!row || !["accepted", "unknown"].includes(row.state)) return publicWake(row);
      await consent();
      return withNativeRuntime(rpc, row.proof.runtimeId, async () => {
        await hostGeneration(row.oldBinding.scope, row.proof.hostGeneration);
        if ((await rpc("status.get"))?.runtimeId !== row.proof.runtimeId) throw Error("Recovery runtime changed; reservation retained.");
        const owner = await resumedOwner(userData, row.oldBinding, row.proof.death.ownerFence);
        if (!owner) return publicWake(row);
        const history = await rpc("agentSession.history", { sessionId: row.oldBinding.sessionId, direction: "tail", limit: 1 });
        if (history?.ok !== true || history.page?.sessionId !== row.oldBinding.sessionId || history.page.fence !== owner.fence) return publicWake(row);
        if ((await resumedOwner(userData, row.oldBinding, row.proof.death.ownerFence))?.fence !== owner.fence) return publicWake(row);
        return publicWake(store.publishWake(id2, row.version, owner));
      });
    },
    async wake(input) {
      if (!input || input.requestId?.length > 100 || Object.keys(input).some((k) => !["teamId", "memberId", "requestId", "bindingRequestId"].includes(k)) || !["teamId", "memberId", "requestId", "bindingRequestId"].every((k) => typeof input[k] === "string" && /^[a-zA-Z0-9-]{1,120}$/.test(input[k]))) throw Error("Choose an exact saved member binding.");
      const prior = store.readWake(input.requestId);
      if (prior) {
        if (["teamId", "memberId", "bindingRequestId"].some((k) => prior[k] !== input[k])) throw Error("Recovery request conflicts with saved input.");
        return publicWake(prior);
      }
      const op = bindingFor(input);
      if (!op || !active(op) || op.teamId !== input.teamId || op.memberId !== input.memberId || op.status !== "created") throw Error("Current saved member identity is required.");
      await consent();
      const status = await rpc("status.get");
      if (typeof status?.runtimeId !== "string" || !status.runtimeId) throw Error("Native runtime identity is required for recovery.");
      return withNativeRuntime(rpc, status.runtimeId, async () => {
        const generation = await hostGeneration(op.scope, op.hostGeneration);
        const work = allWorks().find((w) => w.binding.requestId === op.requestId), fence = work?.instance?.fence ?? op.observation?.ownerFence;
        const death = await stopped({ oldBinding: op, proof: { death: { ownerFence: fence } } });
        if (!death || op.kind === "structured" && death.provider !== op.nativeRequest.agent) return { state: "blocked", detail: "The exact previous execution has not been proven stopped. Reconcile native death evidence before waking this member." };
        const selected = (await rpc("worktree.show", { worktree: op.scope.workspaceId.startsWith("folder:") ? op.scope.workspaceId : `id:${op.scope.workspaceId}` }))?.worktree;
        if (selected?.id !== op.scope.workspaceId || (selected.hostId ?? selected.identity?.executionHostId) !== op.scope.executionHostId) throw Error("Saved recovery project or host changed.");
        let offers;
        try {
          offers = op.kind === "structured" ? await rpc("agentSession.restartResumable", { sessionIds: [op.sessionId] }) : null;
        } catch {
        }
        const offer = offers?.sessions?.find((s) => s.sessionId === op.sessionId && s.workspaceId === op.scope.workspaceId && s.executionHostId === op.scope.executionHostId && s.agent === op.nativeRequest.agent);
        let action = offer ? { method: "agentSession.restartContinue", params: { sessionIds: [op.sessionId] } } : null;
        if (!offer && op.kind === "structured") {
          let history;
          try {
            history = await rpc("agentSession.history", { sessionId: op.sessionId, direction: "tail", limit: 1 });
          } catch {
          }
          if (history?.ok === true && history.page?.sessionId === op.sessionId && Number.isSafeInteger(history.page.fence) && history.page.fence >= death.ownerFence) {
            action = userMessage({ binding: op }, { kind: "structured", fence: history.page.fence }, `TEAM_MEMBER_WAKE
Member ${op.memberId}; original operation ${op.requestId}; TeamWork ${work?.id ?? "preparation"}. Continue this existing conversation after its previous execution was confirmed stopped. ${work ? `Use your own native identity to run-use ${work.run.id ?? "the existing exact objective Run"} and verify its objective ${JSON.stringify(work.nativeObjective)}; never override caller identity.` : ""} Preserve original Task and Dispatch report identity. Await verified supervisor admission before new tasks; do not create another worker.`, status);
          }
        }
        const prepared = store.prepareWake(input, op, { death, ...op.kind === "terminal" ? { stop: death } : {}, runtimeId: status.runtimeId, hostGeneration: generation }, action);
        if (!prepared.fresh || !action) return publicWake(await requestDecision(prepared.row));
        await consent();
        if (!await stopped({ oldBinding: op, proof: { death } })) throw Error("Previous execution is no longer proven stopped.");
        await hostGeneration(op.scope, generation);
        if ((await rpc("status.get"))?.runtimeId !== status.runtimeId) throw Error("Recovery runtime changed before continuation.");
        if (!store.claimWake(input.requestId)) return publicWake(store.readWake(input.requestId));
        let patch;
        try {
          const receipt = await rpc(action.method, action.params, action.envelope);
          const entry = action.method === "agentSession.send" ? { sessionId: op.sessionId, outcome: accepted(receipt, action, { fence }) ? "continued" : receipt?.ok === false ? "refused" : "unknown" } : receipt?.continued?.find((r) => r.sessionId === op.sessionId);
          if (!entry || !["continued", "pending", "unknown", "refused"].includes(entry.outcome)) throw Error("Native continuation identity is unconfirmed.");
          patch = { state: entry.outcome === "continued" ? "accepted" : entry.outcome === "refused" ? "needs_decision" : "unknown", receipt: { sessionId: entry.sessionId, outcome: entry.outcome }, detail: entry.outcome === "continued" ? "Native continuation accepted. New execution and Run authority still require verification." : "Native continuation is unconfirmed or refused; no automatic fallback is allowed." };
        } catch (error) {
          patch = { state: "unknown", detail: String(error.message).slice(0, 1200) };
        }
        const row = store.readWake(input.requestId);
        return publicWake(await requestDecision(store.updateWake(row.requestId, row.version, patch)));
      });
    }
  };
}

// src/local/native-stop.mjs
import { realpath as realpath9 } from "node:fs/promises";
import { join as join10, relative as relative8, isAbsolute as isAbsolute9, sep as sep8 } from "node:path";
async function readStopReceipt(userData, row) {
  let db;
  try {
    const root = await realpath9(userData), file = await realpath9(join10(root, "orchestration.db")), rel = relative8(root, file);
    if (rel === ".." || rel.startsWith(`..${sep8}`) || isAbsolute9(rel)) return null;
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(file, { readOnly: true });
    if (db.prepare("PRAGMA user_version").get().user_version !== 43) return null;
    const caller4 = db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
    if (!caller4) return null;
    const saved = db.prepare("SELECT method,payload_hash,state,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND request_id=?").get(caller4.caller_fingerprint, row.nativeRequestId);
    if (saved?.method !== "orchestration.workerStop" || saved.state !== "completed" || saved.payload_hash !== nativeMutationFingerprint(saved.method, { dispatch: row.target.dispatchId }, { kind: "local-user" })) return null;
    const receipt = JSON.parse(saved.receipt);
    return receipt?.dispatchId === row.target.dispatchId ? receipt : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

// src/local/stop.mjs
var stamp2 = () => (/* @__PURE__ */ new Date()).toISOString();
function createStopService({ store, rpc, userData, consent }) {
  const workFor = (id2) => store.readCurrentWork?.(id2) ?? store.readWork(id2);
  function target(input) {
    if (Object.keys(input ?? {}).some((k) => !["requestId", "teamId", "memberId", "workId", "attemptId", "operationRequestId"].includes(k))) throw Error("Invalid stop selection.");
    const team = store.readSnapshot().teams.find((t) => t.id === input.teamId);
    if (!team?.members.some((m) => m.id === input.memberId)) throw Error("Choose an existing team member.");
    const reserved = store.readReceipt(`dispatch-member:${input.memberId}`);
    if (input.attemptId) {
      const attempt = store.listDispatches(input.workId).find((a) => a.id === input.attemptId), work2 = workFor(input.workId);
      if (!attempt || reserved?.id !== attempt.id || attempt.teamId !== team.id || attempt.memberId !== input.memberId || !attempt.dispatchId || !attempt.binding || work2?.run.id !== attempt.runId || work2.run.consumerGeneration !== attempt.generation) throw Error("Current member, TeamWork, Task and Dispatch binding is required.");
      return { teamId: team.id, memberId: input.memberId, workId: work2.id, attemptId: attempt.id, dispatchId: attempt.dispatchId, nativeTaskId: attempt.nativeTaskId, runId: work2.run.id, generation: attempt.generation, binding: attempt.binding, scope: work2.scope };
    }
    const operation = store.readOperation(input.operationRequestId);
    if (reserved || !operation || !store.isActiveOperation(operation) || operation.teamId !== team.id || operation.memberId !== input.memberId || operation.status !== "created") throw Error("Choose the current exact member execution; assigned members require their Task and Dispatch.");
    const work = (store.listCurrentWorks?.() ?? store.listWorks()).find((w) => w.binding.requestId === operation.requestId), binding = { kind: operation.kind, handle: operation.handle, paneKey: operation.paneKey, sessionId: operation.sessionId, runtimeId: operation.runtimeId, incarnationId: work?.instance?.incarnationId ?? operation.observation?.incarnationId, ptyId: work?.instance?.ptyId ?? operation.observation?.ptyId, processIncarnation: work?.instance?.processIncarnation ?? operation.observation?.processIncarnation, ownerFence: work?.instance?.fence ?? operation.observation?.ownerFence };
    return { teamId: team.id, memberId: input.memberId, operationRequestId: operation.requestId, instanceGeneration: operation.instanceGeneration ?? 1, ...work ? { workId: work.id } : {}, binding, scope: operation.scope };
  }
  function current(row) {
    const input = { teamId: row.target.teamId, memberId: row.target.memberId, ...row.target.attemptId ? { workId: row.target.workId, attemptId: row.target.attemptId } : { operationRequestId: row.target.operationRequestId } };
    if (!sameStopIdentity(target(input), row.target)) throw Error("Member execution changed; the original stop remains reserved.");
  }
  async function verify(row) {
    current(row);
    await consent();
    const t = row.target, b = t.binding, status = await rpc("status.get");
    if (!b.runtimeId || status?.runtimeId !== b.runtimeId) throw Error("Native runtime changed; reconcile the original execution.");
    return withNativeRuntime(rpc, b.runtimeId, async () => {
      let generation = null;
      const host = async () => {
        if (t.scope.executionHostId === "local") return null;
        const state = (await rpc("ssh.getState", { targetId: decodeURIComponent(t.scope.executionHostId.slice(4)) }))?.state;
        if (state?.status !== "connected" || !Number.isSafeInteger(state.connectionGeneration)) throw Error("Stop host is disconnected or unverified.");
        return state.connectionGeneration;
      };
      generation = await host();
      const workspace = (await rpc("worktree.show", { worktree: t.scope.workspaceId.startsWith("folder:") ? t.scope.workspaceId : `id:${t.scope.workspaceId}` }))?.worktree;
      if (workspace?.id !== t.scope.workspaceId || (workspace.hostId ?? workspace.identity?.executionHostId) !== t.scope.executionHostId) throw Error("Stop workspace or host changed.");
      let plan;
      if (t.attemptId) {
        if (!status.capabilities?.includes("orchestration.contract.v1")) throw Object.assign(Error("Current native orchestration stop contract is unsupported."), { unsupported: true });
        const work = workFor(t.workId), attempt = store.listDispatches(t.workId).find((a) => a.id === t.attemptId), proof = await readNativeDispatchEvidence(userData, { work, protocol: store.readDispatchProtocol(work.id), team: store.readTeamVersion(work.teamId, work.configVersion), owner: work.instance, admitted: [attempt] }), found = proof.observations?.find((a) => a.id === attempt.id);
        if (proof.state !== "verified" || found?.state !== "verified" || found.dispatchId !== t.dispatchId || !sameStopIdentity(found.binding, b)) throw Error("Native Task/Dispatch author and current member binding are unverified.");
        const shown = await rpc("orchestration.workerShow", { dispatch: t.dispatchId }), d = shown?.dispatch, w = shown?.worker, h = d?.hostScope;
        const hostMatches = t.scope.executionHostId === "local" ? h?.kind === "local" && h.hostId === "local" : h?.kind === "ssh" && `ssh:${encodeURIComponent(h.targetId)}` === t.scope.executionHostId;
        if (shown.observation?.exactWorker !== true || !["live", "exited"].includes(shown.observation?.status) || !hostMatches || d?.id !== t.dispatchId || d.runId !== t.runId || d.taskId !== t.nativeTaskId || d.assigneeHandle !== b.handle || d.assigneePaneKey !== b.paneKey || d.processIncarnation !== b.incarnationId || (d.creatorDispatchId ?? null) !== (found.creatorDispatchId ?? null) || w?.dispatchId !== t.dispatchId || w.worktreeId !== t.scope.workspaceId || w.runtimeEpoch !== b.runtimeId) throw Error("Native worker ownership changed.");
        plan = { method: "orchestration.workerStop", params: { dispatch: t.dispatchId }, envelope: { orchestrationRequestId: row.nativeRequestId }, ...shown.observation.status === "exited" ? { exitedProof: { kind: "native-worker-exit", dispatchId: t.dispatchId } } : {} };
      } else if (b.kind === "terminal") {
        if (t.scope.executionHostId !== "local") throw Object.assign(Error("Exact standalone terminal stop is unsupported for this remote host."), { unsupported: true });
        const shown = (await rpc("terminal.show", { terminal: b.handle }))?.terminal;
        if (!matchesTerminalObservation(shown, b) || shown.handle !== b.handle || `${shown.tabId}:${shown.leafId}` !== b.paneKey || shown.worktreeId !== t.scope.workspaceId || shown.executionHostId !== t.scope.executionHostId || typeof shown.ptyId !== "string" || !shown.ptyId) throw Error("Exact native terminal PTY and incarnation are unverified.");
        plan = { method: "terminal.stopExact", params: { worktree: t.scope.workspaceId.startsWith("folder:") ? t.scope.workspaceId : `id:${t.scope.workspaceId}`, expectedPtyIds: [shown.ptyId], keepHistory: true, targetOnly: true }, envelope: {} };
      } else {
        if (t.scope.executionHostId !== "local" || !Number.isSafeInteger(b.ownerFence) || b.ownerFence < 1) throw Object.assign(Error("Exact structured owner fence is unavailable; native stop is unsupported for this binding."), { unsupported: true });
        const location = (await rpc("orchestration.partyLocation", { address: `orca_session_id:${b.sessionId}` }))?.location, history = await rpc("agentSession.history", { sessionId: b.sessionId, direction: "tail", limit: 1 });
        if (location?.sessionId !== b.sessionId || location.worktreeId !== t.scope.workspaceId || history?.ok !== true || history.page?.sessionId !== b.sessionId || history.page.fence !== b.ownerFence) throw Error("Structured conversation owner changed.");
        plan = { method: "agentSession.close", params: { sessionId: b.sessionId }, envelope: {} };
      }
      if (await host() !== generation || (await rpc("status.get"))?.runtimeId !== b.runtimeId) throw Error("Native host generation changed before stop.");
      current(row);
      await consent();
      return { ...plan, runtimeId: b.runtimeId, executionHostId: t.scope.executionHostId, hostGeneration: generation, ...plan.method === "terminal.stopExact" ? { terminalIdentity: { handle: b.handle, incarnationId: b.incarnationId, ptyId: plan.params.expectedPtyIds[0], paneKey: b.paneKey, workspaceId: t.scope.workspaceId } } : {} };
    });
  }
  async function settle(id2, receipt, error) {
    let row = store.readStop(id2);
    if (!row || !["submitted", "unknown"].includes(row.state)) return row;
    let state = error?.native === true && ["method_not_found", "method_not_supported"].includes(error.code) ? "unsupported" : "unknown", proof;
    if (!error && row.plan?.method === "orchestration.workerStop" && receipt?.dispatchId === row.target.dispatchId && receipt.state === "stopped" && receipt.close?.ptyKilled === true) {
      state = "stopped";
      proof = { kind: "native-pty-exit", ptyKilled: true };
    }
    if (!error && row.plan?.method === "terminal.stopExact" && receipt?.postStopVerified === true && receipt.stoppedPtyIds?.includes(row.plan.params.expectedPtyIds[0])) {
      state = "stopped";
      proof = { kind: "native-exact-stop", ptyId: row.plan.params.expectedPtyIds[0], postStopVerified: true };
    }
    if (!error && row.plan?.method === "agentSession.close") {
      const death = await readSessionDeath(userData, row.target.binding.sessionId, row.target.binding.ownerFence, row.target.scope);
      if (death) {
        state = "stopped";
        proof = { kind: "native-owner-death", death };
      }
    }
    return store.settleStop(id2, row.version, { state, ...receipt ? { receipt } : {}, ...proof ? { proof, confirmedAt: stamp2() } : {}, detail: state === "stopped" ? "Native evidence confirms this exact execution stopped. Files and execution history are retained." : error ? String(error.message ?? error).slice(0, 1200) : "Stop requested; session exit is unconfirmed. Assignment stopped or a closed view alone does not prove execution stopped. Check evidence; no replacement or automatic retry." });
  }
  return {
    async prepare(input) {
      await consent();
      const row = store.prepareStop(input, target(input));
      return row;
    },
    async validate(id2) {
      const row = store.readStop(id2);
      if (!row || row.state !== "intent") return null;
      try {
        const plan = await verify(row);
        if (plan.exitedProof) {
          store.settleStop(id2, row.version, { state: "stopped", proof: plan.exitedProof, confirmedAt: stamp2(), detail: "Exact native worker observation confirms this saved execution already exited." });
          return null;
        }
        store.settleStop(id2, row.version, { state: "submitted", plan, submittedAt: stamp2(), detail: "Stop request submitted; awaiting native exit evidence." });
        return plan;
      } catch (error) {
        store.settleStop(id2, row.version, { state: error.unsupported ? "unsupported" : "unknown", detail: error.message });
        throw error;
      }
    },
    async recover(input) {
      await consent();
      if (store.readStopRecovery(input)) return { requestId: input.stopRequestId, plan: null };
      const row = store.readStop(input.stopRequestId);
      if (!row || row.version !== input.version || row.state !== "unknown" || row.plan?.method !== "orchestration.workerStop") throw Error("Choose the current unknown native worker stop.");
      const plan = await verify(row), claimed = store.claimStopRecovery(input, plan);
      return { requestId: row.requestId, plan: claimed && !plan.exitedProof ? plan : null };
    },
    settle,
    async check(id2) {
      const row = store.readStop(id2);
      if (!row || !["submitted", "unknown"].includes(row.state)) return row;
      await consent();
      if (row.plan?.method === "orchestration.workerStop") {
        const receipt = await readStopReceipt(userData, row);
        if (receipt) {
          const saved = await settle(id2, receipt);
          if (saved.state === "stopped") return saved;
        }
        try {
          const observed = await verify(store.readStop(id2));
          if (observed.exitedProof) {
            const current3 = store.readStop(id2);
            return store.settleStop(id2, current3.version, { state: "stopped", proof: observed.exitedProof, confirmedAt: stamp2(), detail: "Exact native worker observation confirms this saved execution exited." });
          }
        } catch {
        }
      }
      if (row.plan?.method === "agentSession.close") return settle(id2);
      const current2 = store.readStop(id2);
      return current2.state === "submitted" ? store.settleStop(id2, current2.version, { state: "unknown", detail: "Native stop response is unavailable. The original execution remains reserved; checking never repeats the stop." }) : current2;
    },
    async reconcile() {
      for (const row of store.listStops()) await this.check(row.requestId);
    }
  };
}

// src/local/lifecycle.mjs
function createLifecycleService({ store, rpc, userData, consent, works, notify }) {
  const serialize = createKeyedSerializer();
  const serial = (id2, fn) => serialize(id2, () => withNativeRuntime(rpc, controlRuntime(store.readCurrentWork(id2)), fn));
  async function evidence(id2) {
    const work = store.readCurrentWork(id2);
    if (!work || work.status === "completed") return null;
    const verified = await works.verifyWork(id2, true, { allowSettledParent: true }), protocol = store.readDispatchProtocol(id2);
    if (!protocol || protocol.generation !== work.run.consumerGeneration) throw Error("Supervisor delivery protocol is unavailable.");
    const nativeHistory = store.readNativeHistory(id2);
    const native = await readNativeDispatchEvidence(userData, { work, protocol, team: store.effectiveTeamForWork(work.id), owner: verified.instance, admitted: store.listDispatches(id2), allowSettledParent: true, nativeHistory });
    if (native.state !== "verified") throw Error(native.detail);
    const questionEvidence = await readNativeQuestionEvidence(userData, { work, protocol, owner: verified.instance, attempts: store.listDispatches(id2), nativeHistory });
    return { work, verified, native, questionEvidence };
  }
  async function check(id2) {
    const row = await evidence(id2);
    if (!row) return;
    if (store.readCurrentWork(id2).version !== row.work.version) throw Error("Work changed during delivery observation.");
    for (const proposal of row.native.deliveries ?? []) {
      let d;
      try {
        d = store.recordDelivery(id2, proposal);
      } catch {
        continue;
      }
      if (d?.status === "pending") await notifyQuestionEvent(store, notify, { workId: id2, id: `delivery-${d.id}`, kind: "goal-delivery", title: "Total objective ready for your review", body: d.summary.slice(0, 1e3) });
    }
  }
  return {
    check: (id2) => serial(id2, () => check(id2)),
    decide: (input) => serial(input.workId, async () => {
      await consent();
      const prior = store.readWorkDecision(input.requestId);
      if (prior) return store.decideWork(input);
      const row = await evidence(input.workId);
      if (!row || !row.native.deliveries.some((d) => d.id === input.deliveryId)) throw Error("Current native Head delivery is unavailable.");
      if (input.decision === "accept") for (const child of store.listRunWorks(input.workId).filter((w) => w.parent)) {
        const checked = await evidence(child.id);
        if (!checked || checked.questionEvidence.state !== "verified" || checked.questionEvidence.rejected.length || checked.native.unmanaged?.length || checked.native.rejected.length || checked.native.intents.length) throw Error("Descendant Run contains unresolved or unregistered native work.");
        if (latestBusinessAttempts(store.listDispatches(child.id)).some((a) => a.status !== "accepted" || !checked.native.observations.some((o) => o.id === a.id && o.state === "verified" && o.completion?.evidenceId === a.evidenceId))) throw Error("Descendant execution or acceptance remains unverified.");
      }
      if (input.decision === "accept" && row.native.intents.some((i) => !store.listDispatches(input.workId).some((a) => a.nativeTaskId === i.nativeTaskId))) throw Error("Native task awaits application admission.");
      if (input.decision === "accept" && row.native.unmanaged?.length) throw Error("Unregistered native work requires confirmation before closure.");
      if (input.decision === "accept" && store.listDispatches(input.workId).some((a) => a.status === "accepted" && !row.native.observations.some((o) => o.id === a.id && o.state === "verified" && o.completion?.evidenceId === a.evidenceId))) throw Error("Accepted task execution evidence changed; closure awaits confirmation.");
      if (input.decision === "accept" && (row.questionEvidence.state !== "verified" || row.questionEvidence.rejected.length)) throw Error("Native question evidence needs confirmation before closure.");
      if (input.decision === "accept" && row.native.rejected.length) throw Error("Native task evidence needs confirmation before closure.");
      await works.verifyHost(input.workId, row.verified.hostGeneration);
      const event = store.decideWork(input);
      if (input.decision === "rework") {
        const nativeSend = userMessage(row.work, row.verified.instance, "TEAM_GOAL_REWORK\n" + JSON.stringify({ workId: input.workId, deliveryId: input.deliveryId, decisionId: input.requestId, feedback: input.feedback, instruction: "Continue this same total objective. Submit a new genuine team-delivery/v1 Task referencing previousDeliveryId after corrections; the old proposal cannot be accepted." }), row.verified.status);
        store.updateWorkDecision(input.requestId, { nativeSend, input: { state: "sending" } });
        try {
          await consent();
          await works.verifyHost(input.workId, row.verified.hostGeneration);
          const receipt = await rpc(nativeSend.method, nativeSend.params, nativeSend.envelope);
          if (!accepted(receipt, nativeSend, row.verified.instance)) throw Error("Unconfirmed input");
          store.updateWorkDecision(input.requestId, { input: { state: receipt.value?.queued ? "queued" : "accepted" } });
        } catch (error) {
          store.updateWorkDecision(input.requestId, { input: { state: "unknown", detail: String(error.message).slice(0, 1200) } });
        }
      }
      return event;
    }),
    async reconcile() {
      for (const w of store.listCurrentWorks()) if (w.status !== "completed" && w.run.state === "verified") try {
        await this.check(w.id);
      } catch {
      }
    }
  };
}

// src/local/executor.mjs
import { timingSafeEqual } from "node:crypto";
import { createHash as createHash13, randomUUID as randomUUID7 } from "node:crypto";
var hash3 = (value) => createHash13("sha256").update(value).digest("hex");
function createExecutor(host, cli, { store, internalKey, userData, parentPid = process.ppid, nativeRpc } = {}) {
  const consent = () => host.call("storage.get", { key: "team-work-consent-v1" });
  const rpc = nativeRpc ?? createNativeRpc({ userData, parentPid, consent });
  const works = createWorkService({ store, userData, consent, rpc });
  const staffing = createStaffingService({ store, userData, consent, rpc, works, notify: (params) => host.call("notifications.show", params) });
  const questions = createQuestionService({ store, userData, consent, rpc, works, notify: (params) => host.call("notifications.show", params) });
  const dispatches = createDispatchService({ store, userData, consent, rpc, works, beforeAdmission: (id2) => questions.check(id2), onNativeWait: (...args) => questions.nativeWait(...args), onClosedMember: (input) => wake.wake(input) });
  const hierarchy = createHierarchyService({ store, userData, works });
  const stops = createStopService({ store, rpc, userData, consent });
  const lifecycle = createLifecycleService({ store, rpc, userData, consent, works, notify: (params) => host.call("notifications.show", params) });
  const recovery = createRecoveryService({ store, rpc, userData, consent });
  const wake = createWakeService({ store, rpc, userData, consent, works, notify: (params) => host.call("notifications.show", params) });
  let workTimer, polling = false, stopped = false, reconnecting = false;
  const reconcileExisting = async () => {
    await recovery.reconcile();
    await stops.reconcile();
  };
  const scheduleWork = () => {
    if (!workTimer && !stopped) {
      workTimer = setTimeout(() => {
        workTimer = null;
        void resumeWork();
      }, 5e3);
      workTimer.unref?.();
    }
  };
  async function resumeWork() {
    if (polling || stopped || reconnecting) return;
    polling = true;
    try {
      await consent();
      await recovery.reconcile();
      await stops.reconcile();
      for (const row of store.listWakes()) {
        await wake.check(row.requestId);
        await wake.bind(row.requestId);
      }
      if (!store.listCurrentWorks().some((work) => work.status !== "completed" && (work.recoveryRequestId || work.input.state !== "not_sent") && work.run.state !== "fenced")) return;
      await consent();
      await works.reconcile();
      await dispatches.reconcile();
      await hierarchy.reconcile();
      await dispatches.reconcile();
      await questions.reconcile();
      await staffing.reconcile();
      await lifecycle.reconcile();
      scheduleWork();
    } catch {
      stopped = true;
    } finally {
      polling = false;
    }
  }
  const selections = /* @__PURE__ */ new Map();
  const observations = /* @__PURE__ */ new Map(), capabilities = /* @__PURE__ */ new Map(), latestObservation = /* @__PURE__ */ new Map();
  const launchPlans = /* @__PURE__ */ new Map();
  async function workspaceRecord(workspaceId) {
    if (typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 4096) throw new Error("No verified desktop workspace selection.");
    const selector = workspaceId.startsWith("folder:") ? workspaceId : `id:${workspaceId}`;
    const result = await cli(["worktree", "show", "--worktree", selector]);
    const workspace = result?.worktree;
    if (!workspace?.id || workspace.id !== workspaceId) throw new Error("Open the intended workspace first; Orca returned no active workspace identity.");
    if (workspace.id.startsWith("folder:")) return { ...workspace, kind: "folder" };
    if (typeof workspace.repoId !== "string" || !workspace.repoId || workspace.repoId.length > 4096) throw new Error("Orca did not verify the workspace repository identity.");
    const { repo } = await cli(["repo", "show", "--repo", `id:${workspace.repoId}`]) ?? {};
    if (!repo || repo.id !== workspace.repoId) throw new Error("Orca returned a mismatching workspace repository identity.");
    if (repo.kind !== void 0 && repo.kind !== "git" && repo.kind !== "folder") throw new Error("Orca returned an unsupported repository kind.");
    return { ...workspace, kind: repo.kind ?? "git" };
  }
  function verifiedScope(workspace) {
    const executionHostId = workspace.hostId ?? workspace.identity?.executionHostId;
    if (typeof executionHostId !== "string" || !/^(local|ssh:[^\s|]+)$/.test(executionHostId)) throw new Error("Orca did not verify a supported local or SSH execution host for this workspace.");
    return { workspaceId: workspace.id, executionHostId, kind: workspace.kind, displayName: workspace.displayName || workspace.branch || "Workspace", branch: workspace.branch || "", workspaceKey: hash3(JSON.stringify([workspace.id, executionHostId])) };
  }
  const publicScope2 = ({ workspaceId, ...scope }) => ({ ...scope, nativeAgentLaunch: true });
  async function context(workspaceId, teamId) {
    if (teamId) return publicScope2(store.readScope(teamId));
    const scope = verifiedScope(await workspaceRecord(workspaceId));
    const selectionToken = randomUUID7();
    if (selections.size >= 128) selections.delete(selections.keys().next().value);
    selections.set(selectionToken, scope);
    return { ...publicScope2(scope), selectionToken };
  }
  function savedLaunch(input) {
    launchInput(input);
    const saved = store.readOperation(input.requestId);
    if (saved) {
      if (["teamId", "memberId", "configVersion"].some((key) => saved[key] !== input[key])) throw Error("Request identity conflicts with an existing launch.");
      return saved;
    }
    return null;
  }
  function plan(operation) {
    if (launchPlans.size >= 128) launchPlans.delete(launchPlans.keys().next().value);
    const phaseId = randomUUID7();
    launchPlans.set(phaseId, { requestId: operation.requestId, operationId: operation.nativeRequest.operationId });
    return { phaseId, operation };
  }
  const settled = (operation, patch) => {
    const publicValue = publicOperation({ ...operation, ...patch });
    return store.settleOperation(operation.requestId, operation.nativeRequest.operationId, { ...patch, public: publicValue }, operation.version ?? 1);
  };
  return {
    resumeWork,
    stopWork() {
      stopped = true;
      clearTimeout(workTimer);
      workTimer = null;
    },
    async execute({ op, params = {}, workspaceId, internalKey: suppliedKey } = {}) {
      if (op?.startsWith("_")) {
        if (typeof internalKey !== "string" || typeof suppliedKey !== "string" || Buffer.byteLength(internalKey) !== Buffer.byteLength(suppliedKey) || !timingSafeEqual(Buffer.from(internalKey), Buffer.from(suppliedKey))) throw Error("Internal host observation authority is required.");
        if (op === "_staffingTarget") {
          const prior = store.readStaffingRequest(params);
          if (prior) return { staffing: prior };
          const work = store.readWork(params.workId);
          if (!work || work.status === "completed") throw Error("TeamWork is closed or unavailable.");
          return { teamId: work.teamId };
        }
        if (op === "_saveStaffing") {
          await consent();
          const previous = store.readStaffingRequest(params);
          if (previous) return { staffing: previous, value: store.readSnapshot() };
          const work = store.readWork(params.workId);
          if (!work || work.status === "completed") throw Error("TeamWork is closed or unavailable.");
          const member = params.member ?? store.listStaffingProposals(work.id).find((p) => p.id === params.proposalId)?.member;
          if (params.decision !== "reject") {
            const issue = preferenceIssue(member ?? {}, capabilities.get(work.scope.workspaceKey));
            if (issue) throw Error(issue);
          }
          const result = store.saveStaffing(params);
          await staffing.check(work.id);
          stopped = false;
          scheduleWork();
          return { staffing: result, value: store.readSnapshot() };
        }
        if (op === "_wakeFreshPrepare") {
          const row = store.readWake(params.input.requestId);
          if (!row || row.teamId !== params.input.teamId) throw Error("Saved handoff recovery not found.");
          const observed = capabilities.get(row.oldBinding.scope.workspaceKey), member = store.readSnapshot().teams.find((t) => t.id === row.teamId)?.members.find((m) => m.id === row.memberId);
          if (latestObservation.get(row.oldBinding.scope.workspaceKey) !== params.observationId || !observed || Date.now() - observed.observedAt > 3e4 || observed.runtimeId !== row.proof.runtimeId) throw Error("Fresh authenticated recovery capability admission is required.");
          const issue = preferenceIssue(member, observed, { requireCore: true });
          if (issue) throw Error(issue);
          const result = await wake.prepareFresh(row.requestId);
          return result.fresh ? plan(result.operation) : { receipt: publicOperation(result.operation) };
        }
        if (op === "_stopPrepare") {
          await reconcileExisting();
          return stops.prepare(params);
        }
        if (op === "_stopRecover") return stops.recover(params);
        if (op === "_stopValidate") return stops.validate(params.requestId);
        if (op === "_stopSettle") return stops.settle(params.requestId, params.receipt, params.error);
        if (op === "_decideWork") {
          await reconcileExisting();
          if (!store.readWorkDecision(params.requestId)) await questions.check(params.workId);
          const decision = await lifecycle.decide(params);
          return { value: store.readSnapshot(), decision, teamId: store.readWork(params.workId).teamId };
        }
        if (op === "_nextGoal") {
          const goal = params.goalId ? store.nextGoal(params.teamId) : store.reserveNextGoal(params.teamId);
          if (!goal || params.goalId && goal.id !== params.goalId) return { value: store.readSnapshot() };
          const team = store.readSnapshot().teams.find((t) => t.id === params.teamId);
          if (team?.configVersion !== goal.configVersion) throw Error("Queued transition configuration changed.");
          const pending = Object.entries(goal.launchRequests).find(([memberId, id2]) => store.readOperation(id2)?.status !== "created");
          return { goalId: goal.id, ...pending ? { launch: { teamId: team.id, memberId: pending[0], requestId: pending[1], configVersion: goal.configVersion } } : { ready: true } };
        }
        if (op === "_startQueuedWork") {
          await reconcileExisting();
          const goal = store.nextGoal(params.teamId);
          if (!goal || params.goalId && goal.id !== params.goalId) return { value: store.readSnapshot() };
          const work = await works.submit({ teamId: params.teamId, requestId: goal.workRequestId, objective: goal.objective, expectedRevision: store.readSnapshot().revision });
          await dispatches.check(work.id);
          stopped = false;
          scheduleWork();
          return { value: store.readSnapshot(), work };
        }
        if (op === "_launchLookup") {
          const saved = savedLaunch(params.input);
          if (!saved) return null;
          if (params.recover) return { receipt: publicOperation(await recovery.checkOperation(saved.requestId)) };
          return { receipt: publicOperation(saved) };
        }
        if (op === "_launchPrepare") {
          await reconcileExisting();
          const previous = savedLaunch(params.input);
          if (previous) return { receipt: publicOperation(previous) };
          const input = params.input, team = store.readSnapshot().teams.find((row) => row.id === input.teamId);
          const member = team?.members.find((row) => row.id === input.memberId);
          if (!member || !initialMembers(team).some((row) => row.id === member.id) || team.configVersion !== input.configVersion) throw Error("Launch requires a member selected by the saved roster preparation mode.");
          const scope = store.readScope(team.id), observed = capabilities.get(scope.workspaceKey);
          if (!params.observationId || latestObservation.get(scope.workspaceKey) !== params.observationId || !observed || Date.now() - observed.observedAt > 3e4) throw Error("Fresh authenticated launch capability admission is required.");
          if (typeof observed.runtimeId !== "string" || !observed.runtimeId.trim()) throw Error("Native runtime identity is unavailable; no member was reserved.");
          const issue = preferenceIssue(member, observed, { requireCore: true });
          if (issue) throw Error(issue);
          if (verifiedScope(await workspaceRecord(scope.workspaceId)).workspaceKey !== scope.workspaceKey) throw Error("The bound workspace or execution host changed.");
          if (latestObservation.get(scope.workspaceKey) !== params.observationId) throw Error("Launch capability admission was superseded.");
          const prepared = store.prepareOperation(input, { scope, nativeRequest: nativeLaunchIntent(team, member, scope), roleVersion: member.roleVersion, title: `${team.name}/${member.name}`, executionHostId: scope.executionHostId, runtimeId: observed.runtimeId, hostGeneration: observed.hostGeneration });
          return prepared.fresh ? plan(prepared.operation) : { receipt: publicOperation(prepared.operation) };
        }
        if (op === "_launchValidate") {
          const phase = launchPlans.get(params.phaseId), saved = phase && store.readOperation(phase.requestId);
          if (!saved || latestObservation.get(saved.scope.workspaceKey) !== params.observationId) throw Error("Launch admission is stale.");
          store.assertStaffingPreparation(saved.memberId, saved.requestId);
          const observed = capabilities.get(saved.scope.workspaceKey);
          if (!saved.runtimeId || observed?.runtimeId !== saved.runtimeId) throw Error("Native runtime identity changed; the unknown launch remains reserved until its original ledger can be corroborated.");
          const issue = preferenceIssue({ agent: saved.nativeRequest.agent, model: saved.nativeRequest.sessionOptions?.model ?? "default", effort: saved.nativeRequest.sessionOptions?.effort ?? "default" }, observed, { requireCore: true });
          if (issue) throw Error(issue);
          if (verifiedScope(await workspaceRecord(saved.scope.workspaceId)).workspaceKey !== saved.scope.workspaceKey) throw Error("The saved execution scope changed before launch.");
          if (saved.wakeRequestId) await wake.validateFresh(saved.wakeRequestId);
          settled(saved, { effectState: "submitted", recovery: void 0 });
          return { valid: true };
        }
        if (op === "_launchSettle" || op === "_launchFollowup") {
          const phase = launchPlans.get(params.phaseId);
          if (!phase) throw Error("Launch phase is stale or was already settled.");
          const operation = store.readOperation(phase.requestId);
          if (operation.nativeRequest.operationId !== phase.operationId) throw Error("Launch phase identity changed.");
          if (op === "_launchSettle") {
            launchPlans.delete(params.phaseId);
            let patch;
            try {
              if (params.error) throw Error(params.error);
              patch = { ...launchReceipt(params.result, operation), error: void 0 };
              if (["intent", "unknown"].includes(operation.recovery?.state) && !operation.recovery.incomplete) patch.recovery = void 0;
            } catch (error) {
              patch = { status: "unknown", error: error.message.slice(0, 1200) };
            }
            const saved = settled(operation, patch);
            return saved.status === "created" && store.isActiveOperation(saved) ? { ...plan(saved), receipt: publicOperation(saved) } : { receipt: publicOperation(saved) };
          }
          launchPlans.delete(params.phaseId);
          if (operation.status !== "created") throw Error("A verified created identity is required.");
          return publicOperation(settled(operation, { ...params.warning ? { warning: String(params.warning).slice(0, 1200) } : {}, ...params.observation ? { observation: params.observation } : {} }));
        }
        if (op === "_memberBinding") {
          if (Object.keys(params).some((key) => !["teamId", "memberId", "requestId"].includes(key))) throw Error("Invalid member selection.");
          const saved = store.readOperation(params.requestId);
          if (!saved || !store.isActiveOperation(saved) || saved.teamId !== params.teamId || saved.memberId !== params.memberId || saved.status !== "created") throw Error("A verified saved member binding is required.");
          if (verifiedScope(await workspaceRecord(saved.scope.workspaceId)).workspaceKey !== saved.scope.workspaceKey) throw Error("The saved member execution scope changed.");
          return saved;
        }
        if (op === "_capabilityScope") {
          const scope = params.teamId ? store.readScope(params.teamId) : selections.get(params.selectionToken);
          if (!scope) throw Error("Confirm a saved team or selected project before reading capabilities.");
          const observationId = randomUUID7();
          latestObservation.set(scope.workspaceKey, observationId);
          capabilities.delete(scope.workspaceKey);
          const verified = verifiedScope(await workspaceRecord(scope.workspaceId));
          if (verified.workspaceKey !== scope.workspaceKey) throw Error("The bound execution host changed.");
          if (latestObservation.get(scope.workspaceKey) !== observationId) throw Error("Host capability observation was superseded.");
          if (observations.size >= 128) observations.delete(observations.keys().next().value);
          observations.set(observationId, scope);
          return { observationId, scope };
        }
        if (op === "_capabilityResult") {
          const scope = observations.get(params.observationId);
          observations.delete(params.observationId);
          if (!scope || latestObservation.get(scope.workspaceKey) !== params.observationId || params.value?.workspaceKey !== scope.workspaceKey || params.value?.executionHostId !== scope.executionHostId) throw Error("Host capability observation is stale or does not match its scope.");
          capabilities.set(scope.workspaceKey, params.value);
          return params.value;
        }
        throw Error("Unknown internal observation phase.");
      }
      if (op === "reconnectWork") {
        if (polling || reconnecting) throw Error("A saved evidence check is still running. Wait briefly, then try reconnecting again.");
        reconnecting = true;
        try {
          const work = await works.reconnect(params);
          stopped = false;
          return { value: store.readSnapshot(), work };
        } finally {
          reconnecting = false;
          scheduleWork();
        }
      }
      if (op === "submitWork" || op === "checkWork" || op === "retryObjective") {
        if (op !== "checkWork") await reconcileExisting();
        if (op !== "submitWork" && (!params || Object.keys(params).some((key) => key !== "workId") || typeof params.workId !== "string")) throw Error("Choose a saved TeamWork.");
        const work = op === "submitWork" ? await works.submit(params) : op === "checkWork" ? await works.check(params.workId) : await works.retry(params.workId);
        await dispatches.check(work.id);
        await hierarchy.check(work.id);
        for (const context2 of store.listRunWorks(work.id)) await dispatches.check(context2.id);
        await questions.check(work.id);
        await staffing.check(work.id);
        await recovery.checkWork(work.id);
        await lifecycle.check(work.id).catch(() => {
        });
        stopped = false;
        scheduleWork();
        return { value: store.readSnapshot(), work };
      }
      if (op === "resolveRecoveryQuestion") return { value: await wake.resolveQuestion(params) };
      if (op === "requestReplacement") {
        await stops.reconcile();
        return { value: await wake.requestReplacement(params) };
      }
      if (op === "scheduleOrganization" || op === "cancelOrganization") {
        await consent();
        return { value: store[op](params) };
      }
      if (op === "wakeMember") {
        await stops.reconcile();
        return { value: await wake.wake(params) };
      }
      if (op === "checkWake") {
        await wake.check(params.requestId);
        return { value: await wake.bind(params.requestId) };
      }
      if (op === "decideWake") return { value: await wake.decide(params) };
      if (op === "checkHandoff") return { value: await wake.handoff(params.requestId) };
      if (op === "setAdmission") {
        await consent();
        await reconcileExisting();
        const value = store.setAdmission(params);
        stopped = false;
        scheduleWork();
        return { value };
      }
      if (op === "checkStop") {
        await stops.check(params.requestId);
        return { value: store.readSnapshot() };
      }
      if (op === "answerQuestion") {
        await reconcileExisting();
        return { value: await questions.answer(params) };
      }
      if (op === "enqueueGoal") {
        await consent();
        store.enqueueGoal(params);
        return { value: store.readSnapshot() };
      }
      if (op === "updateAgentPreferences") {
        const replay = store.replay(op, params);
        if (replay) return { value: replay };
        const scope = store.readScope(params.teamId);
        if (!params.inherit) {
          const issue = preferenceIssue(params, capabilities.get(scope.workspaceKey));
          if (issue) throw Error(issue);
        }
        return { value: store.updateAgentPreferences(params) };
      }
      if (op === "context") return context(workspaceId, params.teamId);
      if (op === "previewHistoryCleanup") return store.previewHistoryCleanup(params);
      if (op === "applyHistoryCleanup") return { cleanup: store.applyHistoryCleanup(params), value: store.readSnapshot() };
      if (op === "load") {
        await recovery.reconcile();
        await stops.reconcile();
        return { value: store.readSnapshot() };
      }
      if (op === "createTeam") {
        const previous = store.replay("createTeam", params);
        if (previous) return { value: previous };
        const selected = selections.get(params.selectionToken);
        if (!selected) throw new Error("Confirm the project and execution host again before saving.");
        const verified = verifiedScope(await workspaceRecord(selected.workspaceId));
        if (verified.workspaceKey !== selected.workspaceKey) throw new Error("The selected execution host changed. Confirm the project again.");
        for (let level = 0; level < 3; level++) {
          const issue = preferenceIssue({ agent: params.form.agents?.[level] ?? "codex", model: params.form.models?.[level], effort: params.form.efforts?.[level] }, capabilities.get(selected.workspaceKey));
          if (issue) throw Error(issue);
        }
        return { value: store.createTeam(params, selected) };
      }
      if (op === "updateRole") return { value: store.updateRole(params) };
      if (op === "updateSettings") return { value: store.updateSettings(params) };
      if (op === "receipt") return publicOperation(store.readOperation(params.requestId));
      throw new Error("Unknown team operation.");
    }
  };
}

// src/local/runtime-reconnect-store.mjs
import { createHash as createHash14 } from "node:crypto";
var digest3 = (value) => createHash14("sha256").update(JSON.stringify(canonical(value))).digest("hex");
var fail = (message) => {
  throw Error(message);
};
function runtimeReconnectStore({
  db,
  readPrivate,
  putPrivate,
  readWork,
  persistWork,
  readSnapshot,
  readOperation,
  readDispatchProtocol,
  atomic
}) {
  const all = () => db.prepare("SELECT id,json FROM receipts ORDER BY id").all().map((row) => ({ key: row.id, value: JSON.parse(row.json) }));
  function readControl(work) {
    const pointer = readPrivate(`runtime-control:${work.id}`);
    if (!pointer) return null;
    const row = readPrivate(`runtime-reconnect:${pointer.requestId}`);
    if (row && work.currentSupervisor && row.bindingRequestId !== work.binding.requestId)
      return null;
    if (!row || row.format !== "same-instance-runtime-control/v1" || row.workId !== work.id || row.bindingRequestId !== work.binding.requestId || row.scopeKey !== work.scope.workspaceKey || row.runId !== work.run.id || row.generation !== work.run.consumerGeneration || row.ownerDigest !== digest3(work.instance) || typeof row.runtimeId !== "string" || !row.runtimeId || !Array.isArray(row.members) || row.members.length === 0 || row.proofDigest !== digest3(row.proof))
      fail(
        "Saved runtime recovery evidence is damaged. Keep the existing sessions and reconnect the plugin."
      );
    return row;
  }
  function snapshot(input) {
    const work = readWork(input.workId), state = readSnapshot(), team = state.teams.find((t) => t.id === work?.teamId);
    if (!work || work.parent || work.currentSupervisor || work.recoveryRequestId || work.status === "completed" || work.run.state === "fenced" || work.scope.executionHostId !== "local" || work.binding.kind !== "terminal" || !work.run.id || !Number.isSafeInteger(work.run.consumerGeneration) || !work.instance)
      fail("Reconnect requires the original local terminal supervisor and its saved Run.");
    if (work.version !== input.expectedWorkVersion || state.revision !== input.expectedRevision)
      fail("Work or team changed. Reload before reconnecting the existing team.");
    if (!team || team.configVersion !== work.configVersion || readPrivate(`active-work:${team.id}`)?.workId !== work.id)
      fail("The active work or saved team configuration changed.");
    const protocol = readDispatchProtocol(work.id);
    if (work.input.state !== "accepted" || !work.nativeSend || protocol?.state !== "accepted" || protocol.generation !== work.run.consumerGeneration)
      fail("Objective or admission input is unresolved. Reconnect never resends it.");
    const operations = team.members.map((member) => {
      const pointer = readPrivate(`binding:${member.id}`), op = pointer && readOperation(pointer.requestId), original = work.recipientBindings?.find((r) => r.memberId === member.id);
      if (!op || !original || op.requestId !== original.requestId || op.status !== "created" || op.kind !== "terminal" || op.runtimeId !== work.binding.runtimeId || op.teamId !== team.id || op.configVersion !== work.configVersion || op.roleVersion !== member.roleVersion || op.scope?.workspaceKey !== work.scope.workspaceKey || (pointer.instanceGeneration ?? 1) !== (op.instanceGeneration ?? 1) || (original.instanceGeneration ?? 1) !== (op.instanceGeneration ?? 1) || op.nativeRequest.agent !== member.agent || (op.nativeRequest.sessionOptions?.model ?? "default") !== member.model || (op.nativeRequest.sessionOptions?.effort ?? "default") !== member.effort)
        fail("A prepared member changed or has unresolved launch evidence.");
      if (["handle", "paneKey", "kind", "runtimeId", "roleVersion", "configVersion"].some(
        (key) => op[key] !== original[key]
      ) || digest3(op.nativeRequest) !== digest3(original.nativeRequest) || ["ptyId", "incarnationId", "processIncarnation"].some(
        (key) => op.observation?.[key] !== original.observation?.[key]
      ))
        fail("The original prepared recipient identity changed.");
      if (!op.observation?.ptyId || !op.observation?.incarnationId || op.observation.processIncarnation !== `${op.observation.ptyId}:${op.observation.incarnationId}` || !op.paneKey || /placeholder/.test(op.paneKey))
        fail("A prepared member lacks exact original process and pane evidence.");
      return op;
    });
    if (operations.find((o) => o.memberId === work.supervisorMemberId)?.requestId !== work.binding.requestId)
      fail("The original supervisor binding changed.");
    if (new Set(operations.map((o) => o.handle)).size !== operations.length || new Set(operations.map((o) => o.paneKey)).size !== operations.length)
      fail("Prepared member identities overlap.");
    const members = new Set(team.members.map((m) => m.id)), records = all();
    for (const { key, value: r } of records) {
      const sameWork = r.workId === work.id || r.teamWorkId === work.id;
      const deliveredSessionGuide = key.startsWith("question-event:") && r.kind === "TEAM_SESSION_DECISIONS" && r.state === "accepted" && r.data?.workId === work.id;
      if (sameWork && !deliveredSessionGuide && /^(dispatch:|dispatch-queue:|question:|question-answer:|question-event:|collaboration:|staffing-proposal:|roster-delta:|configuration-amendment:|delivery:|native-run-binding:|intent-withdrawal:)/.test(
        key
      ))
        fail("Reconnect requires a quiet Run with no Task, question, staffing or delivery work.");
      if (key.startsWith("stop:") && members.has(r.target?.memberId) && ["intent", "submitted", "unknown"].includes(r.state))
        fail("An unresolved Stop prevents reconnecting.");
      if (key.startsWith("wake:") && members.has(r.memberId) && !["bound", "resumed"].includes(r.state))
        fail("An unresolved member recovery prevents reconnecting.");
      if (key.startsWith("organization:") && r.teamId === team.id && r.state === "pending")
        fail("A pending organization change prevents reconnecting.");
      if (key.startsWith("operation:") && r.teamId === team.id && r.status === "unknown")
        fail("An unresolved launch prevents reconnecting.");
      if (sameWork && ["sending", "unknown", "queued"].includes(r.input?.state))
        fail("A pending or unknown input prevents reconnecting.");
    }
    const checkpoint = {
      work,
      team,
      revision: state.revision,
      operations,
      protocol,
      control: readControl(work),
      records: records.filter(
        ({ value: r }) => r.workId === work.id || r.teamWorkId === work.id || r.teamId === team.id || members.has(r.memberId) || members.has(r.target?.memberId)
      )
    };
    return { ...checkpoint, digest: digest3(checkpoint) };
  }
  return {
    readRuntimeControl: readControl,
    runtimeReconnectSnapshot: snapshot,
    replayRuntimeReconnect(input) {
      const row = readPrivate(`runtime-reconnect:${input.requestId}`);
      if (!row) return null;
      if (row.inputDigest !== digest3(input))
        fail("Reconnect request identity conflicts with another input.");
      return row;
    },
    commitRuntimeReconnect(input, expected, proof) {
      return atomic(() => {
        const prior = readPrivate(`runtime-reconnect:${input.requestId}`);
        if (prior) {
          if (prior.inputDigest !== digest3(input))
            fail("Reconnect request identity conflicts with another input.");
          return prior;
        }
        const current = snapshot(input);
        if (current.digest !== expected.digest)
          fail("Team evidence changed during reconnect. No control binding was changed.");
        const work = current.work, previous = current.control;
        if (previous?.runtimeId === proof.runtimeId)
          fail("These sessions are already connected to this Orca runtime.");
        const row = {
          format: "same-instance-runtime-control/v1",
          requestId: input.requestId,
          inputDigest: digest3(input),
          workId: work.id,
          teamId: work.teamId,
          bindingRequestId: work.binding.requestId,
          scopeKey: work.scope.workspaceKey,
          runId: work.run.id,
          generation: work.run.consumerGeneration,
          ownerDigest: digest3(work.instance),
          fromRuntimeId: previous?.runtimeId ?? work.binding.runtimeId,
          runtimeId: proof.runtimeId,
          previousRequestId: previous?.requestId ?? null,
          members: current.operations.map((o) => ({
            requestId: o.requestId,
            memberId: o.memberId,
            instanceGeneration: o.instanceGeneration ?? 1
          })),
          proof,
          proofDigest: digest3(proof),
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        putPrivate(`runtime-reconnect:${input.requestId}`, row);
        putPrivate(`runtime-control:${work.id}`, { requestId: input.requestId, workId: work.id });
        persistWork({
          ...work,
          version: work.version + 1,
          status: "active",
          run: {
            ...work.run,
            state: "verified",
            detail: "The original Run and all prepared sessions were rechecked after Orca restarted."
          },
          snapshot: { tasks: [], stale: false, observedAt: row.createdAt },
          error: void 0
        });
        return row;
      });
    }
  };
}

// src/local/native-history-store.mjs
function nativeHistoryReader({ db, readPrivate, readWork, questions }) {
  const rows = (prefix) => db.prepare("SELECT json FROM receipts WHERE id LIKE ? ORDER BY rowid").all(prefix + "%").map((r) => JSON.parse(r.json));
  return (workId) => {
    const work = readWork(workId), history = work?.supervisorHistory ?? [], authorities = [], controls = [];
    for (const protocol of rows(`dispatch-protocol-history:${workId}:`)) for (const [epoch, previous] of history.entries()) {
      const owner = previous.instance, send = protocol.nativeSend;
      if (protocol.workId !== workId || previous.run.id !== work.run.id || previous.run.consumerGeneration !== protocol.generation || !owner) continue;
      if (owner.kind === "structured" ? send?.method !== "agentSession.send" || send.params.envelope.sessionId !== previous.binding.sessionId || send.params.envelope.expectedRuntimeFence !== owner.fence : send?.method !== "terminal.send" || send.params.terminal !== previous.binding.handle) continue;
      const recovery = readPrivate(`wake:${previous.recoveryRequestId}`);
      const recoveryVerified = recovery?.state === "bound" && recovery.memberId === work.supervisorMemberId && recovery.oldBinding.requestId === previous.binding.requestId && recovery.newInstance?.workId === workId && recovery.newInstance.runId === work.run.id;
      authorities.push({ epoch, protocol, owner, recoveryVerified });
    }
    for (const q of questions.listQuestions(workId)) {
      const epoch = q.epoch ?? 0, r = q.resolution, wake = r && readPrivate(`wake:${r.recoveryRequestId}`), recovered = history.findIndex((h) => h.recoveryRequestId === r?.recoveryRequestId);
      const resolved = q.status === "closed" && r?.kind === "superseded-by-recovery" && r.by === "user" && r.note?.trim() && Number.isSafeInteger(epoch) && epoch >= 0 && epoch < (work.epoch ?? 0) && recovered >= epoch && wake?.state === "bound" && wake.memberId === work.supervisorMemberId && wake.newInstance?.workId === workId;
      const answered = q.status === "answered" && (q.answers.length ? q.answers.every((a) => questionAnswerResolved(q, a)) : Boolean(q.nativeQuestion?.answer));
      if (resolved || answered) {
        if (q.resolution?.sessionDecision) controls.push({ kind: "session-resolution", record: { proof: q.resolution.sessionDecision } });
        for (const a of q.answers.filter((a2) => a2.processed === "confirmed" && a2.sessionDecision)) controls.push({ kind: "session-answer", record: { proof: a.sessionDecision } });
        controls.push({ kind: "question", record: q, epoch });
        for (const a of q.answers.filter((a2) => a2.processed === "confirmed" && a2.acknowledgement)) controls.push({ kind: "answer-ack", record: q, answer: a });
      }
    }
    for (const r of rows("staffing-request:").filter((r2) => r2.result?.workId === workId && r2.sessionDecision)) controls.push({ kind: "staffing-decision", record: { proof: r.sessionDecision } });
    for (const e of rows("question-event:").filter((e2) => e2.workId === workId && e2.kind === "TEAM_SESSION_DECISION_RESULT" && e2.data?.status === "rejected" && e2.data.proof)) controls.push({ kind: e.data.proof.spec.kind, record: { proof: e.data.proof } });
    for (const d of rows("delivery:").filter((d2) => d2.workId === workId && ["superseded", "changes_requested", "accepted"].includes(d2.status))) controls.push({ kind: "delivery", record: d, epoch: d.epoch ?? 0 });
    for (const p of rows("staffing-proposal:").filter((p2) => p2.contextId === workId && ["approved", "rejected"].includes(p2.status) && p2.decision?.from === "user")) controls.push({ kind: "staffing-proposal", record: p });
    for (const d of rows("roster-delta:").filter((d2) => d2.contextId === workId && d2.processed === "confirmed" && d2.acknowledgement)) controls.push({ kind: "roster-ack", record: d });
    for (const c of rows("collaboration:").filter((c2) => c2.workId === workId)) controls.push({ kind: "collaboration-directive", record: c });
    for (const m of rows("team-message:").filter((m2) => m2.workId === workId && m2.controlProof)) controls.push({ kind: "message-evidence", record: m });
    for (const w of rows("wake:").filter((w2) => w2.state === "bound" && w2.handoff?.workId === workId && w2.handoff.nativeTaskId)) controls.push({ kind: "recovery-handoff", record: w.handoff });
    const withdrawals = rows("intent-withdrawal:").filter((row) => row.workId === workId);
    const withdrawalContexts = withdrawals.map((row) => {
      let original, result;
      try {
        original = JSON.parse(row.originalSpec);
        result = JSON.parse(row.result);
      } catch {
        return { nativeTaskId: row.nativeTaskId };
      }
      const team = Number.isSafeInteger(original.configVersion) ? JSON.parse(db.prepare("SELECT json FROM team_versions WHERE team_id=? AND version=?").get(work.teamId, original.configVersion)?.json ?? "null") : null;
      return { nativeTaskId: row.nativeTaskId, epoch: row.epoch, team, authorities: authorities.filter((a) => a.recoveryVerified && a.epoch === row.epoch && a.protocol.token === result.token && a.protocol.generation === row.generation) };
    });
    return { authorities, controls, withdrawals, withdrawalContexts };
  };
}

// src/local/staffing-fingerprint.mjs
import { createHash as createHash15 } from "node:crypto";
var canonical5 = (v) => Array.isArray(v) ? v.map(canonical5) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== void 0).map((k) => [k, canonical5(v[k])])) : v;
var staffingFingerprint = (v) => createHash15("sha256").update(JSON.stringify(canonical5(v))).digest("hex");

// src/local/staffing-expiry.mjs
function staffingExpiryProof(proposal, read) {
  const work = read(`work:${proposal.workId}`), delivery = work && read(`delivery:${work.id}:${work.handoff?.deliveryId}`), spec = proposal.proof?.spec;
  if (!work || work.status !== "completed" || !work.closedAt || work.teamId !== proposal.teamId || !delivery || delivery.status !== "accepted" || delivery.workId !== work.id || delivery.id !== work.handoff?.deliveryId || !delivery.proof?.requestId || !delivery.proof?.payloadHash) return null;
  if (!spec || spec.protocol !== "team-questions/v1" || spec.kind !== "staffing-proposal" || spec.workId !== proposal.contextId || spec.appQuestionId !== proposal.id || spec.proposingManagerId !== proposal.proposingManagerId || spec.configVersion !== proposal.configVersion || spec.generation !== proposal.generation || !proposal.proof.requestId || !proposal.proof.nativeTaskId || !proposal.proof.payloadHash || proposal.fingerprint !== staffingFingerprint(proposal.proof) || !proposal.createdAt || proposal.createdAt > work.closedAt) return null;
  const context = read(`${proposal.contextId === work.id ? "work" : "native-run-binding"}:${proposal.contextId}`);
  if (!context || (context.teamWorkId ?? context.id) !== work.id || context.teamId !== work.teamId) return null;
  const expiry = proposal.expiry;
  if (!expiry || expiry.kind !== "accepted-work-closure" || expiry.workId !== work.id || expiry.deliveryId !== delivery.id || expiry.recordedAt !== work.closedAt) return null;
  const decision = read(`work-decision:${expiry.decisionRequestId}`);
  if (!decision || decision.requestId !== expiry.decisionRequestId || decision.workId !== work.id || decision.deliveryId !== delivery.id || decision.decision !== "accept" || decision.recordedAt !== work.closedAt || decision.input?.state !== "none" || !decision.fingerprint) return null;
  return { kind: "accepted-work-closure", workId: work.id, deliveryId: delivery.id, decisionRequestId: decision.requestId, recordedAt: decision.recordedAt };
}

// src/local/history-cleanup.mjs
import { randomUUID as randomUUID8, createHash as createHash16 } from "node:crypto";
var CLEARED = "[History manually cleared]";
var hash4 = (v) => createHash16("sha256").update(JSON.stringify(v)).digest("hex");
var family = (id2) => id2.split(":")[0];
var known = /* @__PURE__ */ new Set(["runtime-control", "runtime-reconnect", "work", "native-run-binding", "work-request", "active-work", "session-work", "operation", "binding", "binding-generation", "launch", "dispatch", "dispatch-intent", "intent-withdrawal", "dispatch-member", "dispatch-binding", "dispatch-review", "dispatch-protocol", "dispatch-protocol-history", "dispatch-queue", "question", "question-answer", "question-event", "team-message", "collaboration", "delivery", "work-decision", "goal", "goal-request", "next-goal", "stop", "stop-recovery", "wake", "wake-member", "staffing-request", "staffing-proposal", "configuration-amendment", "work-configuration", "roster-delta", "organization"]);
var contains = (value, ids) => typeof value === "string" ? ids.has(value) || [...ids].some((id2) => id2.length >= 32 && value.includes(id2)) : Array.isArray(value) ? value.some((v) => contains(v, ids)) : value && typeof value === "object" ? Object.values(value).some((v) => contains(v, ids)) : false;
var uncertain = (value) => value && typeof value === "object" && Object.entries(value).some(([key, v]) => ["state", "status", "processed"].includes(key) && ["unknown", "sending", "submitted", "needs_decision", "pending", "unconfirmed"].includes(v) || typeof v === "object" && !["processing", "run", "snapshot", "proof", "controlProof", "nativeSend", "nativeRequest", "binding", "oldBinding", "observation"].includes(key) && uncertain(v));
function settledStopRecovery(row, byId) {
  const audit = row.value, previous = audit.previous, current = byId.get(`stop:${audit.stopRequestId}`)?.value;
  if (audit.requestId !== row.id.slice("stop-recovery:".length) || !previous || previous.state !== "unknown" || previous.requestId !== audit.stopRequestId || previous.plan?.method !== "orchestration.workerStop" || !current || current.requestId !== audit.stopRequestId || current.state !== "stopped") return false;
  if (typeof previous.nativeRequestId !== "string" || !previous.nativeRequestId || typeof previous.target?.dispatchId !== "string" || !previous.target.dispatchId || previous.plan.params?.dispatch !== previous.target.dispatchId || previous.plan.envelope?.orchestrationRequestId !== previous.nativeRequestId || typeof current.confirmedAt !== "string" || !current.confirmedAt || !Number.isSafeInteger(previous.version) || !Number.isSafeInteger(current.version) || current.version <= previous.version) return false;
  if (current.nativeRequestId !== previous.nativeRequestId || !sameStopIdentity(current.target, previous.target) || !sameStopIdentity(current.plan, previous.plan)) return false;
  return current.proof?.kind === "native-pty-exit" && current.proof.ptyKilled === true || current.proof?.kind === "native-worker-exit" && current.proof.dispatchId === current.target.dispatchId;
}
function settledStaffingNotification(row, byId) {
  const event = row.value;
  if (event.kind !== "decision" || event.state !== "unconfirmed" || event.nativeSend || typeof event.id !== "string" || !event.id.startsWith("staffing-")) return false;
  const proposal = byId.get(`staffing-proposal:${event.workId}:${event.id.slice("staffing-".length)}`)?.value;
  return proposal?.status === "expired" && event.data?.body === proposal.rationale && !!staffingExpiryProof(proposal, (key) => byId.get(key)?.value);
}
function settledRecipientIntents(work, byId, settledHistory) {
  if (work.status !== "completed" || !work.closedAt || !Array.isArray(work.currentRecipientBindings)) return work;
  const delivery = byId.get(`delivery:${work.id}:${work.handoff?.deliveryId}`)?.value;
  const accepted2 = delivery?.status === "accepted" && delivery.workId === work.id && [...byId.values()].some((r) => family(r.id) === "work-decision" && r.value.workId === work.id && r.value.deliveryId === delivery.id && r.value.decision === "accept" && r.value.recordedAt === work.closedAt && r.value.input?.state === "none" && r.value.fingerprint);
  if (!accepted2) return work;
  const keys = ["requestId", "memberId", "teamId", "instanceGeneration", "configVersion", "roleVersion", "nativeRequest", "scope", "replaces", "resumedFrom", "wakeRequestId", "createdAt", "runtimeId", "executionHostId", "hostGeneration"];
  function prove(recipient, seen = /* @__PURE__ */ new Set()) {
    if (seen.has(recipient.requestId)) return null;
    seen.add(recipient.requestId);
    const op = byId.get(`operation:${recipient.requestId}`)?.value, wake = byId.get(`wake:${recipient.wakeRequestId}`)?.value;
    if (recipient.format !== void 0 || op?.format !== void 0 || wake?.format !== void 0 || wake?.oldBinding?.format !== void 0) return null;
    if (!Number.isSafeInteger(recipient.version) || !Number.isSafeInteger(recipient.instanceGeneration) || recipient.instanceGeneration < 2 || (!recipient.nativeRequest || !recipient.resumedFrom && !recipient.nativeRequest.operationId) || recipient.teamId !== work.teamId || !op || op.status !== "created" || op.public?.status !== "created" || !Number.isSafeInteger(op.version) || op.version < recipient.version || hash4(keys.map((k) => recipient[k])) !== hash4(keys.map((k) => op[k]))) return null;
    if (recipient.status === "unknown" && (recipient.version !== 1 || recipient.effectState !== "intent" || recipient.public?.status !== "unknown" || op.version <= recipient.version) || !["unknown", "created"].includes(recipient.status)) return null;
    if (!wake || wake.requestId !== recipient.wakeRequestId || !["bound", "resumed"].includes(wake.state) || uncertain(wake) || wake.teamId !== work.teamId || wake.memberId !== recipient.memberId || wake.newInstance?.requestId !== recipient.requestId || wake.newInstance.instanceGeneration !== recipient.instanceGeneration || (wake.oldBinding?.instanceGeneration ?? 1) + 1 !== recipient.instanceGeneration) return null;
    if (recipient.resumedFrom) {
      const death = wake.proof?.death, fence = wake.newInstance.fence;
      if (recipient.status !== "created" || recipient.public?.status !== "created" || recipient.requestId !== `wake-${wake.requestId}` || wake.oldBinding?.requestId !== recipient.resumedFrom || op.kind !== "structured" || wake.oldBinding.kind !== "structured" || wake.oldBinding.status !== "created" || op.runtimeId !== wake.proof?.runtimeId || !["exit-observed", "pid-absent", "identity-mismatch"].includes(death?.kind) || !Number.isSafeInteger(death.ownerFence) || death.ownerFence < 1 || !Number.isSafeInteger(death.observedAt) || death.provider !== op.nativeRequest.agent || !Number.isSafeInteger(fence) || fence <= death.ownerFence || op.observation?.ownerFence !== fence) return null;
      const resumedKeys = ["nativeRequest", "scope", "teamId", "memberId", "kind", "handle", "sessionId"];
      if (hash4(resumedKeys.map((k) => op[k])) !== hash4(resumedKeys.map((k) => wake.oldBinding[k]))) return null;
    } else if (wake.state !== "bound" || wake.handoff?.decision !== "replace" || wake.oldBinding?.requestId !== recipient.replaces) return null;
    if (["requestId", "memberId", "teamId", "instanceGeneration", "configVersion", "roleVersion"].some((k) => recipient.public?.[k] !== recipient[k])) return null;
    if (!op.handle || !(op.kind === "terminal" && op.paneKey || op.kind === "structured" && op.sessionId)) return null;
    for (const id2 of [wake.oldBinding.sourceWorkId, wake.newInstance.workId].filter(Boolean)) {
      const context = byId.get(`work:${id2}`)?.value ?? byId.get(`native-run-binding:${id2}`)?.value;
      if (!context || (context.teamWorkId ?? context.id) !== work.id) return null;
    }
    const prior = wake.oldBinding.wakeRequestId ? prove(wake.oldBinding, seen) : [];
    if (!prior) return null;
    return [...prior, `wake:${recipient.wakeRequestId}`, `operation:${recipient.requestId}`];
  }
  const currentRecipientBindings = work.currentRecipientBindings.map((recipient) => {
    if (recipient.status !== "unknown" || recipient.public?.status !== "unknown") return recipient;
    const history = prove(recipient);
    if (!history) return recipient;
    for (const id2 of history) settledHistory.add(id2);
    return { ...recipient, status: void 0, public: { ...recipient.public, status: void 0 } };
  });
  return { ...work, currentRecipientBindings };
}
function supersededDeliveryHistory(work, byId) {
  const prefix = `delivery:${work.id}:`, rows = [...byId.values()].filter((r) => family(r.id) === "delivery" && (r.value.workId === work.id || r.id.startsWith(prefix))), current = byId.get(prefix + work.handoff?.deliveryId)?.value;
  const result = { obsolete: /* @__PURE__ */ new Set(), ancestors: /* @__PURE__ */ new Set(), invalid: false };
  if (rows.length < 2 && !current?.previousDeliveryId && !(current?.revision > 1)) return result;
  const invalid = () => ({ ...result, invalid: true });
  if (work.status !== "completed" || !work.closedAt || !current || current.status !== "accepted" || current.format !== void 0 || current.workId !== work.id || current.epoch !== (work.currentSupervisor?.epoch ?? work.epoch ?? 0) || current.generation !== (work.currentSupervisor?.run ?? work.run).consumerGeneration) return invalid();
  const accepted2 = [...byId.values()].some((r) => r.id === `work-decision:${r.value.requestId}` && r.value.format === void 0 && r.value.workId === work.id && r.value.deliveryId === current.id && r.value.decision === "accept" && r.value.recordedAt === work.closedAt && r.value.input?.state === "none" && /^[a-f0-9]{64}$/.test(r.value.fingerprint ?? ""));
  if (!accepted2) return invalid();
  let row = current, child = null;
  while (row) {
    const key = prefix + row.id;
    if (result.ancestors.has(key) || byId.get(key)?.value !== row || row.format !== void 0 || row.workId !== work.id || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isSafeInteger(row.epoch) || row.epoch < 0 || !Number.isSafeInteger(row.generation) || row.generation < 1 || !row.supervisorMemberId || !row.protocolToken || !row.proof?.requestId || !/^[a-f0-9]{64}$/.test(row.proof.payloadHash ?? "") || !Number.isFinite(Date.parse(row.createdAt)) || row.createdAt > work.closedAt) return invalid();
    if (child && (row.revision !== child.revision - 1 || row.epoch > child.epoch || row.generation > child.generation || row.createdAt > child.createdAt || row.supervisorMemberId !== child.supervisorMemberId || row.epoch === child.epoch && (row.protocolToken !== child.protocolToken || row.generation !== child.generation) || !["pending", "changes_requested", "superseded"].includes(row.status))) return invalid();
    result.ancestors.add(key);
    if (child && row.status === "pending") result.obsolete.add(key);
    if (row.previousDeliveryId == null) {
      if (row.revision !== 1) return invalid();
      break;
    }
    if (typeof row.previousDeliveryId !== "string" || !row.previousDeliveryId) return invalid();
    child = row;
    row = byId.get(prefix + row.previousDeliveryId)?.value;
    if (!row) return invalid();
  }
  if (rows.length !== result.ancestors.size) return invalid();
  return result;
}
function historyCleanup({ db, readSnapshot, write, atomic }) {
  const previews = /* @__PURE__ */ new Map();
  function plan(ids) {
    const rows = db.prepare("SELECT id,json FROM receipts ORDER BY id").all().map((r) => ({ ...r, value: JSON.parse(r.json) })), byId = new Map(rows.map((r) => [r.id, r]));
    const eligibleWorkIds = [], retained = [], changes = [], graph = /* @__PURE__ */ new Map(), teamIds = /* @__PURE__ */ new Set();
    const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const knownTables = /* @__PURE__ */ new Set(["metadata", "snapshot", "scopes", "team_versions", "role_versions", "requests", "receipts", "maintenance"]);
    const columns2 = { metadata: ["format"], snapshot: ["id", "json"], scopes: ["team_id", "json"], team_versions: ["team_id", "version", "json"], role_versions: ["member_id", "version", "json"], requests: ["id", "fingerprint", "result"], receipts: ["id", "json"], maintenance: ["id", "json"] };
    const unknownSchema = schema.some((row) => row.type === "table" && !knownTables.has(row.name)) || Object.entries(columns2).some(([table, expected]) => JSON.stringify(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)) !== JSON.stringify(expected));
    for (const id2 of ids) {
      const work = byId.get(`work:${id2}`)?.value;
      if (!work || work.status !== "completed" || !work.closedAt) {
        retained.push({ workId: id2, reason: "Only closed work explicitly accepted by you is eligible." });
        continue;
      }
      if (work.historyPruned) {
        retained.push({ workId: id2, reason: "This work was already cleaned; its closure and identity evidence remain." });
        continue;
      }
      teamIds.add(work.teamId);
      const contexts = /* @__PURE__ */ new Set([id2, ...rows.filter((r) => family(r.id) === "native-run-binding" && r.value.teamWorkId === id2).map((r) => r.value.id)]);
      const own = (r) => contexts.has(r.value.workId) || contexts.has(r.value.teamWorkId) || contexts.has(r.value.target?.workId) || family(r.id) === "stop-recovery" && contexts.has(r.value.previous?.target?.workId) || family(r.id) === "wake" && contexts.has(r.value.newInstance?.workId) || contexts.has(r.value.id) && ["work", "native-run-binding"].includes(family(r.id));
      const members = rows.filter(own), identities = /* @__PURE__ */ new Set([...contexts, ...members.flatMap((r) => [r.value.id, r.value.attemptId, r.value.dispatchId, r.value.nativeTaskId, r.value.evidenceId, r.value.binding?.requestId, r.value.currentSupervisor?.binding?.requestId, ...(r.value.recipientBindings ?? []).map((b) => b.requestId), ...(r.value.currentRecipientBindings ?? []).map((b) => b.requestId)]).filter((v) => typeof v === "string")]);
      let reason = unknownSchema ? "An unknown storage table or column may reference this history; use a compatible cleanup implementation." : void 0;
      for (const r of rows) if (own(r) || contains(r.value, identities)) graph.set(r.id, r.json);
      const settledHistory = /* @__PURE__ */ new Set(), workUncertainty = settledRecipientIntents(work, byId, settledHistory);
      for (const id3 of settledHistory) graph.set(id3, byId.get(id3).json);
      const deliveryHistory = supersededDeliveryHistory(work, byId);
      for (const id3 of deliveryHistory.ancestors) graph.set(id3, byId.get(id3).json);
      if (deliveryHistory.invalid) reason = "Delivery revision history is incomplete or unverified.";
      if (!members.some((r) => family(r.id) === "work-decision" && r.value.workId === id2 && r.value.decision === "accept" && r.value.deliveryId === work.handoff?.deliveryId)) reason = "User acceptance provenance is missing.";
      for (const r of rows) {
        const k = family(r.id), v = r.value, related = own(r), sameTeam = v.teamId === work.teamId || v.target?.teamId === work.teamId || k === "stop-recovery" && v.previous?.target?.teamId === work.teamId;
        const uncertainty = k === "work" && v.id === work.id ? workUncertainty : k === "delivery" && !deliveryHistory.invalid && deliveryHistory.obsolete.has(r.id) ? { ...v, status: void 0 } : k === "stop-recovery" && settledStopRecovery(r, byId) ? { ...v, previous: void 0 } : k === "question-event" && settledStaffingNotification(r, byId) ? { ...v, state: void 0 } : k === "question-event" && ["TEAM_SESSION_DECISIONS", "TEAM_SESSION_QUESTION", "TEAM_STAFFING_PROPOSAL", "TEAM_SESSION_DECISION_RESULT"].includes(v.kind) ? { state: v.state } : v;
        if (!known.has(k) && (contains(v, identities) || sameTeam)) reason = "An unknown record references this history; preserve it for a compatible plugin.";
        if (related && (v.format && /-(v[0-9]+)$/.test(v.format) && !v.format.endsWith("-v1") || !(k === "question-event" && v.kind === "goal-delivery" && !v.nativeSend) && uncertain(uncertainty))) reason = "Unknown, pending or unprocessed evidence remains in this work.";
        if (related && k === "native-run-binding" && (v.status !== "completed" || v.currentSupervisor && v.currentSupervisor.status !== "completed")) reason = "A descendant manager context remains active.";
        if (related && k === "dispatch" && !["accepted", "rework", "rejected"].includes(v.status)) reason = "A task is running or still requires supervisor acceptance.";
        if (sameTeam && k === "goal" && ["queued", "reserved"].includes(v.status)) reason = "A later goal awaits its Work transition.";
        if (related && k === "dispatch-queue") reason = "Queued task admission remains.";
        if (related && k === "staffing-proposal" && !(["approved", "rejected"].includes(v.status) || v.status === "expired" && staffingExpiryProof(v, (key) => byId.get(key)?.value))) reason = "A staffing proposal needs a decision.";
        if (related && k === "roster-delta" && !(v.state === "queued" && !v.nativeSend || v.processed === "confirmed")) reason = "A roster update awaits confirmed processing.";
        if (sameTeam && k === "organization" && v.state === "pending") reason = "An organization change awaits its Work boundary.";
        if (sameTeam && k === "wake" && !["bound", "resumed"].includes(v.state)) reason = "Member recovery or replacement remains unresolved.";
        if (sameTeam && k === "stop" && ["intent", "submitted", "unknown"].includes(v.state)) reason = "A stop outcome remains unresolved.";
        if (sameTeam && k === "operation" && v.status !== "created") reason = "An original native operation remains unknown.";
        if (k === "active-work" && contexts.has(v.workId)) reason = "This work is still actively reserved.";
        if (!related && !settledHistory.has(r.id) && contains(v, identities) && !(k === "operation" && identities.has(v.requestId) && v.status === "created") && !["work-request", "session-work", "goal-request", "question-answer", "dispatch-intent", "dispatch-review", "staffing-request"].includes(k)) reason = "A surviving record depends on this history (including later goals or another Work).";
      }
      if (reason) {
        retained.push({ workId: id2, reason });
        continue;
      }
      eligibleWorkIds.push(id2);
      const associated = rows.filter((r) => own(r) || family(r.id) === "dispatch-review" && identities.has(r.id.slice("dispatch-review:".length)));
      for (const r of associated) {
        const v = structuredClone(r.value), k = family(r.id), fields2 = [];
        const clear = (obj, key, path = key) => {
          if (obj && typeof obj[key] === "string" && obj[key] !== CLEARED) {
            obj[key] = CLEARED;
            fields2.push(path);
          }
        };
        if (["work", "native-run-binding"].includes(k)) {
          clear(v.handoff, "summary", "handoff.summary");
          for (const [snapshot2, path] of [[v.snapshot, "snapshot"], [v.currentSupervisor?.snapshot, "currentSupervisor.snapshot"]]) for (const [i, task] of (snapshot2?.tasks ?? []).entries()) {
            clear(task, "result", `${path}.tasks[${i}].result`);
            clear(task, "summary", `${path}.tasks[${i}].summary`);
          }
          v.historyPruned = { at: "$commit", kind: "summary-results", workId: id2 };
          fields2.push("historyPruned");
        }
        if (k === "delivery") clear(v, "summary");
        if (k === "dispatch") {
          clear(v, "result");
          clear(v.review, "summary", "review.summary");
          clear(v, "detail");
        }
        if (k === "dispatch-review") clear(v, "summary");
        if (fields2.length) changes.push({ id: r.id, workId: id2, fields: fields2, value: v, beforeHash: hash4(r.json), logicalBytes: Buffer.byteLength(r.json) });
      }
    }
    const requestRows = db.prepare("SELECT id,fingerprint,result FROM requests ORDER BY id").all();
    const snapshots = requestRows.filter((r) => {
      const v = JSON.parse(r.result);
      return v?.format === "orca-team-store" && v.version === 2 && Array.isArray(v.works) && v.works.some((w) => eligibleWorkIds.includes(w.id));
    }).map((r) => r.id);
    const snapshot = JSON.parse(db.prepare("SELECT json FROM snapshot WHERE id=1").get().json);
    const teams = snapshot.teams.filter((t) => teamIds.has(t.id)).map((t) => ({ id: t.id, configVersion: t.configVersion, scope: t.scope, members: t.members.map((m) => ({ id: m.id, boss: m.boss, roleVersion: m.roleVersion })) }));
    const storageRevision = hash4({ schema, userVersion: db.prepare("PRAGMA user_version").get().user_version, teams, selectedWorkIds: ids, eligibleWorkIds, retained, graph: [...graph].sort(([a], [b]) => a.localeCompare(b)), snapshots: requestRows.filter((r) => snapshots.includes(r.id)) });
    return { selectedWorkIds: ids, eligibleWorkIds, retained, changes, snapshots, storageRevision };
  }
  return {
    previewHistoryCleanup(input) {
      if (!input || Object.keys(input).some((k) => k !== "selectedWorkIds") || !Array.isArray(input.selectedWorkIds) || input.selectedWorkIds.length < 1 || input.selectedWorkIds.length > 100 || input.selectedWorkIds.some((id2) => typeof id2 !== "string" || !/^[a-zA-Z0-9-]{1,120}$/.test(id2))) throw Error("Select 1\u2013100 saved Work histories.");
      return atomic(() => {
        const ids = [...new Set(input.selectedWorkIds)].sort(), p = plan(ids), previewToken = randomUUID8(), storageRevision = p.storageRevision, expiresAt = Date.now() + 3e5;
        if (previews.size >= 64) previews.delete(previews.keys().next().value);
        previews.set(previewToken, { ...p, storageRevision, expiresAt });
        return { previewToken, storageRevision, expiresAt, selectedWorkIds: ids, eligibleWorkIds: p.eligibleWorkIds, retained: p.retained, changes: p.changes.map(({ id: id2, workId, fields: fields2, logicalBytes }) => ({ recordId: id2, workId, fields: fields2, logicalBytes })), snapshotCount: p.snapshots.length, logicalBytes: p.changes.reduce((n, r) => n + r.logicalBytes, 0), notice: "Clears displayed delivery summaries, task results, review summaries and cached public snapshots. Keeps objectives, native request/proof bodies (which may contain copies), questions, notification evidence, closure decisions, identities, replay barriers, configuration and role versions. Migration backups may still contain history. Project files, login data, native sessions and provider conversations are outside this cleanup. No secure erasure or immediate file shrink is promised." };
      });
    },
    applyHistoryCleanup(input) {
      return atomic(() => {
        if (!input || Object.keys(input).some((k) => !["requestId", "previewToken", "expectedStorageRevision"].includes(k)) || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || typeof input.previewToken !== "string" || typeof input.expectedStorageRevision !== "string") throw Error("Invalid cleanup request.");
        const key = `cleanup:${input.requestId}`, fingerprint2 = hash4({ requestId: input.requestId, previewToken: input.previewToken, expectedStorageRevision: input.expectedStorageRevision }), prior = db.prepare("SELECT json FROM maintenance WHERE id=?").get(key);
        if (prior) {
          const p2 = JSON.parse(prior.json);
          if (p2.fingerprint !== fingerprint2) throw Error("Cleanup request identity conflicts.");
          return p2.result;
        }
        const p = previews.get(input.previewToken);
        if (!p || p.expiresAt < Date.now()) throw Error("Cleanup preview expired or worker restarted; preview again.");
        if (p.storageRevision !== input.expectedStorageRevision || plan(p.selectedWorkIds).storageRevision !== p.storageRevision) throw Error("Storage changed since preview; preview again before cleaning.");
        if (!p.eligibleWorkIds.length) throw Error("No selected history is eligible for cleanup.");
        const at = (/* @__PURE__ */ new Date()).toISOString();
        for (const row of p.changes) {
          if (row.value.historyPruned) row.value.historyPruned.at = at;
          db.prepare("UPDATE receipts SET json=? WHERE id=?").run(JSON.stringify(row.value), row.id);
        }
        for (const id2 of p.snapshots) db.prepare("UPDATE requests SET result=? WHERE id=?").run(JSON.stringify({ format: "history-pruned-replay-v1", recordedAt: at }), id2);
        const state = readSnapshot();
        state.revision++;
        write(state);
        const result = { requestId: input.requestId, cleanedWorkIds: p.eligibleWorkIds, retained: p.retained, changedRecords: p.changes.length, prunedSnapshots: p.snapshots.length, recordedAt: at };
        db.prepare("INSERT INTO maintenance VALUES(?,?)").run(key, JSON.stringify({ fingerprint: fingerprint2, result }));
        return result;
      });
    }
  };
}

// src/local/organization-store.mjs
import { createHash as createHash17 } from "node:crypto";
function reorganize(team, changes) {
  const members = structuredClone(team.members), ids = /* @__PURE__ */ new Set();
  if (!Array.isArray(changes) || !changes.length || changes.length > 49) throw Error("Choose at least one organization change.");
  for (const change of changes) {
    if (!change || ids.has(change.memberId) || Object.keys(change).some((k) => !["memberId", "remove", "boss"].includes(k))) throw Error("Invalid or duplicate organization change.");
    ids.add(change.memberId);
    const member = members.find((m) => m.id === change.memberId);
    if (!member) throw Error("Organization member is no longer present.");
    if (change.remove === true) {
      if (Object.hasOwn(change, "boss")) throw Error("Removal cannot also reparent a member.");
      members.splice(members.indexOf(member), 1);
    } else if (Object.hasOwn(change, "boss")) member.boss = change.boss;
    else throw Error("Choose removal or a new direct supervisor.");
  }
  const heads = members.filter((m) => m.boss === null);
  if (heads.length !== 1 || !["ceo", "head"].includes(heads[0].role)) throw Error("The organization requires one highest Head or CEO.");
  const ordered = [], visited = /* @__PURE__ */ new Set();
  function visit(member, level) {
    if (level > 3 || visited.has(member.id)) throw Error("Reporting tree has a cycle or unsupported depth.");
    visited.add(member.id);
    member.level = level;
    ordered.push(member);
    for (const child of members.filter((m) => m.boss === member.id)) visit(child, level + 1);
  }
  visit(heads[0], 1);
  if (ordered.length !== members.length) throw Error("Reporting tree has a cycle, removed parent or foreign supervisor.");
  for (const m of ordered) {
    const previous = team.members.find((p) => p.id === m.id);
    if (m.boss !== null && ordered.some((c) => c.boss === m.id) && m.role === "worker") m.role = "lead";
    if (m.boss !== previous.boss || m.level !== previous.level || m.role !== previous.role) m.roleVersion++;
  }
  return ordered;
}
function organizationStore({ db, readPrivate, putPrivate, atomic, readSnapshot, write, readWork, archive, validate }) {
  const list = () => db.prepare("SELECT json FROM receipts WHERE id LIKE 'organization:%' ORDER BY rowid").all().map((r) => JSON.parse(r.json));
  return {
    organizationProjection: () => list(),
    scheduleOrganization(input) {
      return atomic(() => {
        if (!input || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || Object.keys(input).some((k) => !["requestId", "teamId", "workId", "expectedRevision", "configVersion", "changes", "pause"].includes(k))) throw Error("Invalid organization request.");
        const key = `organization:${input.requestId}`, fingerprint2 = createHash17("sha256").update(JSON.stringify(input)).digest("hex"), prior = readPrivate(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint2) throw Error("Organization request conflicts with saved input.");
          return prior;
        }
        const state = readSnapshot(), team = state.teams.find((t) => t.id === input.teamId), work = readWork(input.workId);
        if (!team || state.revision !== input.expectedRevision || team.configVersion !== input.configVersion) throw Error("Organization configuration changed; reload and review your changes.");
        if (readPrivate(`next-goal:${team.id}`) || !work || work.teamId !== team.id || work.status === "completed" || readPrivate(`active-work:${team.id}`)?.workId !== work.id) throw Error("The current accepted-end boundary changed or a goal transition is reserved. Reload the active work.");
        if (list().some((r) => r.teamId === team.id && r.state === "pending")) throw Error("An organization change already awaits this boundary; cancel it before replacing.");
        reorganize(team, input.changes);
        const row = { ...input, fingerprint: fingerprint2, state: "pending", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        putPrivate(key, row);
        if (input.pause === true) {
          team.admission ??= { paused: false, members: {} };
          for (const c of input.changes) team.admission.members[c.memberId] = true;
        }
        const raw = readPrivate(`work:${work.id}`);
        raw.version++;
        putPrivate(`work:${work.id}`, raw);
        state.revision++;
        write(state);
        return row;
      });
    },
    cancelOrganization(input) {
      return atomic(() => {
        const row = readPrivate(`organization:${input.requestId}`), state = readSnapshot();
        if (!row || row.state !== "pending" || state.revision !== input.expectedRevision) throw Error("Organization request changed; reload.");
        row.state = "cancelled";
        row.cancelledAt = (/* @__PURE__ */ new Date()).toISOString();
        putPrivate(`organization:${row.requestId}`, row);
        const raw = readPrivate(`work:${row.workId}`);
        raw.version++;
        putPrivate(`work:${row.workId}`, raw);
        state.revision++;
        write(state);
        return row;
      });
    },
    applyOrganization(work, team) {
      if (!db.isTransaction) throw Error("Organization application requires the acceptance transaction.");
      const row = list().find((r) => r.teamId === team.id && r.workId === work.id && r.state === "pending");
      if (!row) return;
      if (team.configVersion !== row.configVersion) throw Error("Pending organization configuration changed; cancel and review it again before acceptance.");
      team.members = reorganize(team, row.changes);
      team.configVersion++;
      validate(team);
      archive(team);
      row.state = "applied";
      row.appliedConfigVersion = team.configVersion;
      row.appliedAt = (/* @__PURE__ */ new Date()).toISOString();
      putPrivate(`organization:${row.requestId}`, row);
    }
  };
}

// src/local/staffing-store.mjs
import { randomUUID as randomUUID9 } from "node:crypto";
var text7 = (v, n) => typeof v === "string" && v.trim().length > 0 && v.length <= n;
var id = (v) => text7(v, 120) && /^[a-zA-Z0-9-]+$/.test(v);
function staffingStore({ db, readPrivate, putPrivate, readWork, listRunWorks, readSnapshot, write, archive, atomic }) {
  const rows = (prefix) => db.prepare("SELECT json FROM receipts WHERE id LIKE ? ORDER BY rowid").all(prefix + "%").map((r) => JSON.parse(r.json));
  const rootWork = (id2) => {
    const w = readWork(id2);
    return w?.teamWorkId ? readWork(w.teamWorkId) : w;
  };
  const active = (id2) => {
    const w = rootWork(id2);
    if (!w || w.status === "completed") throw Error("This TeamWork is closed or unavailable; staffing requires a current work.");
    return w;
  };
  const effectiveTeamForWork = (id2) => {
    const work = rootWork(id2);
    if (!work) return null;
    const amendment = readPrivate(`work-configuration:${work.id}`);
    return JSON.parse(db.prepare("SELECT json FROM team_versions WHERE team_id=? AND version=?").get(work.teamId, amendment?.configVersion ?? work.configVersion)?.json ?? "null");
  };
  const listRosterDeltas = (id2) => rows("roster-delta:").filter((r) => r.workId === (rootWork(id2)?.id ?? id2));
  const listStaffingProposals = (id2) => rows("staffing-proposal:").filter((r) => r.workId === (rootWork(id2)?.id ?? id2));
  const recordConfigurationAmendment = (workId, team, { requestId, kind, memberIds }) => {
    if (!db.isTransaction) throw Error("Configuration amendment must share its validated save transaction.");
    const work = active(workId), previous = effectiveTeamForWork(work.id);
    if (team.id !== work.teamId || team.configVersion <= previous.configVersion || !memberIds.length || memberIds.some((id2) => !team.members.some((m) => m.id === id2))) throw Error("Invalid Work configuration amendment.");
    const amendment = { id: randomUUID9(), workId: work.id, teamId: team.id, previousConfigVersion: previous.configVersion, configVersion: team.configVersion, requestId, kind, memberIds, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    putPrivate(`configuration-amendment:${amendment.id}`, amendment);
    putPrivate(`work-configuration:${work.id}`, amendment);
    for (const supervisorMemberId of new Set(team.members.filter((m) => team.members.some((child) => child.boss === m.id)).map((m) => m.id))) {
      const delta = { id: randomUUID9(), workId: work.id, teamId: team.id, amendmentId: amendment.id, supervisorMemberId, configVersion: team.configVersion, memberIds: memberIds.filter((id2) => team.members.find((m) => m.id === id2).boss === supervisorMemberId), state: "queued", processed: "unconfirmed", createdAt: amendment.createdAt };
      putPrivate(`roster-delta:${delta.id}`, delta);
    }
    return amendment;
  };
  const publicDelta = ({ nativeSend, ...row }) => row;
  const api = {
    effectiveTeamForWork,
    listRosterDeltas,
    listStaffingProposals,
    recordConfigurationAmendment,
    expireStaffingProposals(decision) {
      if (!db.isTransaction) throw Error("Staffing expiry must share the accepted Work transaction.");
      let expired = 0;
      for (const proposal of listStaffingProposals(decision.workId).filter((p) => p.status === "pending")) {
        const expiry = { kind: "accepted-work-closure", workId: decision.workId, deliveryId: decision.deliveryId, decisionRequestId: decision.requestId, recordedAt: decision.recordedAt };
        if (!staffingExpiryProof({ ...proposal, expiry }, readPrivate)) continue;
        putPrivate(`staffing-proposal:${proposal.workId}:${proposal.id}`, { ...proposal, status: "expired", expiry });
        expired++;
      }
      return expired;
    },
    reconcileExpiredStaffingProposals() {
      return atomic(() => {
        let expired = 0;
        for (const decision of rows("work-decision:").filter((d) => d.decision === "accept")) expired += api.expireStaffingProposals(decision);
        if (expired) {
          const state = readSnapshot();
          state.revision++;
          write(state);
        }
        return expired;
      });
    },
    staffingRecipientBindings(workId) {
      const root = rootWork(workId), ids = new Set(rows("configuration-amendment:").filter((a) => a.workId === root?.id && a.kind === "add-member").flatMap((a) => a.memberIds));
      return rows("operation:").filter((o) => ids.has(o.memberId) && readPrivate(`binding:${o.memberId}`)?.requestId === o.requestId).map((o) => ({ memberId: o.memberId, requestId: o.requestId, instanceGeneration: o.instanceGeneration ?? 1 }));
    },
    staffingClosureBlockers(workId) {
      const root = rootWork(workId), reasons = [];
      for (const d of listRosterDeltas(workId)) if (d.processed !== "confirmed" && (d.state !== "queued" || (listRunWorks?.(workId) ?? [root]).some((w) => w.supervisorMemberId === d.supervisorMemberId && (!w.parent || readPrivate(`dispatch:${w.parent.attemptId}`)?.status === "running")))) reasons.push(`Roster configuration ${d.configVersion} awaits manager processing`);
      for (const r of rows("staffing-request:")) if (r.result?.workId === root?.id && r.result.launch && readPrivate(`operation:${r.result.launch.requestId}`)?.status !== "created") reasons.push("Approved staffing preparation remains pending or unknown");
      return [...new Set(reasons)];
    },
    assertStaffingPreparation(memberId, requestId) {
      const request = rows("staffing-request:").find((r) => r.result?.memberId === memberId && r.result.launch?.requestId === requestId);
      if (request) active(request.result.workId);
    },
    readStaffingRequest(input) {
      const prior = readPrivate(`staffing-request:${input.requestId}`);
      if (prior && prior.fingerprint !== staffingFingerprint(input)) throw Error("Staffing request identity conflicts.");
      return prior?.result ?? null;
    },
    staffingProjection: (workId) => ({ staffingProposals: listStaffingProposals(workId).map(({ proof, fingerprint: fingerprint2, ...p }) => ({ ...p, ...p.decision ? { decision: (({ sessionDecision, ...d }) => d)(p.decision) } : {} })), rosterDeltas: listRosterDeltas(workId).map(publicDelta), effectiveConfigVersion: effectiveTeamForWork(workId)?.configVersion }),
    claimRosterDelta(id2, { nativeSend, contextId, runId, generation, supervisorMemberId }) {
      return atomic(() => {
        const key = `roster-delta:${id2}`, row = readPrivate(key);
        if (!row || row.state !== "queued") return false;
        active(row.workId);
        const work = readWork(contextId);
        if (!work || work.supervisorMemberId !== row.supervisorMemberId || supervisorMemberId !== row.supervisorMemberId || work.run.id !== runId || work.run.consumerGeneration !== generation) throw Error("Roster recipient authority changed.");
        Object.assign(row, { state: "sending", nativeSend, contextId, runId, generation });
        putPrivate(key, row);
        return true;
      });
    },
    updateRosterDelta(id2, patch) {
      return atomic(() => {
        const key = `roster-delta:${id2}`, row = readPrivate(key);
        if (!row) throw Error("Roster delta missing.");
        if (Object.keys(patch).some((k) => !["state", "detail"].includes(k))) throw Error("Roster evidence is immutable.");
        Object.assign(row, patch);
        putPrivate(key, row);
        return row;
      });
    },
    acknowledgeRosterDelta(contextId, intent) {
      return atomic(() => {
        const s = intent.spec, key = `roster-delta:${s.deltaId}`, row = readPrivate(key), work = readWork(contextId);
        if (!row || !["accepted", "sending", "unknown"].includes(row.state) || row.contextId !== contextId || row.supervisorMemberId !== work.supervisorMemberId || row.runId !== work.run.id || row.generation !== s.generation || row.configVersion !== s.configVersion) throw Error("Roster acknowledgement does not match its actual manager/version.");
        row.processed = "confirmed";
        row.acknowledgement = { nativeTaskId: intent.nativeTaskId, payloadHash: intent.payloadHash };
        putPrivate(key, row);
        return row;
      });
    },
    ingestStaffingProposal(workId, intent) {
      return atomic(() => {
        const work = active(workId), context = readWork(workId), s = intent.spec, team = effectiveTeamForWork(workId), fingerprint2 = staffingFingerprint(intent), key = `staffing-proposal:${work.id}:${s.appQuestionId}`, prior = readPrivate(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint2) throw Error("Proposal identity conflicts.");
          return prior;
        }
        if (s.kind !== "staffing-proposal" || !id(s.appQuestionId) || s.proposingManagerId !== context.supervisorMemberId || s.configVersion !== team.configVersion || s.roleVersion !== 1 || !text7(s.rationale, 8e3) || !Array.isArray(s.affectedTaskKeys) || s.affectedTaskKeys.some((v) => !id(v)) || !s.member || !team.members.some((m) => m.id === s.member.boss && ["ceo", "head", "lead"].includes(m.role))) throw Error("Staffing proposal configuration or manager is stale.");
        const proposal = { id: s.appQuestionId, workId: work.id, contextId: workId, teamId: team.id, proposingManagerId: context.supervisorMemberId, runId: context.run.id, generation: context.run.consumerGeneration, configVersion: s.configVersion, roleVersion: s.roleVersion, member: s.member, rationale: s.rationale, affectedTaskKeys: s.affectedTaskKeys, status: "pending", proof: intent, fingerprint: fingerprint2, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        putPrivate(key, proposal);
        return proposal;
      });
    },
    saveSessionStaffing(workId, intent) {
      const s = intent.spec, work = readWork(workId), requestId = "session-" + sessionDecisionKey(intent), prior = readPrivate(`staffing-request:${requestId}`);
      if (prior) {
        if (staffingFingerprint(prior.sessionDecision) !== staffingFingerprint(intent)) throw Error("Session decision identity conflicts.");
        return prior.result;
      }
      validateSessionDecision(work, readPrivate(`dispatch-protocol:${workId}`), s);
      if (!work || work.parent || work.status === "completed" || s.kind !== "staffing-decision" || s.workId !== workId || s.generation !== work.run.consumerGeneration || s.userConfirmed !== true || !text7(s.userStatement, 8e3)) throw Error("Only the current highest supervisor records explicit user staffing decisions.");
      const proposal = listStaffingProposals(workId).find((p) => p.id === s.proposalId);
      if (!proposal || proposal.proof.nativeTaskId !== s.proposalNativeTaskId) throw Error("Review the exact saved staffing proposal before deciding.");
      return api.saveStaffing({ requestId, workId, expectedRevision: readSnapshot().revision, configVersion: s.configVersion, proposalId: s.proposalId, decision: s.decision }, { sessionDecision: intent });
    },
    saveStaffing(input, { sessionDecision } = {}) {
      return atomic(() => {
        if (!input || !id(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || !Number.isSafeInteger(input.configVersion) || Object.keys(input).some((k) => !["requestId", "workId", "expectedRevision", "configVersion", "member", "proposalId", "decision"].includes(k)) || !input.proposalId && input.decision !== void 0) throw Error("Invalid staffing request identity or revision.");
        const fingerprint2 = staffingFingerprint(input), key = `staffing-request:${input.requestId}`, prior = readPrivate(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint2) throw Error("Staffing request identity conflicts.");
          return prior.result;
        }
        const work = active(input.workId), state = readSnapshot(), team = state.teams.find((t) => t.id === work.teamId);
        const proposal = input.proposalId ? readPrivate(`staffing-proposal:${work.id}:${input.proposalId}`) : null;
        if (input.proposalId && (!proposal || !["approve", "reject"].includes(input.decision) || input.member)) throw Error("Choose a saved staffing proposal and user decision.");
        if (proposal?.status !== "pending" && proposal) {
          if (proposal.decision.choice !== input.decision || proposal.configVersion !== input.configVersion) throw Error("Proposal is already decided; its decision cannot be changed.");
          putPrivate(key, { fingerprint: fingerprint2, result: proposal.decision.result, ...sessionDecision ? { sessionDecision } : {} });
          return proposal.decision.result;
        }
        if (proposal && input.decision === "approve" && (readWork(proposal.contextId)?.run.id !== proposal.runId || readWork(proposal.contextId)?.run.consumerGeneration !== proposal.generation)) throw Error("Proposal supervisor changed; review a fresh proposal.");
        if (proposal && proposal.configVersion !== input.configVersion) throw Error("Proposal configuration changed; review a fresh proposal.");
        const decide = (result2) => {
          if (proposal) {
            proposal.status = input.decision === "reject" ? "rejected" : "approved";
            proposal.decision = { from: "user", choice: input.decision, requestId: input.requestId, recordedAt: (/* @__PURE__ */ new Date()).toISOString(), result: result2, ...sessionDecision ? { source: "supervisor-session", recordedBy: work.supervisorMemberId, sessionDecision } : {} };
            putPrivate(`staffing-proposal:${work.id}:${proposal.id}`, proposal);
          }
          putPrivate(key, { fingerprint: fingerprint2, result: result2, ...sessionDecision ? { sessionDecision } : {} });
          return result2;
        };
        if (proposal && input.decision === "reject") {
          state.revision++;
          write(state);
          return decide({ requestId: input.requestId, workId: work.id, proposalId: proposal.id, decision: "rejected" });
        }
        if (state.revision !== input.expectedRevision || team?.configVersion !== input.configVersion || effectiveTeamForWork(work.id)?.configVersion !== input.configVersion) throw Error("Team configuration changed; reload and review staffing again.");
        if (readPrivate(`next-goal:${team.id}`)) throw Error("Queued goal transition is reserved.");
        const source = proposal?.member ?? input.member, boss = team.members.find((m) => m.id === source?.boss);
        if (!source || Object.keys(source).some((k) => !["name", "boss", "brief", "habits", "collaboration", "agent", "model", "effort"].includes(k)) || !text7(source.name, 120) || !text7(source.brief, 1500) || [source.habits, source.collaboration].some((v) => typeof v !== "string" || v.length > 1500) || !boss || !["ceo", "head", "lead"].includes(boss.role) || boss.level >= 3) throw Error("Choose a current direct manager and valid member role content.");
        if (team.members.length >= 49) throw Error("The current team schema supports at most 49 members.");
        if (!["claude", "codex"].includes(source.agent) || !text7(source.model, 120) || !text7(source.effort, 120) || source.model === "default" && source.effort !== "default") throw Error("Choose valid agent, model and effort preferences.");
        if (team.members.some((m) => m.name.toLowerCase() === source.name.toLowerCase())) throw Error("Member name already exists.");
        if (team.scope.workspaceKey !== work.scope.workspaceKey || team.scope.executionHostId !== work.scope.executionHostId) throw Error("TeamWork execution scope changed.");
        const member = { ...source, id: randomUUID9(), team: boss.team, role: boss.role === "ceo" ? "head" : boss.level === 1 && team.configuration.levels === 3 ? "lead" : "worker", level: boss.level + 1, roleVersion: 1, state: "unassigned", preferenceOverride: true };
        team.members.push(member);
        team.configVersion++;
        archive(team);
        const amendment = recordConfigurationAmendment(work.id, team, { requestId: input.requestId, kind: "add-member", memberIds: [member.id] });
        state.revision++;
        validatePersistentState(state);
        write(state);
        const result = { requestId: input.requestId, workId: work.id, from: "user", source: sessionDecision ? "supervisor-session" : proposal ? "proposal" : "direct", recordedAt: (/* @__PURE__ */ new Date()).toISOString(), memberId: member.id, configVersion: team.configVersion, amendmentId: amendment.id, decision: "approved", ...team.configuration.launchMode === "all" && !sessionDecision ? { launch: { teamId: team.id, memberId: member.id, configVersion: team.configVersion, requestId: randomUUID9() } } : {} };
        return decide(result);
      });
    }
  };
  return api;
}

// src/local/lifecycle-store.mjs
import { randomUUID as randomUUID10, createHash as createHash18 } from "node:crypto";
var digest4 = (value) => createHash18("sha256").update(JSON.stringify(value)).digest("hex");
var fail2 = (message) => {
  throw Error(message);
};
var boundedHandoff = (h) => ({ ...h, summary: h.summary.slice(0, 2e3), evidenceRefs: h.evidenceRefs.slice(0, 10).map((r) => r.slice(0, 160)), truncated: h.summary.length > 2e3 || h.evidenceRefs.length > 10 || h.evidenceRefs.some((r) => r.length > 160) });
function lifecycleStore({ db, readPrivate, putPrivate, readWork, persistWork, listDispatches, listRunWorks, listGoals, questions, staffing, atomic, readSnapshot, write, applyOrganization }) {
  const deliveries = (id2) => db.prepare("SELECT json FROM receipts WHERE id LIKE 'delivery:%' ORDER BY rowid").all().map((r) => JSON.parse(r.json)).filter((r) => r.workId === id2);
  const current = (id2) => deliveries(id2).at(-1);
  const blockers = (work) => {
    const reasons = [...staffing?.().staffingClosureBlockers(work.id) ?? []];
    if (db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().some((r) => {
      const row = JSON.parse(r.json);
      return row.teamId === work.teamId && !["bound", "resumed"].includes(row.state);
    })) reasons.push("Member recovery or handoff remains unresolved");
    for (const row of db.prepare("SELECT json FROM receipts WHERE id LIKE 'stop:%'").all()) {
      const stop = JSON.parse(row.json);
      if (listRunWorks(work.id).some((w) => w.id === stop.target.workId) && ["intent", "submitted", "unknown"].includes(stop.state)) reasons.push("Stop outcome remains unconfirmed; preserve the exact member reservation");
    }
    if (db.prepare("SELECT json FROM receipts WHERE id LIKE 'dispatch-queue:%'").all().some((r) => listRunWorks(work.id).some((w) => w.id === JSON.parse(r.json).workId))) reasons.push("Queued member tasks await admission");
    const latest = latestBusinessAttempts(listDispatches(work.id));
    for (const expected of work.currentRecipientBindings ?? work.recipientBindings ?? [work.binding]) if (readPrivate(`operation:${expected.requestId}`)?.status !== "created") reasons.push("Preparation member launch remains unknown");
    for (const a of latest) if (a.status !== "accepted") reasons.push(`Task ${a.taskKey}: ${a.status}`);
    for (const q of listRunWorks(work.id).flatMap((w) => questions.listQuestions(w.id))) if (questionNeedsProcessing(q)) reasons.push(`User decision ${q.id} awaits processing`);
    for (const child of listRunWorks(work.id).filter((w) => w.parent)) if (child.run.state !== "verified" || child.error) reasons.push("Manager Run " + child.supervisorMemberId + " awaits verification");
    if (work.run.state !== "verified") reasons.push("Supervisor Run authority is unverified");
    return reasons;
  };
  const api = {
    workClosureBlockers: (workId) => blockers(readWork(workId)),
    deliveryProjection(workId) {
      const d = current(workId);
      return d ? { delivery: { ...d, proof: void 0 }, closureBlockers: blockers(readWork(workId)) } : {};
    },
    recordDelivery(workId, proposal) {
      return atomic(() => {
        const w = readWork(workId);
        if (w?.parent) fail2("Only the highest supervisor may deliver the total objective.");
        if (!w || w.status === "completed") return null;
        const existing = deliveries(workId).find((d2) => d2.id === proposal.id);
        if (existing) {
          if (existing.proof.payloadHash !== proposal.proof.payloadHash) fail2("Delivery identity conflicts.");
          return existing;
        }
        const previous = current(workId);
        if ((proposal.previousDeliveryId ?? null) !== (previous?.id ?? null)) fail2("Delivery must reference the current delivery revision.");
        if ((proposal.epoch ?? 0) !== (w.epoch ?? 0) || w.epoch && proposal.protocolToken !== readPrivate(`dispatch-protocol:${workId}`)?.token || proposal.generation !== w.run.consumerGeneration) fail2("Delivery Run generation changed.");
        const d = { ...proposal, workId, epoch: w.epoch ?? 0, revision: (previous?.revision ?? 0) + 1, status: "pending", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        putPrivate(`delivery:${workId}:${d.id}`, d);
        w.status = "awaiting_acceptance";
        w.version++;
        persistWork(w);
        return d;
      });
    },
    readWorkDecision(requestId) {
      return readPrivate(`work-decision:${requestId}`);
    },
    decideWork(input) {
      return atomic(() => {
        if (!input || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || !["accept", "rework"].includes(input.decision) || Object.keys(input).some((k) => !["requestId", "workId", "deliveryId", "expectedWorkVersion", "decision", "feedback"].includes(k))) fail2("Invalid user delivery decision.");
        const key = `work-decision:${input.requestId}`, fingerprint2 = digest4(input), prior = readPrivate(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint2) fail2("User decision identity conflicts.");
          return prior;
        }
        const w = readWork(input.workId), d = current(input.workId);
        if (!w || w.version !== input.expectedWorkVersion || w.status !== "awaiting_acceptance" || d?.id !== input.deliveryId || d.status !== "pending" || (d.epoch ?? 0) !== (w.epoch ?? 0)) fail2("Delivery changed or was superseded. Reload before deciding.");
        if (input.decision === "rework" && (typeof input.feedback !== "string" || !input.feedback.trim() || input.feedback.length > 8e3)) fail2("Describe the requested corrections (1\u20138000 characters).");
        if (input.decision === "accept") {
          const reasons = blockers(w);
          if (reasons.length) fail2("Required work remains: " + reasons.join("; "));
          const latest = latestBusinessAttempts(listDispatches(w.id));
          if (latest.some((a) => !d.attemptIds.includes(a.id) || !d.evidenceRefs.includes(a.evidenceId))) fail2("Delivery omits required accepted task evidence.");
        }
        const event = { ...input, fingerprint: fingerprint2, recordedAt: (/* @__PURE__ */ new Date()).toISOString(), input: { state: input.decision === "rework" ? "not_sent" : "none" } };
        d.status = input.decision === "accept" ? "accepted" : "changes_requested";
        putPrivate(`delivery:${w.id}:${d.id}`, d);
        w.status = input.decision === "accept" ? "completed" : "active";
        w.version++;
        if (input.decision === "accept") {
          if (readPrivate(`active-work:${w.teamId}`)?.workId !== w.id) fail2("Active TeamWork pointer changed.");
          const state = readSnapshot(), team = state.teams.find((t) => t.id === w.teamId);
          const expectedRecipients = [...w.currentRecipientBindings ?? w.recipientBindings ?? [w.binding], ...staffing?.().staffingRecipientBindings(w.id) ?? []];
          if (Object.values(team.launch?.members ?? {}).some((r) => !expectedRecipients.some((e) => e.requestId === r.requestId))) fail2("Current member binding changed during Work; reconcile before closure.");
          for (const expected of expectedRecipients) {
            const pointer = readPrivate(`binding:${expected.memberId}`);
            if (pointer?.requestId !== expected.requestId || (pointer.instanceGeneration ?? 1) !== (expected.instanceGeneration ?? 1)) fail2("Current member binding changed; closure must not retire a replacement.");
            db.prepare("DELETE FROM receipts WHERE id=?").run(`binding:${expected.memberId}`);
            putPrivate(`binding-generation:${expected.memberId}`, { generation: expected.instanceGeneration ?? 1 });
            if (team.launch?.members?.[expected.memberId]?.requestId === expected.requestId) delete team.launch.members[expected.memberId];
          }
          for (const a of listDispatches(w.id)) {
            if (readPrivate(`dispatch-member:${a.memberId}`)?.id === a.id) db.prepare("DELETE FROM receipts WHERE id=?").run(`dispatch-member:${a.memberId}`);
            if (readPrivate(`dispatch-binding:${a.memberId}`)?.attemptId === a.id) db.prepare("DELETE FROM receipts WHERE id=?").run(`dispatch-binding:${a.memberId}`);
          }
          db.prepare("DELETE FROM receipts WHERE id=?").run(`active-work:${w.teamId}`);
          for (const child of listRunWorks(w.id).filter((context) => context.parent)) {
            child.status = "completed";
            child.closedAt = event.recordedAt;
            child.version++;
            persistWork(child);
          }
          w.closedAt = event.recordedAt;
          w.handoff = { summary: d.summary, evidenceRefs: d.evidenceRefs, deliveryId: d.id };
          applyOrganization?.(w, team);
          const goal = listGoals(w.teamId).find((g) => g.status === "queued");
          if (goal) {
            goal.status = "reserved";
            goal.previousWorkId = w.id;
            goal.launchRequests = Object.fromEntries(initialMembers(team).map((m) => [m.id, randomUUID10()]));
            goal.workRequestId = randomUUID10();
            goal.configVersion = team.configVersion;
            goal.supervisorMemberId = team.members.find((m) => m.boss === null).id;
            goal.handoff = boundedHandoff(w.handoff);
            putPrivate(`goal:${goal.id}`, goal);
            putPrivate(`next-goal:${w.teamId}`, { goalId: goal.id });
            event.nextGoalId = goal.id;
          }
          state.revision++;
          write(state);
        }
        persistWork(w);
        putPrivate(key, event);
        if (input.decision === "accept") staffing?.().expireStaffingProposals(event);
        return event;
      });
    },
    updateWorkDecision(requestId, patch) {
      return atomic(() => {
        const event = readPrivate(`work-decision:${requestId}`);
        if (!event) fail2("Saved decision not found.");
        Object.assign(event, patch);
        putPrivate(`work-decision:${requestId}`, event);
        return event;
      });
    },
    reserveNextGoal(teamId) {
      return atomic(() => {
        const prior = api.nextGoal(teamId);
        if (prior) return prior;
        if (readPrivate(`active-work:${teamId}`)) return null;
        const state = readSnapshot(), team = state.teams.find((t) => t.id === teamId), goal = listGoals(teamId).find((g) => g.status === "queued");
        if (!team || !goal) return null;
        if (Object.keys(team.launch?.members ?? {}).length) fail2("Existing preparation bindings must be resolved before a fresh queued goal.");
        const old = db.prepare("SELECT json FROM receipts WHERE id LIKE 'work:%' ORDER BY rowid DESC").all().map((r) => JSON.parse(r.json)).find((w) => w.teamId === teamId && w.status === "completed");
        if (!old) fail2("Submit the first total objective with its prepared supervisor before advancing later goals.");
        Object.assign(goal, { status: "reserved", previousWorkId: old.id, handoff: boundedHandoff(old.handoff), launchRequests: Object.fromEntries(initialMembers(team).map((m) => [m.id, randomUUID10()])), workRequestId: randomUUID10(), configVersion: team.configVersion, supervisorMemberId: team.members.find((m) => m.boss === null).id });
        putPrivate(`goal:${goal.id}`, goal);
        putPrivate(`next-goal:${teamId}`, { goalId: goal.id });
        state.revision++;
        write(state);
        return goal;
      });
    },
    nextGoal(teamId) {
      const p = readPrivate(`next-goal:${teamId}`);
      return p ? readPrivate(`goal:${p.goalId}`) : null;
    }
  };
  return api;
}

// src/local/store.mjs
import { mkdir as mkdir2, realpath as realpath10, stat as stat3, open as open2 } from "node:fs/promises";
import { join as join11, isAbsolute as isAbsolute10, relative as relative9, sep as sep9 } from "node:path";
import { randomUUID as randomUUID11, createHash as createHash19 } from "node:crypto";
var FORMAT = "orca-team-store";
var canonical6 = (value) => Array.isArray(value) ? value.map(canonical6) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical6(value[key])])) : value;
var fingerprint = (value) => createHash19("sha256").update(JSON.stringify(canonical6(value))).digest("hex");
var publicScope = ({ workspaceId, ...scope }) => scope;
var empty = () => ({ format: FORMAT, version: 2, revision: 0, teams: [], settings: { ...SETTINGS } });
var fail3 = (message) => {
  throw new Error(message);
};
async function openTeamStore(options) {
  try {
    return await openStore(options);
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM", "ENOTDIR", "EROFS", "EEXIST", "ELOOP", "ENOSPC", "EMFILE", "ENFILE", "EIO"].includes(error.code)) throw new Error(`Team storage is unavailable (${error.code}). Check access to the verified Orca profile; existing data has not been reset.`);
    throw error;
  }
}
async function openStore({ userData, sqlite = () => import("node:sqlite") } = {}) {
  if (typeof userData !== "string" || !isAbsolute10(userData) || userData.includes("\0")) fail3("Verified Orca profile is required for team storage.");
  let DatabaseSync, backup;
  try {
    ({ DatabaseSync, backup } = await sqlite());
  } catch {
    fail3("This worker does not support node:sqlite. Team persistence is unavailable.");
  }
  if (typeof DatabaseSync !== "function") fail3("This worker does not support node:sqlite. Team persistence is unavailable.");
  const profile = await realpath10(userData);
  const directory = join11(profile, "plugins-data", "herman925.team-orchestrator");
  const inside = (path2) => {
    const rel = relative9(profile, path2);
    if (rel === ".." || rel.startsWith(`..${sep9}`) || isAbsolute10(rel)) fail3("Plugin data directory escapes the verified Orca profile.");
  };
  for (const target of [join11(profile, "plugins-data"), directory]) {
    try {
      inside(await realpath10(target));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir2(target, { mode: 448 });
      inside(await realpath10(target));
    }
  }
  const path = join11(directory, "team-orchestrator.sqlite");
  let exists = false;
  try {
    await stat3(path);
    exists = true;
    inside(await realpath10(path));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let prepared;
  if (exists) try {
    prepared = await prepareStorage({ path, directory, DatabaseSync, backup });
  } catch (error) {
    const backups = await recoveryInventory(directory, DatabaseSync);
    const reason = error instanceof SyntaxError ? "Saved JSON evidence is damaged" : /^(EACCES|EPERM|EROFS|ENOSPC|EIO|EMFILE|ENFILE)$/.test(error.code ?? "") ? `Storage filesystem failure (${error.code})` : error.message;
    throw Error(`Cannot open team storage: ${reason}. Existing data has not been reset. Recovery: preserve the database and WAL/SHM/journal sidecars; stop the plugin before making a recovery copy. Verified migration backups: ${backups.filter((b) => b.status === "verified-backup").length}. Do not restore an older backup automatically: later native effects require manual reconciliation.`);
  }
  if (!exists) {
    const fresh = await open2(path, "wx", 384);
    await fresh.close();
  }
  const db = new DatabaseSync(path);
  try {
    if (exists) {
      migrateStorage(db, prepared);
    } else {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE metadata (format TEXT NOT NULL);
        INSERT INTO metadata VALUES ('${FORMAT}');
        CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
        CREATE TABLE scopes (team_id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE team_versions (team_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(team_id,version));
        CREATE TABLE role_versions (member_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(member_id,version));
        CREATE TABLE requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE receipts (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        ${MAINTENANCE_DDL};
        PRAGMA user_version=${STORAGE_SCHEMA};
        `);
      db.prepare("INSERT INTO snapshot VALUES (1,?)").run(JSON.stringify(empty()));
      db.exec("COMMIT");
    }
    let runtimeReconnect;
    const readWork = (id2) => {
      const row = db.prepare("SELECT json FROM receipts WHERE id=?").get(`work:${id2}`) ?? db.prepare("SELECT json FROM receipts WHERE id=?").get(`native-run-binding:${id2}`);
      return row ? validateWork(JSON.parse(row.json)) : null;
    };
    const readCurrentWork = (id2) => {
      const raw = readWork(id2), work = raw?.currentSupervisor ? { ...raw, ...raw.currentSupervisor, nativeSend: raw.currentSupervisor.nativeSend, error: raw.currentSupervisor.error, originalBinding: raw.binding } : raw;
      if (work?.parent) {
        const parent = readWork(work.parent.workId), epoch = parent?.currentSupervisor, attempt = readPrivate(`dispatch:${work.parent.attemptId}`);
        if (epoch && attempt?.reviewAuthority?.recoveryRequestId === epoch.recoveryRequestId && attempt.reviewAuthority.generation === epoch.run.consumerGeneration) work.parentAuthority = { generation: epoch.run.consumerGeneration, recoveryRequestId: epoch.recoveryRequestId };
      }
      if (work) delete work.runtimeControl;
      const control = work && runtimeReconnect?.readRuntimeControl(work);
      if (control) work.runtimeControl = control;
      return work;
    };
    const listCurrentWorks = () => listWorks().map((work) => readCurrentWork(work.id));
    const listWorks = () => db.prepare("SELECT json FROM receipts WHERE id LIKE 'work:%'").all().map((row) => validateWork(JSON.parse(row.json)));
    const persistWork = (work) => {
      const { parentAuthority, runtimeControl, ...saved } = work;
      return db.prepare("INSERT INTO receipts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(`${work.parent ? "native-run-binding" : "work"}:${work.id}`, JSON.stringify(saved));
    };
    const persistCurrentWork = (work) => {
      const raw = readWork(work.id);
      if (!raw?.currentSupervisor) return persistWork(work);
      for (const key of ["status", "input", "processing", "run", "snapshot", "error", "instance", "nativeSend"]) raw.currentSupervisor[key] = work[key];
      raw.version = work.version;
      for (const key of ["closedAt", "handoff"]) if (work[key] !== void 0) raw[key] = work[key];
      if (work.status === "completed") raw.status = "completed";
      persistWork(raw);
    };
    const readPrivate = (key) => {
      const row = db.prepare("SELECT json FROM receipts WHERE id=?").get(key);
      return row ? JSON.parse(row.json) : null;
    };
    const putPrivate = (key, value) => db.prepare("INSERT INTO receipts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(key, JSON.stringify(value));
    const readDispatchProtocol = (workId) => {
      const row = readPrivate(`dispatch-protocol:${workId}`);
      return row ? validateDispatchProtocol(row) : null;
    };
    const listDispatches = (workId) => db.prepare("SELECT json FROM receipts WHERE id LIKE 'dispatch:%' ORDER BY rowid").all().map((row) => validateDispatch(JSON.parse(row.json))).filter((row) => !workId || row.workId === workId);
    const listRunWorks = (id2) => {
      const root = readCurrentWork(id2);
      if (!root) return [];
      const teamWorkId = root.teamWorkId ?? root.id;
      return [readCurrentWork(teamWorkId), ...db.prepare("SELECT json FROM receipts WHERE id LIKE 'native-run-binding:%' ORDER BY rowid").all().map((r) => readCurrentWork(JSON.parse(r.json).id)).filter((w) => w.teamWorkId === teamWorkId)];
    };
    const listTeamDispatches = (id2) => {
      const ids = new Set(listRunWorks(id2).map((w) => w.id));
      return listDispatches().filter((a) => ids.has(a.workId));
    };
    const queuedTasks = (workId) => db.prepare("SELECT json FROM receipts WHERE id LIKE 'dispatch-queue:%' ORDER BY rowid").all().map((row) => JSON.parse(row.json)).filter((row) => row.workId === workId);
    const withdrawnIntents = (workId) => db.prepare("SELECT json FROM receipts WHERE id LIKE 'intent-withdrawal:%'").all().map((row) => JSON.parse(row.json)).filter((row) => row.workId === workId);
    const dispatchProjection = (workId) => ({ withdrawnIntents: listRunWorks(workId).flatMap((w) => withdrawnIntents(w.id).map(({ originalSpec, replacementSpec, result, createProof, replacementProof, updateProof, ...row }) => row)), queuedTasks: listRunWorks(workId).flatMap((w) => queuedTasks(w.id)), dispatchProtocol: publicDispatchProtocol(readDispatchProtocol(workId), readCurrentWork(workId)?.status === "completed"), tasks: listTeamDispatches(workId).map(publicDispatch), nativeRuns: listRunWorks(workId).map((w) => ({ id: w.id, teamWorkId: w.teamWorkId ?? w.id, supervisorMemberId: w.supervisorMemberId, run: w.run, parent: w.parent, input: { state: w.input.state }, error: w.error, questions: questions.listQuestions(w.id).map((q) => ({ id: q.id, summary: q.summary, status: q.status, to: q.to, relay: q.relay })), dispatchProtocol: publicDispatchProtocol(readDispatchProtocol(w.id), w.status === "completed") })) });
    const atomicDispatch = (action) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = action();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    };
    const stops = stopStore({ db, readPrivate, putPrivate, atomic: atomicDispatch });
    const listGoals = (teamId) => db.prepare("SELECT json FROM receipts WHERE id LIKE 'goal:%' ORDER BY rowid").all().map((row) => JSON.parse(row.json)).filter((row) => !teamId || row.teamId === teamId);
    const questions = questionStore({ db, readPrivate, putPrivate, readWork: readCurrentWork, listDispatches, effectiveTeamForWork: (id2) => staffing.effectiveTeamForWork(id2), atomic: atomicDispatch });
    const readSnapshot = () => {
      const value = JSON.parse(db.prepare("SELECT json FROM snapshot WHERE id=1").get()?.json ?? "null");
      if (!value || value.format !== FORMAT || value.version !== 2 || !Number.isInteger(value.revision) || !Array.isArray(value.teams)) fail3("Team database snapshot is invalid; original data has been preserved.");
      return { ...validatePersistentState(value), stops: stops.stopProjection(), goals: listGoals(), organizationChanges: organization.organizationProjection(), recoveries: db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().map((r) => publicWake(JSON.parse(r.json))), works: listCurrentWorks().map((work) => ({ ...publicWork(work), ...dispatchProjection(work.id), ...questions.questionProjection(work.id), ...lifecycle.deliveryProjection(work.id), ...staffing.staffingProjection(work.id) })) };
    };
    const write = ({ works, goals, recoveries, organizationChanges, stops: ignoredStops, ...value }) => db.prepare("UPDATE snapshot SET json=? WHERE id=1").run(JSON.stringify(value));
    const lifecycle = lifecycleStore({ db, readPrivate, putPrivate, readWork: readCurrentWork, persistWork: persistCurrentWork, listDispatches: listTeamDispatches, listRunWorks, listGoals, questions, staffing: () => staffing, atomic: atomicDispatch, readSnapshot, write, applyOrganization: (work, team) => organization.applyOrganization(work, team) });
    const mutate = (op, input, action) => {
      if (!input || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || !Number.isInteger(input.expectedRevision)) fail3("Invalid mutation request identity or revision.");
      const digest5 = fingerprint({ op, input });
      db.exec("BEGIN IMMEDIATE");
      try {
        const previous = db.prepare("SELECT * FROM requests WHERE id=?").get(input.requestId);
        if (previous) {
          if (previous.fingerprint !== digest5) fail3("Request identity conflicts with another input.");
          const saved = JSON.parse(previous.result);
          const result = saved.format === "history-pruned-replay-v1" ? readSnapshot() : validatePersistentState(saved);
          db.exec("COMMIT");
          return result;
        }
        const next = readSnapshot();
        if (next.revision !== input.expectedRevision) fail3("Another panel changed the team data. Reload saved teams before trying again; your changes were not saved.");
        if (op !== "setAdmission" && input.teamId && readPrivate(`next-goal:${input.teamId}`)) fail3("A queued-goal transition is reserved; finish it before changing team configuration.");
        action(next);
        next.revision++;
        validatePersistentState(next);
        write(next);
        db.prepare("INSERT INTO requests VALUES (?,?,?)").run(input.requestId, digest5, JSON.stringify(next));
        db.exec("COMMIT");
        return next;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    };
    const archive = (team) => {
      db.prepare("INSERT INTO team_versions VALUES (?,?,?)").run(team.id, team.configVersion, JSON.stringify(team));
      for (const member of team.members) db.prepare("INSERT OR IGNORE INTO role_versions VALUES (?,?,?)").run(member.id, member.roleVersion, JSON.stringify({ brief: member.brief, habits: member.habits, collaboration: member.collaboration }));
    };
    const organization = organizationStore({ db, readPrivate, putPrivate, atomic: atomicDispatch, readSnapshot, write, readWork: readCurrentWork, archive, validate: (team) => validatePersistentState({ ...readSnapshot(), teams: [team] }) });
    const readOperation = (id2) => {
      const row = db.prepare("SELECT json FROM receipts WHERE id=?").get(`operation:${id2}`);
      return row ? JSON.parse(row.json) : null;
    };
    const persistOperation = (operation, observationOnly = false) => {
      db.prepare("INSERT INTO receipts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(`operation:${operation.requestId}`, JSON.stringify(operation));
      const next = readSnapshot(), team = next.teams.find((row) => row.id === operation.teamId);
      const pointer = readPrivate(`binding:${operation.memberId}`);
      if (!team?.members.some((member) => member.id === operation.memberId) || pointer?.requestId !== operation.requestId || (pointer.instanceGeneration ?? 1) !== (operation.instanceGeneration ?? 1)) return;
      team.launch ??= { native: true, status: "sending", mode: team.configuration.launchMode ?? "on-demand", workspaceKey: team.scope.workspaceKey, configVersion: operation.configVersion, members: {} };
      team.launch.members[operation.memberId] = { ...operation.public, status: operation.status, requestId: operation.requestId, ...operation.handle ? { terminalId: operation.handle, title: operation.title, briefAccepted: operation.briefAccepted === true, executionHostId: operation.executionHostId } : {}, ...operation.error ? { error: operation.error } : {} };
      team.launch.status = initialMembers(team).every((member) => team.launch.members[member.id]?.status === "created") ? "accepted" : "unknown";
      if (!observationOnly) next.revision++;
      validatePersistentState(next);
      write(next);
    };
    const assertReplacementIdle = (memberId) => {
      const memberTeam = readSnapshot().teams.find((t) => t.members.some((m) => m.id === memberId)), affected = /* @__PURE__ */ new Set([memberId]);
      for (let changed = true; changed; ) {
        changed = false;
        for (const m of memberTeam?.members ?? []) if (affected.has(m.boss) && !affected.has(m.id)) {
          affected.add(m.id);
          changed = true;
        }
      }
      if (stops.listStops().some((r) => affected.has(r.target.memberId) && ["intent", "submitted", "unknown"].includes(r.state))) fail3("Unresolved Stop blocks idle replacement.");
      if (db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().some((r) => {
        const w = JSON.parse(r.json);
        return affected.has(w.memberId) && w.memberId !== memberId && !["bound", "resumed"].includes(w.state);
      })) fail3("Descendant recovery blocks idle replacement.");
      for (const a of listDispatches().filter((a2) => affected.has(a2.memberId))) if (!["accepted", "rework"].includes(a.status) || !a.evidenceId) fail3("Member has running, unknown or unreviewed execution.");
      for (const saved of db.prepare("SELECT json FROM receipts WHERE id LIKE 'dispatch-queue:%'").all()) {
        const q = JSON.parse(saved.json);
        if (affected.has(q.memberId) || affected.has(q.supervisorMemberId)) fail3("Queued execution blocks idle replacement.");
      }
      const roots = listCurrentWorks().filter((w) => w.teamId === memberTeam?.id && w.status !== "completed").flatMap((w) => listRunWorks(w.id));
      for (const w of roots) {
        if (affected.has(w.supervisorMemberId) && ["sending", "unknown", "queued"].includes(w.input.state)) fail3("Supervisor input remains pending or unknown.");
        for (const q of questions.listQuestions(w.id)) if (questionNeedsProcessing(q)) fail3("Unresolved question blocks idle replacement.");
      }
    };
    const replacementTeam = (teamId) => {
      const work = listCurrentWorks().find((w) => w.teamId === teamId && w.status !== "completed");
      return work ? staffing.effectiveTeamForWork(work.id) : readSnapshot().teams.find((t) => t.id === teamId);
    };
    const staffing = staffingStore({ db, readPrivate, putPrivate, readWork: readCurrentWork, listRunWorks, readSnapshot, write, archive, atomic: atomicDispatch });
    runtimeReconnect = runtimeReconnectStore({ db, readPrivate, putPrivate, readWork, persistWork, readSnapshot, readOperation, readDispatchProtocol, atomic: atomicDispatch });
    readSnapshot();
    staffing.reconcileExpiredStaffingProposals();
    let closed = false;
    return {
      ...historyCleanup({ db, readSnapshot, write, atomic: atomicDispatch }),
      ...runtimeReconnect,
      storageInfo: () => ({ schema: STORAGE_SCHEMA, backupId: prepared?.backupId ?? null }),
      ...staffing,
      ...questions,
      ...organization,
      assertReplacementIdle,
      reserveIdleReplacement(input, operation, proof) {
        return mutate("reserveIdleReplacement", input, (next) => {
          const team = next.teams.find((t) => t.id === input.teamId), member = team?.members.find((m) => m.id === input.memberId), current = operation.sourceAttemptId ? readPrivate(`dispatch:${operation.sourceAttemptId}`) : readOperation(operation.requestId);
          if (!member || current?.version !== operation.version) fail3("Current member execution changed; reload.");
          const pointer = readPrivate(operation.sourceAttemptId ? `dispatch-member:${member.id}` : `binding:${member.id}`);
          if ((pointer?.requestId ?? pointer?.id) !== operation.requestId || readPrivate(`wake-member:${member.id}`)) fail3("Current member replacement reservation changed.");
          assertReplacementIdle(member.id);
          if (!["codex", "claude"].includes(input.agent) || [input.model, input.effort].some((v) => typeof v !== "string" || !v.trim() || v.length > 120) || input.model === "default" && input.effort !== "default") fail3("Choose valid requested agent/model/effort preferences.");
          team.admission ??= { paused: false, members: {} };
          team.admission.members[member.id] = true;
          Object.assign(member, { agent: input.agent, model: input.model, effort: input.effort, preferenceOverride: true });
          team.configVersion++;
          archive(team);
          for (const work of listCurrentWorks().filter((w) => w.teamId === team.id && w.status !== "completed")) staffing.recordConfigurationAmendment(work.id, team, { requestId: input.requestId, kind: "idle-replacement", memberIds: [member.id] });
          const row = { requestId: input.requestId, teamId: team.id, memberId: member.id, bindingRequestId: operation.requestId, mode: "idle-replacement", oldBinding: operation, proof, state: "approved", version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString(), handoff: { reviewer: "user", decision: "replace", summary: input.summary, evidenceRefs: input.evidenceRefs, oldRequestId: operation.requestId }, detail: "Confirmed idle application recipient retirement. The old native conversation may remain open for inspection; no process death is claimed." };
          putPrivate(`wake:${row.requestId}`, row);
          putPrivate(`wake-member:${member.id}`, { requestId: row.requestId });
        });
      },
      ...wakeStore({ db, readPrivate, putPrivate, atomic: atomicDispatch, readOperation, persistOperation, readWork, persistWork, readCurrentWork, replacementTeam, assertReplacementIdle }),
      ...stops,
      ...lifecycle,
      readOperation,
      readMemberDispatch(memberId) {
        const pointer = readPrivate(`dispatch-member:${memberId}`);
        return pointer ? listDispatches(pointer.workId).find((a) => a.id === pointer.id) : null;
      },
      recordDispatchName(id2, version, naming) {
        return atomicDispatch(() => {
          const row = validateDispatch(readPrivate(`dispatch:${id2}`));
          if (row.version !== version || readCurrentWork(row.workId)?.status === "completed" || readPrivate(`dispatch-member:${row.memberId}`)?.id !== id2 || readPrivate(`binding:${row.memberId}`)) fail3("Member changed before sidebar naming.");
          if (row.binding?.kind !== "terminal" || row.admission !== "committed" || row.reuse || typeof naming.title !== "string" || !naming.title || !["attempted", "confirmed", "unconfirmed"].includes(naming.outcome) || typeof naming.at !== "string") fail3("Verified terminal naming is required.");
          if (!row.sidebarNaming && naming.outcome !== "attempted") fail3("Sidebar naming intent must precede its receipt.");
          if (row.sidebarNaming && row.sidebarNaming.outcome !== "attempted") return row;
          if (row.sidebarNaming && naming.title !== row.sidebarNaming.title) fail3("Saved sidebar name cannot change.");
          row.sidebarNaming = naming;
          row.version++;
          putPrivate(`dispatch:${id2}`, row);
          return row;
        });
      },
      readMemberOperation(memberId) {
        const pointer = readPrivate(`binding:${memberId}`);
        return pointer ? readOperation(pointer.requestId) : null;
      },
      listOperations: () => db.prepare("SELECT json FROM receipts WHERE id LIKE 'operation:%'").all().map((row) => JSON.parse(row.json)),
      isActiveOperation(operation) {
        const pointer = readPrivate(`binding:${operation.memberId}`);
        return pointer?.requestId === operation.requestId && (pointer.instanceGeneration ?? 1) === (operation.instanceGeneration ?? 1) && readSnapshot().teams.some((team) => team.id === operation.teamId && team.members.some((member) => member.id === operation.memberId));
      },
      // Retires only the app recipient pointer. Callers must separately establish lifecycle authorization.
      retireBinding({ memberId, requestId, instanceGeneration }) {
        return atomicDispatch(() => {
          const pointer = readPrivate(`binding:${memberId}`);
          if (pointer?.requestId !== requestId || (pointer.instanceGeneration ?? 1) !== instanceGeneration) return false;
          db.prepare("DELETE FROM receipts WHERE id=?").run(`binding:${memberId}`);
          putPrivate(`binding-generation:${memberId}`, { generation: instanceGeneration });
          const next = readSnapshot(), team = next.teams.find((row) => row.members.some((member) => member.id === memberId));
          if (team?.launch?.members?.[memberId]?.requestId === requestId) {
            delete team.launch.members[memberId];
            next.revision++;
            write(next);
          }
          return true;
        });
      },
      setAdmission(input) {
        return mutate("setAdmission", input, (next) => {
          const team = next.teams.find((row) => row.id === input.teamId);
          if (!team || typeof input.paused !== "boolean" || input.memberId && !team.members.some((row) => row.id === input.memberId)) fail3("Choose a saved team or member.");
          team.admission ??= { paused: false, members: {} };
          if (input.memberId) team.admission.members[input.memberId] = input.paused;
          else team.admission.paused = input.paused;
        });
      },
      assertAdmission(teamId, memberId) {
        const team = readSnapshot().teams.find((row) => row.id === teamId);
        if (!team) fail3("Saved team is unavailable.");
        if (db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().some((r) => {
          const wake = JSON.parse(r.json);
          if (wake.mode !== "idle-replacement" || wake.teamId !== teamId || ["bound", "resumed"].includes(wake.state)) return false;
          let member = team.members.find((m) => m.id === memberId);
          while (member) {
            if (member.id === wake.memberId) return true;
            member = team.members.find((m) => m.id === member.boss);
          }
          return false;
        })) fail3("Member replacement handoff is reserved; new assignments are paused.");
        if (team.admission?.paused || team.admission?.members?.[memberId]) fail3("New assignments are paused. Existing executions remain unchanged.");
        if (stops.listStops().some((row) => row.target.teamId === teamId && row.target.memberId === memberId && ["intent", "submitted", "unknown"].includes(row.state))) fail3("Stop outcome is unresolved; reconcile this member before a new assignment.");
      },
      listGoals,
      enqueueGoal(input) {
        workInput(input);
        return atomicDispatch(() => {
          const key = `goal-request:${input.requestId}`, digest5 = fingerprint(input), prior = readPrivate(key);
          if (prior) {
            if (prior.fingerprint !== digest5) fail3("Queued goal request identity conflicts.");
            return readPrivate(`goal:${prior.id}`);
          }
          const state = readSnapshot(), team = state.teams.find((row) => row.id === input.teamId);
          if (!team || state.revision !== input.expectedRevision) fail3("Team changed; reload before queueing a goal.");
          const goal = { id: randomUUID11(), teamId: team.id, objective: input.objective, status: "queued", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
          putPrivate(`goal:${goal.id}`, goal);
          putPrivate(key, { id: goal.id, fingerprint: digest5 });
          state.revision++;
          write(state);
          return goal;
        });
      },
      readCurrentWork,
      listCurrentWorks,
      recordIntentWithdrawals(workId, rows) {
        return atomicDispatch(() => {
          for (const row of rows) {
            if (row.workId !== workId) fail3("Withdrawal belongs to another work.");
            const key = `intent-withdrawal:${workId}:${row.nativeTaskId}`, prior = readPrivate(key);
            if (prior) {
              if (fingerprint(prior) !== fingerprint(row)) fail3("Recorded withdrawal changed.");
              continue;
            }
            putPrivate(key, row);
          }
        });
      },
      readWork,
      listWorks,
      readDispatchProtocol,
      listDispatches,
      listRunWorks,
      listTeamDispatches,
      dispatchProjection,
      readNativeHistory: nativeHistoryReader({ db, readPrivate, readWork: readCurrentWork, questions }),
      readOwningWork(workId, memberId) {
        const root = readCurrentWork(workId), team = this.effectiveTeamForWork?.(root.id) ?? JSON.parse(db.prepare("SELECT json FROM team_versions WHERE team_id=? AND version=?").get(root.teamId, root.configVersion).json), member = team.members.find((m) => m.id === memberId);
        return listRunWorks(workId).filter((w) => w.supervisorMemberId === member?.boss).at(-1) ?? null;
      },
      prepareManagerRun(parentWorkId, attemptId) {
        return atomicDispatch(() => {
          const parentWork = readCurrentWork(parentWorkId), attempt = listDispatches(parentWorkId).find((a) => a.id === attemptId);
          const prior = listRunWorks(parentWorkId).find((w) => w.parent?.attemptId === attemptId);
          if (prior) return prior;
          const root = readCurrentWork(parentWork.teamWorkId ?? parentWork.id);
          const team = this.effectiveTeamForWork?.(root.id) ?? JSON.parse(db.prepare("SELECT json FROM team_versions WHERE team_id=? AND version=?").get(root.teamId, root.configVersion).json), member = team.members.find((m) => m.id === attempt?.memberId);
          if (root.status === "completed" || parentWork.run.state !== "verified" || attempt?.status !== "running" || attempt.admission !== "committed" || !attempt.dispatchId || !attempt.binding || attempt.supervisorMemberId !== parentWork.supervisorMemberId || !team.members.some((m) => m.boss === member?.id) || listDispatches(parentWorkId).filter((a) => a.taskKey === attempt.taskKey).at(-1)?.id !== attempt.id) fail3("A current genuine manager parent assignment is required.");
          const id2 = randomUUID11(), protocolToken = randomUUID11(), b = attempt.binding;
          const binding = { status: "created", requestId: attempt.id, sourceAttemptId: attempt.id, memberId: member.id, teamId: root.teamId, kind: b.kind, handle: b.handle, ...b.sessionId ? { sessionId: b.liveSessionId ?? b.sessionId } : {}, paneKey: b.paneKey, runtimeId: b.runtimeId, scope: root.scope, nativeRequest: { agent: member.agent, sessionOptions: { model: member.model, effort: member.effort } } };
          const work = { format: "team-work-v1", id: id2, teamWorkId: root.id, teamId: root.teamId, requestId: attempt.id, objective: attempt.instruction, configVersion: team.configVersion, roleVersion: attempt.roleVersion, supervisorMemberId: member.id, scope: root.scope, binding, protocolToken, nativeObjective: `TeamWork ${id2} ${protocolToken}
${attempt.instruction}`, createdAt: (/* @__PURE__ */ new Date()).toISOString(), version: 1, status: "preparing", input: { state: "not_sent" }, processing: { state: "unknown" }, run: { state: "unverified" }, parent: { workId: parentWork.id, runId: attempt.runId, taskId: attempt.nativeTaskId, dispatchId: attempt.dispatchId, attemptId: attempt.id, generation: attempt.generation } };
          validateWork(work);
          persistWork(work);
          return work;
        });
      },
      ensureDispatchProtocol(workId) {
        return atomicDispatch(() => {
          const work = readCurrentWork(workId);
          if (work?.status === "completed" || work?.run.state !== "verified" || !work.instance) fail3("Verify the real supervisor Run before enabling dispatch.");
          const prior = readDispatchProtocol(workId);
          if (prior) {
            if (prior.generation !== work.run.consumerGeneration) fail3("Dispatch protocol belongs to an older Run generation.");
            return prior;
          }
          const protocol = { format: "team-dispatch-protocol-v1", workId, generation: work.run.consumerGeneration, token: randomUUID11(), state: "not_sent", version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
          putPrivate(`dispatch-protocol:${workId}`, protocol);
          return protocol;
        });
      },
      updateDispatchProtocol(workId, version, patch) {
        return atomicDispatch(() => {
          if (readWork(workId)?.status === "completed") fail3("Completed TeamWork is sealed.");
          const row = readDispatchProtocol(workId);
          if (!row || row.version !== version) fail3("Dispatch protocol changed while observing evidence.");
          if (Object.keys(patch).some((key) => !["state", "detail", "nativeSend"].includes(key))) fail3("Immutable dispatch protocol cannot change.");
          Object.assign(row, patch, { version: version + 1 });
          validateDispatchProtocol(row);
          putPrivate(`dispatch-protocol:${workId}`, row);
          return row;
        });
      },
      queueDispatch(workId, intent, detail2) {
        return atomicDispatch(() => {
          if (listDispatches(workId).some((row) => row.nativeTaskId === intent.nativeTaskId)) return;
          putPrivate(`dispatch-queue:${workId}:${intent.nativeTaskId}`, { workId, nativeTaskId: intent.nativeTaskId, taskKey: intent.spec.taskKey, memberId: intent.member.id, memberName: intent.member.name, supervisorMemberId: readWork(workId).supervisorMemberId, configVersion: intent.spec.configVersion, roleVersion: intent.spec.roleVersion, status: "queued", instruction: intent.spec.instruction, dependencies: intent.spec.dependencies ?? [], writeScope: intent.spec.writeScope, detail: String(detail2).slice(0, 1200) });
        });
      },
      prepareDispatch(workId, intent, startParams, reuse) {
        return atomicDispatch(() => {
          const work = readCurrentWork(workId), protocol = readDispatchProtocol(workId);
          if (work?.status === "completed" || work?.run.state !== "verified" || protocol?.state !== "accepted" || protocol.generation !== work.run.consumerGeneration || intent.spec.token !== protocol.token) fail3("Current supervisor admission authority is required.");
          if (work.parent) {
            const parent = readWork(work.parent.workId), a = listDispatches(parent.id).find((a2) => a2.id === work.parent.attemptId);
            if (readWork(work.teamWorkId)?.status === "completed" || a?.status !== "running" || a.evidenceId || a.dispatchId !== work.parent.dispatchId || listDispatches(parent.id).filter((r) => r.taskKey === a.taskKey).at(-1)?.id !== a.id) fail3("Parent attempt is stale or settled; child admission is fenced.");
          }
          const key = `dispatch-intent:${workId}:${intent.spec.taskKey}${intent.spec.previousAttemptId ? `:${intent.spec.previousAttemptId}` : ""}`, digest5 = fingerprint({ spec: intent.spec, nativeTaskId: intent.nativeTaskId });
          const prior = readPrivate(key);
          if (prior) {
            if (prior.fingerprint !== digest5) fail3("Task intent identity conflicts with another input.");
            return { attempt: validateDispatch(readPrivate(`dispatch:${prior.id}`)), fresh: false };
          }
          this.assertAdmission(work.teamId, intent.spec.memberId);
          questions.questionTaskGate(workId, intent.spec.taskKey, intent.nativeTaskId);
          const team = staffing.effectiveTeamForWork(workId), member = team?.members.find((row) => row.id === intent.spec.memberId);
          if (!member || member.boss !== work.supervisorMemberId || member.roleVersion !== intent.spec.roleVersion || intent.spec.configVersion !== team.configVersion) fail3("Only the true direct supervisor can admit this frozen member role.");
          const history = listDispatches(workId), previous = history.filter((row) => row.taskKey === intent.spec.taskKey).at(-1);
          const recovery = reuse?.recoveryRequestId && readPrivate(`wake:${reuse.recoveryRequestId}`), recoveredPrior = recovery && recovery.handoff?.decision === "replace" && recovery.handoff.reviewer === work.supervisorMemberId && (recovery.oldBinding.sourceAttemptId === previous?.id || previous?.reuse?.requestId === recovery.oldBinding.requestId) && recovery.newInstance?.requestId === reuse.requestId;
          if (previous && (!intent.spec.previousAttemptId || intent.spec.previousAttemptId !== previous.id || previous.status !== "rework" && !recoveredPrior || previous.memberId !== member.id)) fail3("A new attempt requires the current direct supervisor rework decision.");
          if (!previous && intent.spec.previousAttemptId) fail3("Rework attempt does not exist in this TeamWork.");
          const stopAttempts = new Set(stops.listStops().filter((row) => ["intent", "submitted", "unknown"].includes(row.state)).map((row) => row.target.attemptId));
          const writeScope = declaredWriteScope(intent.spec.writeScope), conflict = scopeBlocker(listTeamDispatches(work.teamWorkId ?? work.id).filter((a) => a.id !== work.parent?.attemptId).map((a) => ({ ...a, originalTaskKey: a.taskKey, ...stopAttempts.has(a.id) ? { status: "unknown" } : {}, taskKey: `${a.workId}:${a.taskKey}` })), `${workId}:${intent.spec.taskKey}`, writeScope);
          if (conflict && !intent.unadmitted) fail3(`Write scope conflicts with ${conflict.originalTaskKey ?? conflict.taskKey}; wait for direct supervisor acceptance or resolve its unknown result.`);
          if (previous && JSON.stringify(writeScope) !== JSON.stringify(previous.writeScope ?? [])) fail3("Rework must preserve the declared write scope.");
          const dependencies = intent.spec.dependencies ?? [];
          if (previous && JSON.stringify(dependencies) !== JSON.stringify(previous.dependencies ?? [])) fail3("Rework must preserve business task dependencies.");
          if (dependencies.some((key2) => history.filter((row) => row.taskKey === key2).at(-1)?.status !== "accepted")) fail3("Application dependencies await direct supervisor acceptance.");
          const reservation = readPrivate(`dispatch-member:${member.id}`), retained = reservation && history.find((row) => row.id === reservation.id);
          const preparedPointer = readPrivate(`binding:${member.id}`), prepared2 = preparedPointer && readOperation(preparedPointer.requestId);
          if (preparedPointer && (!reuse || reuse.kind === "prepared" && (reuse.requestId !== preparedPointer.requestId || (reuse.instanceGeneration ?? 1) !== (preparedPointer.instanceGeneration ?? 1) || prepared2?.status !== "created" || prepared2.memberId !== member.id || prepared2.teamId !== work.teamId || prepared2.scope?.workspaceKey !== work.scope.workspaceKey))) fail3("This member already has an active launch binding; verify it before reuse.");
          const recoveredMember = recovery && recovery.newInstance?.requestId === prepared2?.requestId && (recovery.oldBinding.sourceAttemptId === retained?.id || retained?.reuse?.requestId === recovery.oldBinding.requestId) && (["accepted", "rework"].includes(retained?.status) || recovery.handoff?.decision === "replace" && recovery.handoff.reviewer === work.supervisorMemberId);
          if (reuse?.kind === "prepared" && (!prepared2 || reservation && !recoveredMember || startParams.terminal !== reuse.terminal)) fail3("Prepared member reservation changed.");
          if (reservation && !recoveredMember && (!reuse || retained?.id !== reuse.attemptId || !["accepted", "rework"].includes(retained.status) || JSON.stringify(retained.binding) !== JSON.stringify(reuse.binding) || startParams.terminal !== reuse.terminal)) fail3("This member already has a reserved or active binding. Reconcile it before another dispatch.");
          if (reuse && reuse.kind !== "prepared" && !reservation) fail3("Retained member reservation changed.");
          const instanceGeneration = reuse?.instanceGeneration ?? retained?.instanceGeneration ?? (readPrivate(`binding-generation:${member.id}`)?.generation ?? 0) + 1;
          const id2 = randomUUID11(), attempt = { format: "team-dispatch-v1", id: id2, attemptId: id2, instanceGeneration, workId, teamWorkId: work.teamWorkId ?? work.id, runId: work.run.id, teamId: work.teamId, supervisorMemberId: work.supervisorMemberId, memberId: member.id, memberName: member.name, nativeTaskId: intent.nativeTaskId, taskKey: intent.spec.taskKey, taskSpec: intent.taskSpec, dependencies, writeScope, reviewToken: randomUUID11(), ...previous ? { previousAttemptId: previous.id } : {}, configVersion: team.configVersion, roleVersion: member.roleVersion, role: intent.spec.role, instruction: intent.spec.instruction, token: protocol.token, generation: protocol.generation, scope: work.scope, startParams, ...reuse ? { reuse } : {}, createRequestId: intent.requestId, createPayloadHash: intent.payloadHash, admission: intent.unadmitted ? "unadmitted" : "committed", status: intent.unadmitted ? "unknown" : "admitted", permit: { state: intent.unadmitted ? "unknown" : "not_sent" }, ...intent.unadmitted ? { detail: "Native work started before plugin admission. Reserved for reconciliation; no permit or replacement was sent." } : {}, version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
          validateDispatch(attempt);
          db.prepare("DELETE FROM receipts WHERE id=?").run(`dispatch-queue:${workId}:${intent.nativeTaskId}`);
          putPrivate(`dispatch:${id2}`, attempt);
          putPrivate(key, { id: id2, fingerprint: digest5 });
          putPrivate(`dispatch-member:${member.id}`, { id: id2, workId });
          return { attempt, fresh: true };
        });
      },
      recordDispatchReview(id2, review) {
        return atomicDispatch(() => {
          const row = validateDispatch(readPrivate(`dispatch:${id2}`)), work = readCurrentWork(row.workId), current = listDispatches(row.workId).filter((other) => other.taskKey === row.taskKey).at(-1);
          if (row.review) {
            if (row.review.requestId === review.requestId && row.review.payloadHash === review.payloadHash) return row;
            fail3("This attempt already has an immutable supervisor decision.");
          }
          if (work?.status === "completed" || review.reviewToken !== (row.reviewAuthority?.reviewToken ?? row.reviewToken) || review.protocolToken !== readDispatchProtocol(row.workId)?.token || current?.id !== row.id || row.status !== "pending_acceptance" || work?.run.state !== "verified" || work.run.consumerGeneration !== review.generation || (row.reviewAuthority?.generation ?? row.generation) !== review.generation || review.attemptId !== id2 || review.reviewerMemberId !== row.supervisorMemberId || !review.evidenceRefs?.includes(row.evidenceId) || !["accept", "rework"].includes(review.decision)) fail3("Review is not for the current completed attempt and supervisor.");
          if (review.decision === "accept") for (const child of listRunWorks(row.teamWorkId ?? row.workId).filter((w) => w.parent?.attemptId === row.id)) {
            if (child.run.state !== "verified" || latestBusinessAttempts(listDispatches(child.id)).some((a) => a.status !== "accepted") || queuedTasks(child.id).length || questions.listQuestions(child.id).some(questionNeedsProcessing)) fail3("Manager acceptance awaits descendant results and questions.");
          }
          const event = { ...review, workId: row.workId, taskKey: row.taskKey, nativeTaskId: row.nativeTaskId, dispatchId: row.dispatchId, recordedAt: (/* @__PURE__ */ new Date()).toISOString() };
          row.review = event;
          row.status = review.decision === "accept" ? "accepted" : "rework";
          row.version++;
          row.detail = review.decision === "accept" ? "Direct supervisor accepted the execution and validation evidence." : "Direct supervisor requested rework; dependencies remain blocked.";
          validateDispatch(row);
          putPrivate(`dispatch-review:${row.id}`, event);
          putPrivate(`dispatch:${row.id}`, row);
          return row;
        });
      },
      updateDispatch(id2, version, patch, expectedWorkVersion) {
        return atomicDispatch(() => {
          const row = validateDispatch(readPrivate(`dispatch:${id2}`));
          if (readWork(row.workId)?.status === "completed") fail3("Completed TeamWork is sealed.");
          if (expectedWorkVersion !== void 0 && readWork(row.workId)?.version !== expectedWorkVersion) fail3("TeamWork changed during recovery.");
          if (row.version !== version) fail3(DISPATCH_OBSERVATION_CHANGED);
          if (Object.keys(patch).some((key) => !["admission", "status", "permit", "dispatchId", "creatorDispatchId", "depth", "binding", "nativeState", "startRequestId", "startPayloadHash", "outcome", "result", "evidenceId", "detail", "recovery"].includes(key))) fail3("Immutable Dispatch identity cannot change.");
          if (patch.admission !== void 0 && (patch.admission !== "unadmitted" || row.permit.state !== "not_sent")) fail3("Admission cannot be rewritten after a permit attempt.");
          if (row.dispatchId && patch.dispatchId && row.dispatchId !== patch.dispatchId) fail3("Late native evidence belongs to a different Dispatch.");
          if (row.evidenceId && patch.evidenceId && row.evidenceId !== patch.evidenceId) fail3("Execution result already has immutable native evidence.");
          if (row.binding && patch.binding && ["kind", "handle", "sessionId", "paneKey", "incarnationId", "runtimeId", "workspaceId", "executionHostId"].some((key) => row.binding[key] !== patch.binding[key])) fail3("Saved member execution instance changed; prior binding remains reserved.");
          if (patch.binding && listDispatches().some((other) => other.memberId !== row.memberId && other.binding && (patch.binding.sessionId ? other.binding.sessionId === patch.binding.sessionId : other.binding.handle === patch.binding.handle && other.binding.incarnationId === patch.binding.incarnationId))) fail3("Native session is already bound to another member.");
          if (row.evidenceId) {
            if (patch.recovery) {
              row.recovery = patch.recovery;
              row.version = version + 1;
              putPrivate(`dispatch:${id2}`, row);
            }
            return row;
          }
          Object.assign(row, patch, { version: version + 1 });
          validateDispatch(row);
          putPrivate(`dispatch:${id2}`, row);
          if (row.binding && row.reuse?.recoveryRequestId) {
            const wake = readPrivate(`wake:${row.reuse.recoveryRequestId}`);
            if (wake && wake.newInstance?.requestId === row.reuse.requestId && wake.state === "replacing") {
              wake.state = "bound";
              wake.newInstance = { ...wake.newInstance, attemptId: row.id, dispatchId: row.dispatchId };
              wake.version++;
              putPrivate(`wake:${wake.requestId}`, wake);
              db.prepare("DELETE FROM receipts WHERE id=?").run(`wake-member:${row.memberId}`);
            }
          }
          if (row.binding && readPrivate(`dispatch-member:${row.memberId}`)?.id === row.id) putPrivate(`dispatch-binding:${row.memberId}`, { workId: row.workId, attemptId: row.id, dispatchId: row.dispatchId, ...row.binding });
          return row;
        });
      },
      prepareWork(input) {
        workInput(input);
        const digest5 = fingerprint(input);
        db.exec("BEGIN IMMEDIATE");
        try {
          const request = db.prepare("SELECT json FROM receipts WHERE id=?").get(`work-request:${input.requestId}`);
          if (request) {
            const saved = JSON.parse(request.json);
            if (saved.fingerprint !== digest5) fail3("Objective request identity conflicts with another input.");
            const work2 = readWork(saved.workId);
            if (!work2) fail3("Saved objective is missing.");
            db.exec("COMMIT");
            return { work: work2, fresh: false };
          }
          const state = readSnapshot(), team = state.teams.find((row) => row.id === input.teamId), supervisor = team?.members.find((row) => row.boss === null);
          const nextGoal = lifecycle.nextGoal(input.teamId);
          if (nextGoal && (input.requestId !== nextGoal.workRequestId || input.objective !== nextGoal.objective || team?.configVersion !== nextGoal.configVersion)) fail3("A queued-goal transition reserves this team.");
          if (nextGoal && Object.entries(nextGoal.launchRequests).some(([memberId, id3]) => readPrivate(`binding:${memberId}`)?.requestId !== id3 || readOperation(id3)?.status !== "created")) fail3("Queued goal awaits verified fresh preparation sessions.");
          if (!supervisor) fail3("Saved team supervisor is missing.");
          if (db.prepare("SELECT id FROM receipts WHERE id=?").get(`active-work:${team.id}`)) fail3("This team already has a total objective in progress. Check its active work.");
          if (state.revision !== input.expectedRevision) fail3("Another panel changed team data. Reload before submitting the objective.");
          const requestId = team.launch?.members?.[supervisor.id]?.requestId, binding = requestId && readOperation(requestId);
          if (binding?.status !== "created" || binding.teamId !== team.id || binding.memberId !== supervisor.id || !binding.handle) fail3("Launch and verify the registered highest supervisor before submitting a total objective.");
          if (listWorks().some((w) => w.teamId === team.id && (binding.kind === "structured" ? w.binding.sessionId === binding.sessionId : w.binding.handle === binding.handle || w.binding.paneKey === binding.paneKey))) fail3("New TeamWork requires a fresh native conversation; old session authority cannot be reused.");
          if (supervisor.agent !== binding.nativeRequest.agent || supervisor.model !== (binding.nativeRequest.sessionOptions?.model ?? "default") || supervisor.effort !== (binding.nativeRequest.sessionOptions?.effort ?? "default")) fail3("The prepared supervisor preferences differ from the saved preferences. Restore its original requested preferences or replace the session through a supported lifecycle action first.");
          if (db.prepare("SELECT id FROM receipts WHERE id=?").get(`session-work:${requestId}`)) fail3("This preparation session has already accepted a total objective.");
          const scope = JSON.parse(db.prepare("SELECT json FROM scopes WHERE team_id=?").get(team.id).json);
          const id2 = randomUUID11(), protocolToken = randomUUID11();
          const work = { format: "team-work-v1", id: id2, teamId: team.id, requestId: input.requestId, objective: input.objective, configVersion: team.configVersion, roleVersion: supervisor.roleVersion, supervisorMemberId: supervisor.id, scope, binding, recipientBindings: Object.values(team.launch?.members ?? {}).map((r) => readOperation(r.requestId)).filter(Boolean), protocolToken, nativeObjective: `TeamWork ${id2} ${protocolToken}
${input.objective}`, createdAt: (/* @__PURE__ */ new Date()).toISOString(), version: 1, status: "preparing", input: { state: "not_sent" }, processing: { state: "unknown" }, run: { state: "unverified" } };
          if (nextGoal) {
            work.handoff = nextGoal.handoff;
            work.previousWorkId = nextGoal.previousWorkId;
            nextGoal.status = "started";
            nextGoal.workId = work.id;
            putPrivate(`goal:${nextGoal.id}`, nextGoal);
            db.prepare("DELETE FROM receipts WHERE id=?").run(`next-goal:${team.id}`);
          }
          persistWork(work);
          for (const [key, value] of [[`work-request:${input.requestId}`, { workId: id2, fingerprint: digest5 }], [`active-work:${team.id}`, { workId: id2 }], [`session-work:${requestId}`, { workId: id2 }]]) db.prepare("INSERT INTO receipts VALUES (?,?)").run(key, JSON.stringify(value));
          state.revision++;
          write(state);
          db.exec("COMMIT");
          return { work, fresh: true };
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      updateWork(id2, version, patch) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const work = readWork(id2);
          if (!work || work.version !== version) fail3("TeamWork changed while native evidence was being observed.");
          if (work.status === "completed") fail3("Completed TeamWork is sealed.");
          const permitted = ["status", "input", "processing", "run", "snapshot", "error", "instance", "nativeSend"];
          if (Object.keys(patch).some((key) => !permitted.includes(key))) fail3("Immutable TeamWork identity cannot be changed.");
          const current = readCurrentWork(id2), before = Object.fromEntries(Object.keys(patch).map((key) => [key, current[key]])), after = { ...patch };
          for (const value of [before, after]) for (const key of ["run", "snapshot"]) if (value[key]) value[key] = { ...value[key], observedAt: void 0 };
          const nextVersion = version + (fingerprint(before) === fingerprint(after) ? 0 : 1);
          if (work.currentSupervisor) {
            Object.assign(work.currentSupervisor, patch);
            work.version = nextVersion;
          } else Object.assign(work, patch, { version: nextVersion });
          validateWork(work);
          persistWork(work);
          db.exec("COMMIT");
          return readCurrentWork(id2);
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      prepareOperation(input, intent) {
        const digest5 = fingerprint(input);
        db.exec("BEGIN IMMEDIATE");
        try {
          const previous = readOperation(input.requestId);
          if (previous) {
            if (previous.fingerprint !== digest5) fail3("Request identity conflicts with another launch input.");
            db.exec("COMMIT");
            return { operation: previous, fresh: false };
          }
          const team = readSnapshot().teams.find((row) => row.id === input.teamId);
          const member = team?.members.find((row) => row.id === input.memberId);
          if (!member || !initialMembers(team).some((row) => row.id === member.id) || team.configVersion !== input.configVersion) fail3("Launch requires a member selected by the saved roster preparation mode.");
          staffing.assertStaffingPreparation(member.id, input.requestId);
          const nextGoal = lifecycle.nextGoal(input.teamId);
          if (nextGoal && (nextGoal.launchRequests[input.memberId] !== input.requestId || nextGoal.configVersion !== input.configVersion)) fail3("Queued transition requires its saved fresh launch identity.");
          const bindingKey = `binding:${input.memberId}`;
          if (db.prepare("SELECT id FROM receipts WHERE id=?").get(bindingKey) || readPrivate(`dispatch-member:${member.id}`) || team.launch?.members?.[member.id]) fail3("This member already has a launch or unresolved binding. Inspect its saved operation.");
          const instanceGeneration = (readPrivate(`binding-generation:${input.memberId}`)?.generation ?? 0) + 1;
          const operation = { ...intent, ...input, fingerprint: digest5, status: "unknown", effectState: "intent", instanceGeneration, version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
          db.prepare("INSERT INTO receipts VALUES (?,?)").run(bindingKey, JSON.stringify({ requestId: input.requestId, instanceGeneration }));
          persistOperation(operation);
          db.exec("COMMIT");
          return { operation, fresh: true };
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      settleOperation(requestId, nativeOperationId, patch, expectedVersion) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const operation = readOperation(requestId);
          if (!operation || operation.nativeRequest.operationId !== nativeOperationId) fail3("Launch settlement does not match its operation.");
          if (expectedVersion !== void 0 && (operation.version ?? 1) !== expectedVersion) fail3("Operation changed while observing evidence; stale panel observation discarded.");
          if (operation.status === "created" && patch.status === "unknown") {
            db.exec("COMMIT");
            return operation;
          }
          if (operation.handle && patch.handle && (operation.kind !== patch.kind || (operation.kind === "structured" ? operation.sessionId !== patch.sessionId : operation.handle !== patch.handle && (!operation.paneKey || operation.paneKey !== patch.paneKey)))) fail3("Launch settlement conflicts with its saved identity.");
          const observationOnly = (!patch.status || patch.status === operation.status) && (!patch.handle || patch.handle === operation.handle);
          Object.assign(operation, patch, { version: (operation.version ?? 1) + 1 });
          persistOperation(operation, observationOnly);
          db.exec("COMMIT");
          return operation;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      readSnapshot,
      replay(op, input) {
        readSnapshot();
        if (typeof input?.requestId !== "string") fail3("Invalid request identity.");
        const previous = db.prepare("SELECT fingerprint,result FROM requests WHERE id=?").get(input.requestId);
        if (!previous) return null;
        if (previous.fingerprint !== fingerprint({ op, input })) fail3("Request identity conflicts with another input.");
        const saved = JSON.parse(previous.result);
        return saved.format === "history-pruned-replay-v1" ? readSnapshot() : validatePersistentState(saved);
      },
      readScope(teamId) {
        const row = db.prepare("SELECT json FROM scopes WHERE team_id=?").get(teamId);
        if (!row) fail3("Saved team scope was not found.");
        const scope = JSON.parse(row.json);
        const saved = readSnapshot().teams.find((team) => team.id === teamId)?.scope;
        if (!saved || !scope || ["workspaceKey", "executionHostId", "kind"].some((key) => saved[key] !== scope[key]) || fingerprint([scope.workspaceId, scope.executionHostId]) !== scope.workspaceKey) fail3("Saved project binding is damaged. Original data has been preserved.");
        return scope;
      },
      createTeam(input, scope) {
        return mutate("createTeam", input, (next) => {
          if (!scope?.workspaceId || !scope.executionHostId || !["git", "folder"].includes(scope.kind)) fail3("Confirm a verified project and execution host before saving.");
          const team = planTeam(input.form);
          const ids = new Map(team.members.map((member) => [member.id, randomUUID11()]));
          team.id = randomUUID11();
          team.createdAt = (/* @__PURE__ */ new Date()).toISOString();
          team.configVersion = 1;
          team.scope = publicScope(scope);
          team.members = team.members.map((member) => ({ ...member, id: ids.get(member.id), boss: member.boss ? ids.get(member.boss) : null, roleVersion: 1, habits: "", collaboration: "" }));
          db.prepare("INSERT INTO scopes VALUES (?,?)").run(team.id, JSON.stringify(scope));
          archive(team);
          next.teams.push(team);
        });
      },
      updateAgentPreferences(input) {
        return mutate("updateAgentPreferences", input, (next) => {
          const team = next.teams.find((row) => row.id === input.teamId);
          if (!team) fail3("Choose a saved team.");
          const member = input.memberId ? team.members.find((row) => row.id === input.memberId) : null;
          if (input.memberId ? !member || input.level !== void 0 : ![1, 2, 3].includes(input.level) || !team.members.some((row) => row.level === input.level)) fail3("Choose a member or hierarchy level.");
          const preferences = input.inherit === true && member ? { agent: team.configuration.agents[member.level - 1], model: team.configuration.models[member.level - 1], effort: team.configuration.efforts[member.level - 1] } : { agent: input.agent, model: input.model, effort: input.effort };
          if (!["codex", "claude"].includes(preferences.agent) || [preferences.model, preferences.effort].some((value) => typeof value !== "string" || !value.trim() || value.length > 120) || preferences.model === "default" && preferences.effort !== "default") fail3("Choose a valid agent, model and effort; default model inherits its effort.");
          if (member) Object.assign(member, preferences, { preferenceOverride: input.inherit !== true });
          else {
            for (const [key, values] of [["agent", "agents"], ["model", "models"], ["effort", "efforts"]]) team.configuration[values][input.level - 1] = preferences[key];
            for (const row of team.members) if (row.level === input.level && !row.preferenceOverride) Object.assign(row, preferences);
          }
          team.configVersion++;
          archive(team);
        });
      },
      beginLaunch(input) {
        return mutate("beginLaunch", input, (next) => {
          const team = next.teams.find((row) => row.id === input.teamId);
          if (!team || !["on-demand", "all"].includes(input.mode)) fail3("Choose a saved team and launch mode.");
          if (team.launch) fail3("This launch has already been attempted. Inspect the saved receipts.");
          team.launch = { native: true, status: "sending", mode: input.mode, workspaceKey: team.scope.workspaceKey, configVersion: team.configVersion, members: {} };
        });
      },
      readReceipt(id2) {
        const row = db.prepare("SELECT json FROM receipts WHERE id=?").get(id2);
        return row ? JSON.parse(row.json) : null;
      },
      writeReceipt(id2, receipt) {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("INSERT INTO receipts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(id2, JSON.stringify(receipt));
          const next = readSnapshot();
          const team = next.teams.find((row) => row.members.some((member) => `launch:${row.id}-${member.id}` === id2));
          if (team?.launch) {
            const member = team.members.find((member2) => `launch:${team.id}-${member2.id}` === id2);
            team.launch.members[member.id] = receipt.handle ? { status: "created", terminalId: receipt.handle, title: receipt.title, briefAccepted: receipt.briefAccepted === true, executionHostId: receipt.executionHostId ?? null, ...receipt.warning ? { error: receipt.warning } : {} } : { status: receipt.status === "starting" ? "starting" : "unknown", ...receipt.error ? { error: receipt.error } : {} };
            team.launch.status = receipt.status === "unknown" ? "unknown" : "accepted";
            next.revision++;
            write(next);
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      updateSettings(input) {
        return mutate("updateSettings", input, (next) => {
          if (typeof input.settings?.chart !== "boolean" || !["stacked", "columns"].includes(input.settings.layout)) fail3("Invalid display settings.");
          next.settings = { chart: input.settings.chart, layout: input.settings.layout };
        });
      },
      updateRole(input) {
        return mutate("updateRole", input, (next) => {
          const team = next.teams.find((row) => row.id === input.teamId);
          const member = team?.members.find((row) => row.id === input.memberId);
          if (!member) fail3("Member was not found in this team.");
          for (const key of ["brief", "habits", "collaboration"]) {
            if (typeof input[key] !== "string" || input[key].length > 1500 || key === "brief" && !input[key].trim()) fail3("Role text must be valid and under 1500 characters.");
            member[key] = input[key];
          }
          member.roleVersion++;
          team.configVersion++;
          archive(team);
          for (const work of listWorks().filter((w) => w.teamId === team.id && w.status !== "completed")) staffing.recordConfigurationAmendment(work.id, team, { requestId: input.requestId, kind: "role-update", memberIds: [member.id] });
        });
      },
      readTeamVersion(teamId, version) {
        const row = db.prepare("SELECT json FROM team_versions WHERE team_id=? AND version=?").get(teamId, version);
        if (!row) fail3("Configuration version was not found.");
        return JSON.parse(row.json);
      },
      readRoleVersion(memberId, version) {
        const row = db.prepare("SELECT json FROM role_versions WHERE member_id=? AND version=?").get(memberId, version);
        if (!row) fail3("Role version was not found.");
        return JSON.parse(row.json);
      },
      close() {
        if (!closed) {
          db.close();
          closed = true;
        }
      }
    };
  } catch (error) {
    db.close();
    throw new Error(`Cannot open team storage: ${error.message}`);
  }
}

// src/worker.mjs
function activate(orca) {
  const internalKey = randomBytes4(32).toString("hex");
  let ready;
  let initialising = false;
  let executorPromise;
  let storePromise;
  let storeProfile;
  const executorFor = async (report) => {
    if (storeProfile && storeProfile !== report.cliPaths.userData) throw new Error("Orca profile changed; restart the plugin worker before continuing.");
    storeProfile = report.cliPaths.userData;
    storePromise ??= openTeamStore({ userData: storeProfile }).catch((error) => {
      storePromise = null;
      throw error;
    });
    executorPromise ??= Promise.all([locateCli(void 0, void 0, report.cliPaths), storePromise]).then(([command, store]) => createExecutor(orca.host, createCliRunner(command), { store, internalKey, userData: storeProfile, parentPid: report.parentPid ?? process.ppid })).catch((error) => {
      executorPromise = null;
      throw error;
    });
    return executorPromise;
  };
  const publicReport = ({ cliPaths, internalKey: ignoredKey, ...report }) => report;
  const initialise = () => {
    if (ready) return ready;
    initialising = true;
    ready = Promise.resolve().then(async () => {
      await orca.host.call("storage.get", { key: "team-definitions-v1" });
      const report = await bootstrap({ version: "0.1.12", internalKey, consent: () => orca.host.call("storage.get", { key: "team-work-consent-v1" }) });
      orca.log(report.detail);
      if (report.ready) void executorFor(report).then((executor) => executor.resumeWork()).catch(() => orca.log("Team storage or pending work is unavailable; inspect the panel recovery details."));
      return report;
    }).catch((error) => {
      ready = null;
      if (/not enabled|current consent|no longer approved/i.test(error.message)) throw new Error("Orca denied the local worker permission check. Let any plugin refresh finish, then retry Initialise local adapter. If Orca marks Team Orchestrator as needing review, review and enable it in Settings > Plugins.");
      throw error;
    }).finally(() => {
      initialising = false;
    });
    return ready;
  };
  orca.commands.register("team.initialise", async () => {
    if (!initialising) ready = null;
    return publicReport(await initialise());
  });
  orca.commands.register("team.control", async (args) => {
    const report = await initialise();
    if (!args || args.op === "ping") return { nonce: args?.nonce, ...publicReport(report), workerPid: process.pid };
    if (!report.ready) throw new Error(report.detail);
    if (!report.cliPaths) throw new Error("Orca bootstrap did not resolve the local runtime profile. Retry Initialise local adapter.");
    if (args.op === "storageRecovery") return inspectTeamStorage({ userData: report.cliPaths.userData });
    return (await executorFor(report)).execute(args);
  });
  for (const event of ["worktree.created", "agent.status.changed"]) orca.events.on(event, () => initialise());
  initialise().catch((error) => orca.log(`Bootstrap failed: ${error.message}`));
}
export {
  activate as default
};
