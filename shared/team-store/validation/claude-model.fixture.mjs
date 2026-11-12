// Anthropic-compatible loopback model for deterministic native CLI tests.
import {createServer} from 'node:http';
export async function claudeFixtureModel(next){
 let calls=0,error=null;const requests=[];
 const server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
  if(req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({input_tokens:10}));return;}
  if(req.method!=='POST'||!req.url.includes('/messages')){res.writeHead(404);res.end();return;}
  calls++;requests.push({call:calls,tools:(body.tools??[]).map(tool=>tool.name)});const choice=await next(body,calls),content=choice.tool?{type:'tool_use',id:'fixture_tool_'+calls,name:choice.tool,input:choice.args??{}}:{type:'text',text:choice.text??'Synthetic native Claude sequence complete.'};
  const message={id:'msg_fixture_'+calls,type:'message',role:'assistant',model:body.model,content:[content],stop_reason:choice.tool?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:5}};
  if(body.stream!==true){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});const event=(name,data)=>res.write('event: '+name+'\ndata: '+JSON.stringify({type:name,...data})+'\n\n');
  event('message_start',{message:{...message,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}});event('content_block_start',{index:0,content_block:choice.tool?{...content,input:{}}:{type:'text',text:''}});event('content_block_delta',{index:0,delta:choice.tool?{type:'input_json_delta',partial_json:JSON.stringify(content.input)}:{type:'text_delta',text:content.text}});event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:5}});event('message_stop',{});res.end();
 }catch(failure){error=failure.message;res.destroy(failure);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,calls:()=>calls,error:()=>error,requests:()=>structuredClone(requests),async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
export function claudeFixtureEnvironment(home,url){const env={...process.env};for(const key of Object.keys(env))if(/^(?:ANTHROPIC|CLAUDE|ORCA|TEAM_|CODEX_)/i.test(key))delete env[key];return {...env,CLAUDE_CONFIG_DIR:home,ANTHROPIC_API_KEY:'fixture-not-a-real-key',ANTHROPIC_BASE_URL:url,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};}
