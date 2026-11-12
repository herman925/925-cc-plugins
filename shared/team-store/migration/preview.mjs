// Native migration preparation only. This module has no target database,
// approval callback, session launcher or apply operation.
import {createHash} from 'node:crypto';
import {lstat,realpath,readdir,open} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
const marker='<!-- END OF THE GENERATED PART. The Team Orchestrator rewrites everything above this line when the team changes. Write your own notes below it. -->';
const fail=(code,message)=>{throw Object.assign(Error(message),{code:'MIGRATION_'+code});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const fingerprint=files=>digest(JSON.stringify(files.map(f=>({path:f.path,sha256:f.sha256,bytes:f.bytes})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)));
function validatedFiles(files){
 if(!Array.isArray(files)||!files.length||files.length>512)fail('SOURCE_INVALID','Capture between one and 512 classic source files.');
 let total=0;const paths=new Set();
 return files.map(f=>{
  if(!f||typeof f.path!=='string'||!f.path||f.path.includes('\\')||f.path.startsWith('/')||/[:\0]/.test(f.path)||f.path.split('/').some(p=>!p||p==='.'||p==='..'))fail('SOURCE_INVALID','Source entries must be unambiguous relative file paths.');
  const key=f.path.toLowerCase();if(paths.has(key))fail('SOURCE_INVALID','Duplicate or case-colliding source file paths require review.');paths.add(key);
  if(typeof f.base64!=='string'||f.base64.length>1400000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.base64))fail('SOURCE_INVALID','Invalid bounded source-file encoding.');
  const bytes=Buffer.from(f.base64,'base64');total+=bytes.length;if(bytes.length>1048576||total>8388608)fail('SOURCE_TOO_LARGE','Classic migration capture exceeds its bounded preview size. No files were omitted.');
  return {path:f.path,base64:f.base64,bytes:bytes.length,sha256:digest(bytes)};
 });
}
function decode(file){try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(file.base64,'base64'));}catch{fail('SOURCE_INVALID','A required classic document is not valid UTF-8.');}}
function json(file){try{return JSON.parse(decode(file));}catch(error){if(error.code?.startsWith('MIGRATION_'))throw error;fail('SOURCE_INVALID','A required classic JSON document is malformed.');}}
// A double capture detects ordinary concurrent edits, including added/removed
// files. Apply must capture again and compare the exact fingerprint; this is
// never a promise that a changing source can be imported from an old preview.
export async function captureClassicSource({projectRoot}){
 if(typeof projectRoot!=='string'||!isAbsolute(projectRoot))fail('SOURCE_INVALID','A verified absolute project root is required.');
 const root=await realpath(projectRoot),directory=join(root,'.claude','team-orchestrator');
 const capture=async()=>{
  if((await lstat(directory)).isSymbolicLink()||await realpath(directory)!==directory)fail('SOURCE_REDIRECTED','Classic source must be a real directory inside this project.');
  const files=[];let directories=0,totalBytes=0;
  const walk=async(path,relative='',depth=0)=>{
   if(++directories>512||depth>16)fail('SOURCE_TOO_LARGE','Classic source exceeds the bounded directory inventory. No paths were omitted.');
   const names=(await readdir(path)).sort();
   for(const name of names){
    const child=join(path,name),info=await lstat(child),key=relative?relative+'/'+name:name;
    if(info.isSymbolicLink()||await realpath(child)!==child)fail('SOURCE_REDIRECTED','Classic source contains a redirected path; resolve it before migration.');
    if(info.isDirectory())await walk(child,key,depth+1);
    else if(info.isFile()){
     if(info.size>1048576||files.length>=512)fail('SOURCE_TOO_LARGE','Classic migration capture exceeds its bounded preview size. No files were omitted.');
     const handle=await open(child,'r');let bytes;
     try{const buffer=Buffer.alloc(1048577);let count=0;while(count<buffer.length){const read=await handle.read(buffer,count,buffer.length-count,count);if(!read.bytesRead)break;count+=read.bytesRead;}if(count>1048576)fail('SOURCE_TOO_LARGE','A classic file grew beyond the bounded capture size.');bytes=buffer.subarray(0,count);}finally{await handle.close();}
     totalBytes+=bytes.length;if(totalBytes>8388608)fail('SOURCE_TOO_LARGE','Classic migration capture exceeds its bounded preview size. No files were omitted.');
     if(await realpath(child)!==child)fail('SOURCE_REDIRECTED','A classic path was redirected during capture.');
     files.push({path:key,base64:bytes.toString('base64')});
    }else fail('SOURCE_INVALID','Classic source contains an unsupported file type.');
   }
  };
  await walk(directory);return validatedFiles(files);
 };
 let first,second;try{first=await capture();second=await capture();}catch(error){if(error.code==='ENOENT')fail('SOURCE_NOT_FOUND','Classic source is absent or changed during capture. Nothing was created.');throw error;}
 const hash=fingerprint(first);if(hash!==fingerprint(second))fail('SOURCE_CHANGED','Classic source changed during capture. Review a new preview.');
 return Object.freeze({format:'925-classic-source',version:1,projectRoot:root,fingerprint:hash,files:first});
}
export function classicArchive(snapshot){
 if(snapshot?.format!=='925-classic-source'||snapshot.version!==1)fail('SOURCE_INVALID','Unsupported classic source capture.');
 const files=validatedFiles(snapshot.files),hash=fingerprint(files);if(snapshot.fingerprint!==hash)fail('SOURCE_CHANGED','The source capture no longer matches its fingerprint.');
 return {format:'925-classic-archive',version:1,fingerprint:hash,files};
}
export function previewClassicImport(snapshot){
 const archive=classicArchive(snapshot),files=archive.files,hash=archive.fingerprint;
 const rosterFile=files.find(f=>f.path==='roster.json');if(!rosterFile)fail('SOURCE_INVALID','The classic roster is missing.');
 const roster=json(rosterFile);if(!Array.isArray(roster)||!roster.length||roster.length>100)fail('SOURCE_INVALID','The classic roster must contain between one and 100 members.');
 const blockers=[],warnings=[],names=new Map(),rolePaths=new Set();
 if(roster.length>30)blockers.push({code:'MEMBER_LIMIT_UNSUPPORTED',message:'The current native shared-team creation contract supports at most 30 members. No source members were dropped.'});
 for(const m of roster){
  if(!m||!['name','team','role','boss'].every(k=>typeof m[k]==='string'&&m[k].trim()&&m[k].length<=8192&&!m[k].includes('\0')))fail('SOURCE_INVALID','Each classic member needs a bounded name, team, role and reporting line.');
  if(names.has(m.name)||[...names.keys()].some(name=>name.toLowerCase()===m.name.toLowerCase()))fail('SOURCE_INVALID','Classic member names are ambiguous. Resolve duplicates before migration.');names.set(m.name,m);
 }
 const id=name=>'legacy-'+digest(name).slice(0,32),roots=roster.filter(m=>m.boss==='user');
 if(roots.length!==1)blockers.push({code:'HEAD_SELECTION_REQUIRED',message:'Select one complete reporting organization before import; no heads were merged or discarded.'});
 const members=roster.map(m=>{
  if(m.boss!=='user'&&!names.has(m.boss))blockers.push({code:'BOSS_UNMAPPED',member:m.name,boss:m.boss});
  const seen=new Set([m.name]);let current=m;
  while(current.boss!=='user'&&names.has(current.boss)){if(seen.has(current.boss)){blockers.push({code:'REPORTING_CYCLE',member:m.name});break;}seen.add(current.boss);current=names.get(current.boss);}
  const cli=m.cli||'claude';if(!['claude','codex'].includes(cli))blockers.push({code:'CLI_NOT_INTEGRATED',member:m.name,cli});
  const path=`roles/${m.name.replace(/[^\p{L}\p{N}._-]+/gu,'_')}.md`;
  if(rolePaths.has(path.toLowerCase()))blockers.push({code:'ROLE_PATH_COLLISION',member:m.name});rolePaths.add(path.toLowerCase());
  const file=files.find(f=>f.path===path),document=file?decode(file):'',at=document.indexOf(marker);
  if(!file)warnings.push({code:'ROLE_DOCUMENT_MISSING',member:m.name});
  if(file&&at<0)warnings.push({code:'ROLE_BOUNDARY_UNKNOWN',member:m.name,message:'The full role document is preserved; select its official and advisory parts in review.'});
  return {memberId:id(m.name),name:m.name,sourceTeam:m.team,bossMemberId:m.boss==='user'?null:id(m.boss),role:m.role,cli,
   officialDraft:m.role,advisoryNotes:at<0?'':document.slice(at+marker.length).replace(/^\r?\n/,''),
   preferences:{model:typeof m.model==='string'?m.model:'default',effort:typeof m.effort==='string'?m.effort:'default',allowWrite:false,allowAgent:false},
   previousPermissions:{allowWrite:m.allowWrite===true,allowAgent:m.allowAgent===true},
   previousSession:{sessionId:m.sessionId??null,handle:m.handle??null,machine:m.machine??null,registeredHome:m.registeredHome??null,worktree:m.worktree??null,location:m.location??null},binding:null};
 });
 if(new Set(roster.map(m=>m.team)).size>1)warnings.push({code:'TEAM_LABEL_MAPPING_REQUIRED',message:'Preserve and review the original named-team labels; this preview does not flatten their meaning.'});
 const reviewItems=roster.filter(m=>typeof m.note==='string'&&m.note.trim()).map(m=>({kind:'member-note',memberId:id(m.name),body:m.note,status:'head_review_required',requiresFreshAssignment:true}));
 const prunedFile=files.find(f=>f.path==='queue/pruned.json'),pruned=prunedFile?json(prunedFile):null;
 if(prunedFile&&(!pruned||!Array.isArray(pruned.names)||pruned.names.some(n=>typeof n!=='string')))fail('SOURCE_INVALID','The classic queue pruning index is malformed.');
 for(const file of files.filter(f=>f.path.startsWith('queue/')&&f.path.endsWith('.json')&&f.path!=='queue/pruned.json')){
  const entry=json(file);
  if(!pruned?.names.includes(file.path.slice('queue/'.length))&&['pending','sending','failed'].includes(entry?.state)&&typeof entry.message==='string')reviewItems.push({kind:'pending-message',source:file.path,to:entry.to??null,from:entry.from??null,body:entry.message,previousQueueState:entry.state,status:'head_review_required',requiresFreshAssignment:true,requiresOutcomeReconciliation:entry.state==='sending'});
 }
 const settings=files.find(f=>f.path==='settings.json');if(settings)json(settings);
 return {preview:{format:'925-classic-import-preview',version:1,sourceFingerprint:hash,fileCount:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),members,reviewItems,blockers,warnings,
  execution:'review-only',permissionPolicy:'start-disabled',workPolicy:'head-review-fresh-assignment',bindings:[],assignments:[],deliveries:[],deadlines:[],sourcePreserved:true,requiresNativeReview:true,requiresSourceRecheck:true,requiresBackup:true,
  settingsStatus:settings?'preserved-for-explicit-mapping':'not-present'},
  // Native archival data is deliberately separate from the public preview.
  // A client must not serialize this into a model-facing response or log.
  archive};
}
