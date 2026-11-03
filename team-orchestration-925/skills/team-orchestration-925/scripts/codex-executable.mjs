// Resolve the native CLI used only for staged configuration. This is not caller
// authentication: MCP still verifies its exact parent, thread lock and Orca actor.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath,lstat,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,dirname,basename,isAbsolute,delimiter} from 'node:path';
const execute=promisify(execFile);
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
async function regular(path){try{return (await lstat(path)).isFile();}catch{return false;}}
async function packageBinary(entry,arch){
 const candidates=[];
 // npm's PATH entry contains shell shims. Resolve the installed package as data;
 // never execute a shim or query another process to find the native binary.
 try{candidates.push(createRequire(join(entry,'codex-resolver.cjs')).resolve('@openai/codex/package.json'));}catch{}
 for(const shim of ['codex','codex.cmd','codex.ps1']){
  try{const resolved=await realpath(join(entry,shim));if(basename(resolved)==='codex.js')candidates.push(join(dirname(resolved),'..','package.json'));}catch{}
 }
 for(const path of new Set(candidates)){
  try{
   const stat=await lstat(path);if(!stat.isFile()||stat.size>65536)continue;
   const pkg=JSON.parse(await readFile(path,'utf8'));if(pkg.name!=='@openai/codex')continue;
   const root=dirname(await realpath(path)),triple=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
   let vendor;try{vendor=join(dirname(createRequire(join(root,'package.json')).resolve(`@openai/codex-win32-${arch}/package.json`)),'vendor');}catch{vendor=join(root,'vendor');}
   const binary=join(vendor,triple,'bin','codex.exe');if(await regular(binary))return binary;
  }catch{}
 }
 return null;
}
export async function discoverCodexExecutable({executable,env=process.env,platform=process.platform,arch=process.arch}={},dependencies={}){
 if(platform!=='win32'||!['x64','arm64'].includes(arch))fail('SETUP_HOST_UNSUPPORTED','The native Codex adapter currently supports Windows x64/arm64 Orca terminals.');
 const validate=async path=>{
  if(typeof path!=='string'||!isAbsolute(path)||!/^codex\.exe$/i.test(basename(path)))fail('SETUP_CODEX_PATH_INVALID','Configure an absolute native codex.exe path, not a shell shim or interpreter.');
  let canonical;try{canonical=await realpath(path);if(!await regular(canonical)||!/^codex\.exe$/i.test(basename(canonical)))throw Error();}catch{fail('SETUP_CODEX_PATH_INVALID','The configured native codex.exe is missing or inaccessible.');}
  try{const {stdout}=await (dependencies.execute??execute)(canonical,['--version'],{windowsHide:true,timeout:5000,maxBuffer:8192,env});if(!/^codex-cli \d+\.\d+\.\d+(?:\S*)?\s*$/m.test(stdout.trim()))throw Error();}
  catch{fail('SETUP_CODEX_UNAVAILABLE','The native Codex CLI could not run --version. Check its installation and sandbox executable access.');}
  return canonical;
 };
 const configured=executable??env.TEAM_CODEX_EXECUTABLE;if(configured!==undefined)return validate(configured);
 const pathValue=Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]??'';
 for(const raw of pathValue.split(delimiter).slice(0,256)){
  const entry=raw.trim().replace(/^"(.*)"$/,'$1');if(!entry||!isAbsolute(entry))continue;
  const native=join(entry,'codex.exe');if(await regular(native))return validate(native);
  if((await Promise.all(['codex','codex.cmd','codex.ps1'].map(name=>regular(join(entry,name))))).some(Boolean)){
   const packaged=await packageBinary(entry,arch);if(packaged)return validate(packaged);
  }
 }
 fail('SETUP_CODEX_NOT_FOUND','Native codex.exe was not found on PATH or behind its installed npm shim. Install Codex on PATH or explicitly configure TEAM_CODEX_EXECUTABLE. No process inspection or permission escalation was attempted.');
}
