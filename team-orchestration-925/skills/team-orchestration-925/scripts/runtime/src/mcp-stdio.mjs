import {randomUUID} from 'node:crypto';
import {refusal} from './errors.mjs';

// Bidirectional MCP: client replies must be read while an active tools/call is
// waiting for native elicitation. Tool calls remain serialized independently.
export async function serveMcp(adapter,tools,{input=process.stdin,output=process.stdout,reviewTimeoutMs=180000}={}){
 input.setEncoding?.('utf8');
 let buffer='',initialized=false,capabilities={},closed=false,inputEnded=false,queue=Promise.resolve();
 const pending=new Map();
 const send=value=>{if(!closed)output.write(JSON.stringify(value)+'\n');};
 const error=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
 const reviewError=()=>refusal('API_REVIEW_UNAVAILABLE','Native confirmation is unavailable, cancelled or disconnected. No approval was granted.');
 const elicit=(params,requestId)=>{
  if(closed||inputEnded||!capabilities.elicitation||capabilities.elicitation.form===false||Object.keys(capabilities.elicitation).length>0&&!Object.hasOwn(capabilities.elicitation,'form'))return Promise.reject(reviewError());
  return new Promise((resolve,reject)=>{
   const id=`925-to-review-${randomUUID()}`;
   const timer=setTimeout(()=>{pending.delete(id);reject(reviewError());},reviewTimeoutMs);
   pending.set(id,{requestId,resolve:value=>{clearTimeout(timer);resolve(value);},reject:()=>{clearTimeout(timer);reject(reviewError());}});
   send({jsonrpc:'2.0',id,method:'elicitation/create',params});
  });
 };
 const handle=async r=>{
  const {id,method,params={}}=r;
  try{
   let result;
   if(method==='initialize'){
    if(!['2024-11-05','2025-03-26','2025-06-18','2025-11-25','2026-07-28'].includes(params.protocolVersion)){error(id,-32602,'Unsupported MCP protocol version.');return;}
    capabilities=structuredClone(params.capabilities??{});initialized=true;
    result={protocolVersion:params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'925-to',version:'0.5.56'}};
   }else if(!initialized){error(id,-32002,'Initialize the connection first.');return;}
   else if(method==='ping')result={};
   else if(method==='tools/list')result={tools};
   else if(method==='tools/call'){
    if(!tools.some(t=>t.name===params.name)){error(id,-32602,'Unknown tool.');return;}
    try{
     const value=await adapter.call(params.name,params.arguments??{},params._meta,{canElicit:Boolean(capabilities.elicitation&&(Object.keys(capabilities.elicitation).length===0||capabilities.elicitation.form)),elicit:p=>elicit(p,id)});
     result={content:[{type:'text',text:JSON.stringify(value)}]};
    }catch(e){
     const value=params.name==='team_guard'?{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Native caller or team authority could not be verified.'}}:{ok:false,error:{code:e.code??'API_CODEX_REFUSED',message:e.code?e.message:'Native team operation was refused.'}};
     result={content:[{type:'text',text:JSON.stringify(value)}],...(params.name==='team_guard'?{}:{isError:true})};
    }
   }else{error(id,-32601,'Method not found.');return;}
   send({jsonrpc:'2.0',id,result});
  }catch{error(id,-32603,'Team MCP request could not be completed.');}
 };
 try{
  for await(const chunk of input){
   buffer+=chunk;if(Buffer.byteLength(buffer)>1024*1024)throw Error('MCP frame exceeds 1 MiB.');
   let newline;
   while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;
    let r;try{r=JSON.parse(line);}catch{error(null,-32700,'Invalid JSON.');continue;}
    if(r?.jsonrpc!=='2.0'){error(r?.id??null,-32600,'Invalid JSON-RPC request.');continue;}
    if(!r.method&&pending.has(r.id)){
     const waiter=pending.get(r.id);pending.delete(r.id);r.error?waiter.reject():waiter.resolve(r.result);continue;
    }
    if(r.method==='notifications/cancelled'){
     for(const [id,waiter] of pending)if(waiter.requestId===r.params?.requestId){pending.delete(id);waiter.reject();}continue;
    }
    if(typeof r.method!=='string'){error(r.id??null,-32600,'Invalid JSON-RPC method.');continue;}
    if(!Object.hasOwn(r,'id'))continue;
    if(typeof r.id!=='string'&&typeof r.id!=='number'){error(null,-32600,'Invalid request id.');continue;}
    // Discovery/keepalive cannot wait behind a person reviewing a proposal.
    if(initialized&&r.method==='ping'){send({jsonrpc:'2.0',id:r.id,result:{}});continue;}
    if(initialized&&r.method==='tools/list'){send({jsonrpc:'2.0',id:r.id,result:{tools}});continue;}
    queue=queue.then(()=>handle(r));
   }
  }
  // Flush already queued ordinary requests in finite input fixtures. Native
  // confirmation cannot succeed after EOF; pending prompts are explicitly refused.
  inputEnded=true;
  if(pending.size){for(const p of pending.values())p.reject();pending.clear();}
  await queue;
  if(buffer.trim())throw Error('Truncated MCP frame.');
 }finally{closed=true;for(const p of pending.values())p.reject();pending.clear();}
}
