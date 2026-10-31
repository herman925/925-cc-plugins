// Deterministic runtime packaging; no installed plugin or user data is changed.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const source=fileURLToPath(new URL('../../shared/team-store/',import.meta.url));
const target=fileURLToPath(new URL('../store/',import.meta.url));
const check=process.argv.includes('--check');
const files=['api.mjs','index.mjs','contract.mjs','mod-native.mjs','mod-bridge.mjs',...(await readdir(join(source,'src'))).filter(n=>n.endsWith('.mjs')).map(n=>`src/${n}`)];
for(const name of files){
 const bytes=await readFile(join(source,name));
 if(check){if(!bytes.equals(await readFile(join(target,name))))throw Error(`Stale packaged store: ${name}`);}
 else{await mkdir(join(target,name.includes('/')?'src':''),{recursive:true});await writeFile(join(target,name),bytes);}
}
console.log(`${check?'Verified':'Packaged'} ${files.length} shared store modules.`);
