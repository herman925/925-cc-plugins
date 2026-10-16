// Validate the shipped manifest, panel envelope and worker storage against unmodified Orca sources.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliEnvironment } from '../src/local/cli.mjs';
import { nativeLaunchFingerprint, readNativeLaunchLedger } from '../src/local/native-launch-ledger.mjs';
import { DatabaseSync } from 'node:sqlite';
import { sendFingerprint } from '../src/local/teamwork.mjs';
import { readNativeRunEvidence } from '../src/local/native-run.mjs';
import { nativeMutationFingerprint } from '../src/local/native-dispatch.mjs';
import { installAdapter } from '../src/local/adapter.mjs';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { terminalIdentity } from '../src/local/terminal-identity.mjs';
import { verifyCallerScope } from './verify-host-caller-scope.mjs';
for (const revision of ['9fdd90ffa7721e145f1353ad9fb9df2f70c31f43', 'ff4a51c872e723d87ab141044814301ea5a78634']) {
const scopedHost = revision.startsWith('ff4a51c');
const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-plugin-contract-')));
const project = fileURLToPath(new URL('../', import.meta.url));
const source = async path => {
  try { return await readFile(path, 'utf8'); } catch {}
  const ref = relative(root, path).replaceAll('\\', '/');
  if (process.env.ORCA_CONTRACT_REPO) {
    const { stdout } = await promisify(execFile)('git', ['-C', process.env.ORCA_CONTRACT_REPO, 'show', `${revision}:${ref}`], { maxBuffer: 4 * 1024 * 1024 });
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, stdout); return stdout;
  }
  const response = await fetch(`https://raw.githubusercontent.com/stablyai/orca/${revision}/${ref}`);
  if (!response.ok) throw new Error(`Cannot fetch ${ref}: ${response.status}`);
  const text = await response.text();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return text;
};
const bundle = async name => {
  const entry = join(root, 'contract.ts');
  await writeFile(entry, `export { inspectWorkerTerminal, exposeObservation } from './src/main/runtime/rpc/methods/orchestration/worker/worker-observation';\nexport { isDispatchProcessCurrent } from './src/main/runtime/orchestration/db/worker-dispatch/worker-dispatch-stop';\nexport { workerReportObservation } from './src/main/runtime/orchestration/worker-report-observation';\nexport { resolveStructuredWorkerAuthority } from './src/main/runtime/structured-worker-authority';\nexport { getRepoKind } from './src/shared/repo-kind';\nexport { getFolderWorkspaceRootId, getFolderWorkspaceInstanceId } from './src/main/ipc/worktrees/folder-workspace-model';\nexport { SCHEMA_VERSION } from './src/main/runtime/orchestration/db/contract-constants';\nexport { JOURNAL_DB_SCHEMA_VERSION, createAgentSessionRecordTablesSql } from './src/main/native-chat/agent-session-journal/journal-database-schema';\nexport { RestartResumeParams } from './src/main/runtime/rpc/methods/structured-agent-session-schemas';\nexport { EnsureAgentSessionParams } from './src/shared/rpc-contract/agent-session-params';\nexport { TerminalStopExact, TerminalWait } from './src/shared/rpc-contract/terminal-unary-params';\nexport {resolveCreatorDepth,resolveCreatorDispatchId,resolveChildDispatchDepth} from './src/main/runtime/orchestration/db/dispatch-depth';\nexport {findActiveDispatchForAssignee} from './src/main/runtime/orchestration/db/dispatch-context/dispatch-lookup';\nexport {createGraphTablesSql} from './src/main/runtime/orchestration/db/schema/create-graph-tables-sql';\nexport {createTask} from './src/main/runtime/orchestration/db/tasks/task-store';\nexport {resolveNestedWorkerMaxDepth} from './src/shared/nested-worker-depth';\nexport { prepareLocalWorkerStart } from './src/main/runtime/rpc/methods/orchestration/worker/worker-start-validation';\nexport { placeWorkerAgent } from './src/main/runtime/rpc/methods/orchestration/worker/worker-start-agent-placement';\nexport { WorkerDispatchParams, WorkerReadParams } from './src/shared/rpc-contract/orchestration-worker-control-params';\nexport { agentSessionLeaseOwnerVerdict } from './src/shared/agent-session-lease-adjudication';\nexport { TaskUpdateParams, SendParams as OrchestrationSendParams } from './src/main/runtime/rpc/methods/orchestration/schemas';\nexport { TaskCreateParams, AskParams } from './src/shared/rpc-contract/orchestration-params';\nexport { WorkerStartParams } from './src/shared/rpc-contract/orchestration-worker-start-params';\nexport { replayStableCallerParams, hashCanonical } from './src/main/runtime/rpc/orchestration-mutation-receipt';\nexport { SendParams } from './src/shared/rpc-contract/structured-agent-session-params';\nexport { computeAgentSessionPayloadFingerprint } from './src/shared/agent-session-mutation-envelope';\nexport { resolveRpcCallerIdentity, rpcCallerOperationKey } from './src/main/runtime/rpc/rpc-caller-identity';\nexport { createCoreTablesSql } from './src/main/runtime/orchestration/db/schema/create-core-tables-sql';\nexport { currentRunCoordinatorOrcaSessionId } from './src/main/runtime/orchestration/db/runs/run-coordinator-orca-session';\nexport { AgentLaunch, AgentLaunchReplay } from './src/shared/rpc-contract/agent-launch-params';\nexport { computeAgentLaunchFingerprint } from './src/shared/agent-launch-operation';\nexport { PreflightDetectRemoteAgents } from './src/shared/rpc-contract/preflight-params';\nexport { ModelCatalogParams, CreateSupportParams } from './src/shared/rpc-contract/structured-agent-session-params';\nexport { getDefaultUserDataPath } from './src/cli/runtime/metadata';\nexport { buildPluginWorkerEnv } from './src/main/plugins/plugin-worker-env';\nexport { parsePluginManifest } from './src/shared/plugins/plugin-manifest';\nexport { gatePluginHostCall } from './src/shared/plugins/plugin-capability-gate';\nexport { executePluginHostCall } from './src/main/plugins/plugin-host-methods';\nexport { bindPluginHostServices } from './src/main/plugins/plugin-host-service-bindings';\nexport { fingerprintPluginConsent } from './src/shared/plugins/plugin-consent-fingerprint';\nexport { PluginPanelSessions } from './src/main/plugins/plugin-panel-sessions';\nexport { panelActionRequestSchema } from './src/shared/plugins/plugin-panel-bridge';`);
  if (scopedHost) await writeFile(entry, (await readFile(entry, 'utf8')) + `
export { RpcDispatcher } from './src/main/runtime/rpc/dispatcher';
export { RuntimeRpcRequestAdmission } from './src/main/runtime/runtime-rpc/runtime-rpc-request-admission';
export { OWNER_RPC_CALLER_SCOPE, denyRpcMethodForCaller, bindRpcCallToCallerScope } from './src/main/runtime/rpc/rpc-caller-scope';
export { sshBridgeCredentials } from './src/main/runtime/rpc/ssh-bridge-credentials';
export { z } from 'zod';
`);
  const outfile = join(root, `${name}.mjs`);
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', banner: { js: "import { fileURLToPath as contractFilePath } from 'node:url'; const __filename = contractFilePath(import.meta.url);" }, plugins: [{
    name: 'pinned-orca-source', setup(api) {
      // These boundaries are not executed: existing-worker reuse returns before provider creation;
      // the dispatcher receives explicit test methods; admission receives an inert transport base.
      // All real auth, caller scope, owner, receipts, schemas and consent code remains bundled.
      if (scopedHost) api.onResolve({ filter: /agent-launch-mode$/ }, () => ({ path: 'launch-mode', namespace: 'unexecuted-boundary' }));
      api.onResolve({ filter: /^\.\/methods$/ }, args => args.importer.endsWith('/rpc/dispatcher.ts') ? { path: 'methods', namespace: 'unexecuted-boundary' } : undefined);
      api.onResolve({ filter: /runtime-rpc-binary-routing$/ }, () => ({ path: 'transport', namespace: 'unexecuted-boundary' }));
      api.onLoad({ filter: /.*/, namespace: 'unexecuted-boundary' }, args => ({ contents: args.path === 'transport'
        ? 'export class RuntimeRpcBinaryRouting {}'
        : args.path === 'launch-mode' ? 'const unused = () => { throw Error("Unexecuted launch-mode/provider boundary reached"); }; export { unused as decideAgentLaunchMode, unused as downgradeAgentLaunchModeForHost, unused as readAgentLaunchModeSettings, unused as resolveAgentLaunchModeOnHost, unused as warnStructuredLaunchDowngrade };'
        : `export const ALL_RPC_METHODS = new Proxy([], { get() { throw Error('Unexecuted ${args.path} boundary reached'); } });`, loader: 'js' }));
      api.onResolve({ filter: /^electron$/ }, () => ({ path: 'safe-storage', namespace: 'contract-fake' }));
      api.onResolve({ filter: /safe-storage-availability$/ }, () => ({ path: 'safe-storage', namespace: 'contract-fake' }));
      api.onLoad({ filter: /.*/, namespace: 'contract-fake' }, () => ({ contents: 'export const guardedSafeStorage = { isEncryptionAvailable: () => false }; export const safeStorage = guardedSafeStorage;', loader: 'js' }));
      api.onResolve({ filter: /^zod$/ }, () => ({ path: fileURLToPath(import.meta.resolve('zod')) }));
      api.onResolve({ filter: /^\./ }, args => {
        if (!args.importer.startsWith(root)) return;
        const path = resolve(dirname(args.importer), args.path);
        return { path: /\.[cm]?[jt]s$/.test(path) ? path : `${path}.ts` };
      });
      api.onLoad({ filter: /\.ts$/ }, async args => args.path.startsWith(root) ? { contents: await source(args.path), loader: 'ts' } : undefined);
    }
  }] });
  return import(`file://${outfile}`);
};
try {
  const before = await bundle('before');
  if (scopedHost) await verifyCallerScope(before);
  assert.deepEqual(before.TerminalWait.parse({terminal:'term-existing',for:'tui-idle',timeoutMs:1000}),{terminal:'term-existing',for:'tui-idle',timeoutMs:1000});
  assert.throws(()=>before.TerminalWait.parse({terminal:'term-existing',for:'idle'}));
  const waitMethodSource=await source(join(root,'src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts'));
  assert.match(waitMethodSource,/name: 'terminal\.wait'[\s\S]*?wait: await runtime\.waitForTerminal\(params\.terminal, \{[\s\S]*?condition: params\.for,[\s\S]*?timeoutMs: params\.timeoutMs/);
  // Execute the exact pinned method bodies over a no-effect terminal inventory.
  // Their inheritance chains are irrelevant to these getters; no owner/auth logic is replaced.
  const processSource = await source(join(root, 'src/main/runtime/orca-runtime-get-terminal-interactive-wait.ts'));
  const processBody = processSource.match(/getTerminalProcessIncarnation\(handle: string\): string \| null \{([\s\S]*?)\n  \}/)?.[1];
  const promptSource = await source(join(root, 'src/main/runtime/orca-runtime-agent-prompt-request-correlation.ts'));
  const promptBody = promptSource.match(/getTerminalPromptRequestBinding\(handle: string\): \{[\s\S]*?\n  \} \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(processBody); assert.ok(promptBody);
  const nativeProcess = new Function('resolveStructuredWorkerAuthority', `return function(handle) {${processBody}}`)(before.resolveStructuredWorkerAuthority);
  const nativePrompt = new Function('handle', promptBody);
  const ptyId = 'repo::/contract/work@@a2aa4165', incarnationId = '7a4da650-08d8-4846-b043-ec073fe20390';
  const runtime = { getLivePtyForHandle: () => ({ record: { ptyId }, pty: { ptyId, incarnationId } }), getPtyLifecycleGeneration: () => 7 };
  assert.equal(nativeProcess.call(runtime, 'term_contract'), 'repo::/contract/work@@a2aa4165:7a4da650-08d8-4846-b043-ec073fe20390');
  assert.deepEqual(nativePrompt.call(runtime, 'term_contract'), { ptyId, processIncarnation: incarnationId, generation: 7 });
  assert.equal(terminalIdentity({ ptyId, incarnationId }).processIncarnation, nativeProcess.call(runtime, 'term_contract'));
  assert.notEqual(terminalIdentity({ ptyId: 'different-pty', incarnationId }).processIncarnation, nativeProcess.call(runtime, 'term_contract'));
  assert.notEqual(terminalIdentity({ ptyId, incarnationId: 'different-incarnation' }).processIncarnation, nativeProcess.call(runtime, 'term_contract'));
  const taskSource = await source(join(root, 'src/main/runtime/rpc/methods/orchestration/messaging/message-methods.ts'));
  assert.match(taskSource, /createdByProcessIncarnation: creatorAuthority.processIncarnation/);
  const authoritySource = await source(join(root, 'src/main/runtime/orca-runtime-get-orchestration-dispatch-authority.ts'));
  assert.match(authoritySource, /processIncarnation: this.getTerminalProcessIncarnation\(terminalHandle\)/);
  assert.deepEqual(before.workerReportObservation({ id: 'msg_actual-worker-done', run_id: 'run-owning-supervisor', created_at: '2026-10-16T00:00:00.000Z' }), { id: 'worker_report:msg_actual-worker-done', authorityId: 'run_home:run-owning-supervisor', homeReceivedAt: 1792108800000 });
  {
    // Actual native observation and exact process matcher over inert inventory reads.
    const dispatch = { assignee_handle: 'term_contract', assignee_pane_key: 'tab:leaf', process_incarnation: 'pty:raw-incarnation', host_scope: '{"kind":"local","hostId":"local"}' };
    const db = { getWorkerDispatch: () => ({ agent_terminal_handle: 'term_contract', state: 'succeeded' }), getDispatchContextById: () => dispatch, getWorkerTerminalResourceByOwner: () => null, isDispatchProcessCurrent: before.isDispatchProcessCurrent };
    let present = true, processIncarnation = 'pty:raw-incarnation', verdict = { status: 'exited' };
    const runtime = { showTerminal: async () => { if (!present) throw Error('not found'); return { connected: false, agentWait: null }; }, getTerminalPaneKey: () => 'tab:leaf', getTerminalProcessIncarnation: () => processIncarnation, getTerminalLivenessVerdict: () => verdict };
    const observe = async () => before.exposeObservation(await before.inspectWorkerTerminal(runtime, db, 'dispatch-contract'));
    assert.deepEqual(await observe(), { status: 'exited', exactWorker: true, agentWait: null });
    verdict = { status: 'live' }; assert.equal((await observe()).status, 'live');
    verdict = { status: 'unverifiable', reason: 'disconnected' }; assert.equal((await observe()).status, 'unverifiable');
    verdict = { status: 'exited' }; processIncarnation = 'other-pty:raw-incarnation'; assert.deepEqual(await observe(), { status: 'identity_changed', exactWorker: false });
    processIncarnation = 'pty:raw-incarnation'; present = false; assert.deepEqual(await observe(), { status: 'missing', exactWorker: false });
    present = true; verdict = null; dispatch.host_scope = '{"kind":"ssh","targetId":"remote"}'; assert.equal((await observe()).status, 'unverifiable');
  }
  assert.equal(before.SCHEMA_VERSION, 43);
  assert.equal(before.JOURNAL_DB_SCHEMA_VERSION, 4);
  assert.equal(before.getRepoKind({}), 'git');
  assert.equal(before.getRepoKind({ kind: 'folder' }), 'folder');
  assert.equal(before.getRepoKind({ kind: 'git' }), 'git');
  const folderRepo = { id: 'repo-folder', path: '/work', kind: 'folder' };
  assert.equal(before.getFolderWorkspaceRootId(folderRepo), 'repo-folder::/work');
  assert.equal(before.getFolderWorkspaceInstanceId(folderRepo, '11111111-2222-4333-8444-555555555555'), 'repo-folder::/work::workspace:11111111-2222-4333-8444-555555555555');
  const repoMethods = await source(join(root, 'src/main/runtime/rpc/methods/repo.ts'));
  assert.match(repoMethods, /name: 'repo.show',[\s\S]*?params: RepoSelector,[\s\S]*?context.runtime.showRepo\(params.repo\)/);

  {
   // Unmodified pinned depth implementation over its actual native SQLite schema.
   const db=new DatabaseSync(':memory:');db.exec(before.createCoreTablesSql());db.exec(before.createGraphTablesSql());
   const native={db,resolveCreatorDepth:before.resolveCreatorDepth,resolveCreatorDispatchId:before.resolveCreatorDispatchId,resolveChildDispatchDepth:before.resolveChildDispatchDepth,findActiveDispatchForAssignee:before.findActiveDispatchForAssignee,requireRun(id){assert.ok(db.prepare('SELECT id FROM runs WHERE id=?').get(id));},getTask(id){return db.prepare('SELECT * FROM tasks WHERE id=?').get(id);}};
   db.prepare('INSERT INTO runs(id,objective,legacy) VALUES(?,?,0)').run('root','root');
   db.prepare('INSERT INTO runs(id,objective,coordinator_orca_session_id,coordinator_orca_session_id_generation,consumer_generation,legacy) VALUES(?,?,?,1,1,0)').run('child','child','manager');
   const task=before.createTask.call(native,{runId:'root',spec:'manager task'});
   db.prepare('INSERT INTO dispatch_contexts(id,run_id,task_id,assignee_handle,assignee_pane_key,assignee_orca_session_id,depth,status) VALUES(?,?,?,?,?,?,?,?)').run('manager-dispatch','root',task.id,'manager-handle','manager-tab:manager-pane','manager',1,'dispatched');
   const manager={kind:'session',orcaSessionId:'manager'};
   assert.equal(before.resolveNestedWorkerMaxDepth({}),1);
   assert.equal(native.resolveChildDispatchDepth({kind:'session',orcaSessionId:'root-owner'},1),1);
   assert.throws(()=>native.resolveChildDispatchDepth(manager,before.resolveNestedWorkerMaxDepth({})),e=>e.code==='nested_worker_depth_exceeded'&&e.data?.effectsApplied===false&&e.data.nextSteps.some(s=>s.includes('Nested worker depth')));
   assert.equal(native.resolveChildDispatchDepth(manager,2),2,'fresh child Run retains actual parent depth');
   assert.equal(native.resolveCreatorDispatchId(manager),'manager-dispatch');
   assert.throws(()=>before.createTask.call(native,{runId:'child',spec:'child task',parentId:task.id}),/must belong to run/);
   assert.equal(before.createTask.call(native,{runId:'child',spec:'child task'}).parent_id,null);
   db.prepare('INSERT INTO remote_dispatch_attachments(dispatch_id,task_id,home_run_id,home_peer_fingerprint,runtime_epoch,pane_key,process_incarnation,state,depth) VALUES(?,?,?,?,?,?,?,?,?)').run('remote','rt','root','peer','epoch','remote-tab:remote-pane','remote-instance','stop_unknown',2);
   const remote={kind:'terminal',handle:'remote',paneKey:'remote-tab:remote-pane',processIncarnation:'remote-instance'};
   assert.equal(native.resolveCreatorDepth(remote),2);assert.equal(native.resolveCreatorDepth({...remote,processIncarnation:'replaced'}),0);
   db.prepare('INSERT INTO remote_dispatch_attachments(dispatch_id,task_id,home_run_id,home_peer_fingerprint,runtime_epoch,pane_key,process_incarnation,state,depth) VALUES(?,?,?,?,?,?,?,?,?)').run('remote2','rt2','root','peer','epoch','remote-tab:remote-pane','remote-instance','starting',2);
   assert.throws(()=>native.resolveCreatorDepth(remote),/cannot establish nesting depth/);
   db.prepare('UPDATE dispatch_contexts SET creator_handle=assignee_handle,creator_pane_key=assignee_pane_key WHERE id=?').run('manager-dispatch');
   assert.equal(native.resolveCreatorDispatchId(manager),null);assert.equal(native.resolveCreatorDepth(manager),0,'native self-dispatch exclusion');
   db.close();
  }
  assert.deepEqual(before.RestartResumeParams.parse({sessionIds:['saved-session']}),{sessionIds:['saved-session']});
  for(const agent of ['codex','claude'])assert.equal(before.EnsureAgentSessionParams.safeParse({kind:'explicit',worktree:'id:saved-workspace',agent,providerSession:{key:'session_id',id:'native-provider-id'}}).success,true);
  assert.equal(before.EnsureAgentSessionParams.safeParse({kind:'explicit',worktree:'id:saved-workspace',agent:'codex',providerSession:{key:'session_id',id:'-guessed'}}).success,false);
  const idleWire=await source(join(root,'src/shared/agent-session-wire.ts')),turnTypes=await source(join(root,'src/shared/agent-session-journal-types.ts'));
  assert.match(idleWire,/latestTurn\?: AgentSessionLatestTurn \| null/);assert.match(idleWire,/queuedMessages\?: AgentSessionQueuedMessage\[\] \| null/);assert.match(idleWire,/backgroundTasks\?: AgentSessionBackgroundTaskState \| null/);assert.match(turnTypes,/'running',[\s\S]*'completed',[\s\S]*'interrupted',[\s\S]*'unverifiable'/);
  const restartSource=await source(join(root,'src/main/runtime/rpc/methods/structured-agent-session-restart-resume.ts'));
  assert.match(restartSource,/name: 'agentSession.restartResume'[\s\S]*return \{ results: \[\] \}/);
  assert.match(restartSource,/name: 'agentSession.restartContinue'[\s\S]*continueAfterRestart\(\s*params.sessionIds/);
  const ensureSource=await source(join(root,'src/main/runtime/orca-runtime-get-agent-session-execution-namespace.ts'));
  assert.match(ensureSource,/request.kind === 'automatic'[\s\S]*throw new Error\('agent_session_resume_not_authorized'\)/);
  const exactStop={worktree:'folder:/work',expectedPtyIds:['one-pty'],keepHistory:true,targetOnly:true};
  assert.deepEqual(before.TerminalStopExact.parse(exactStop),exactStop);
  const stopParams=before.WorkerDispatchParams.parse({dispatch:'saved-dispatch'});
  assert.equal(nativeMutationFingerprint('orchestration.workerStop',stopParams,{kind:'local-user'}),before.hashCanonical({method:'orchestration.workerStop',params:stopParams}));


  {
    const result=JSON.stringify({protocol:'team-intent-withdrawal/v1',workId:'work',token:'protocol-token',generation:1,supervisorMemberId:'head',nativeTaskId:'malformed',taskKey:'check',memberId:'member',replacementNativeTaskId:'corrected',reason:'missing-worker-rules'});
    const params=before.TaskUpdateParams.parse({id:'malformed',status:'failed',result,run:'run',callerTerminalHandle:'orca_session_id:codex_head'});
    assert.equal(params.status,'failed');assert.equal(params.result,result);
    assert.equal(nativeMutationFingerprint('orchestration.taskUpdate',params,{kind:'structured',sessionId:'codex_head'}),before.hashCanonical({method:'orchestration.taskUpdate',params:before.replayStableCallerParams({getTerminalPaneKey:()=>null},params,'codex_head')}));
    assert.equal(before.TaskUpdateParams.parse({...params,spec:'not editable'}).spec,undefined,'native task-update cannot repair immutable spec');
  }
  assert.deepEqual(before.WorkerDispatchParams.parse({dispatch:'saved-dispatch'}),{dispatch:'saved-dispatch'});
  assert.deepEqual(before.WorkerReadParams.parse({dispatch:'saved-dispatch',source:'auto',limit:40}),{dispatch:'saved-dispatch',source:'auto',limit:40});
  assert.equal(before.WorkerReadParams.safeParse({dispatch:'saved-dispatch',cursor:-1}).success,false);
  const released={claimStatus:'released',handoffStage:null,ownerProcess:null,reservedSpawnToken:null,deathEvidence:null};
  assert.notEqual(before.agentSessionLeaseOwnerVerdict(released),'exited');
  assert.equal(before.agentSessionLeaseOwnerVerdict({...released,deathEvidence:{kind:'exit-observed',observedAt:1,ownerFence:7}}),'exited');

  {
  // Independent pinned-source oracle: parsed params and runtime-resolved identity.
  const caller = 'codex_11111111_2222_4333_8444_555555555555';
  const owner = { kind: 'structured', sessionId: caller };
  const noPane = { getTerminalPaneKey: () => null };
  const spec = '{"protocol":"team-dispatch/v1","attemptId":"attempt-1"}';
  const task = before.TaskCreateParams.parse({ spec, run: 'run_test', callerTerminalHandle: `orca_session_id:${caller}`, deps: '', __orcaCallerOrcaSessionId: 'forged' });
  assert.equal(task.__orcaCallerOrcaSessionId, undefined, 'untrusted caller marker is stripped by native parser');
  const hostHash = (method, params, identity = caller, runtime = noPane) => before.hashCanonical({ method, params: before.replayStableCallerParams(runtime, params, identity) });
  const taskHash = hostHash('orchestration.taskCreate', task);
  assert.equal(taskHash, '917d6c33f373c22b7fa32061068766aecb1764067877a10ffebd13267d491a14');
  assert.equal(nativeMutationFingerprint('orchestration.taskCreate', task, owner), taskHash);
  for (const identity of [null, 'different-resolved-caller']) assert.notEqual(hostHash('orchestration.taskCreate', task, identity), taskHash);
  assert.notEqual(hostHash('orchestration.taskCreate', { ...task, spec: spec + ' ' }), taskHash, 'spec bytes remain exact');
  const delivery={spec:JSON.stringify({protocol:'team-delivery/v1',workId:'work_test',token:'issued-token',generation:1,supervisorMemberId:'head_test',previousDeliveryId:null,summary:'Overall report',evidenceRefs:['artifact:report'],attemptIds:[]}),run:'run_test',callerTerminalHandle:`orca_session_id:${caller}`};
  assert.equal(nativeMutationFingerprint('orchestration.taskCreate',delivery,owner),hostHash('orchestration.taskCreate',before.TaskCreateParams.parse(delivery)),'overall delivery uses actual parsed TaskCreate bytes and resolved native author');
  const staffing={spec:JSON.stringify({protocol:'team-questions/v1',kind:'staffing-proposal',workId:'work',token:'token',generation:1,appQuestionId:'proposal',proposingManagerId:'manager',configVersion:2,roleVersion:1,member:{name:'Reviewer',boss:'manager',brief:'Review',habits:'',collaboration:'Report',agent:'claude',model:'default',effort:'default'},rationale:'Need review',affectedTaskKeys:[]}),run:'run_test',callerTerminalHandle:`orca_session_id:${caller}`};
  assert.equal(nativeMutationFingerprint('orchestration.taskCreate',staffing,owner),hostHash('orchestration.taskCreate',before.TaskCreateParams.parse(staffing)),'staffing uses actual TaskCreate parsed bytes + resolved manager, never ordinary message labels');
  assert.notEqual(nativeMutationFingerprint('orchestration.taskCreate',staffing,owner),hostHash('orchestration.taskCreate',before.TaskCreateParams.parse(staffing),'other-manager'));
  assert.notEqual(nativeMutationFingerprint('orchestration.taskCreate',delivery,owner),hostHash('orchestration.taskCreate',before.TaskCreateParams.parse(delivery),'different-head'));
  const review=before.TaskUpdateParams.parse({id:'task_test',status:'completed',result:'{"decision":"accept"}',run:'run_test',callerTerminalHandle:`orca_session_id:${caller}`,__orcaCallerOrcaSessionId:'forged'});
  assert.equal(review.__orcaCallerOrcaSessionId,undefined);
  assert.equal(nativeMutationFingerprint('orchestration.taskUpdate',review,owner),hostHash('orchestration.taskUpdate',review));
  assert.notEqual(nativeMutationFingerprint('orchestration.taskUpdate',review,owner),hostHash('orchestration.taskUpdate',review,'wrong-reviewer'));
  assert.notEqual(nativeMutationFingerprint('orchestration.taskUpdate',review,owner),hostHash('orchestration.taskUpdate',{...review,result:review.result+' '}));
  const targetPane='target:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reuse={task:'task_test',run:'run_test',from:`orca_session_id:${caller}`,worktree:'folder:/verified',terminal:'target',devMode:false};
  const reuseRuntime={getTerminalPaneKey:handle=>handle==='target'?targetPane:null};
  assert.equal(nativeMutationFingerprint('orchestration.workerStart',reuse,owner,{kind:'terminal',paneKey:targetPane}),hostHash('orchestration.workerStart',before.WorkerStartParams.parse(reuse),caller,reuseRuntime));
  const chatReuse={...reuse,terminal:'orca_session_id:claude_child'};
  assert.equal(nativeMutationFingerprint('orchestration.workerStart',chatReuse,owner,{kind:'structured'}),hostHash('orchestration.workerStart',before.WorkerStartParams.parse(chatReuse)));
  for(const terminal of ['target', 'orca_session_id:claude_child']) {
    const params={...reuse,terminal};
    for(const overrides of [{agent:'codex'},{model:'model'},{effort:'high'}])assert.throws(()=>before.prepareLocalWorkerStart({params:{...params,...overrides},createsWorktree:false,runtime:{}}),/terminal/);
    const effects=[],native=await before.placeWorkerAgent({params,runtime:new Proxy({}, {get(){throw Error('Reuse must not create a native session, terminal or worktree');}}),resolvedWorktree:{id:'folder:/verified',repoId:'existing'},mode:{mode:'terminal'},effects,onStage:()=>{}});
    assert.equal(native.terminalHandle,terminal);assert.equal(native.structuredSession,null);assert.deepEqual(effects,[{kind:'terminal',role:'agent',action:'reused',id:terminal}]);
  }
  const message=before.OrchestrationSendParams.parse({from:`orca_session_id:${caller}`,to:'run:run_test',subject:'Progress',body:'Evidence',type:'status',run:'run_test',devMode:false,__orcaCallerOrcaSessionId:'forged'});
  assert.equal(message.__orcaCallerOrcaSessionId,undefined);
  assert.equal(nativeMutationFingerprint('orchestration.send',message,owner),hostHash('orchestration.send',message));
  const ask=before.AskParams.parse({question:'Which scope?',run:'run_test',from:`orca_session_id:${caller}`,compatibilityCliCommand:'orca',timeoutMs:10000,__orcaCallerOrcaSessionId:'forged'});
  assert.equal(ask.__orcaCallerOrcaSessionId,undefined);
  assert.equal(nativeMutationFingerprint('orchestration.ask',ask,owner),hostHash('orchestration.ask',ask));
  assert.notEqual(nativeMutationFingerprint('orchestration.ask',{...ask,compatibilityCliCommand:undefined},owner),hostHash('orchestration.ask',ask));
  assert.equal(before.AskParams.safeParse({question:'new',resume:'old'}).success,false);
  const workerInput = { task: 'task_test', run: 'run_test', from: `orca_session_id:${caller}`, worktree: 'folder:/verified', agent: 'claude', devMode: false };
  const worker = before.WorkerStartParams.parse({ ...workerInput, waitSubmitMs: 1000, __orcaCallerOrcaSessionId: 'forged' });
  assert.equal(worker.__orcaCallerOrcaSessionId, undefined);
  assert.equal(nativeMutationFingerprint('orchestration.workerStart', workerInput, owner), hostHash('orchestration.workerStart', worker));
  for (const identity of [null, 'different-resolved-caller']) assert.notEqual(hostHash('orchestration.workerStart', worker, identity), hostHash('orchestration.workerStart', worker));
  assert.notEqual(hostHash('orchestration.workerStart', { ...worker, devMode: undefined }), hostHash('orchestration.workerStart', worker), 'parsed devMode absence differs from false');
  assert.equal(before.WorkerStartParams.safeParse({ ...workerInput, model: ' padded ' }).success, false);
  assert.equal(before.WorkerStartParams.safeParse({ ...workerInput, spec }).success, false);
  assert.equal(hostHash('orchestration.workerStart', { ...worker, waitSubmitMs: 8000 }), hostHash('orchestration.workerStart', worker));
  for (const paneKey of ['tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'legacy-pane']) {
    const runtime = { getTerminalPaneKey: () => paneKey };
    const normalized = paneKey.includes(':') ? { paneLeafId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } : { paneKey };
    assert.deepEqual(before.replayStableCallerParams(runtime, { from: 'term', callerTerminalHandle: 'term', terminal: 'target' }), { from: normalized, callerTerminalHandle: normalized, terminal: normalized });
    const terminalOwner = { kind: 'terminal', handle: 'term', paneKey };
    const terminalTask = before.TaskCreateParams.parse({ spec, run: 'run_test', callerTerminalHandle: 'term' });
    assert.equal(nativeMutationFingerprint('orchestration.taskCreate', terminalTask, terminalOwner), hostHash('orchestration.taskCreate', terminalTask, null, runtime));
    const terminalStart = before.WorkerStartParams.parse({ ...workerInput, from: 'term' });
    assert.equal(nativeMutationFingerprint('orchestration.workerStart', terminalStart, terminalOwner), hostHash('orchestration.workerStart', terminalStart, null, runtime));
  }
  }
  const body = { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'A separate total objective' }] };
  const sendEnvelope = { sessionId: 'head-session', clientOperationId: `${Date.now()}-0123456789abcdef0123456789abcdef`, expectedRuntimeFence: 7, payloadFingerprint: sendFingerprint('head-session', body) };
  assert.equal(before.SendParams.safeParse({ envelope: sendEnvelope, body }).success, true);
  const queuedEnvelope={...sendEnvelope,payloadFingerprint:sendFingerprint('head-session',body,'queue-if-active')};
  assert.equal(before.SendParams.safeParse({envelope:queuedEnvelope,body,delivery:'queue-if-active'}).success,true);
  assert.equal(queuedEnvelope.payloadFingerprint,before.computeAgentSessionPayloadFingerprint({method:'agentSession.send',sessionId:'head-session',fields:{body,delivery:'queue-if-active'}}));
  assert.equal(before.SendParams.safeParse({ envelope: sendEnvelope, body: { ...body, role: 'assistant' } }).success, false);
  assert.equal(sendEnvelope.payloadFingerprint, before.computeAgentSessionPayloadFingerprint({ method: 'agentSession.send', sessionId: 'head-session', fields: { body } }));
  assert.deepEqual(before.resolveRpcCallerIdentity(undefined), { kind: 'local-cli' });
  assert.equal(before.rpcCallerOperationKey(before.resolveRpcCallerIdentity(undefined)), 'trusted-local:runtime');
  const runDb = new DatabaseSync(join(root, 'orchestration.db'));
  runDb.exec(before.createCoreTablesSql()); runDb.exec('PRAGMA user_version=43');
  runDb.prepare('INSERT INTO runs (id,objective,coordinator_orca_session_id,coordinator_orca_session_id_generation,consumer_generation,legacy) VALUES (?,?,?,?,?,?)').run('run-proof', 'exact-issued-objective', 'head-session', 2, 2, 0);
  assert.equal(before.currentRunCoordinatorOrcaSessionId({ coordinator_orca_session_id: 'head-session', coordinator_orca_session_id_generation: 1, consumer_generation: 2 }), null);
  runDb.close();
  assert.equal((await readNativeRunEvidence(root, { objective: 'exact-issued-objective', owner: { kind: 'structured', sessionId: 'head-session' } })).state, 'verified');

  const nativeInput = { operationId: `${Date.now()}-0123456789abcdef0123456789abcdef`, agent: 'claude', target: { kind: 'existing', worktree: 'folder:/verified' }, prompt: { text: 'role brief', delivery: 'submit' }, sessionOptions: { model: 'opaque-model', effort: 'max' } };
  assert.equal(before.AgentLaunchReplay.safeParse(nativeInput).success, true);
  assert.equal(before.AgentLaunchReplay.safeParse({ ...nativeInput, operationId: 'plain-uuid' }).success, false);
  assert.equal(before.AgentLaunchReplay.safeParse({ ...nativeInput, operationId: undefined }).success, false);
  assert.equal(before.AgentLaunch.safeParse({ ...nativeInput, operationId: undefined }).success, true);
  for (const variant of [nativeInput, { ...nativeInput, agentArgs: null }, { ...nativeInput, agentArgs: '--configured', presentation: 'background' }]) assert.equal(nativeLaunchFingerprint(variant), before.computeAgentLaunchFingerprint(variant));
  assert.notEqual(nativeLaunchFingerprint(nativeInput), nativeLaunchFingerprint({ ...nativeInput, agentArgs: null }));
  const nativeDb = new DatabaseSync(join(root, 'agent-session-journal.db'));
  nativeDb.exec(before.createAgentSessionRecordTablesSql()); nativeDb.exec('PRAGMA user_version=4');
  const originalReceipt = { worktreeId: 'folder:/verified', outcome: { kind: 'structured', sessionId: 'claude:fixture', handle: 'host-handle' }, receipt: { mode: 'structured', preferred: 'structured', reason: 'user_default', detail: 'fixture' }, prompt: { delivery: 'submit', outcome: 'unconfirmed' } };
  nativeDb.prepare('INSERT INTO agent_session_operations VALUES (?,?)').run(`trusted-local:desktop\0${nativeInput.operationId}`, JSON.stringify({ callerKey: 'trusted-local:desktop', operationId: nativeInput.operationId, fingerprint: before.computeAgentLaunchFingerprint(nativeInput), operationTimestamp: Number(nativeInput.operationId.split('-')[0]), recordedAt: Date.now(), expiresAt: Date.now() + 60000, outcome: { status: 'succeeded', sessionId: 'claude:fixture', launch: originalReceipt } }));
  nativeDb.close();
  assert.deepEqual((await readNativeLaunchLedger(root, nativeInput)).result, originalReceipt);

  const scrubbed = before.buildPluginWorkerEnv({ USERPROFILE: 'C:\\Users\\Herman', APPDATA: 'D:\\Redirected\\Roaming', ORCA_USER_DATA_PATH: 'E:\\custom-profile', DESKTOP_SECRET: 'must-not-copy' }, 'win32');
  assert.equal(scrubbed.APPDATA, undefined);
  assert.equal(scrubbed.ORCA_USER_DATA_PATH, undefined);
  assert.equal(scrubbed.DESKTOP_SECRET, undefined);
  const cliEnv = cliEnvironment({ appData: 'D:\\Redirected\\Roaming', userData: 'E:\\custom-profile' }, scrubbed, 'win32');
  assert.equal(cliEnv.APPDATA, 'D:\\Redirected\\Roaming');
  assert.equal(cliEnv.DESKTOP_SECRET, undefined);
  const previousAppData = process.env.APPDATA;
  const previousProfile = process.env.ORCA_USER_DATA_PATH;
  try {
    delete process.env.APPDATA; delete process.env.ORCA_USER_DATA_PATH;
    assert.throws(() => before.getDefaultUserDataPath('win32', 'C:\\Users\\Herman'), /APPDATA is not set/);
    process.env.ORCA_USER_DATA_PATH = cliEnv.ORCA_USER_DATA_PATH;
    assert.equal(before.getDefaultUserDataPath('win32', 'C:\\Users\\Herman'), 'E:\\custom-profile');
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData;
    if (previousProfile === undefined) delete process.env.ORCA_USER_DATA_PATH; else process.env.ORCA_USER_DATA_PATH = previousProfile;
  }
  assert.equal(before.PreflightDetectRemoteAgents.safeParse({ connectionId: 'fixture' }).success, true);
  assert.equal(before.CreateSupportParams.safeParse({ worktree: 'folder:/fixture', agent: 'codex' }).success, true);
  assert.equal(before.ModelCatalogParams.safeParse({ worktree: 'folder:/fixture', agent: 'claude' }).success, true);
  assert.equal(before.ModelCatalogParams.safeParse({ agent: 'claude', executionHost: 'made-up' }).success, false);
  const manifest = JSON.parse(await readFile(join(project, 'orca-plugin.json'), 'utf8'));
  assert.equal(before.parsePluginManifest(manifest).ok, true);
  assert.equal(before.parsePluginManifest({ ...manifest, version: '0.1.04' }).ok, false);
  assert.equal(manifest.main, 'main.mjs');
  assert.notEqual(before.fingerprintPluginConsent(manifest), before.fingerprintPluginConsent({ ...manifest, main: undefined }));
  assert.equal(before.gatePluginHostCall({ viaPanel: false, grantedCapabilities: [] }, 'notifications.show').granted, false);
  assert.equal(before.gatePluginHostCall({ viaPanel: false, grantedCapabilities: ['notifications:show'] }, 'notifications.show').granted, true);
  assert.equal(before.gatePluginHostCall({ viaPanel: true, grantedCapabilities: ['storage'] }, 'storage.get').granted, false);
  assert.equal(before.gatePluginHostCall({ viaPanel: false, grantedCapabilities: ['storage'] }, 'storage.get').granted, true);
  const envelope = { type: 'orca-panel-action', requestId: 'panel-1', action: 'workspace.readContext', params: { teamWorker: { protocol: 1, nonce: 'roundtrip', commandId: 'team.control', args: { op: 'ping' } } } };
  assert.equal(before.panelActionRequestSchema.safeParse(envelope).success, true);
  const data = new Map();
  const services = {
    dispatchPluginNotification: async notification => ({delivered:notification.pluginId==='herman925.team-orchestrator'}),
    storage: { get: (_, key) => data.get(key), set: (_, key, value) => { data.set(key, value); return { ok: true }; } },
    resolveActiveWorktreeContext: async () => ({ worktreeId: 'repo::/remote/project', branch: 'main', displayName: 'Remote workspace' }),
    listWorktreeTerminals: async () => []
  };
  const base = { pluginId: 'herman925.team-orchestrator', grantedCapabilities: ['storage', 'workspace:read'], services, audit: { record: async () => {} } };
  const worker = input => before.executePluginHostCall({ ...base, viaPanel: false, ...input });
  assert.equal((await worker({method:'notifications.show',params:{title:'Decision',body:'Choose scope'}})).ok,false);
  assert.deepEqual((await worker({method:'notifications.show',params:{title:'Decision',body:'Choose scope'},grantedCapabilities:['notifications:show']})).value,{delivered:true});
  assert.equal((await worker({method:'notifications.show',params:{title:'x'.repeat(121)},grantedCapabilities:['notifications:show']})).code,'invalid_params');
  assert.equal((await worker({ method: 'storage.set', params: { key: 'launch:request-1', value: { status: 'starting' } } })).ok, true);
  assert.deepEqual((await worker({ method: 'storage.get', params: { key: 'launch:request-1' } })).value, { value: { status: 'starting' } });
  assert.equal((await worker({ method: 'storage.set', params: { key: '__proto__', value: 1 } })).code, 'invalid_params');
  assert.equal((await worker({ method: 'storage.set', params: { key: 'teams', value: 1 }, audit: undefined })).ok, false);
  assert.equal((await before.executePluginHostCall({ ...base, viaPanel: true, method: 'workspace.readContext', params: envelope.params })).code, 'invalid_params');
  let enabled = true; let invoked = 0;
  const handlers = new Map();
  const ipcMain = { _invokeHandlers: handlers, handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) };
  handlers.set('plugins:readPanelEntry', async () => ({ sessionToken: 'approved-token' }));
  handlers.set('plugins:panelAction', async (_, args) => before.executePluginHostCall({ ...base, grantedCapabilities: enabled ? base.grantedCapabilities : null, viaPanel: true, method: args.action, params: args.params }));
  handlers.set('plugins:invokeCommand', async (_, args) => { invoked++; assert.equal(args.pluginKey, base.pluginId); return { nonce: args.args.nonce }; });
  const sessions = new before.PluginPanelSessions();
  const binding = { pluginKey: base.pluginId, panelId: 'team', rootDir: project, manifestRevision: 'current' };
  const existingToken = sessions.issue('renderer:20', binding);
  assert.equal(sessions.issue('renderer:20', binding), existingToken);
  assert.equal(sessions.resolve('renderer:21', existingToken), null);
  const installed = await installAdapter({ ipcMain }, { version: 'contract', identity: 'contract' });
  assert.equal(installed.ready, true);
  const mainFrame = {}; const event = { sender: { id: 20, mainFrame }, senderFrame: mainFrame };
  await handlers.get('plugins:readPanelEntry')(event, { pluginKey: base.pluginId, panelId: 'team' });
  const call = { sessionToken: 'approved-token', action: envelope.action, params: envelope.params };
  assert.equal((await handlers.get('plugins:panelAction')(event, call)).value.nonce, 'roundtrip');
  enabled = false;
  assert.equal((await handlers.get('plugins:panelAction')(event, call)).ok, false);
  assert.equal(invoked, 1);
  globalThis[Symbol.for('herman925.team-orchestrator.adapter')].restore();
  console.log(`PASS: pinned Orca ${revision}: stock manifest, trusted-worker consent change, panel transport envelope, original workspace gate, pinned TaskCreate/WorkerStart parsers, PTY-qualified orchestration versus raw prompt identity, resolved-caller hashes and pane normalization, capability read schemas, worker storage/audit, revoked authority, scrubbed Windows environment and explicit desktop runtime profile. Boundaries: inert network base; unexecuted launch-mode/provider boundary and default method registry throw if used. Existing-worker reuse only, not provider launch acceptance.`);
} finally { await rm(root, { recursive: true, force: true }); }

}
