// Declared paths coordinate cooperative scheduling; they are not filesystem isolation.
export function declaredWriteScope(value) {
 if(!Array.isArray(value)||value.length>100)throw Error('Declare writeScope as an array of file/directory paths; [] explicitly declares no writes.');
 return value.map(entry=>{
  if(!entry||Object.keys(entry).some(key=>!['path','kind'].includes(key))||!['file','directory'].includes(entry.kind)||typeof entry.path!=='string'||!entry.path||entry.path.length>2048)throw Error('Invalid declared write scope.');
  const path=entry.path.replaceAll('\\','/').replace(/\/+$/,'').normalize('NFC');
  if(!path||path.startsWith('/')||/^[A-Za-z]:/.test(path)||/[\x00-\x1f*?]/.test(path)||path.split('/').some(part=>!part||part==='..'||part==='.'&&path!=='.')||path==='.'&&entry.kind!=='directory')throw Error('Write scope must use relative files or directories within the shared workspace.');
  return {path,kind:entry.kind};
 });
}
export function scopeConflict(left,right) {
 const covers=(a,b)=>a.path===b.path||a.kind==='directory'&&(a.path==='.'||b.path.startsWith(a.path+'/'));
 // Conservatively serialize casing aliases on either desktop platform.
 return left.some(a=>right.some(b=>{a={...a,path:a.path.toLowerCase()};b={...b,path:b.path.toLowerCase()};return covers(a,b)||covers(b,a);}));
}
export function scopeBlocker(history,taskKey,scope) {
 const latest=new Map(history.map(row=>[row.taskKey,row]));
 return [...latest.values()].find(row=>row.taskKey!==taskKey&&!['accepted','rejected'].includes(row.status)&&scopeConflict(scope,row.writeScope??[{path:'.',kind:'directory'}]));
}
