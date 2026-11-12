// Describe the existing manager-write rule; this is not a permission grant or
// proof that a particular command/assignment passed its other checks.
export function memberGuardPolicy(member,directReportCount){
 const active=member.membership_state==='active',knownProvider=['claude','codex'].includes(member.cli);
 const writes=Number(member.allow_write)===1,agents=Number(member.allow_agent)===1;
 return {memberId:member.member_id,memberGeneration:Number(member.generation),directReportCount,
  standingWritesEnabled:writes,standingSubagentsEnabled:agents,
  managerWriteRule:!active||!knownProvider?'unverified':directReportCount>0&&!writes?'requires-write-grant':'not-blocked-by-manager-rule',
  subagentRule:!active||!knownProvider?'unverified':agents?'standing-grant':'requires-subagent-grant',
  scope:'Team guard rule only. Private state, stale binding, worker bootstrap and native permissions have separate checks. Inspect assignment validity separately; task expiry is not a write denial. A new assignment changes no permissions.'};
}
export function teamGuardPolicies(members){
 return members.filter(member=>member.membership_state==='active').map(member=>memberGuardPolicy(member,members.filter(child=>child.membership_state==='active'&&child.boss_member_id===member.member_id).length));
}
