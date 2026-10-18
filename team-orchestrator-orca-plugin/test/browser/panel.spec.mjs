import {test,expect} from '@playwright/test';
import {panel,launchTeam,snapshot} from './helpers.mjs';

test('Roster contains only launched teams and member monitoring; creation belongs to New team',async({page})=>{
 await page.goto('/');const ui=panel(page);await expect(ui.getByRole('heading',{name:'No teams in this project'})).toBeVisible();await expect(ui.getByRole('button',{name:/Squad/})).toHaveCount(0);
 await launchTeam(page);await expect(ui.getByRole('heading',{name:'@Squad',exact:true})).toBeVisible();
 await expect(ui.locator('.roster tbody tr')).toHaveCount(4);await expect(ui.locator('.roster thead')).toContainText('Status');await expect(ui.locator('.roster thead')).toContainText('Context');
 for(const label of ['Start team work','Submit total objective','Next total objectives','Pause new assignments','Open verified session','Check saved launch'])await expect(ui.getByText(label,{exact:true})).toHaveCount(0);
 await expect(ui.getByRole('button',{name:'Add team',exact:true})).toHaveCount(1);await expect(ui.locator('main textarea')).toHaveCount(0);await expect(ui.locator('main')).not.toContainText('Input acceptance does not prove');
 const team=(await snapshot(page)).teams[0];expect(team.configuration.launchMode).toBe('all');expect(Object.keys(team.launch.members)).toHaveLength(4);
 await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('heading',{name:'New team',exact:true})).toBeVisible();
 await page.reload();await expect(panel(page).locator('.roster tbody tr')).toHaveCount(4);
});

test('launch automatically initializes the highest supervisor and never needs a submitted panel objective',async({page})=>{
 const ui=await launchTeam(page,{mode:'roster-live'});
 await expect.poll(async()=>(await snapshot(page)).works.find(w=>w.mode==='supervisor-session')?.run.state,{timeout:20000}).toBe('verified');
 expect((await snapshot(page)).goals).toHaveLength(0);
 expect(await page.evaluate(()=>bridgeCalls.some(c=>['submitWork','enqueueGoal','startNextGoal','decideWork'].includes(c.params?.teamWorker?.args?.op)))).toBe(false);
 await expect(ui.locator('.roster tbody tr').first()).toContainText('Working');await expect(ui.locator('.roster tbody tr').first()).toContainText('40%');await expect(ui.locator('.roster tbody tr').first()).toContainText('reported-model');
});

for(const [mode,label] of [['roster-idle','Idle'],['roster-asking','Needs input']])test(mode+' reports native state for the supervisor',async({page})=>{
 const ui=await launchTeam(page,{mode});await expect(ui.locator('.roster tbody tr').first()).toContainText(label);await expect(ui.locator('.roster tbody tr').nth(1)).toContainText(label);
});

test('terminal context is unavailable rather than fabricated, and launch preferences are labeled as configured',async({page})=>{
 const ui=await launchTeam(page);const row=ui.locator('.roster tbody tr').first();await expect(row).toContainText('Idle');await expect(row.locator('[title="Context usage has not been reported by this session"]')).toHaveText('—');await expect(row).toContainText('set');
 await ui.getByRole('button',{name:'Open supervisor',exact:true}).click();await expect(ui.locator('.success')).toContainText('Opened the supervisor’s session');
 const team=(await snapshot(page)).teams[0],root=team.members.find(m=>m.boss===null);const opens=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='openMember').map(c=>c.params.teamWorker.args.params));expect(opens).toHaveLength(1);expect(opens[0]).toMatchObject({teamId:team.id,memberId:root.id,requestId:team.launch.members[root.id].requestId});
});

test('polling refreshes the roster and follows the selected project without submitting work',async({page})=>{
 const ui=await launchTeam(page);const before=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='rosterStatus').length);
 await expect.poll(()=>page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='rosterStatus').length),{timeout:10000}).toBeGreaterThan(before);
 await page.route('**/rpc',async route=>{if(route.request().postDataJSON().message.args?.op==='context'){const response=await route.fetch(),body=await response.json();body.value.workspaceKey='different-project';await route.fulfill({response,json:body});}else await route.continue();});
 await expect(ui.locator('.team-card')).toHaveCount(0,{timeout:10000});await expect(ui.getByRole('heading',{name:'No teams in this project'})).toBeVisible();
});

for(const width of [320,960])test('member monitoring stays inside '+width+'px panel',async({page})=>{
 await page.setViewportSize({width,height:1000});const ui=await launchTeam(page);await expect(ui.locator('.roster tbody tr')).toHaveCount(4);
 const frame=page.frames().find(f=>f.url()==='about:srcdoc');expect(await frame.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
});

test('unconfirmed launch remains visible as Unknown without a duplicate launch on reload',async({page})=>{
 const ui=await launchTeam(page,{mode:'launch-unknown'});await expect(ui.locator('.roster tbody tr').first()).toContainText('Unknown');await page.reload();await expect(panel(page).locator('.roster tbody tr').first()).toContainText('Unknown');
 expect(await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='launchSupervisor').length)).toBe(0);
});

test('connection diagnostics are optional in Settings and missing interfaces hide the roster',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Settings',exact:true}).click();const connection=ui.getByRole('region',{name:'Connection',exact:true});await expect(connection).toContainText('Connected to Orca');await connection.getByText('Technical details',{exact:true}).click();await expect(connection).toContainText('compatibility layer available');
 await page.goto('/?mode=incompatible-host');await expect(panel(page).getByRole('alert')).toContainText('Plugin unavailable');await expect(panel(page).locator('.roster')).toHaveCount(0);await panel(page).getByRole('button',{name:'Details',exact:true}).click();await expect(panel(page).locator('#failure-details')).toContainText('required interfaces');
});

test('member names and organisation chart remain read-only through refresh and reload',async({page})=>{
 const ui=await launchTeam(page);const team=(await snapshot(page)).teams[0];
 const refreshes=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='rosterStatus').length);
 const capabilities=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='capabilities').length);
 await ui.locator('.roster tbody tr').nth(1).locator('.member-name').click();await ui.locator('.org-chart .org-node').last().click();
 const check=async()=>{
  await expect(panel(page).getByRole('region',{name:'Member details'})).toHaveCount(0);
  await expect(panel(page).locator('.roster button, .org-chart button, main input, main select, main textarea')).toHaveCount(0);
  await expect(panel(page).locator('.team-card button')).toHaveCount(1);
  for(const name of ['Role and preferences','Session controls and diagnostics','Save role','Save preferences','Pause new assignments'])await expect(panel(page).getByText(name,{exact:true})).toHaveCount(0);
 };
 await check();expect(await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='capabilities').length)).toBe(capabilities);
 await expect.poll(()=>page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='rosterStatus').length),{timeout:10000}).toBeGreaterThan(refreshes);
 expect((await snapshot(page)).teams[0]).toMatchObject({id:team.id,members:team.members,configuration:team.configuration,configVersion:team.configVersion});await page.reload();await expect(panel(page).locator('.roster tbody tr')).toHaveCount(4);await check();
});

test('failed supervisor navigation reports the error without launching or recovering a member',async({page})=>{
 const ui=await launchTeam(page);const before=await page.evaluate(()=>bridgeCalls.length);
 await page.route('**/rpc',async route=>{if(route.request().postDataJSON().message.args?.op==='openMember')await route.fulfill({json:{error:'Saved supervisor session is no longer available.'}});else await route.continue();});
 await ui.getByRole('button',{name:'Open supervisor',exact:true}).click();await expect(ui.getByRole('alert')).toContainText('Saved supervisor session is no longer available');
 const calls=await page.evaluate(offset=>bridgeCalls.slice(offset).map(c=>c.params?.teamWorker?.args?.op),before);expect(calls).toContain('openMember');expect(calls.some(op=>['launchSupervisor','recoverLaunch','wakeMember','replaceMember','requestReplacement'].includes(op))).toBe(false);
});

test('Add team opens a simple form and automatically loads separate CLI catalogs',async({page})=>{
 await page.goto('/?mode=capabilities-local');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();
 await expect(ui.getByRole('heading',{name:'New team',exact:true})).toBeVisible();
 await expect(ui.getByRole('group',{name:'Structure'}).getByRole('button')).toHaveCount(2);
 for(const text of ['Quick start','Head only','Preparation mode'])await expect(ui.getByText(text,{exact:false})).toHaveCount(0);
 await expect(ui.getByLabel('Head model',{exact:true}).locator('option[value="my-model"]')).toHaveCount(1);await expect(ui.locator('input[data-model]')).toHaveCount(0);
 await ui.getByLabel('Head model',{exact:true}).selectOption('my-model');await ui.getByLabel('Head effort',{exact:true}).selectOption('ultra');
 await ui.getByLabel('Head CLI',{exact:true}).selectOption('claude');await expect(ui.getByLabel('Head model',{exact:true})).toHaveValue('default');await expect(ui.getByLabel('Head effort',{exact:true})).toHaveValue('default');
 await expect(ui.getByLabel('Head model',{exact:true}).locator('option[value="my-model"]')).toHaveCount(0);await ui.getByLabel('Head model',{exact:true}).selectOption('claude-model');await expect(ui.getByLabel('Head effort',{exact:true}).locator('option')).toHaveText(['Default','low','max']);
 await ui.getByRole('button',{name:'Head → Leads → Workers',exact:true}).click();await expect(ui.getByLabel('Leads CLI',{exact:true})).toBeVisible();
 await expect(ui.getByRole('button',{name:'CEO over several teams',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>bridgeCalls.some(c=>c.params?.teamWorker?.args?.op==='launchSupervisor'))).toBe(false);
});

test('model discovery retries automatically when the host catalog is still loading',async({page})=>{
 let reads=0;await page.route('**/rpc',async route=>{
  if(route.request().postDataJSON().message.args?.op!=='capabilities')return route.continue();
  const response=await route.fetch(),body=await response.json();if(++reads===1)for(const a of Object.values(body.value.agents)){a.models=[];a.catalogStatus='unknown';a.listingInProgress=true;}
  await route.fulfill({response,json:body});
 });
 await page.goto('/?mode=capabilities-local');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();
 await expect(ui.getByLabel('Head model',{exact:true}).locator('option')).toHaveCount(1);
 await expect(ui.getByLabel('Head model',{exact:true}).locator('option[value="my-model"]')).toHaveCount(1,{timeout:15000});expect(reads).toBeGreaterThan(1);
});

test('remote model catalog does not offer unverified local model names',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Refresh models'})).toBeEnabled();
 await expect(ui.getByLabel('Head model',{exact:true}).locator('option')).toHaveCount(1);await expect(ui.getByLabel('Head model',{exact:true})).toHaveValue('default');await expect(ui.getByLabel('Head effort',{exact:true})).toBeDisabled();await expect(ui.getByText('model list unavailable for this remote host',{exact:false})).toBeVisible();
});

test('Structure has two choices with independently adjustable staffing and one fixed head',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 await expect(ui.getByRole('group',{name:'Structure'}).getByRole('button')).toHaveText(['Head → Workers','Head → Leads → Workers']);
 await expect(ui.getByLabel('Head',{exact:true})).toHaveValue('1');await expect(ui.getByLabel('Head',{exact:true})).toBeDisabled();await ui.getByLabel('Workers',{exact:true}).selectOption('4');await expect(ui.locator('#preview .count')).toContainText('5 members');
 await ui.getByRole('button',{name:'Head → Leads → Workers',exact:true}).click();await expect(ui.getByLabel('Leads',{exact:true})).toHaveValue('1');await ui.getByLabel('Leads',{exact:true}).selectOption('2');await expect(ui.getByLabel('Workers per lead',{exact:true})).toHaveValue('4');await expect(ui.locator('#preview .count')).toContainText('11 members');
 await ui.getByLabel('Workers per lead',{exact:true}).selectOption('3');await expect(ui.getByLabel('Leads',{exact:true})).toHaveValue('2');await expect(ui.locator('#preview .count')).toContainText('9 members');
 await ui.getByRole('button',{name:'Head → Workers',exact:true}).click();await expect(ui.locator('#preview .count')).toContainText('4 members');await expect(ui.getByLabel('Head',{exact:true})).toHaveValue('1');
 for(const name of ['Project and execution host','Confirm project and host','Refresh workspace','Reports each','Levels'])await expect(ui.getByText(name,{exact:true})).toHaveCount(0);
});

test('launch captures the current project after a switch without manual confirmation',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();await ui.getByLabel('Workers',{exact:true}).selectOption('1');
 let captured;await page.route('**/rpc',async route=>{
  const data=route.request().postDataJSON();
  if(data.message.args?.op==='context'){
   const response=await route.fetch({postData:JSON.stringify({...data,mode:'folder'})});const body=await response.json();captured=body.value;await route.fulfill({response,json:body});
  }else await route.continue();
 });
 await ui.getByRole('button',{name:'Launch team',exact:true}).click();await expect(ui.locator('.roster tbody tr')).toHaveCount(2,{timeout:45000});
 const team=(await snapshot(page)).teams[0];expect(team.scope).toMatchObject({kind:'folder',displayName:'Demo folder',workspaceKey:captured.workspaceKey});expect(Object.keys(team.launch.members)).toHaveLength(2);
 const creation=await page.evaluate(()=>bridgeCalls.find(c=>c.params?.teamWorker?.args?.op==='createTeam').params.teamWorker.args.params);expect(creation.selectionToken).not.toBeUndefined();expect(creation.form.workersPerLead).toBe(1);
});

test('New team follows the active project without losing typed setup',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();await ui.getByLabel('Team name',{exact:true}).fill('Keep-my-draft');
 await page.route('**/rpc',async route=>{const data=route.request().postDataJSON();if(data.message.args?.op==='context'){const response=await route.fetch({postData:JSON.stringify({...data,mode:'folder'})});await route.fulfill({response});}else await route.continue();});
 await expect(ui.locator('[aria-label="Current project"]')).toContainText('Demo folder',{timeout:12000});await expect(ui.getByLabel('Team name',{exact:true})).toHaveValue('Keep-my-draft');
});

test('a missing current project prevents saving or launching against the previously detected one',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 await page.route('**/rpc',route=>route.request().postDataJSON().message.args?.op==='context'?route.fulfill({json:{ok:true,value:null}}):route.continue());
 await ui.getByRole('button',{name:'Launch team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeDisabled();await expect(ui.locator('[aria-label="Current project"]')).toContainText('No project selected');
 expect(await page.evaluate(()=>bridgeCalls.some(c=>['createTeam','launchSupervisor'].includes(c.params?.teamWorker?.args?.op)))).toBe(false);
});
