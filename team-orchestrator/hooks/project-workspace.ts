// A client UI preference, never actor proof or a team permission. Paths only
// select this installation's saved preference; all API authority stays native.
export function workspaceProjectKey(root:string){
 const path=String(root).replace(/\\/g,'/').replace(/\/+$/,'')
 return /^[A-Za-z]:\//.test(path)?path.toLowerCase():path
}
export function projectWorkspaceEnabled(fallback:boolean,modes:readonly string[],root:string){
 const key=workspaceProjectKey(root)
 const choice=modes.find(value=>value===`shared|${key}`||value===`classic|${key}`)
 return choice?choice.startsWith('shared|'):fallback
}
export function withProjectWorkspace(modes:readonly string[],root:string,enabled:boolean){
 const key=workspaceProjectKey(root)
 if(!key||/[\u0000-\u001f]/.test(key))throw Error('The current project folder is unavailable.')
 return [...modes.filter(value=>value!==`shared|${key}`&&value!==`classic|${key}`),`${enabled?'shared':'classic'}|${key}`]
}

// Scalar text is a supported native /config row; multiple/list declarations
// can validate in the manifest without producing a row on the live host.
export function parseProjectWorkspaceModes(value:unknown):string[]{
 if(value===undefined||value===null||value==='')return []
 const decoded=typeof value==='string'?JSON.parse(value):value
 if(!Array.isArray(decoded)||decoded.some(v=>typeof v!=='string'||/[\u0000-\u001f]/.test(v)))throw Error('Use a JSON list of project workspace choices.')
 return [...decoded]
}
