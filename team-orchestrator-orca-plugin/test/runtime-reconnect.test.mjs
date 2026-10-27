import { endpointFor } from './endpoint.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './dispatch-fixture.mjs';
import { createWorkService } from '../src/local/teamwork.mjs';
import { createDispatchService } from '../src/local/dispatch.mjs';

async function setup(t) {
  const f = await fixture(t, {
    kind: 'terminal',
    childKind: 'terminal',
    prestarted: true,
    preparedKind: 'terminal',
    allPrepared: true,
  });
  const dispatch = createDispatchService({
    store: f.store,
    rpc: f.rpc,
    userData: f.profile,
    consent: async () => {},
    works: f.works,
  });
  await dispatch.check(f.work.id);
  let edit = (method, result) => result,
    epoch = 'runtime-two',
    consented = true;
  const context = new AsyncLocalStorage();
  const rpc = async (method, ...args) => {
    if (context.getStore() && context.getStore() !== epoch)
      throw Error('Native runtime epoch changed during observation; intent remains reserved.');
    const result = await f.rpc(method, ...args);
    return edit(
      method,
      method === 'status.get' ? { ...result, runtimeId: epoch } : result,
      args[0],
    );
  };
  rpc.withRuntime = (epoch, action) => {
    if (context.getStore() && context.getStore() !== epoch)
      throw Error('Native runtime epoch changed inside observation.');
    return context.run(epoch, action);
  };
  const consent = async () => {
    if (!consented) throw Error('Native consent revoked');
  };
  const works = createWorkService({ store: f.store, rpc, userData: f.profile, consent });
  return {
    ...f,
    get store() {
      return f.store;
    },
    rpc,
    works,
    consent,
    edit: (fn) => {
      edit = fn;
    },
    setEpoch: (value) => {
      epoch = value;
    },
    revoke: () => {
      consented = false;
    },
    input: {
      requestId: 'reconnect-one',
      workId: f.work.id,
      expectedWorkVersion: f.store.readWork(f.work.id).version,
      expectedRevision: f.store.readSnapshot().revision,
    },
  };
}
test('explicit reconnect retains original four sessions, objective input and protocol while restoring the original Run', async (t) => {
  const f = await setup(t),
    before = f.store.readWork(f.work.id),
    protocol = f.store.readDispatchProtocol(f.work.id),
    ops = f.store.listOperations(),
    sends = f.messages.length;
  const blocked = await f.works.check(f.work.id);
  assert.equal(blocked.run.state, 'unverified');
  f.input.expectedWorkVersion = f.store.readWork(f.work.id).version;
  const result = await f.works.reconnect(f.input);
  assert.equal(result.run.state, 'verified');
  assert.equal(result.runtimeRecovery.state, 'reconnected');
  assert.equal(result.run.id, 'run-head');
  assert.equal(result.run.consumerGeneration, 1);
  assert.equal(f.messages.length, sends);
  assert.deepEqual(f.store.listOperations(), ops);
  const after = f.store.readWork(f.work.id);
  assert.deepEqual(after.binding, before.binding);
  assert.deepEqual(after.nativeSend, before.nativeSend);
  assert.deepEqual(after.input, before.input);
  assert.deepEqual(f.store.readDispatchProtocol(f.work.id), protocol);
  assert.equal((await f.works.check(f.work.id)).run.state, 'verified');
  assert.equal(
    f.calls.some((m) => /workerStart|runCreate|stop|close|ensureAgent/.test(m)),
    false,
  );
});

test('after reconnect the original supervisor can dispatch, review and deliver through the new runtime without changing creation provenance', async (t) => {
  const f = await setup(t);
  await f.works.reconnect(f.input);
  const service = createDispatchService({
    store: f.store,
    rpc: f.rpc,
    userData: f.profile,
    consent: async () => {},
    works: f.works,
  });
  f.createIntent(f.store.readDispatchProtocol(f.work.id));
  f.onInput((text) => {
    if (text.startsWith('TEAM_DISPATCH_PERMIT\n'))
      f.start(JSON.parse(text.split('\n').slice(1).join('\n')));
  });
  await service.check(f.work.id);
  let attempt = f.store.listDispatches(f.work.id)[0];
  assert.equal(attempt?.status, 'running');
  assert.equal(attempt.reuse.kind, 'prepared');
  f.complete(attempt);
  await service.check(f.work.id);
  attempt = f.store.listDispatches(f.work.id)[0];
  f.review(attempt);
  await service.check(f.work.id);
  attempt = f.store.listDispatches(f.work.id)[0];
  assert.equal(attempt.status, 'accepted');
  assert.equal(f.store.readOperation('launch').runtimeId, 'runtime-one');
  assert.equal(f.store.readOperation('prepared-child').runtimeId, 'runtime-one');
  assert.equal(f.store.readWork(f.work.id).binding.runtimeId, 'runtime-one');
  const { createLifecycleService } = await import('../src/local/lifecycle.mjs');
  const protocol = f.store.readDispatchProtocol(f.work.id),
    spec = JSON.stringify({
      protocol: 'team-delivery/v1',
      workId: f.work.id,
      token: protocol.token,
      generation: 1,
      supervisorMemberId: f.team.members[0].id,
      previousDeliveryId: null,
      summary: 'Read-only task verified',
      evidenceRefs: [attempt.evidenceId],
      attemptIds: [attempt.id],
    });
  f.db
    .prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      'delivery-one',
      'run-head',
      spec,
      'ready',
      null,
      'term-head',
      'tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'head-pty:head-instance',
      1,
    );
  f.receipt(
    'create-delivery',
    'orchestration.taskCreate',
    { spec, run: 'run-head', callerTerminalHandle: f.from },
    { task: { id: 'delivery-one', run_id: 'run-head', spec, status: 'ready', result: null } },
  );
  const lifecycle = createLifecycleService({
    store: f.store,
    rpc: f.rpc,
    userData: f.profile,
    consent: async () => {},
    works: f.works,
    notify: async () => {},
  });
  await lifecycle.check(f.work.id);
  assert.equal(f.store.readSnapshot().works[0].delivery.id, 'delivery-one');
  await lifecycle.decide({
    requestId: 'accept-delivery',
    workId: f.work.id,
    deliveryId: 'delivery-one',
    expectedWorkVersion: f.store.readCurrentWork(f.work.id).version,
    decision: 'accept',
  });
  assert.equal(f.store.readWork(f.work.id).status, 'completed');
  const cleanup = f.store.previewHistoryCleanup({ selectedWorkIds: [f.work.id] });
  assert.deepEqual(cleanup.eligibleWorkIds, [f.work.id]);
  f.store.applyHistoryCleanup({
    requestId: 'cleanup-after-reconnect',
    previewToken: cleanup.previewToken,
    expectedStorageRevision: cleanup.storageRevision,
  });
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl.runtimeId, 'runtime-two');
});

for (const [field, value] of Object.entries({
  handle: 'other',
  ptyId: 'other-pty',
  incarnationId: 'other-instance',
  tabId: 'other-tab',
  leafId: 'placeholder',
  worktreeId: 'folder:/elsewhere',
  executionHostId: 'ssh:elsewhere',
  agentIdentity: 'other-provider',
  connected: false,
  writable: false,
}))
  test(`reconnect rejects changed terminal ${field} and preserves all original launch/input evidence`, async (t) => {
    const f = await setup(t),
      before = f.store.readWork(f.work.id),
      ops = f.store.listOperations(),
      sends = f.messages.length;
    f.edit((method, result) =>
      method === 'terminal.show' ? { terminal: { ...result.terminal, [field]: value } } : result,
    );
    await assert.rejects(f.works.reconnect(f.input), /session changed|supervisor execution/);
    assert.deepEqual(f.store.readWork(f.work.id), before);
    assert.deepEqual(f.store.listOperations(), ops);
    assert.equal(f.messages.length, sends);
    assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
  });
for (const status of ['working', 'permission', 'waiting', 'unknown', undefined])
  test(`reconnect requires positive idle evidence rather than ${status}`, async (t) => {
    const f = await setup(t);
    f.edit((method, result) =>
      method === 'terminal.agentStatus'
        ? { agentStatus: { ...result.agentStatus, status } }
        : result,
    );
    await assert.rejects(f.works.reconnect(f.input), /verified idle status/);
    assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
  });
for (const field of [
  'objective',
  'coordinator_handle',
  'coordinator_pane_key',
  'consumer_generation',
])
  test(`reconnect rejects changed native Run ${field}`, async (t) => {
    const f = await setup(t);
    f.db.prepare(`UPDATE runs SET ${field}=?`).run(field === 'consumer_generation' ? 2 : 'other');
    await assert.rejects(f.works.reconnect(f.input), /Run owner or generation/);
    assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
  });
test('a native Task created between the two reads blocks reconnect and causes no send', async (t) => {
  const f = await setup(t),
    sends = f.messages.length;
  let reads = 0;
  f.edit((method, result) => {
    if (method === 'orchestration.taskList' && ++reads === 1)
      f.createIntent(f.store.readDispatchProtocol(f.work.id));
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /Task or Dispatch/);
  assert.equal(f.messages.length, sends);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});
test('a native Task created during the last runtime check cannot settle an obsolete reconnect', async (t) => {
  const f = await setup(t);
  let reads = 0;
  f.edit((method, result) => {
    if (method === 'status.get' && ++reads === 4)
      f.createIntent(f.store.readDispatchProtocol(f.work.id));
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /Task or Dispatch/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});
test('a concurrent panel change rejects the saved reconnect plan atomically', async (t) => {
  const f = await setup(t);
  let changed = false;
  f.edit((method, result) => {
    if (method === 'orchestration.taskList' && !changed) {
      changed = true;
      f.store.setAdmission({
        requestId: 'pause-race',
        teamId: f.team.id,
        expectedRevision: f.store.readSnapshot().revision,
        paused: true,
      });
    }
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /Work or team changed/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});
test('a second desktop restart during revalidation does not follow the new epoch', async (t) => {
  const f = await setup(t);
  let reads = 0;
  f.edit((method, result) => {
    if (method === 'orchestration.taskList' && ++reads === 1) f.setEpoch('runtime-three');
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /epoch changed/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});
test('revoked native consent rejects reconnect without changing original evidence', async (t) => {
  const f = await setup(t);
  f.edit((method, result) => {
    if (method === 'orchestration.taskList') f.revoke();
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /consent revoked/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});
for (const state of ['sending', 'unknown', 'queued'])
  test(`unresolved ${state} objective input blocks reconnect`, async (t) => {
    const f = await setup(t),
      work = f.store.readWork(f.work.id);
    f.store.updateWork(work.id, work.version, { input: { ...work.input, state } });
    f.input.expectedWorkVersion = f.store.readWork(work.id).version;
    await assert.rejects(f.works.reconnect(f.input), /input is unresolved/);
    assert.equal(f.store.readWork(work.id).input.state, state);
  });
for (const state of ['sending', 'unknown'])
  test(`unresolved ${state} admission protocol blocks reconnect`, async (t) => {
    const f = await setup(t),
      protocol = f.store.readDispatchProtocol(f.work.id);
    f.store.updateDispatchProtocol(f.work.id, protocol.version, { state });
    await assert.rejects(f.works.reconnect(f.input), /input is unresolved/);
    assert.equal(f.store.readDispatchProtocol(f.work.id).state, state);
  });
for (const state of ['intent', 'submitted', 'unknown'])
  test(`unresolved ${state} Stop blocks reconnect without changing the Stop record`, async (t) => {
    const f = await setup(t),
      stop = f.store.prepareStop(
        { requestId: 'stop-one' },
        { teamId: f.team.id, memberId: f.member.id },
      );
    if (state !== 'intent') f.store.settleStop(stop.requestId, stop.version, { state });
    const saved = f.store.readStop(stop.requestId);
    await assert.rejects(f.works.reconnect(f.input), /unresolved Stop/);
    assert.deepEqual(f.store.readStop(stop.requestId), saved);
  });
test('same reconnect request replays after worker reload without another transition; altered input conflicts', async (t) => {
  const f = await setup(t);
  const saved = await f.works.reconnect(f.input);
  await f.restart();
  const works = createWorkService({
      store: f.store,
      rpc: f.rpc,
      userData: f.profile,
      consent: f.consent,
    }),
    version = f.store.readWork(f.work.id).version,
    count = f.calls.length;
  const replay = await works.reconnect(f.input);
  assert.equal(replay.runtimeRecovery.requestId, saved.runtimeRecovery.requestId);
  assert.equal(f.calls.length, count);
  assert.equal(f.store.readWork(f.work.id).version, version);
  await assert.rejects(
    works.reconnect({ ...f.input, expectedWorkVersion: version }),
    /identity conflicts/,
  );
  await assert.rejects(
    works.reconnect({ ...f.input, requestId: 'new-click', expectedWorkVersion: version }),
    /already belong/,
  );
});

test('member recovery and missing original PTY evidence remain blocked', async (t) => {
  const f = await setup(t),
    op = f.store.readOperation('prepared-child');
  f.store.prepareWake(
    {
      requestId: 'wake-one',
      teamId: f.team.id,
      memberId: f.member.id,
      bindingRequestId: op.requestId,
    },
    op,
    { state: 'unknown' },
    undefined,
  );
  await assert.rejects(f.works.reconnect(f.input), /unresolved member recovery/);
});
test('incomplete original member identity cannot be enriched into reconnect authorization', async (t) => {
  const f = await setup(t),
    op = f.store.readOperation('prepared-child');
  f.store.settleOperation(op.requestId, op.nativeRequest.operationId, {
    observation: { incarnationId: 'child-instance' },
  });
  await assert.rejects(
    f.works.reconnect(f.input),
    /exact original process|original prepared recipient/,
  );
});
test('identity drift on the second pass does not partially reconnect the first members', async (t) => {
  const f = await setup(t);
  let count = 0;
  f.edit((method, result) => {
    if (method === 'terminal.show' && ++count === f.team.members.length + 1)
      result.terminal.ptyId = 'new-pty';
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /session changed/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});
test('a concurrent member observation revision rejects a stale reconnect snapshot', async (t) => {
  const f = await setup(t);
  let changed = false;
  f.edit((method, result) => {
    if (method === 'orchestration.taskList' && !changed) {
      changed = true;
      const op = f.store.readOperation('prepared-child');
      f.store.settleOperation(op.requestId, op.nativeRequest.operationId, {
        warning: 'Changed during check',
      });
    }
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /Team evidence changed/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});
test('failed atomic control-pointer commit preserves raw work and all original receipts, then an exact retry succeeds once', async (t) => {
  const { DatabaseSync } = await import('node:sqlite'),
    { join } = await import('node:path');
  const f = await setup(t),
    db = new DatabaseSync(
      join(f.profile, 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'),
    );
  t.after(() => db.close());
  const before = db.prepare('SELECT id,json FROM receipts ORDER BY id').all();
  db.exec(
    "CREATE TRIGGER reject_reconnect BEFORE INSERT ON receipts WHEN NEW.id LIKE 'runtime-control:%' BEGIN SELECT RAISE(ABORT,'control disk failure'); END",
  );
  await assert.rejects(f.works.reconnect(f.input), /control disk failure/);
  assert.deepEqual(db.prepare('SELECT id,json FROM receipts ORDER BY id').all(), before);
  db.exec('DROP TRIGGER reject_reconnect');
  await f.works.reconnect(f.input);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM receipts WHERE id LIKE 'runtime-reconnect:%'").get().n,
    1,
  );
});
test('an unrelated Run and member Stop do not prevent reconnecting the selected idle team', async (t) => {
  const f = await setup(t);
  f.store.prepareStop(
    { requestId: 'unrelated-stop' },
    { teamId: 'other-team', memberId: 'other-member' },
  );
  f.db
    .prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)')
    .run('foreign-task', 'foreign-run', '{}', 'dispatched', null, null, null, null, null);
  await f.works.reconnect(f.input);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl.runtimeId, 'runtime-two');
});
for (const failure of [null, 'parent-pid', 'response-epoch'])
  test(`real authenticated socket reconnect ${failure ?? 'preserves profile and runtime guards'}`, async (t) => {
    const { createServer } = await import('node:net'),
      { writeFile } = await import('node:fs/promises'),
      { join } = await import('node:path'),
      { createNativeRpc } = await import('../src/local/native-runtime.mjs');
    const f = await setup(t),
      ep = endpointFor(f.profile), endpoint = ep.endpoint,
      requests = [];
    const server = createServer((socket) => {
      let input = '';
      socket.on('data', async (chunk) => {
        input += chunk;
        if (!input.includes('\n')) return;
        try {
          const request = JSON.parse(input.trim());
          requests.push(request.method);
          assert.equal(request.authToken, 'fixture-private');
          const result = await f.rpc(request.method, request.params, {
            orchestrationRequestId: request.orchestrationRequestId,
          });
          socket.end(
            JSON.stringify({
              id: request.id,
              ok: true,
              result,
              _meta: { runtimeId: failure === 'response-epoch' ? 'wrong-runtime' : 'runtime-two' },
            }) + '\n',
          );
        } catch (error) {
          socket.destroy(error);
        }
      });
    });
    await new Promise((resolve) => server.listen(endpoint, resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    await writeFile(
      join(f.profile, 'orca-runtime.json'),
      JSON.stringify({
        pid: failure === 'parent-pid' ? process.pid + 1 : process.pid,
        runtimeId: 'runtime-two',
        authToken: 'fixture-private',
        transports:[ep],
      }),
    );
    const rpc = createNativeRpc({
        userData: f.profile,
        parentPid: process.pid,
        consent: f.consent,
      }),
      works = createWorkService({ store: f.store, rpc, userData: f.profile, consent: f.consent });
    if (failure) {
      await assert.rejects(works.reconnect(f.input), /runtime|process/);
      assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
    } else {
      await works.reconnect(f.input);
      assert.equal((await works.check(f.work.id)).run.state, 'verified');
      assert.ok(requests.length > 20);
      assert.ok(
        requests.every((m) =>
          [
            'status.get',
            'worktree.show',
            'terminal.show',
            'terminal.agentStatus',
            'terminal.wait',
            'orchestration.runShow',
            'orchestration.taskList',
          ].includes(m),
        ),
      );
    }
  });

test('native positive tui-idle wait supports a live Codex without a title-derived status', async (t) => {
  const f = await setup(t);
  f.edit((method, result) =>
    method === 'terminal.agentStatus'
      ? { agentStatus: { ...result.agentStatus, status: null } }
      : result,
  );
  await f.works.reconnect(f.input);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl.runtimeId, 'runtime-two');
  assert.ok(f.calls.includes('terminal.wait'));
});

for (const [field, value] of Object.entries({
  handle: 'other',
  condition: 'exit',
  satisfied: false,
  status: 'exited',
  exitCode: 0,
  blockedReason: 'permission',
}))
  test(`native idle wait ${field} mismatch cannot authorize reconnect`, async (t) => {
    const f = await setup(t);
    f.edit((method, result) =>
      method === 'terminal.wait' ? { wait: { ...result.wait, [field]: value } } : result,
    );
    await assert.rejects(f.works.reconnect(f.input), /native idle check/);
    assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
  });
test('native idle wait timeout preserves the original unresolved work', async (t) => {
  const f = await setup(t);
  f.edit((method, result) => {
    if (method === 'terminal.wait') throw Error('Native wait timed out');
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /timed out/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});
test('a session changing after native idle wait is rejected before any control update', async (t) => {
  const f = await setup(t);
  let waited = false;
  f.edit((method, result) => {
    if (method === 'terminal.wait') waited = true;
    if (waited && method === 'terminal.show') result.terminal.incarnationId = 'replacement';
    return result;
  });
  await assert.rejects(f.works.reconnect(f.input), /changed or became busy/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});

test('a rewritten launch identity cannot substitute for the original prepared recipient even if the new terminal exists', async (t) => {
  const f = await setup(t),
    op = f.store.readOperation('prepared-child'),
    old = await f.rpc('terminal.show', { terminal: op.handle });
  f.store.settleOperation(op.requestId, op.nativeRequest.operationId, {
    kind: 'terminal',
    paneKey: op.paneKey,
    handle: 'rewritten-handle',
  });
  f.input.expectedRevision = f.store.readSnapshot().revision;
  f.edit((method, result, params) =>
    method === 'terminal.show' && params.terminal === 'rewritten-handle'
      ? { terminal: { ...old.terminal, handle: 'rewritten-handle' } }
      : result,
  );
  await assert.rejects(f.works.reconnect(f.input), /original prepared recipient/);
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl, undefined);
});

test('background reconciliation yields while the explicit reconnect owns its evidence check', async (t) => {
  const { createExecutor } = await import('../src/local/executor.mjs');
  const f = await setup(t);
  let entered,
    release,
    held = false;
  const started = new Promise((resolve) => {
      entered = resolve;
    }),
    gate = new Promise((resolve) => {
      release = resolve;
    });
  f.edit(async (method, result) => {
    if (method === 'status.get' && !held) {
      held = true;
      entered();
      await gate;
    }
    return result;
  });
  const executor = createExecutor(
    { call: async () => ({ value: null }) },
    async () => {
      throw Error('Unexpected CLI effect');
    },
    { store: f.store, userData: f.profile, nativeRpc: f.rpc },
  );
  t.after(() => executor.stopWork());
  const reconnect = executor.execute({ op: 'reconnectWork', params: f.input });
  await started;
  const background = executor.resumeWork(),
    yielded = await Promise.race([
      background.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 40)),
    ]);
  release();
  const settled = await Promise.allSettled([reconnect, background]);
  assert.equal(yielded, true);
  assert.equal(settled[0].status, 'fulfilled');
  assert.equal(f.store.readCurrentWork(f.work.id).runtimeControl.runtimeId, 'runtime-two');
});

test('a late changed launch receipt cannot redirect a prepared member after reconnect', async (t) => {
  const f = await setup(t);
  await f.works.reconnect(f.input);
  const op = f.store.readOperation('prepared-child'),
    old = await f.rpc('terminal.show', { terminal: op.handle });
  f.store.settleOperation(op.requestId, op.nativeRequest.operationId, {
    kind: 'terminal',
    paneKey: op.paneKey,
    handle: 'late-new-handle',
  });
  f.edit((method, result, params) =>
    method === 'terminal.show' && params.terminal === 'late-new-handle'
      ? { terminal: { ...old.terminal, handle: 'late-new-handle' } }
      : result,
  );
  const dispatch = createDispatchService({
    store: f.store,
    rpc: f.rpc,
    userData: f.profile,
    consent: f.consent,
    works: f.works,
  });
  f.createIntent(f.store.readDispatchProtocol(f.work.id));
  await dispatch.check(f.work.id);
  assert.equal(f.messages.filter((text) => text.startsWith('TEAM_DISPATCH_PERMIT\n')).length, 0);
  assert.equal(f.store.listDispatches(f.work.id).length, 0);
});

for (const state of ['accepted', 'unknown', 'sending']) test(`session guide ${state} respects quiet-runtime reconnect`, async t => {
  const f = await setup(t);
  f.store.ensureQuestionEvent(f.work.id, 'session-guide', 'TEAM_SESSION_DECISIONS', {workId: f.work.id});
  f.store.updateQuestionEvent(f.work.id, 'session-guide', {state});
  if (state === 'accepted') assert.equal((await f.works.reconnect(f.input)).run.state, 'verified');
  else await assert.rejects(f.works.reconnect(f.input), /quiet Run/);
});
