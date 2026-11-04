export type TeamEditDraft={teamId:string;version:number;controller:number;tab:string;advanced:boolean;name:string;purpose:string;capacity:string;pickup:string;answer:string;window:string;replay:string;original:any;command:any|null}
const line=(v:any)=>String(v??'').replace(/[\r\n\t]+/g,' ').replace(/[\u0000-\u001f\u007f-\u009f]/g,'')
const text=(v:any)=>String(v??'').replace(/\r\n?/g,'\n').replace(/\t/g,' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g,'')
export function beginTeamEdit(snapshot:any,controller:number):TeamEditDraft{
 if(!snapshot?.settings||!Number.isSafeInteger(controller)||controller<1)throw Error('Refresh the team and its management approval before editing.')
 const {team,settings}=snapshot
 return {teamId:team.team_id,version:team.config_version,controller,tab:'team',advanced:false,name:team.name,purpose:team.function_text,capacity:String(settings.maxOpen),pickup:String(settings.pickupWindowMinutes),answer:String(settings.answerWindowMinutes),window:settings.taskWindowMinutes===null?'':String(settings.taskWindowMinutes),replay:String(settings.replayIntervalMs),original:JSON.parse(JSON.stringify({name:team.name,purpose:team.function_text,settings})),command:null}
}
export function teamEditCommand(d:TeamEditDraft){
 const number=(v:string,label:string,min=1)=>{if(!/^\d+$/.test(v.trim())||!Number.isSafeInteger(Number(v))||Number(v)<min)throw Error(`${label} must be a whole number of at least ${min}.`);return Number(v)}
 const name=line(d.name).trim(),purpose=text(d.purpose),changes:any[]=[]
 if(!name)throw Error('Enter a team name.')
 const settings={...d.original.settings,maxOpen:number(d.capacity,'Capacity',0),pickupWindowMinutes:number(d.pickup,'Pickup window'),answerWindowMinutes:number(d.answer,'Answer window'),taskWindowMinutes:d.window.trim()?number(d.window,'Task window'):null,replayIntervalMs:number(d.replay,'Replay interval')}
 if(name!==d.original.name||purpose!==d.original.purpose)changes.push({type:'updateTeam',name,functionText:purpose})
 if(JSON.stringify(settings)!==JSON.stringify(d.original.settings))changes.push({type:'saveSettings',settings})
 if(!changes.length)throw Error('There are no changes to review.')
 const command={type:'editTeam',teamId:d.teamId,expectedConfigVersion:d.version,expectedControllerGeneration:d.controller,changes}
 if(JSON.stringify(command).length>11500)throw Error('This edit is too large for one review. Shorten the purpose or split the change.')
 return command
}
export async function sharedTeamEditView(ui:any,{draft:d,stale,onPatch,onReview,onSave,onCancel}:any){
 const {Box,Text,Button,Input}=ui
 const patch=(p:any)=>onPatch({...p,command:null})
 const button=(key:string,label:string,onPress:()=>Promise<any>,primary=false)=><Button key={key} label={label} variant={primary?'primary':undefined} onPress={onPress}/>
 const field=(key:string,label:string,value:string,rows=1)=><Box flexDirection="column"><Input key={`team-edit-${key}`} label={rows===1?label:undefined} value={rows===1?line(value):text(value)} placeholder={label} rows={rows} onInput={async(v:string)=>patch({[key]:rows===1?line(v):text(v)})} onSubmit={()=>{}}/></Box>
 const settings=d.command?.changes.find((c:any)=>c.type==='saveSettings')?.settings
 const changed=(label:string,old:any,next:any)=><Box key={label} flexDirection="column"><Text weight="bold">{label}</Text><Text dimColor>{`Before: ${old===null?'Off':String(old)||'(empty)'}`}</Text><Text>{`After: ${next===null?'Off':String(next)||'(empty)'}`}</Text></Box>
 return <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" rowGap={1}>
  <Text weight="bold">Edit team · {d.original.name}</Text>
  <Box flexWrap="wrap" columnGap={1}>{['team','options','review'].map(tab=>button(`team-edit-tab-${tab}`,`${d.tab===tab?'● ':''}${tab[0].toUpperCase()+tab.slice(1)}`,async()=>tab==='review'?onReview():onPatch({tab})))}</Box>
  {stale&&<Text color="yellow">Team configuration or approval changed. Cancel and reopen Edit team to review the latest state.</Text>}
  {d.tab==='team'&&<Box flexDirection="column">{field('name','Team name',d.name)}<Text dimColor>Purpose</Text>{field('purpose','Purpose',d.purpose,3)}</Box>}
  {d.tab==='options'&&<Box flexDirection="column" rowGap={1}><Text weight="bold">Capacity</Text>{field('capacity','Open sessions',d.capacity)}<Text dimColor>At capacity, new sessions queue.</Text><Text weight="bold">Deadlines</Text>{field('pickup','Pickup window · minutes',d.pickup)}{field('answer','Answer window · minutes',d.answer)}{field('window','Task window · minutes, blank for off',d.window)}<Text dimColor>The answer window starts when the recipient reads. Existing work keeps its admitted deadlines.</Text>{button('team-edit-advanced',d.advanced?'Hide delivery options':'Delivery options',async()=>onPatch({advanced:!d.advanced}))}{d.advanced&&field('replay','Replay interval · milliseconds',d.replay)}</Box>}
  {d.tab==='review'&&d.command&&<Box flexDirection="column" rowGap={1}><Text weight="bold">Review changes</Text>{d.command.changes.some((c:any)=>c.type==='updateTeam')&&<Box flexDirection="column">{d.name.trim()!==d.original.name&&changed('Team name',d.original.name,d.name.trim())}{text(d.purpose)!==d.original.purpose&&changed('Purpose',d.original.purpose,text(d.purpose))}</Box>}{settings&&[['Capacity','maxOpen'],['Pickup window · minutes','pickupWindowMinutes'],['Answer window · minutes','answerWindowMinutes'],['Task window · minutes','taskWindowMinutes'],['Replay interval · milliseconds','replayIntervalMs']].map(([label,key])=>settings[key]!==d.original.settings[key]?changed(label,d.original.settings[key],settings[key]):null)}<Text dimColor>Apply saves this exact proposal. Member roles, permissions and session connections use their own flows.</Text>{!stale&&button('team-edit-apply','Apply reviewed changes',onSave,true)}</Box>}
  <Box flexWrap="wrap" columnGap={1}>{d.tab!=='review'&&!stale&&button('team-edit-review','Review changes',onReview,true)}{button('team-edit-cancel','Cancel edit',onCancel)}</Box>
 </Box>
}
