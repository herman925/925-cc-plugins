import type {Register} from 'claude-code'
export const register:Register=(on)=>{
 on('session.start',async($,e,next)=>{await $.command.register({name:'runtimecheck',description:'Owned fixture native acceptance driver after provider credit exhaustion'});return next(e)})
 on('command.run',{command:'runtimecheck'},async($,e)=>{
  if(e.args.trim()!=='accept')return {text:'Use runtimecheck accept for the owned fixture only.'}
  const log:any={kind:'native_test_driver_after_provider_402',realModelAcceptance:false,events:[]}
  const call=async(command:any)=>{
   const input={operationId:`native-driver-${command.type}-${Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join('')}`,command}
   const raw:any=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',...input} as any)
   const value=JSON.parse(typeof raw.result==='string'?raw.result:raw.text)
   log.events.push({input,value});if(!value.ok)throw Error(JSON.stringify(value.error));return value.result.result
  }
  try{
   if(String(await $.session.root()).replace(/\\/g,'/')!=='C:/Users/Herman/AppData/Local/Temp/runtime-ind2/project'||String(await $.session.id())!=='d6b8f06c-38f9-4091-9068-98e6182607eb')throw Error('Wrong fixture or head session')
   const me=await call({type:'inspectCaller'}),teamId='bd748ab66729eef30a98937ec67d1286',assignmentId='assign-lifecycle-002'
   const before=await call({type:'inspectAssignment',teamId,assignmentId});log.before=before
   if(me.member.member_id!==before.assignment.assigned_by_member_id)throw Error('Only the admitting head may review')
   if(before.acceptance?.decision==='accepted'){log.alreadyAccepted=true}else{
    if(before.attempt.outcome!=='succeeded'||before.attempt.summary!==before.brief.instructions||before.attempt.evidence!=='Verbatim instruction line from brief: '+before.brief.instructions)throw Error('The verbatim instruction-line deliverable does not match')
    log.acceptance=await call({type:'acceptTask',teamId,assignmentId,decision:'accepted',reason:'Native test driver after provider402 independently confirmed summary exactly equals the original instruction and evidence exactly equals the fixed explanatory prefix plus that instruction. No real-model head decision is claimed.',expectedConfigVersion:me.configVersion,expectedMemberGeneration:me.member.generation,expectedBindingGeneration:me.binding.generation,expectedAttemptGeneration:before.attempt.generation})
   }
   log.after=await call({type:'inspectAssignment',teamId,assignmentId});log.passed=log.after.task.status==='succeeded'&&log.after.acceptance?.decision==='accepted'
  }catch(error){log.error=String(error)}
  await $.fs.write('C:/Users/Herman/AppData/Local/Temp/runtime-ind2/native-acceptance-driver.json',JSON.stringify(log,null,2))
  return {text:`Native acceptance driver finished: ${log.passed?'passed':log.error||'inspect log'}. Real-model head acceptance was not measured.`}
 })
}

