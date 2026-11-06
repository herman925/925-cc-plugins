import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {serveMcp} from '../src/mcp-stdio.mjs';
async function exchange({reply,cancel=false,capabilities={elicitation:{form:{}}},timeout=500}){
 const input=new PassThrough(),output=new PassThrough();let body='',pending='',reviewCount=0;const rows=[];
 output.setEncoding('utf8');output.on('data',chunk=>{
  body+=chunk;pending+=chunk;let n;while((n=pending.indexOf('\n'))>=0){const row=JSON.parse(pending.slice(0,n));pending=pending.slice(n+1);rows.push(row);
   if(row.method==='elicitation/create'){reviewCount++;assert.ok(row.id.startsWith('925-to-review-'));if(cancel)input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:2}})+'\n');else if(reply)input.write(JSON.stringify({jsonrpc:'2.0',id:row.id,result:reply})+'\n');}
   if(row.id===2&&!row.method)input.end();
  }
 });
 const run=serveMcp({call:async(_name,_args,_meta,connection)=>{if(!connection.canElicit)throw Object.assign(Error('Unavailable'),{code:'API_REVIEW_UNAVAILABLE'});return connection.elicit({mode:'form',message:'Exact proposal',requestedSchema:{type:'object',properties:{confirm:{type:'boolean'}},required:['confirm']}});}},[{name:'review',inputSchema:{type:'object'}}],{input,output,reviewTimeoutMs:timeout});
 input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities}})+'\n');input.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'review',arguments:{}}})+'\n');await run;return {rows,reviewCount,body};
}
test('native elicitation replies are read while the tool call waits; no server deadlock',async()=>{
 const r=await exchange({reply:{action:'accept',content:{confirm:true}}});assert.equal(r.reviewCount,1);assert.equal(JSON.parse(r.rows.find(v=>v.id===2).result.content[0].text).content.confirm,true);
});
test('client cancellation and timeout return refusals rather than accepting default values',async()=>{
 for(const options of [{cancel:true},{timeout:10}]){const r=await exchange(options);const result=r.rows.find(v=>v.id===2).result;assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).error.code,'API_REVIEW_UNAVAILABLE');}
});
test('clients lacking elicitation support receive a clear refusal and no prompt',async()=>{
 const r=await exchange({capabilities:{}});assert.equal(r.reviewCount,0);assert.equal(r.rows.find(v=>v.id===2).result.isError,true);
});
test('human review remains pending beyond the former three-minute deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const input=new PassThrough(),output=new PassThrough(),rows=[],traces=[];let buffer='',reviewId;
 output.on('data',chunk=>{buffer+=chunk;for(let n;(n=buffer.indexOf('\n'))>=0;){const row=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);rows.push(row);if(row.method==='elicitation/create')reviewId=row.id;if(row.id===2&&!row.method)input.end();}});
 const run=serveMcp({call:async(_n,_a,_m,c)=>c.elicit({mode:'form',message:'Fixture only',requestedSchema:{type:'object',properties:{confirm:{type:'boolean'}}}})},[{name:'review'}],{input,output,reviewTrace:e=>traces.push(e)});
 input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{elicitation:{form:{}}}}})+'\n');
 input.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'review'}})+'\n');
 await new Promise(setImmediate);assert.ok(reviewId);
 t.mock.timers.tick(25*60*1000);await new Promise(setImmediate);
 assert.equal(rows.some(r=>r.id===2&&!r.method),false,'waiting is not approval or refusal');
 input.write(JSON.stringify({jsonrpc:'2.0',id:reviewId,result:{action:'accept',content:{confirm:true}}})+'\n');await run;
 assert.equal(JSON.parse(rows.find(r=>r.id===2).result.content[0].text).content.confirm,true);
 assert.deepEqual(traces.map(e=>e.event),['request','response']);assert.equal(traces[0].timeoutMs,null);
 assert.equal(traces[0].id,traces[1].id);assert.equal(traces[0].tool,'review');assert.ok(!JSON.stringify(traces).includes('Fixture only'));
});
test('an explicit deadline cancels the native request and a racing late accept cannot authorize effects',async()=>{
 const input=new PassThrough(),output=new PassThrough(),rows=[],traces=[];let buffer='',effects=0;
 output.on('data',chunk=>{buffer+=chunk;for(let n;(n=buffer.indexOf('\n'))>=0;){const row=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);rows.push(row);
  if(row.method==='notifications/cancelled')input.write(JSON.stringify({jsonrpc:'2.0',id:row.params.requestId,result:{action:'accept',content:{confirm:true}}})+'\n');
  if(row.id===2&&!row.method)input.end();
 }});
 const run=serveMcp({call:async(_n,_a,_m,c)=>{await c.elicit({mode:'form',message:'Fixture',requestedSchema:{type:'object',properties:{}}});effects++;}},[{name:'review'}],{input,output,reviewTimeoutMs:10,reviewTrace:e=>traces.push(e)});
 input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{elicitation:{}}}})+'\n');input.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'review'}})+'\n');await run;
 assert.equal(effects,0);assert.equal(rows.find(r=>r.id===2).result.isError,true);
 assert.equal(rows.find(r=>r.method==='notifications/cancelled').params.requestId,traces[0].id);
 assert.deepEqual(traces.map(e=>e.event),['request','timeout','unmatched-response']);
 assert.equal(rows.some(r=>r.error),false,'never answer a late JSON-RPC response with another error response');
});
test('keepalive replies are served while native confirmation is pending',async()=>{
 const input=new PassThrough(),output=new PassThrough();let buffer='',reviewId,pingAnswered=false;
 output.setEncoding('utf8');output.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const row=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);
  if(row.method==='elicitation/create'){reviewId=row.id;input.write(JSON.stringify({jsonrpc:'2.0',id:3,method:'ping'})+'\n');}
  if(row.id===3){pingAnswered=true;input.write(JSON.stringify({jsonrpc:'2.0',id:reviewId,result:{action:'accept',content:{confirm:true}}})+'\n');}
  if(row.id===2){assert.equal(pingAnswered,true);input.end();}
 }});
 const run=serveMcp({call:async(_n,_a,_m,c)=>c.elicit({mode:'form',message:'Review',requestedSchema:{type:'object',properties:{}}})},[{name:'review'}],{input,output,reviewTimeoutMs:1000});
 input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{elicitation:{}}}})+'\n');input.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'review'}})+'\n');await run;
});
