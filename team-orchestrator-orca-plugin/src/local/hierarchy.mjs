import {createKeyedSerializer} from './keyed-serializer.mjs';
import {readNativeParentEvidence} from './native-hierarchy.mjs';
export function createHierarchyService({store,userData,works}){
 const serialize=createKeyedSerializer();
 async function check(id){
  const root=(store.readCurrentWork??store.readWork)(id);if(!root||root.status==='completed')return;
  const team=store.effectiveTeamForWork?.(root.id)??store.readTeamVersion(root.teamId,root.configVersion);
  for(const parentWork of store.listRunWorks(root.teamWorkId??id)){
   if(parentWork.run.state!=='verified')continue;
   for(const attempt of store.listDispatches(parentWork.id)){
    if(attempt.status!=='running'||!team.members.some(m=>m.boss===attempt.memberId))continue;
    try{
     await works.verifyWork(parentWork.id);
     const proof=await readNativeParentEvidence(userData,{parentWork:(store.readCurrentWork??store.readWork)(parentWork.id),attempt});
     if(proof.state!=='verified')continue;
     const binding=store.prepareManagerRun(parentWork.id,attempt.id);
     if(binding.input.state==='not_sent')await works.startManager(binding.id);
     else await works.check(binding.id);
    }catch{/* Existing Run/attempt stays reserved; independent managers continue. */}
   }
  }
 }
 return {check:id=>serialize(id,()=>check(id)),async reconcile(){for(const w of store.listWorks())await this.check(w.id);}};
}
