// Each service owns a separate serializer. Resolve authority inside the action,
// after earlier work for this key has settled, never when the action is queued.
export function createKeyedSerializer(){
 const queues=new Map();
 return (key,action)=>{
  const pending=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(action);
  queues.set(key,pending);
  pending.finally(()=>{if(queues.get(key)===pending)queues.delete(key);}).catch(()=>{});
  return pending;
 };
}
