import {exact} from './api-domain.mjs';
import {refusal} from './errors.mjs';
// Fixed, non-secret draft fields. These replies never count as approval of a
// controller, configuration effect, binding, role change or permission grant.
export function interviewForm(args){
 exact(args,['step','bossNames']);
 const names=args.bossNames??[];
 if(!Array.isArray(names)||names.length>30||names.some(n=>typeof n!=='string'||!n.trim()||n.length>200)||new Set(names).size!==names.length)throw refusal('API_INPUT_INVALID','Supply distinct bounded boss names from the current draft.');
 const forms={
  action:{message:'925 Team Orchestrator — choose what to do.',properties:{action:{type:'string',title:'Action',enum:['create-team','edit-team','connect-session','launch-workers','status','meeting','diagnose']}},required:['action']},
  team:{message:'Describe the team you want. These answers prepare a draft; the final proposal is reviewed separately.',properties:{name:{type:'string',title:'Team name',minLength:1,maxLength:200},purpose:{type:'string',title:'Team purpose',minLength:1,maxLength:4000},composition:{type:'string',title:'Desired members and reporting structure',maxLength:4000}},required:['name','purpose']},
  lead:{message:'Choose the lead session for a new team. This prepares a draft only. A separate managed lead needs its own creation and launch reviews; no existing conversation is moved or approved.',properties:{leadSession:{type:'string',title:'Where should the lead run?',enum:['Connect an existing conversation','Create a separate managed lead'],default:'Connect an existing conversation'}},required:['leadSession']},
  member:{message:'Describe one member. The assistant will include its role and reporting line in the final review.',properties:{name:{type:'string',title:'Member name',minLength:1,maxLength:200},cli:{type:'string',title:'CLI',enum:['codex','claude']},role:{type:'string',title:'Role',minLength:1,maxLength:1000},reportsTo:{type:'string',title:'Reports to',enum:['You (top member)',...names]},instructions:{type:'string',title:'Official instructions or preferences',maxLength:8000}},required:['name','cli','role','reportsTo']},
  change:{message:'Choose the kind of team edit. The actual changes need a separate native review.',properties:{change:{type:'string',title:'Edit',enum:['team-details','settings','add-member','member-details']}},required:['change']},
 };
 if(!Object.hasOwn(forms,args.step))throw refusal('API_INPUT_INVALID','Choose action, team, lead, member or change interview step.');
 const {message,properties,required}=forms[args.step];return {mode:'form',message,requestedSchema:{type:'object',properties,required}};
}
