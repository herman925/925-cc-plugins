import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexLaunchCommand} from '../src/codex-launch.mjs';
const options={member:{model:'default',effort:'default'},actor:{projectRoot:'C:/fixture'},target:{terminalHandle:'target',contextId:'context'},codexExecutable:'C:/native/codex.exe',launchProfile:'C:/private/profile.json'};
test('launch command refuses an absent or widened worker tool-access policy',{skip:process.platform!=='win32'},()=>{
 for(const workerToolPolicy of [undefined,'all-tools','team-worker-v2'])assert.throws(()=>codexLaunchCommand({...options,workerToolPolicy}),{code:'API_WORKER_ACCESS_REQUIRED'});
});
test('reviewed worker command configures only the fixed team tools and preserves native filesystem/approval settings',{skip:process.platform!=='win32'},()=>{
 const command=codexLaunchCommand({...options,workerToolPolicy:'team-worker-v1'}),script=Buffer.from(command.split(' ').at(-1),'base64').toString('utf16le');
 for(const tool of ['shared_team_status','shared_team','shared_inbox_read','shared_inbox_seen'])assert.ok(script.includes(`tools.${tool}.approval_mode=`),tool);
 for(const forbidden of ['approval_policy','sandbox_mode','dangerously-bypass','default_tools_approval_mode','tools.shared_team_manage','tools.shared_team_launch','tools.shared_team_upgrade'])assert.ok(!script.includes(forbidden),forbidden);
});
