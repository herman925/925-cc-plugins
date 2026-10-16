const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2); const log = join(__dirname, '../../cli-calls.jsonl');
const expectedProfile = join(__dirname, '../../redirected-runtime-profile');
if (process.env.ORCA_USER_DATA_PATH !== expectedProfile) { console.log(JSON.stringify({ ok: false, error: { message: 'APPDATA is not set, so the Orca runtime metadata path cannot be resolved.' } })); process.exit(1); }
appendFileSync(log, JSON.stringify(args) + '\n');
let result;
if (args[0] === 'agent-context') { console.log(JSON.stringify({ commands: [{ command: 'terminal create', flags: ['shell'] }] })); process.exit(0); }
if (args[0] === 'worktree') result = { worktree: { id: 'repo::/remote/project', repoId: 'repo', path: '/remote/project', displayName: 'Remote workspace', hostId: 'ssh:fixture' } };
else if (args[0] === 'repo') result = { repo: { id: 'repo', kind: 'git' } };
else if (args[1] === 'create') { const count = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).filter(a => a[1] === 'create').length; result = { terminal: { handle: 'fixture-child-' + count } }; }
else if (args[1] === 'show') { const handle = args[args.indexOf('--terminal') + 1]; const names = ['Head', 'Worker-1', 'Worker-2', 'Worker-3']; result = { terminal: { title: 'Squad/' + names[Number(handle.split('-').at(-1)) - 1], executionHostId: 'ssh:fixture' } }; }
else result = {};
console.log(JSON.stringify({ ok: true, result }));
