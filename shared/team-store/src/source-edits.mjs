// Public package source is editable by an explicitly write-enabled member.
// This does not authorize executing that source or editing installed runtimes.
import {existsSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
const sources=['shared/team-store/','team-orchestrator/','team-orchestration-925/','docs/'];
const publicPath=(root,path)=>{
 const name=relative(root,path).replaceAll('\\','/');
 return !isAbsolute(name)&&!name.startsWith('../')&&sources.some(prefix=>name.startsWith(prefix))&&/\.(?:[cm]?js|tsx?|jsx|json|md|ps1|toml|ya?ml|css|html|txt)$/.test(name)&&!name.split('/').some(part=>part.startsWith('.')&&part!=='.claude-plugin'&&part!=='.codex-plugin');
};
export function sourceEditAllowed(authority,{tool,input}){
 if(tool!=='apply_patch'||Number(authority.member?.allow_write)!==1)return false;
 const home=authority.member?.home_original_path,patch=typeof input==='string'?input:input?.command??input?.patch;
 if(typeof home!=='string'||!isAbsolute(home)||typeof patch!=='string'||!patch.startsWith('*** Begin Patch\n')&&!patch.startsWith('*** Begin Patch\r\n')||!patch.trimEnd().endsWith('*** End Patch'))return false;
 const headers=[...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): ([^\r\n]+)\r?$/gm)];if(!headers.length||headers.length>100)return false;
 try{
  const root=realpathSync(home);
  for(const [,name] of headers){
   if(name!==name.trim()||name.includes('\0')||name.length>4096)return false;
   const path=resolve(root,name);if(!publicPath(root,path))return false;
   // Resolve an existing file or its nearest parent: junctions/symlinks cannot
   // turn a public-looking target into an installed or external state target.
   let ancestor=path;while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)return false;ancestor=parent;}
   const canonical=resolve(realpathSync(ancestor),relative(ancestor,path));if(!publicPath(root,canonical))return false;
  }
  return true;
 }catch{return false;}
}
