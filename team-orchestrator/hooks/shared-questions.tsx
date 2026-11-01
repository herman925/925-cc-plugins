import {atom,read,update} from 'claude-code'
const initial={scope:'',compose:false,target:'',assignment:'',question:'',answer:'',selected:''}
const state=atom({plugin:'team-orchestrator',key:'sharedQuestions'} as const,initial)
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')
const clean=(v:string)=>String(v).replace(/[\r\n\t]+/g,' ').replace(/[\u0000-\u001f\u007f-\u009f]/g,'')
export async function sharedQuestionsView($:any,ui:any,{scope,me,snapshot,onCommand}:any){
 const {Box,Text,Button,Input,Select}=ui,saved=await read($,state),s=saved.scope===scope?saved:{...initial,scope}
 const set=async(patch:any)=>update($,state,old=>({...(old.scope===scope?old:{...initial,scope}),...patch}))
 const peers=snapshot.members.filter((m:any)=>m.membership_state==='active'&&(m.member_id===me.boss_member_id||m.boss_member_id===me.member_id)),target=peers.find((m:any)=>m.member_id===s.target)||peers[0]
 const questions=snapshot.questions??[],selected=questions.find((q:any)=>q.thread_id===s.selected)||questions[0]
 const tasks=snapshot.work.filter((w:any)=>[w.assignment.member_id,w.assignment.assigned_by_member_id].includes(me.member_id)&&[w.assignment.member_id,w.assignment.assigned_by_member_id].includes(target?.member_id)&&['open','blocked'].includes(w.task.status)&&!w.returned)
 return <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
  <Box flexWrap="wrap" justifyContent="space-between"><Text weight="bold">Questions</Text>{peers.length>0&&<Button key="question-new" label={s.compose?'Cancel question':'Ask a question'} onPress={async()=>set({compose:!s.compose})}/>}</Box>
  {s.compose&&target&&<Box flexDirection="column">
   <Select key="question-recipient" label="To " value={target.member_id} options={peers.map((m:any)=>({value:m.member_id,label:clean(m.name)}))} onSelect={async(v:string)=>set({target:v,assignment:''})}/>
   <Select key="question-task" label="About " value={s.assignment||''} options={[{value:'',label:'Team coordination'},...tasks.map((w:any)=>({value:w.assignment.assignment_id,label:clean(w.brief.instructions).slice(0,80)}))]} onSelect={async(v:string)=>set({assignment:v})}/>
   <Input key="question-text" label="Question" value={s.question} onInput={async(v:string)=>set({question:clean(v)})} onSubmit={()=>{}}/>
   <Text dimColor>The answer window starts when the recipient reads it. Unanswered questions expire and notify the head.</Text>
   <Button key="question-send" label="Send question" variant="primary" onPress={async()=>{if(!s.question.trim())return;await onCommand({type:'askQuestion',threadId:uid(),runId:uid(),assignmentId:s.assignment||null,recipientMemberId:target.member_id,question:s.question.trim()});await set({compose:false,question:''})}}/>
  </Box>}
  {(snapshot.notices??[]).map((n:any)=><Box key={n.notice_id} borderStyle="round" borderColor="yellow" flexDirection="column"><Text color="yellow">{JSON.parse(n.event_json).event==='question_expired'?'Question went unanswered':'Task deadline expired'}</Text><Text>{JSON.parse(n.event_json).question||JSON.parse(n.event_json).assignmentId}</Text><Button key={`notice-${n.notice_id}`} label="Mark notice read" onPress={async()=>onCommand({type:'acknowledgeNotice',noticeId:n.notice_id})}/></Box>)}
  {!questions.length&&<Text dimColor>No questions yet.</Text>}
  {questions.length>0&&<Select key="question-select" label="Question " value={selected?.thread_id} options={questions.map((q:any)=>({value:q.thread_id,label:clean(`${q.status==='open'?'●':'✓'} ${q.question}`).slice(0,100)}))} onSelect={async(v:string)=>set({selected:v,answer:''})}/>}
  {selected&&<Box flexDirection="column"><Text>{selected.question}</Text><Text dimColor>{selected.status==='open'?(selected.answer_deadline_ms?`Answer due ${new Date(Number(selected.answer_deadline_ms)).toISOString()}`:'Waiting for recipient to read'):selected.status==='answered'?'Answered':'Closed · no answer pending'}</Text>
   {selected.answer&&<Text color="green">{selected.answer}</Text>}
   {selected.status==='open'&&selected.recipient_member_id===me.member_id&&selected.question_delivered_at_ms!==null&&<Box flexDirection="column"><Input key="question-answer" label="Your answer" value={s.answer} onInput={async(v:string)=>set({answer:clean(v)})} onSubmit={()=>{}}/><Button key="question-answer-send" label="Send answer" variant="primary" onPress={async()=>{if(!s.answer.trim())return;await onCommand({type:'answerQuestion',threadId:selected.thread_id,expectedThreadGeneration:selected.generation,answer:s.answer.trim()});await set({answer:''})}}/></Box>}
  </Box>}
 </Box>
}
