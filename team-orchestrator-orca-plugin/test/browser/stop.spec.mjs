import {test,expect} from '@playwright/test';
async function ready(page,mode){await page.goto('/?mode='+mode);const ui=page.frameLocator('#panel');await ui.getByRole('button',{name:/Squad/}).click();await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Save team',exact:true}).click();await ui.getByRole('button',{name:'Launch this team'}).click();await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');await ui.getByLabel('Total objective').fill('Inspect checkout');await ui.getByRole('button',{name:'Submit total objective'}).click();return ui;}
test('team and member pause controls resume admission while retaining native execution',async({page})=>{const ui=await ready(page,'dispatch-running');await ui.getByRole('button',{name:'Pause new assignments',exact:true}).click();await expect(ui.getByRole('region',{name:'Team tasks',exact:true})).toContainText('Native assignment observed');await expect(ui.getByRole('button',{name:'Resume new assignments'})).toBeVisible();await page.reload();await ui.getByRole('button',{name:'Resume new assignments'}).click();await ui.getByRole('button',{name:'View member'}).click();const control=ui.getByRole('region',{name:'Execution control'});await control.getByRole('button',{name:'Pause new assignments'}).click();await expect(control).toContainText('Member new assignments: Paused');await control.getByRole('button',{name:'Resume new assignments'}).click();await expect(control).toContainText('Member new assignments: Allowed');expect(await page.evaluate(()=>window.bridgeCalls.some(c=>c.params?.teamWorker?.args?.op==='stopMember'))).toBe(false);});
for(const mode of ['dispatch-stop-success','dispatch-stop-unknown','dispatch-stop-unsupported'])test(`${mode}: explicit stop shows native evidence and repeated click does not claim rollback`,async({page})=>{const ui=await ready(page,mode);await ui.getByRole('button',{name:'View member'}).click();const control=ui.getByRole('region',{name:'Execution control'});await control.getByRole('button',{name:'Stop current execution'}).click();await expect(control).toContainText(mode==='dispatch-stop-success'?'Stop: stopped':mode==='dispatch-stop-unsupported'?'Stop: unsupported':'Stop: unknown');await expect(control).toContainText('Modified files are retained');await control.getByRole('button',{name:'Stop current execution'}).click();await expect(control.getByRole('button',{name:'Check stop evidence'})).toHaveCount(1);await control.getByRole('button',{name:'Check stop evidence'}).click();await expect(control).toContainText(mode==='dispatch-stop-success'?'Stop: stopped':mode==='dispatch-stop-unsupported'?'Stop: unsupported':'Stop: unknown');});

test('next-goal prepared member Stop ignores completed Task history while history remains visible',async({page})=>{
 let history=false,preparedRequest,memberId,stopInput;
 // Public panel seam: retained completed-work history alongside genuine newly
 // prepared member receipts. Stop is captured before the fake native effect.
 await page.route('**/rpc',async route=>{
  const op=route.request().postDataJSON()?.message?.args?.op;
  if(op==='stopMember'){stopInput=route.request().postDataJSON().message.args.params;await route.fulfill({json:{ok:false,error:'Captured fixture Stop target before effects'}});return;}
  const response=await route.fetch(),body=await response.json(),snapshot=body.value?.value;
  if(history&&op==='load'&&snapshot?.teams?.length){
   const team=snapshot.teams[0],member=team.members.find(m=>m.name==='Worker-3');memberId=member.id;preparedRequest=team.launch.members[member.id].requestId;
   const base={teamId:team.id,supervisorMemberId:team.members[0].id,scope:team.scope,configVersion:team.configVersion,roleVersion:1,input:{state:'accepted'},processing:{state:'unknown'},run:{state:'verified',id:'old-run',consumerGeneration:1}};
   snapshot.works=[{...base,id:'completed-work',objective:'Earlier accepted objective',status:'completed',tasks:[{id:'retired-attempt',attemptId:'retired-attempt',workId:'completed-work',memberId:member.id,supervisorMemberId:team.members[0].id,taskKey:'historical-worker-task',status:'accepted',dispatchId:'retired-dispatch'}]},{...base,id:'next-work',objective:'Next objective with fresh prepared member',status:'awaiting_run',tasks:[]}];
  }
  await route.fulfill({response,json:body});
 });
 await page.goto('/?mode=capabilities-local');const ui=page.frameLocator('#panel');await ui.getByRole('button',{name:/Squad/}).click();await ui.getByRole('combobox',{name:'Preparation mode'}).selectOption('all');await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Save team',exact:true}).click();await ui.getByRole('button',{name:'Launch this team'}).click();await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false',{timeout:45000});
 history=true;await page.reload();await ui.getByRole('button',{name:'Worker-3',exact:true}).click();await expect(ui.getByRole('region',{name:'Member tasks'})).toContainText('historical-worker-task');
 await ui.getByRole('region',{name:'Execution control'}).getByRole('button',{name:'Stop current execution'}).click();await expect.poll(()=>stopInput).toBeTruthy();
 expect(stopInput.memberId).toBe(memberId);expect(stopInput.operationRequestId).toBe(preparedRequest);expect(stopInput.attemptId).toBeUndefined();expect(stopInput.workId).toBeUndefined();
});
test('an unknown worker stop offers explicit recovery of the same operation and keeps uncertainty after a refused recovery',async({page})=>{
 const ui=await ready(page,'dispatch-stop-unknown');await ui.getByRole('button',{name:'View member'}).click();const control=ui.getByRole('region',{name:'Execution control'});
 await control.getByRole('button',{name:'Stop current execution'}).click();await expect(control).toContainText('Stop: unknown');
 const recover=control.getByRole('button',{name:'Recover same stop request',exact:true});await expect(recover).toBeVisible();
 await control.getByRole('button',{name:'Check stop evidence'}).click();expect(await page.evaluate(()=>window.bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='recoverStop').length)).toBe(0);
 await recover.click();await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');await expect(control).toContainText('Stop: unknown');
 expect(await page.evaluate(()=>window.bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='recoverStop').length)).toBe(1);
 await expect(control).toContainText('same native request');await expect(control.getByText('Stop: unknown',{exact:true})).toHaveCount(1);
});
