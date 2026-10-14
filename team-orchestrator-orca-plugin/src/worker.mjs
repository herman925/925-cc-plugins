import { bootstrap } from './local/bootstrap.mjs';
import { locateCli, createCliRunner } from './local/cli.mjs';
import { createExecutor } from './local/executor.mjs';
export default function activate(orca) {
  let ready;
  let initialising = false;
  const executorPromise = locateCli().then(command => createExecutor(orca.host, createCliRunner(command)));
  // Register immediately: Orca's worker ready deadline is shorter than a bootstrap attempt.
  const initialise = () => {
    if (ready) return ready;
    initialising = true;
    ready = bootstrap({ version: __PLUGIN_DISPLAY_VERSION__ }).then(async report => {
      await orca.host.call('storage.set', { key: 'bootstrap-status', value: report });
      orca.log(report.detail);
      return report;
    }).finally(() => { initialising = false; });
    return ready;
  };
  orca.commands.register('team.initialise', async () => { if (!initialising) ready = null; return initialise(); });
  orca.commands.register('team.control', async args => {
    const report = await initialise();
    if (!report.ready) throw new Error(report.detail);
    if (!args || args.op === 'ping') return { nonce: args?.nonce, ...report, workerPid: process.pid };
    return (await executorPromise).execute(args);
  });
  for (const event of ['worktree.created', 'agent.status.changed']) orca.events.on(event, () => initialise());
  // A subscribed event or the Initialise command starts this lazy worker.
  initialise().catch(error => orca.log(`Bootstrap failed: ${error.message}`));
  executorPromise.catch(error => orca.log(`Executor unavailable: ${error.message}`));
}
