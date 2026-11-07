// A negative membership lookup is not an identity proof or an approval. It only
// decides whether an ordinary tool needs the existing, stronger native checks.
// Input comes from the host session API, never from a model tool's arguments.
export const SHARED_MEMBERSHIP_PROBE = String.raw`// team-orchestrator-membership-v1
const {readFileSync,realpathSync,lstatSync}=require('node:fs');
const {join,isAbsolute}=require('node:path');
const {hostname}=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {pathToFileURL}=require('node:url');
(async()=>{
let db;
try {
 const input=readFileSync(0,'utf8');if(input.length>8192)throw Error();
 const {root,sessionId,handle,libraryRoot}=JSON.parse(input);
 if(typeof root!=='string'||!isAbsolute(root)||typeof sessionId!=='string'||!sessionId||sessionId.length>1024)throw Error();
 const canonical=realpathSync(root),directory=join(canonical,'.team-orchestrator'),file=join(directory,'team.sqlite');
 if(lstatSync(directory).isSymbolicLink()||realpathSync(directory)!==directory||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw Error();
 db=new DatabaseSync(file,{readOnly:true});db.exec('BEGIN');
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 let member=false;
 if(tables.size){
  if(typeof libraryRoot!=='string'||!isAbsolute(libraryRoot))throw Error();
  const library=realpathSync(libraryRoot);
  const current=await import(pathToFileURL(join(library,'store/contract.mjs')).href);
  const metadata=db.prepare('SELECT format,schema_version FROM store_metadata WHERE singleton=1').get();
  if(!Number.isSafeInteger(metadata?.schema_version)||metadata.schema_version<5||metadata.schema_version>current.SCHEMA_VERSION)throw Error();
  const definition=metadata.schema_version===current.SCHEMA_VERSION?current:await import(pathToFileURL(join(library,'store/src', 'schema'+metadata.schema_version+'-contract.mjs')).href);
  const {inspectSchema}=await import(pathToFileURL(join(library,'store/src/bootstrap.mjs')).href);
  await inspectSchema({engine:'sqlite',objects:async()=>db.prepare("SELECT name,type FROM sqlite_master").all(),query:async sql=>db.prepare(sql).all()},{format:definition.FORMAT,version:definition.SCHEMA_VERSION,ddl:definition.DDL,render:definition.ddlFor,label:'membership lookup'});
  const protocol=db.prepare('SELECT minimum_writer_protocol FROM project_identity WHERE singleton=1').get();
  if(!Number.isSafeInteger(protocol?.minimum_writer_protocol)||protocol.minimum_writer_protocol<1||protocol.minimum_writer_protocol>current.WRITER_PROTOCOL_VERSION)throw Error();
  // This is the same machine key used by mod-bridge and the Orca shared host.
  // A matching conversation under a different key is uncertainty, never proof
  // that this is an ordinary session (for example after a machine rename).
  const machine=hostname();
  if(db.prepare("SELECT 1 FROM member_bindings b JOIN members m ON m.member_id=b.member_id WHERE b.machine_id<>? AND b.provider='claude' AND b.conversation_id=? AND m.membership_state='active' LIMIT 1").get(machine,sessionId))throw Error();
  const binding=db.prepare("SELECT m.membership_state FROM member_bindings b LEFT JOIN members m ON m.member_id=b.member_id WHERE b.machine_id=? AND b.provider='claude' AND b.conversation_id=?").get(machine,sessionId);
  if(binding&&!['active','retired'].includes(binding.membership_state))throw Error();
  member=binding?.membership_state==='active';
  // A retired ordinary member is outside the team, but launch reservations and
  // unbound reserved terminals must never become an ordinary-session bypass.
  if(metadata.schema_version>=7){
   if(db.prepare('SELECT 1 FROM member_launches WHERE machine_id<>? AND conversation_id=? LIMIT 1').get(machine,sessionId))throw Error();
   member=member||!!db.prepare("SELECT 1 FROM member_launches WHERE machine_id=? AND (conversation_id=? OR member_id IN (SELECT member_id FROM member_bindings WHERE machine_id=? AND provider='claude' AND conversation_id=?)) LIMIT 1").get(machine,sessionId,machine,sessionId);
  }
  if(metadata.schema_version>=9&&typeof handle==='string'&&handle){
   if(db.prepare('SELECT 1 FROM launch_targets WHERE machine_id<>? AND terminal_handle=? LIMIT 1').get(machine,handle))throw Error();
   member=member||!!db.prepare('SELECT 1 FROM launch_targets WHERE machine_id=? AND terminal_handle=? LIMIT 1').get(machine,handle);
  }
 }
 process.stdout.write(JSON.stringify({membership:member?'member':'none'}));
} catch {process.stdout.write(JSON.stringify({membership:'unknown'}));}
finally {if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
})().catch(()=>process.stdout.write(JSON.stringify({membership:'unknown'})));
`;

export async function sharedGuardMembership($,{node}){
 try{
  const root=await $.session.root(),sessionId=await $.session.id();
  if(typeof root!=='string'||typeof sessionId!=='string'||!sessionId)return {membership:'unknown'};
  if(!await $.fs.exists(`${root}/.team-orchestrator/team.sqlite`))return {membership:'none'};
  const handle=String((await $.env.get('ORCA_TERMINAL_HANDLE').catch(()=>''))??'');
  const result=await $.process.run([node,'--input-type=commonjs','-e',SHARED_MEMBERSHIP_PROBE],{stdin:JSON.stringify({root,sessionId,handle,libraryRoot:$.plugin.root}),timeoutMs:5000});
  if(result.exitCode!==0)return {membership:'unknown'};
  const value=JSON.parse(String(result.stdout));
  return ['member','none'].includes(value?.membership)?{membership:value.membership}:{membership:'unknown'};
 }catch{return {membership:'unknown'};}
}
