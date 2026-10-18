// Depth counts dispatch generations, not roster size. The saved root is depth 0.
export function requiredDispatchDepth(members) {
  if(!Array.isArray(members)||!members.length)throw Error('A saved roster is required to check dispatch depth.');
  const byId=new Map(members.map(member=>[member.id,member]));
  if(byId.size!==members.length||members.filter(member=>member.boss===null).length!==1)throw Error('The saved roster hierarchy is invalid.');
  const depths=new Map();
  const visit=(member,ancestors=new Set())=>{
    if(depths.has(member.id))return depths.get(member.id);
    if(ancestors.has(member.id))throw Error('The saved roster hierarchy contains a cycle.');
    const next=new Set(ancestors).add(member.id),parent=member.boss===null?null:byId.get(member.boss);
    if(member.boss!==null&&!parent)throw Error('The saved roster hierarchy has an unavailable supervisor.');
    const depth=parent?visit(parent,next)+1:0;depths.set(member.id,depth);return depth;
  };
  return Math.max(1,...members.map(member=>visit(member)));
}
export function nativeDispatchDepth(settings) {
  if(!settings||typeof settings!=='object'||Array.isArray(settings)||typeof settings.then==='function')throw Error('The native dispatch settings format is unavailable.');
  const value=settings.nestedWorkerMaxDepth;
  return Number.isSafeInteger(value)&&value>=1?value:1;
}
export async function ensureDispatchDepth(plan,{authority,getSettings,setSettings}) {
  const required=plan.requiredDepth;
  if(!Number.isSafeInteger(required)||required<1)throw Error('The saved dispatch depth is invalid.');
  if(required===1)return {requiredDepth:1,adjusted:false,status:'not-needed'};
  // A desktop setting cannot stand in for the execution host's settings.
  if(plan.scope.executionHostId!=='local')return {requiredDepth:required,adjusted:false,status:'remote-not-verified'};
  await authority();
  if(typeof getSettings!=='function'||typeof setSettings!=='function')throw Error('Orca cannot configure dispatch depth automatically. Set Nested worker depth in its native Settings.');
  // The native getter is synchronous. Read and invoke the partial native setter
  // in the same main-thread turn, so an existing higher setting is never lowered.
  const before=nativeDispatchDepth(getSettings());
  if(before>=required)return {requiredDepth:required,previousDepth:before,observedDepth:before,adjusted:false,status:'verified'};
  if(required>2)throw Error('This legacy roster needs a depth above 2. Configure its native dispatch limit explicitly.');
  await setSettings({nestedWorkerMaxDepth:2});
  await authority();
  const after=nativeDispatchDepth(getSettings());
  if(after<required)throw Error('Orca did not confirm the required dispatch depth. No member was launched.');
  return {requiredDepth:required,previousDepth:before,observedDepth:after,adjusted:true,status:'verified'};
}
