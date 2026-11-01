// The original classic quick starts, also offered by shared Create team.
export const TEAM_TEMPLATES = [
 {label:'Squad',sketch:'●┬○○○',hint:'head + 3 workers',form:{team:'Squad',ceo:'0',levels:'2',fan:'3',groups:''}},
 {label:'All-Purpose Team',sketch:'■┬●●',hint:'CEO + 2 heads, 4 workers each',form:{team:'All-Purpose-Team',ceo:'1',levels:'3',fan:'4',groups:'Team 1, Team 2'}},
 {label:'Tech Team',sketch:'■┬●●●●',hint:'CEO + 4 heads, 4 workers each',form:{team:'Tech-Team',ceo:'1',levels:'3',fan:'4',groups:'Dev Team, UI Team, Test Team, Security Team'}},
]
export type TemplateMember={name:string;role:string;boss:string|null;officialText:string}
export function templateMembers(template:typeof TEAM_TEMPLATES[number],purpose:string):TemplateMember[]{
 const {form}=template,goal=purpose.trim()||'the team purpose agreed with the user'
 const out:TemplateMember[]=[]
 const add=(name:string,role:string,boss:string|null,officialText:string)=>out.push({name,role,boss,officialText})
 if(form.ceo==='1'){
  add('CEO','Lead the organisation',null,`Own ${goal}. Delegate to the named branch heads, review their evidence and report to the user.`)
  for(const group of form.groups.split(',').map(s=>s.trim())){
   const head=`${group}-Head`
   add(head,`Head of ${group}`,'CEO',`Own the ${group} branch of ${goal}. Delegate tasks to your direct workers, review their evidence and report to the CEO.`)
   for(let i=1;i<=Number(form.fan);i++)add(`${group}-Worker-${i}`,`Worker in ${group}`,head,`Read your role and task brief before work. Execute tasks from ${head}, verify the result and report an explicit outcome with evidence to ${head}.`)
  }
 }else{
  add('Head','Lead and review',null,`Lead ${goal}. Delegate tasks to direct workers and review their evidence before accepting outcomes. Report to the user.`)
  for(let i=1;i<=Number(form.fan);i++)add(`Worker-${i}`,'Implement and verify','Head','Read your role and task brief before work. Execute tasks from Head, verify the result and report an explicit outcome with evidence to Head.')
 }
 return out
}
