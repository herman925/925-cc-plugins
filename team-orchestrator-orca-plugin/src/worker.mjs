import { randomBytes } from 'node:crypto';
import { bootstrap } from './local/bootstrap.mjs';
import { locateCli, createCliRunner } from './local/cli.mjs';
import { createExecutor } from './local/executor.mjs';
import { openTeamStore } from './local/store.mjs';
export default function activate(orca) {
  const internalKey = randomBytes(32).toString('hex');
  let ready;
  let initialising = false;
  let executorPromise;
  let storePromise;
  let storeProfile;
  const publicReport = ({ cliPaths, internalKey: ignoredKey, ...report }) => report;
  // Register immediately: Orca's worker ready deadline is shorter than a bootstrap attempt.
  const initialise = () => {
    if (ready) return ready;
    initialising = true;
    ready = Promise.resolve().then(async () => {
      // Check live worker authority before touching the parent process.
      await orca.host.call('storage.get', { key: 'team-definitions-v1' });
      const report = await bootstrap({ version: __PLUGIN_DISPLAY_VERSION__, internalKey });
      orca.log(report.detail);
      return report;
    }).catch(error => {
      ready = null;
      if (/not enabled|current consent|no longer approved/i.test(error.message)) throw new Error('Orca denied the local worker permission check. Let any plugin refresh finish, then retry Initialise local adapter. If Orca marks Team Orchestrator as needing review, review and enable it in Settings > Plugins.');
      throw error;
    }).finally(() => { initialising = false; });
    return ready;
  };
  orca.commands.register('team.initialise', async () => { if (!initialising) ready = null; return publicReport(await initialise()); });
  orca.commands.register('team.control', async args => {
    const report = await initialise();
    if (!args || args.op === 'ping') return { nonce: args?.nonce, ...publicReport(report), workerPid: process.pid };
    if (!report.ready) throw new Error(report.detail);
    if (!report.cliPaths) throw new Error('Orca bootstrap did not resolve the local runtime profile. Retry Initialise local adapter.');
    if (storeProfile && storeProfile !== report.cliPaths.userData) throw new Error('Orca profile changed; restart the plugin worker before continuing.');
    storeProfile = report.cliPaths.userData;
    storePromise ??= openTeamStore({ userData: storeProfile }).catch(error => { storePromise = null; throw error; });
    executorPromise ??= Promise.all([locateCli(undefined, undefined, report.cliPaths), storePromise])
      .then(([command, store]) => createExecutor(orca.host, createCliRunner(command), { store, internalKey, userData: storeProfile }))
      .catch(error => { executorPromise = null; throw error; });
    return (await executorPromise).execute(args);
  });
  for (const event of ['worktree.created', 'agent.status.changed']) orca.events.on(event, () => initialise());
  // A subscribed event or the Initialise command starts this lazy worker.
  initialise().catch(error => orca.log(`Bootstrap failed: ${error.message}`));
}
