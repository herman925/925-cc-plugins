import {readdir,readFile,lstat,realpath,mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
const fail=()=>{throw Object.assign(Error('The private runtime snapshot changed or is not a regular owned directory. Project configuration was not replaced.'),{code:'SETUP_RUNTIME_REFUSED'});};
async function readTree(root){
 const files=[];
 async function walk(directory,prefix=''){
  const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())fail();
  for(const name of (await readdir(directory)).sort()){
   const path=join(directory,name),relative=prefix+name,stat=await lstat(path);if(stat.isSymbolicLink())fail();
   if(stat.isDirectory())await walk(path,relative+'/');else if(stat.isFile()){if(stat.size>2*1024*1024)fail();files.push({name:relative,bytes:await readFile(path)});}else fail();
  }
 }
 await walk(root);return files;
}
const digest=files=>{const h=createHash('sha256');for(const file of files)h.update(file.name).update('\0').update(file.bytes).update('\0');return h.digest('hex');};
export async function prepareRuntime(source,state){
 const root=await realpath(source),files=await readTree(root);if(!files.some(f=>f.name==='codex-mcp.mjs'))fail();
 const hash=digest(files),directory=join(state,'runtimes',hash);return {files,digest:hash,directory,path:join(directory,'codex-mcp.mjs')};
}
export async function installRuntime(snapshot){
 const parent=dirname(snapshot.directory);if(basename(parent)!=='runtimes'||basename(snapshot.directory)!==snapshot.digest||digest(snapshot.files)!==snapshot.digest)fail();
 await mkdir(parent,{recursive:true,mode:0o700});if(await realpath(parent)!==parent||(await lstat(parent)).isSymbolicLink())fail();
 const exists=async()=>{try{const stat=await lstat(snapshot.directory);if(!stat.isDirectory()||stat.isSymbolicLink()||digest(await readTree(snapshot.directory))!==snapshot.digest)fail();return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 if(await exists())return;
 const stage=await mkdtemp(join(parent,'.stage-'));
 try{
  for(const file of snapshot.files){const path=join(stage,...file.name.split('/'));await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,file.bytes,{flag:'wx',mode:0o600});}
  if(digest(await readTree(stage))!==snapshot.digest)fail();
  if(dirname(stage)!==parent||dirname(snapshot.directory)!==parent)fail();
  try{await rename(stage,snapshot.directory);}catch(error){if(!await exists())throw error;}
 }finally{
  if(dirname(stage)!==parent||!basename(stage).startsWith('.stage-'))fail();
  await rm(stage,{recursive:true,force:true});
 }
}
