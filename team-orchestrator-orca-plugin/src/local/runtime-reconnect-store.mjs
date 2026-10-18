import { createHash } from 'node:crypto';
import { canonical } from './native-mutation.mjs';
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const fail = (message) => {
  throw Error(message);
};
export function runtimeReconnectStore({
  db,
  readPrivate,
  putPrivate,
  readWork,
  persistWork,
  readSnapshot,
  readOperation,
  readDispatchProtocol,
  atomic,
}) {
  const all = () =>
    db
      .prepare('SELECT id,json FROM receipts ORDER BY id')
      .all()
      .map((row) => ({ key: row.id, value: JSON.parse(row.json) }));
  function readControl(work) {
    const pointer = readPrivate(`runtime-control:${work.id}`);
    if (!pointer) return null;
    const row = readPrivate(`runtime-reconnect:${pointer.requestId}`);
    if (row && work.currentSupervisor && row.bindingRequestId !== work.binding.requestId)
      return null;
    if (
      !row ||
      row.format !== 'same-instance-runtime-control/v1' ||
      row.workId !== work.id ||
      row.bindingRequestId !== work.binding.requestId ||
      row.scopeKey !== work.scope.workspaceKey ||
      row.runId !== work.run.id ||
      row.generation !== work.run.consumerGeneration ||
      row.ownerDigest !== digest(work.instance) ||
      typeof row.runtimeId !== 'string' ||
      !row.runtimeId ||
      !Array.isArray(row.members) ||
      row.members.length === 0 ||
      row.proofDigest !== digest(row.proof)
    )
      fail(
        'Saved runtime recovery evidence is damaged. Keep the existing sessions and reconnect the plugin.',
      );
    return row;
  }
  function snapshot(input) {
    const work = readWork(input.workId),
      state = readSnapshot(),
      team = state.teams.find((t) => t.id === work?.teamId);
    if (
      !work ||
      work.parent ||
      work.currentSupervisor ||
      work.recoveryRequestId ||
      work.status === 'completed' ||
      work.run.state === 'fenced' ||
      work.scope.executionHostId !== 'local' ||
      work.binding.kind !== 'terminal' ||
      !work.run.id ||
      !Number.isSafeInteger(work.run.consumerGeneration) ||
      !work.instance
    )
      fail('Reconnect requires the original local terminal supervisor and its saved Run.');
    if (work.version !== input.expectedWorkVersion || state.revision !== input.expectedRevision)
      fail('Work or team changed. Reload before reconnecting the existing team.');
    if (
      !team ||
      team.configVersion !== work.configVersion ||
      readPrivate(`active-work:${team.id}`)?.workId !== work.id
    )
      fail('The active work or saved team configuration changed.');
    const protocol = readDispatchProtocol(work.id);
    if (
      work.input.state !== 'accepted' ||
      !work.nativeSend ||
      protocol?.state !== 'accepted' ||
      protocol.generation !== work.run.consumerGeneration
    )
      fail('Objective or admission input is unresolved. Reconnect never resends it.');
    const operations = team.members.map((member) => {
      const pointer = readPrivate(`binding:${member.id}`),
        op = pointer && readOperation(pointer.requestId),
        original = work.recipientBindings?.find((r) => r.memberId === member.id);
      if (
        !op ||
        !original ||
        op.requestId !== original.requestId ||
        op.status !== 'created' ||
        op.kind !== 'terminal' ||
        op.runtimeId !== work.binding.runtimeId ||
        op.teamId !== team.id ||
        op.configVersion !== work.configVersion ||
        op.roleVersion !== member.roleVersion ||
        op.scope?.workspaceKey !== work.scope.workspaceKey ||
        (pointer.instanceGeneration ?? 1) !== (op.instanceGeneration ?? 1) ||
        (original.instanceGeneration ?? 1) !== (op.instanceGeneration ?? 1) ||
        op.nativeRequest.agent !== member.agent ||
        (op.nativeRequest.sessionOptions?.model ?? 'default') !== member.model ||
        (op.nativeRequest.sessionOptions?.effort ?? 'default') !== member.effort
      )
        fail('A prepared member changed or has unresolved launch evidence.');
      if (
        ['handle', 'paneKey', 'kind', 'runtimeId', 'roleVersion', 'configVersion'].some(
          (key) => op[key] !== original[key],
        ) ||
        digest(op.nativeRequest) !== digest(original.nativeRequest) ||
        ['ptyId', 'incarnationId', 'processIncarnation'].some(
          (key) => op.observation?.[key] !== original.observation?.[key],
        )
      )
        fail('The original prepared recipient identity changed.');
      if (
        !op.observation?.ptyId ||
        !op.observation?.incarnationId ||
        op.observation.processIncarnation !==
          `${op.observation.ptyId}:${op.observation.incarnationId}` ||
        !op.paneKey ||
        /placeholder/.test(op.paneKey)
      )
        fail('A prepared member lacks exact original process and pane evidence.');
      return op;
    });
    if (
      operations.find((o) => o.memberId === work.supervisorMemberId)?.requestId !==
      work.binding.requestId
    )
      fail('The original supervisor binding changed.');
    if (
      new Set(operations.map((o) => o.handle)).size !== operations.length ||
      new Set(operations.map((o) => o.paneKey)).size !== operations.length
    )
      fail('Prepared member identities overlap.');
    const members = new Set(team.members.map((m) => m.id)),
      records = all();
    for (const { key, value: r } of records) {
      const sameWork = r.workId === work.id || r.teamWorkId === work.id;
      const deliveredSessionGuide = key.startsWith('question-event:') && r.kind === 'TEAM_SESSION_DECISIONS' && r.state === 'accepted' && r.data?.workId === work.id;
      if (
        sameWork && !deliveredSessionGuide &&
        /^(dispatch:|dispatch-queue:|question:|question-answer:|question-event:|collaboration:|staffing-proposal:|roster-delta:|configuration-amendment:|delivery:|native-run-binding:|intent-withdrawal:)/.test(
          key,
        )
      )
        fail('Reconnect requires a quiet Run with no Task, question, staffing or delivery work.');
      if (
        key.startsWith('stop:') &&
        members.has(r.target?.memberId) &&
        ['intent', 'submitted', 'unknown'].includes(r.state)
      )
        fail('An unresolved Stop prevents reconnecting.');
      if (
        key.startsWith('wake:') &&
        members.has(r.memberId) &&
        !['bound', 'resumed'].includes(r.state)
      )
        fail('An unresolved member recovery prevents reconnecting.');
      if (key.startsWith('organization:') && r.teamId === team.id && r.state === 'pending')
        fail('A pending organization change prevents reconnecting.');
      if (key.startsWith('operation:') && r.teamId === team.id && r.status === 'unknown')
        fail('An unresolved launch prevents reconnecting.');
      if (sameWork && ['sending', 'unknown', 'queued'].includes(r.input?.state))
        fail('A pending or unknown input prevents reconnecting.');
    }
    const checkpoint = {
      work,
      team,
      revision: state.revision,
      operations,
      protocol,
      control: readControl(work),
      records: records.filter(
        ({ value: r }) =>
          r.workId === work.id ||
          r.teamWorkId === work.id ||
          r.teamId === team.id ||
          members.has(r.memberId) ||
          members.has(r.target?.memberId),
      ),
    };
    return { ...checkpoint, digest: digest(checkpoint) };
  }
  return {
    readRuntimeControl: readControl,
    runtimeReconnectSnapshot: snapshot,
    replayRuntimeReconnect(input) {
      const row = readPrivate(`runtime-reconnect:${input.requestId}`);
      if (!row) return null;
      if (row.inputDigest !== digest(input))
        fail('Reconnect request identity conflicts with another input.');
      return row;
    },
    commitRuntimeReconnect(input, expected, proof) {
      return atomic(() => {
        const prior = readPrivate(`runtime-reconnect:${input.requestId}`);
        if (prior) {
          if (prior.inputDigest !== digest(input))
            fail('Reconnect request identity conflicts with another input.');
          return prior;
        }
        const current = snapshot(input);
        if (current.digest !== expected.digest)
          fail('Team evidence changed during reconnect. No control binding was changed.');
        const work = current.work,
          previous = current.control;
        if (previous?.runtimeId === proof.runtimeId)
          fail('These sessions are already connected to this Orca runtime.');
        const row = {
          format: 'same-instance-runtime-control/v1',
          requestId: input.requestId,
          inputDigest: digest(input),
          workId: work.id,
          teamId: work.teamId,
          bindingRequestId: work.binding.requestId,
          scopeKey: work.scope.workspaceKey,
          runId: work.run.id,
          generation: work.run.consumerGeneration,
          ownerDigest: digest(work.instance),
          fromRuntimeId: previous?.runtimeId ?? work.binding.runtimeId,
          runtimeId: proof.runtimeId,
          previousRequestId: previous?.requestId ?? null,
          members: current.operations.map((o) => ({
            requestId: o.requestId,
            memberId: o.memberId,
            instanceGeneration: o.instanceGeneration ?? 1,
          })),
          proof,
          proofDigest: digest(proof),
          createdAt: new Date().toISOString(),
        };
        putPrivate(`runtime-reconnect:${input.requestId}`, row);
        putPrivate(`runtime-control:${work.id}`, { requestId: input.requestId, workId: work.id });
        persistWork({
          ...work,
          version: work.version + 1,
          status: 'active',
          run: {
            ...work.run,
            state: 'verified',
            detail:
              'The original Run and all prepared sessions were rechecked after Orca restarted.',
          },
          snapshot: { tasks: [], stale: false, observedAt: row.createdAt },
          error: undefined,
        });
        return row;
      });
    },
  };
}
