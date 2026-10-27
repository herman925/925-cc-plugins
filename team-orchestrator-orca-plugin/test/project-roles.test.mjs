import { rmTemp } from './temp.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, writeFile, readdir, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { projectRoot, syncProjectRoles } from '../src/local/project-roles.mjs';
import { roleFilePath, ROLE_MARKER, rolePointer } from '../src/role-files.mjs';
import { memberLaunch } from '../src/launch.mjs';
import { dispatchInstructions } from '../src/local/dispatch.mjs';
import { planTeam, DEFAULT_FORM } from '../src/team.mjs';
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-role-files-')));
  // Keep recursive deletion confined to the exact mkdtemp directory.
  t.after(() => rmTemp(root));
  const team = planTeam({...DEFAULT_FORM,projectRoleFiles:1}); team.id=randomUUID();team.configVersion=1;
  const ids=new Map(team.members.map(m=>[m.id,randomUUID()]));
  team.members=team.members.map(m=>({...m,id:ids.get(m.id),boss:ids.get(m.boss)??null,roleVersion:1,habits:'',collaboration:''}));
  return {root,team,path:m=>join(root,roleFilePath(team,m))};
}
test('all role files and generated roster are stable and preserve exact personal notes on roster amendments',async t=>{
  const f=await fixture(t);await syncProjectRoles(f.team,f.root);
  for(const member of f.team.members)assert.match(await readFile(f.path(member),'utf8'),/Configuration version: 1; role version: 1/);
  const head=f.team.members[0],before=await readFile(f.path(head),'utf8');
  const notes='\r\n\r\n## Personal notes\r\nUse concise updates. 中文\r\n';
  await writeFile(f.path(head),before.slice(0,before.indexOf(ROLE_MARKER)+ROLE_MARKER.length)+notes);
  f.team.configVersion++;head.name='Renamed Head';head.brief='Review the results carefully.';head.roleVersion++;
  await syncProjectRoles(f.team,f.root);const after=await readFile(f.path(head),'utf8');
  assert.ok(after.endsWith(notes));assert.match(after,/# Renamed Head/);assert.match(after,/Configuration version: 2; role version: 2/);
  await syncProjectRoles(f.team,f.root);assert.equal(await readFile(f.path(head),'utf8'),after);
  const roster=JSON.parse(await readFile(join(f.root,'.orca/team-orchestrator',f.team.id,'roster.json'),'utf8'));
  assert.equal(roster.configVersion,2);assert.equal(roster.members.length,f.team.members.length);
  assert.ok(!(await readdir(join(f.root,'.orca/team-orchestrator',f.team.id,'roles'))).some(name=>name.endsWith('.tmp')));
});
test('identically named teams and members have independent stable files',async t=>{
  const a=await fixture(t),b=await fixture(t);await syncProjectRoles(a.team,a.root);await syncProjectRoles(b.team,a.root);
  assert.notEqual(roleFilePath(a.team,a.team.members[0]),roleFilePath(b.team,b.team.members[0]));
  assert.match(await readFile(join(a.root,roleFilePath(b.team,b.team.members[0])),'utf8'),new RegExp(b.team.id===a.team.id?'impossible':b.team.members[0].id));
});
test('unmarked existing roles and symlinked project directories fail without overwriting content',async t=>{
  const f=await fixture(t);await syncProjectRoles(f.team,f.root);const path=f.path(f.team.members[0]);
  await writeFile(path,'Keep my unrelated file');await assert.rejects(syncProjectRoles(f.team,f.root),/no generated-section marker/);
  assert.equal(await readFile(path,'utf8'),'Keep my unrelated file');
  const other=await fixture(t),outside=await fixture(t);await symlink(outside.root,join(other.root,'.orca'),'junction');
  await assert.rejects(syncProjectRoles(other.team,other.root),/symlinks or junctions/);assert.deepEqual(await readdir(outside.root),[]);
});
test('only the exact verified local project root can receive files',async t=>{
  const f=await fixture(t),scope={workspaceId:'folder:test',executionHostId:'local',projectPath:f.root};
  assert.equal(await projectRoot({id:scope.workspaceId,hostId:'local',path:f.root},scope),f.root);
  await assert.rejects(projectRoot({id:scope.workspaceId,hostId:'ssh:remote',path:f.root},{...scope,executionHostId:'ssh:remote'}),/remote project writes are unsupported/);
  await assert.rejects(projectRoot({id:scope.workspaceId,hostId:'local',path:tmpdir()},scope),/saved project path changed/);
  await assert.rejects(projectRoot({id:'other',hostId:'local',path:f.root},scope),/unverified/);
});
test('both CLI launch prompts and later task packets carry the exact persistent reread pointer',async t=>{
  const f=await fixture(t),head=f.team.members[0],worker=f.team.members[1];
  for(const agent of ['codex','claude'])assert.ok(memberLaunch(f.team,{...head,agent},'key').brief.startsWith(rolePointer(f.team,head)));
  const packet=dispatchInstructions({id:'work',supervisorMemberId:head.id,run:{id:'run'}},f.team,{token:'token',generation:1});
  assert.ok(packet.includes(roleFilePath(f.team,worker)));assert.ok(packet.includes('roleFileInstruction'));
  delete f.team.configuration.projectRoleFiles;assert.ok(!memberLaunch(f.team,head,'key').brief.includes('.orca/team-orchestrator/'));
});
