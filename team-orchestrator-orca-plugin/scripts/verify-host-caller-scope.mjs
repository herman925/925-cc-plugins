import assert from 'node:assert/strict';

// Executable source contract, not a socket/provider acceptance test. The actual pinned
// admission and dispatcher run over an inert network base and explicit no-effect methods.
export async function verifyCallerScope(host) {
  const runtime = { getRuntimeId: () => 'contract-runtime', showTerminal: async handle => ({ executionHostId: handle === 'remote' ? 'ssh:contract-target' : 'local' }) };
  let invocations = 0;
  const methods = [
    { name: 'contract.probe', permission: 'desktop-control', params: host.z.object({ value: host.z.string() }), handler: (params, context) => { invocations++; return { params, callerKey: host.rpcCallerOperationKey(context.caller) }; } },
    { name: 'terminal.show', permission: 'workspace', params: host.z.object({ terminal: host.z.string() }), handler: params => { invocations++; return { terminal: params.terminal }; } }
  ];
  const dispatcher = new host.RpcDispatcher({ runtime, methods });
  class AdmissionFixture extends host.RuntimeRpcRequestAdmission {
    constructor() { super(); this.runtime = runtime; this.authToken = 'isolated-contract-owner'; this.dispatcher = dispatcher; }
    receive(request) { return this.handleMessage(JSON.stringify(request)); }
  }
  const admission = new AdmissionFixture();
  const request = { id: 'contract-request', method: 'contract.probe', params: { value: 'read only' }, authToken: 'isolated-contract-owner' };
  assert.deepEqual((await admission.receive(request)).result, { params: { value: 'read only' }, callerKey: 'trusted-local:runtime' });
  for (const authToken of [undefined, '', 'wrong-token']) {
    const count = invocations;
    const response = await admission.receive({ ...request, authToken, callerScope: { kind: 'owner' }, params: { ...request.params, callerScope: { kind: 'owner' } } });
    assert.equal(response.error.code, 'unauthorized'); assert.equal(invocations, count);
  }
  const bridge = host.sshBridgeCredentials.mint({ kind: 'ssh-bridge', targetId: 'contract-target', remoteCliControl: false });
  try {
    const count = invocations;
    const forged = await admission.receive({ ...request, authToken: bridge.token, callerScope: { kind: 'owner' }, params: { ...request.params, callerScope: { kind: 'owner' }, __orcaCallerScope: { kind: 'owner' } } });
    assert.equal(forged.error.code, 'forbidden'); assert.equal(invocations, count);
    assert.equal((await admission.receive({ ...request, method: 'terminal.show', params: { terminal: 'remote' }, authToken: bridge.token })).ok, true);
    const outsideHost = await admission.receive({ ...request, method: 'terminal.show', params: { terminal: 'local', callerScope: { kind: 'owner' } }, authToken: bridge.token });
    assert.equal(outsideHost.error.code, 'forbidden');
  } finally { bridge.revoke(); }
  assert.equal((await admission.receive({ ...request, authToken: bridge.token })).error.code, 'unauthorized');
  for (const callerScope of [{ kind: 'mobile' }, { kind: 'runtime-paired', grants: [] }, { kind: 'ssh-bridge', targetId: 'contract-target', remoteCliControl: true }]) {
    const count = invocations;
    const pinned = new host.RpcDispatcher({ runtime, methods, callerScope });
    const response = await pinned.dispatch({ ...request, callerScope: { kind: 'owner' } }, { callerScope: host.OWNER_RPC_CALLER_SCOPE });
    assert.equal(response.error.code, 'forbidden'); assert.equal(invocations, count);
  }
  assert.equal(host.denyRpcMethodForCaller(host.OWNER_RPC_CALLER_SCOPE, 'contract.probe', 'desktop-control'), null);
  assert.equal(host.bindRpcCallToCallerScope(host.OWNER_RPC_CALLER_SCOPE, runtime, 'contract.probe', {}), null);
  assert.equal(host.denyRpcMethodForCaller({ kind: 'runtime-paired', grants: ['desktop-control'] }, 'contract.probe', 'desktop-control'), null);
  const desktop = await dispatcher.dispatch(request, { caller: { kind: 'desktop' } });
  assert.equal(desktop.result.callerKey, 'trusted-local:desktop');
  assert.notEqual(desktop.result.callerKey, (await admission.receive(request)).result.callerKey);
  console.log('PASS: actual pinned token admission, owner/paired/mobile/SSH scope, forged payload refusal, host binding and distinct desktop/runtime caller namespaces (inert transport fixture).');
}
