import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchMember,launchCommand,launchSettings} from '../src/mod-launch.mjs';
test('a reviewed owned-provider reservation cannot be claimed by the legacy terminal launcher',async()=>{
 let claims=0,effects=0;const api={launch:async request=>{if(request.command.type!=='reserveLaunch')claims++;return {result:{launch:{launch_id:'owned',conversation_id:null},member:{cli:'claude'}}};}};
 await assert.rejects(launchMember({api,native:{createTerminal:()=>effects++},actor:{contextId:'context'},request:{operationId:'attempt',command:{type:'reserveLaunch'}}}),{code:'API_LAUNCH_UNSUPPORTED'});assert.equal(claims,0);assert.equal(effects,0);
});
test('an unknown native create result is never repeated, including after a fresh request',async()=>{
 let claimed=false,creates=0;
 const launch={launch_id:'l',conversation_id:'00000000-0000-4000-8000-000000000001'},member={name:"Worker ' $(touch x)",model:'default',effort:'default'};
 const api={launch:async r=>r.command.type==='reserveLaunch'?{result:{launch,member}}:claimed?{result:{claimed:false,launch}}:(claimed=true,{result:{claimed:true,launch,member}})};
 const native={createTerminal:async()=>{creates++;throw Error('lost response');}},actor={contextId:'r::/project'},request={operationId:'r',command:{type:'reserveLaunch',teamId:'t',expectedConfigVersion:1,expectedControllerGeneration:1}};
 assert.equal((await launchMember({api,native,actor,request,pluginRoot:'/plugin',writeSettings:async()=>'/private/settings.json'})).unknown,true);
 assert.equal((await launchMember({api,native,actor,request:{...request,operationId:'r2'},pluginRoot:'/plugin',writeSettings:async()=>'/private/settings.json'})).unknown,undefined);
 assert.equal(creates,1);
 const command=launchCommand({launch,member},'C:/Plugin with spaces','win32');
 const script=Buffer.from(command.split(' ').at(-1),'base64').toString('utf16le');
 assert.ok(script.includes("'Worker '' $(touch x)'"));assert.ok(script.includes("'C:/Plugin with spaces'"));
 assert.ok(!command.includes(member.name));assert.ok(!script.includes('dangerously-skip'));
});
test('queued launch does not perform a native effect and uses the exact native home once claimed',async()=>{
 let permit=false,creates=0;
 const result={launch:{launch_id:'l',conversation_id:'c'},member:{name:'Worker',model:'default',effort:'default'}};
 const api={launch:async r=>({result:r.command.type==='reserveLaunch'?result:{...result,claimed:permit,queued:!permit}})};
 const native={createTerminal:async input=>{creates++;assert.equal(input.context,'folder:exact');return {terminal:{handle:'new'}};}};
 const options={api,native,actor:{contextId:'folder:exact'},request:{operationId:'r',command:{type:'reserveLaunch',teamId:'t'}},pluginRoot:'/plugin',writeSettings:async()=>'/private/settings.json'};
 assert.equal((await launchMember(options)).queued,true);assert.equal(creates,0);permit=true;
 assert.equal((await launchMember(options)).terminalHandle,'new');assert.equal(creates,1);
});

test('child settings enable only the exact project and preserve configured executables',()=>{const s=JSON.parse(launchSettings({projectRoot:'C:\\Project A\\',node:'C:/Node/node.exe',orca:'C:/Orca/orca.exe'}));const o=s.pluginConfigs['team-orchestrator@inline'].options;assert.deepEqual(JSON.parse(o.projectWorkspaceModes),['shared|c:/project a']);assert.equal(o.sharedStoreNode,'C:/Node/node.exe');assert.equal(o.orcaCommand,'C:/Orca/orca.exe');assert.equal(s.enabledPlugins['team-orchestrator@herman-mods'],false);});
