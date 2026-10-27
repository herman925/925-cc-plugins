import { rmTemp } from './temp.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { transcriptContext, terminalProviderSession, createTerminalContextReader } from '../src/local/terminal-context.mjs';
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const meta = { type:'session_meta', payload:{id:'session',cwd:'/work'} };
const codex = (used=40000,limit=100000) => ({type:'event_msg',timestamp:'2026-10-18T12:00:00Z',payload:{type:'token_count',info:{last_token_usage:{total_tokens:used,input_tokens:used-100,output_tokens:100},total_token_usage:{total_tokens:9876543},model_context_window:limit}}});
const claude = (extra={}) => ({type:'assistant',sessionId:'session',cwd:'/work',timestamp:'2026-10-18T12:00:00Z',message:{model:'custom-backend',usage:{input_tokens:1000,cache_creation_input_tokens:2000,cache_read_input_tokens:3000,output_tokens:9000}},...extra});
function parse(agent,rows,extra={}) { const text=jsonl(rows);return transcriptContext({agent,sessionId:'session',cwd:'/work',head:text,tail:text,...extra}); }
test('Codex context uses its last reading and reported window, never cumulative billing',()=>{
 const usage=parse('codex',[meta,codex()]);assert.equal(usage.used,40000);assert.equal(usage.percent,40);assert.equal(usage.estimated,false);
 assert.equal(parse('codex',[meta,codex(120000)]).percent,120);
 assert.equal(parse('codex',[meta,codex(40000,null)]).percent,null);
 assert.equal(parse('codex',[meta,codex(0)]),null);
});
test('Claude context counts main-thread input and cache, leaves unreported capacity unknown',()=>{
 const usage=parse('claude',[claude(),claude({isSidechain:true,message:{usage:{input_tokens:90000}}})]);
 assert.equal(usage.used,6000);assert.equal(usage.limit,null);assert.equal(usage.percent,null);assert.equal(usage.estimated,true);
 assert.equal(parse('claude',[claude({message:{model:'custom',usage:{input_tokens:0}}})]).used,0);
 assert.equal(parse('claude',[claude({message:{model:'custom',usage:{input_tokens:-1}}})]),null);
});
test('transcript identity, project and compaction boundaries prevent another or obsolete reading',()=>{
 assert.equal(parse('codex',[meta,codex()],{sessionId:'other'}),null);
 assert.equal(parse('codex',[meta,codex()],{cwd:'/elsewhere'}),null);
 assert.equal(parse('claude',[claude({sessionId:'other'})]),null);
 assert.equal(parse('claude',[claude({cwd:'/elsewhere'})]),null);
 assert.equal(parse('codex',[meta,codex(),{type:'compacted'}]),null);
 assert.equal(parse('claude',[claude(),{type:'system',subtype:'compact_boundary',sessionId:'session',cwd:'/work'}]),null);
 assert.equal(parse('codex',[meta,{type:'compacted'},codex(10000)]).used,10000);
 assert.equal(parse('claude',[claude(),claude({message:{model:'<synthetic>',usage:{input_tokens:999}}})]).used,6000);
});
test('bounded tails ignore truncated records and incomplete last writes',()=>{
 const tail='partial prior record\n'+jsonl([claude()])+JSON.stringify(claude({message:{usage:{input_tokens:99999}}}));
 assert.equal(transcriptContext({agent:'claude',sessionId:'session',cwd:'/work',head:'',tail,partialStart:true}).used,6000);
});
const shown = {handle:'term',worktreeId:'workspace',worktreePath:'/work',tabId:'tab',leafId:'leaf',ptyId:'pty',incarnationId:'instance'};
function snapshot(path) { return {worktree:'workspace',tabs:[{type:'terminal',parentTabId:'tab',leafId:'leaf',ptyId:'pty',incarnationId:'instance',agentStatus:{terminalHandle:'term',agentType:'claude',providerSession:{key:'session_id',id:'session',transcriptPath:path}}}]}; }
test('provider transcript mapping requires the exact native pane, PTY, handle and agent',()=>{
 const value=snapshot('/private/session.jsonl');assert.equal(terminalProviderSession(value,shown,'claude').sessionId,'session');
 for(const field of ['handle','worktreeId','tabId','leafId','ptyId','incarnationId'])assert.equal(terminalProviderSession(value,{...shown,[field]:'other'},'claude'),null,field);
 assert.equal(terminalProviderSession(value,shown,'codex'),null);
 value.tabs.push(value.tabs[0]);assert.equal(terminalProviderSession(value,shown,'claude'),null);
 for(const key of ['restoredUnconfirmed','sessionBoundary']){const stale=snapshot('/private/session.jsonl');stale.tabs[0].agentStatus[key]=true;assert.equal(terminalProviderSession(stale,shown,'claude'),null);}
});
test('reader caches only measurements, refreshes changed files and rejects changed provider identity',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'team-context-'));t.after(()=>rmTemp(dir));const path=join(dir,'session.jsonl');await writeFile(path,jsonl([claude()]));
 const reader=createTerminalContextReader();let calls=0,change=false;
 const rpc=async(method)=>{assert.equal(method,'session.tabs.list');calls++;const row=snapshot(path);if(change&&calls%2===0)row.tabs[0].agentStatus.providerSession.id='new-session';return row;};
 const read=()=>reader({rpc,shown,agent:'claude',scope:{workspaceId:'workspace',executionHostId:'local'},snapshots:new Map()});
 assert.equal((await read()).used,6000);assert.equal((await read()).used,6000);
 await appendFile(path,jsonl([claude({message:{model:'custom',usage:{input_tokens:8000}}})]));assert.equal((await read()).used,8000);
 change=true;assert.equal(await read(),null);
});
test('reader never opens remote paths, symlinks, or a file selected by a mismatched native tab',{skip:process.platform==='win32'?'a symlink needs Developer Mode or an elevated account on Windows':false},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'team-context-'));t.after(()=>rmTemp(dir));const path=join(dir,'session.jsonl'),link=join(dir,'link.jsonl');await writeFile(path,jsonl([claude()]));await symlink(path,link);
 const reader=createTerminalContextReader();const args={shown,agent:'claude',scope:{workspaceId:'workspace',executionHostId:'ssh:elsewhere'},snapshots:new Map(),rpc:()=>{throw Error('Remote lookup should not happen');}};
 assert.equal(await reader(args),null);
 await assert.rejects(reader({...args,scope:{...args.scope,executionHostId:'local'},rpc:async()=>snapshot(link)}));
 const other=snapshot(path);other.tabs[0].incarnationId='other';assert.equal(await reader({...args,scope:{...args.scope,executionHostId:'local'},snapshots:new Map(),rpc:async()=>other}),null);
});
