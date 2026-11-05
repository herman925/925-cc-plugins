// Read parsed configuration through the native client; never regex-parse TOML
// or mistake the connection-only `mcp get` result for every user setting.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {configurationEnvironment} from './setup-environment.mjs';
export async function nativeToolSettings(executable,stage){
 const child=spawn(executable,['app-server','--listen','stdio://'],{cwd:stage,env:configurationEnvironment(stage),windowsHide:true,stdio:['pipe','pipe','ignore']});
 let seq=0;const pending=new Map(),exited=new Promise(resolve=>child.once('close',resolve));
 const fail=()=>{for(const p of pending.values())p.reject(Error('Native configuration reader closed.'));pending.clear();};child.once('error',fail);child.once('exit',fail);
 const timer=setTimeout(()=>{fail();child.kill();},15000);
 const reading=(async()=>{for await(const line of createInterface({input:child.stdout})){if(Buffer.byteLength(line)>2*1024*1024)throw Error('Native config response too large.');const value=JSON.parse(line);const p=pending.get(value.id);if(p){pending.delete(value.id);value.error?p.reject(Error('Native configuration was refused.')):p.resolve(value.result);}}})();
 reading.catch(()=>fail());
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 try{
  await rpc('initialize',{clientInfo:{name:'team_setup_config',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const result=await rpc('config/read',{includeLayers:false});return result.config?.mcp_servers?.team_orchestrator?.tools??{};
 }finally{child.stdin.end();const stop=setTimeout(()=>child.kill(),1500);await Promise.allSettled([reading,exited]);clearTimeout(stop);clearTimeout(timer);}
}
export function toolSettingsToml(tools){
 if(!tools||typeof tools!=='object'||Array.isArray(tools))throw Error('Native tool settings have an unsupported shape.');
 const scalar=value=>{if(['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(scalar).join(',')+']';throw Error('Native tool setting cannot be preserved safely.');};
 return Object.entries(tools).map(([tool,settings])=>{if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Native tool settings have an unsupported shape.');return `\n[mcp_servers.team_orchestrator.tools.${JSON.stringify(tool)}]\n`+Object.entries(settings).map(([key,value])=>`${JSON.stringify(key)} = ${scalar(value)}\n`).join('');}).join('');
}
