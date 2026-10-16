import {createHash} from 'node:crypto';
export const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
export const nativeMutationFingerprint=(method,params,owner,target)=>{
 const stable={...params}; delete stable.waitSubmitMs;
 if(owner.kind==='structured')stable.__orcaCallerOrcaSessionId=owner.sessionId;
 if(typeof stable.terminal==='string'&&target?.kind==='terminal'&&target.paneKey){const parts=target.paneKey.split(':');stable.terminal=parts.length===2&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parts[1])?{paneLeafId:parts[1]}:{paneKey:target.paneKey};}
 for(const key of ['from','callerTerminalHandle'])if(typeof stable[key]==='string'&&owner.paneKey){
  const parts=owner.paneKey.split(':'),leaf=parts[1];
  stable[key]=parts.length===2&&parts[0]&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(leaf)?{paneLeafId:leaf}:{paneKey:owner.paneKey};
 }
 return createHash('sha256').update(JSON.stringify(canonical({method,params:stable}))).digest('hex');
};
