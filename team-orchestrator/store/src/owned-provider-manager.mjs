// One project service, two owned provider implementations. Pin the provider
// before creation; absence/loss never switches a recorded launch to another CLI.
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createOwnedCodexManager} from './owned-codex-manager.mjs';
import {createOwnedClaudeManager} from './owned-claude-manager.mjs';
import {refusal} from './errors.mjs';
export function createOwnedProviderManager(options,dependencies={}){
 const codex=(dependencies.createCodex??createOwnedCodexManager)(options,dependencies.codex),claude=(dependencies.createClaude??createOwnedClaudeManager)({...options,directory:join(dirname(options.directory),'owned-claude')},dependencies.claude),providers={codex,claude},root=join(dirname(options.directory),'owned-routing');
 const path=id=>join(root,createHash('sha256').update(id).digest('hex')+'.json');
 const read=async id=>{try{const file=path(id),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>8192)throw Error('Invalid provider receipt.');const value=JSON.parse(await readFile(file,'utf8'));if(value.launchId!==id||!Object.hasOwn(providers,value.provider))throw Error('Invalid provider receipt.');return value;}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const select=async input=>{const prior=await read(input.launchId),provider=input.provider??'codex';if(!Object.hasOwn(providers,provider)||prior&&prior.provider!==provider)throw refusal('API_LAUNCH_SCOPE','The reviewed launch provider changed. Reconcile its original attempt.');if(prior)return provider;await mkdir(root,{recursive:true,mode:0o700});let file;try{file=await open(path(input.launchId),'wx',0o600);}catch(error){if(error.code==='EEXIST'){const row=await read(input.launchId);if(row.provider!==provider)throw refusal('API_LAUNCH_SCOPE','Another provider already owns this launch.');return provider;}throw error;}try{await file.writeFile(JSON.stringify({launchId:input.launchId,provider}));await file.sync();}finally{await file.close();}return provider;};
 const manager=async id=>providers[(await read(id))?.provider??'codex']; // Old Codex receipts remain reachable.
 return Object.freeze({async prepare(input){const provider=await select(input),{provider:_provider,...rest}=input;return providers[provider].prepare(rest);},async list(){return [...await codex.list(),...await claude.list()];},...Object.fromEntries(['start','inspect','sendWake','pending','respond','reviewReceipt','reviewInfo'].map(method=>[method,async input=>(await manager(input.launchId))[method](input)])),active:()=>codex.active()||claude.active(),async close(){await Promise.allSettled([codex.close(),claude.close()]);}});
}
