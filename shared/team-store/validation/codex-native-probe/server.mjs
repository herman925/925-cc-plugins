import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
for await(const line of createInterface({input:process.stdin})){
 let r;try{r=JSON.parse(line)}catch{continue}if(r.id===undefined)continue;
 let result;if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'team-native-identity-probe',version:'0.0.0'}};
 else if(r.method==='tools/list')result={tools:[{name:'inspect_native_context',description:'No-effect native identity metadata probe',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 else if(r.method==='tools/call'){appendFileSync(process.argv[2],JSON.stringify({method:r.method,params:r.params,environmentNames:Object.keys(process.env).filter(k=>/^(CODEX|ORCA)_/.test(k)),parentPid:process.ppid})+'\n');result={content:[{type:'text',text:'Native metadata observed; no task or authority mutation.'}]};}
 else if(r.method==='ping')result={};else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'No such method'}})+'\n');continue}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\n');
}
