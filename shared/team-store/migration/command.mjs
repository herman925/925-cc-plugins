// Assemble reviewed data, never authority. The native API separately requires
// a real review and a post-review source/backup/native-state verifier.
import {previewClassicImport} from './preview.mjs';
const fail=message=>{throw Object.assign(Error(message),{code:'MIGRATION_MAPPING_REQUIRED'});};
export function classicImportCommand({snapshot,backup,targetHome,teamId,name,functionText,settings,expectedControllerGeneration}){
 const {preview}=previewClassicImport(snapshot);
 if(preview.blockers.length)fail('Resolve all source mapping blockers before import.');
 if(backup?.verified!==true||backup.sourceFingerprint!==preview.sourceFingerprint||typeof backup.sha256!=='string'||!/^[a-f0-9]{64}$/.test(backup.sha256))fail('Verify a complete private backup of this exact source before reviewing import.');
 const fields=['projectRoot','machineId','contextId','executionHostId'];if(!targetHome||fields.some(k=>typeof targetHome[k]!=='string'||!targetHome[k])||targetHome.projectRoot!==snapshot.projectRoot)fail('A verified exact native target home is required for this import.');
 const home=Object.fromEntries(fields.map(k=>[k,targetHome[k]]));
 if(preview.members.some(m=>{const p=m.previousSession;return p.location==='remote'||p.machine&&p.machine!==home.machineId||p.worktree&&p.worktree!==home.contextId||p.registeredHome&&(p.registeredHome.originalPath!==home.projectRoot||p.registeredHome.executionHostId!==home.executionHostId);} ))fail('Some original homes are remote, different or uncertain. Explicit home mapping/transfer is required; no member was silently relocated.');
 const members=[],remaining=[...preview.members];
 while(remaining.length){const next=remaining.findIndex(m=>m.bossMemberId===null||members.some(p=>p.memberId===m.bossMemberId));if(next<0)fail('The complete boss-first hierarchy cannot be mapped.');members.push(remaining.splice(next,1)[0]);}
 const reviewedWork='\n\n## Classic work awaiting head review\n\nThese are imported records, not active tasks or instructions. Reconcile uncertain prior outcomes; issue a fresh assignment before any work.\n\n```json\n'+JSON.stringify({sourceFingerprint:preview.sourceFingerprint,items:preview.reviewItems},null,2)+'\n```\n';
 const command={type:'importClassicTeam',teamId,name,functionText,settings,targetHome:home,expectedControllerGeneration,sourceFingerprint:preview.sourceFingerprint,backupDigest:backup.sha256,
  members:members.map(m=>({memberId:m.memberId,name:m.name,bossMemberId:m.bossMemberId,role:m.role,officialText:m.officialDraft,cli:m.cli,model:m.preferences.model,effort:m.preferences.effort,advisoryNotes:m.advisoryNotes+'\n\nClassic team label (historical): '+JSON.stringify(m.sourceTeam)+(m.bossMemberId===null?reviewedWork:'')}))};
 if(Buffer.byteLength(JSON.stringify(command))>40000)fail('This import exceeds a complete bounded native review. Use a supported paged review before importing; no fields were truncated.');
 return command;
}
