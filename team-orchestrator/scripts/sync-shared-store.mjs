// Deterministic runtime packaging; no installed plugin or user data is changed.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const source=fileURLToPath(new URL('../../shared/team-store/',import.meta.url));
const targets=[fileURLToPath(new URL('../store/',import.meta.url)),fileURLToPath(new URL('../../925-to/skills/925-to/scripts/runtime/',import.meta.url))];
const check=process.argv.includes('--check');
const files=['api.mjs','index.mjs','contract.mjs','mod-native.mjs','mod-bridge.mjs','codex-native.mjs','codex-mcp.mjs','codex-setup.mjs',...(await readdir(join(source,'src'))).filter(n=>n.endsWith('.mjs')||n==='windows-thread-owner.ps1').map(n=>`src/${n}`)];
for(const target of targets)for(const name of files){
 const bytes=await readFile(join(source,name));
 if(check){if(!bytes.equals(await readFile(join(target,name))))throw Error(`Stale packaged store: ${name}`);}
 else{await mkdir(join(target,name.includes('/')?'src':''),{recursive:true});await writeFile(join(target,name),bytes);}
}
console.log(`${check?'Verified':'Packaged'} ${files.length} shared runtime files in ${targets.length} packages.`);
