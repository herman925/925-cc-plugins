import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {connectOwnedProviderRpc} from '../src/provider-rpc.mjs';
function fixture(options={}){
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.exitCode=null;child.killed=false;
 let sent='';child.stdin.setEncoding('utf8');child.stdin.on('data',chunk=>sent+=chunk);
 const rpc=connectOwnedProviderRpc({child,...options});return {child,rpc,frames:()=>sent.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),reply:row=>child.stdout.write(JSON.stringify(row)+'\n')};
}
test('owned provider calls correlate by exact request id even out of order',async()=>{
 const f=fixture(),one=f.rpc.call('thread/read',{threadId:'one'}),two=f.rpc.call('thread/read',{threadId:'two'}),frames=f.frames();f.reply({id:frames[1].id,result:{id:'two'}});f.reply({id:frames[0].id,result:{id:'one'}});assert.deepEqual(await one,{id:'one'});assert.deepEqual(await two,{id:'two'});assert.equal(f.rpc.status().pendingCalls,0);
});
test('native approval requests remain pending without any automatic response',async()=>{
 const received=[],f=fixture({onRequest:row=>received.push(row)});f.reply({id:'approval',method:'mcpServer/elicitation/request',params:{message:'Human review'}});assert.equal(received.length,1);assert.equal(f.frames().length,0);assert.equal(f.rpc.pendingRequests()[0].id,'approval');f.rpc.disconnect();assert.equal(f.frames().length,0);
});
test('an explicit private human bridge can settle only an existing request once',()=>{
 const f=fixture();f.reply({id:'question',method:'item/tool/requestUserInput',params:{}});f.rpc.respond('question',{fixture:'synthetic answer, not live consent'});assert.equal(f.frames().length,1);assert.throws(()=>f.rpc.respond('question',{}));assert.throws(()=>f.rpc.respond('other',{}));
});
test('process exit rejects pending calls without restarting or replaying the child',async()=>{
 const f=fixture(),call=f.rpc.call('turn/start',{threadId:'one'});f.child.exitCode=1;f.child.emit('exit',1);await assert.rejects(call,{code:'API_PROVIDER_CONNECTION_LOST'});assert.equal(f.frames().length,1);assert.equal(f.rpc.alive(),false);await assert.rejects(f.rpc.call('turn/start',{}));assert.equal(f.frames().length,1);
});
test('a timed-out mutation is explicitly unknown and never sent twice',async()=>{
 const f=fixture(),call=f.rpc.call('turn/start',{}, {timeoutMs:5});await assert.rejects(call,{code:'API_PROVIDER_REPLY_UNKNOWN'});const frame=f.frames()[0];f.reply({id:frame.id,result:{turn:{id:'late'}}});assert.equal(f.frames().length,1);f.rpc.disconnect();
});
test('protocol corruption and duplicate native requests stop further input',async()=>{
 const f=fixture(),call=f.rpc.call('thread/read',{});f.child.stdout.write('not json\n');await assert.rejects(call,{code:'API_PROVIDER_PROTOCOL'});assert.equal(f.rpc.alive(),false);
 const g=fixture();g.reply({id:1,method:'approval',params:{}});g.reply({id:1,method:'approval',params:{}});assert.equal(g.rpc.alive(),false);assert.equal(g.frames().length,0);
});
test('one owned pipe cannot be attached to two drivers',()=>{const f=fixture();assert.throws(()=>connectOwnedProviderRpc({child:f.child}));f.rpc.disconnect();});
test('native request resolution removes only the matching thread request and never invents an answer',()=>{
 const f=fixture();f.reply({id:'question',method:'item/tool/requestUserInput',params:{threadId:'thread'}});f.reply({method:'serverRequest/resolved',params:{requestId:'question',threadId:'other'}});assert.equal(f.rpc.pendingRequests().length,1);f.reply({method:'serverRequest/resolved',params:{requestId:'question',threadId:'thread'}});assert.equal(f.rpc.pendingRequests().length,0);assert.equal(f.frames().length,0);assert.throws(()=>f.rpc.respond('question',{}));
});
