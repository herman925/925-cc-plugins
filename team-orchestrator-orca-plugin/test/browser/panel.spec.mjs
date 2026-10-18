import {test,expect} from '@playwright/test';
import {panel,launchTeam,snapshot} from './helpers.mjs';

test('Roster contains only launched teams and member monitoring; creation belongs to New team',async({page})=>{
 await page.goto('/');const ui=panel(page);await expect(ui.getByRole('heading',{name:'No teams in this project'})).toBeVisible();await expect(ui.getByRole('button',{name:/Squad/})).toHaveCount(0);
 await launchTeam(page);await expect(ui.getByRole('heading',{name:'@Squad',exact:true})).toBeVisible();
 await expect(ui.locator('.roster tbody tr')).toHaveCount(4);await expect(ui.locator('.roster thead')).toContainText('Status');await expect(ui.locator('.roster thead')).toContainText('Context');
 for(const label of ['Start team work','Submit total objective','Next total objectives','Pause new assignments','Open verified session','Check saved launch'])await expect(ui.getByText(label,{exact:true})).toHaveCount(0);
 await expect(ui.getByRole('button',{name:'Add team',exact:true})).toHaveCount(1);await expect(ui.locator('main textarea')).toHaveCount(0);await expect(ui.locator('main')).not.toContainText('Input acceptance does not prove');
 const team=(await snapshot(page)).teams[0];expect(team.configuration).toMatchObject({launchMode:'all',leadCount:1,levels:2});expect(Object.keys(team.launch.members)).toHaveLength(4);
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
 await ui.locator('.roster').getByRole('button',{name:'Open Head’s session',exact:true}).click();await expect(ui.locator('.success')).toContainText('Opened Head’s session');
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
 const ui=await launchTeam(page,{mode:'launch-unknown'});await expect(ui.locator('.roster tbody tr').first()).toContainText('Unknown');await expect(ui.locator('.roster button').first()).toBeDisabled();await expect(ui.locator('.organisation button').first()).toBeDisabled();await page.reload();await expect(panel(page).locator('.roster tbody tr').first()).toContainText('Unknown');
 expect(await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='launchSupervisor').length)).toBe(0);
});

test('connection diagnostics are optional in Settings and missing interfaces hide the roster',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Settings',exact:true}).click();const connection=ui.getByRole('region',{name:'Connection',exact:true});await expect(connection).toContainText('Connected to Orca');await connection.getByText('Technical details',{exact:true}).click();await expect(connection).toContainText('compatibility layer available');
 await page.goto('/?mode=incompatible-host');await expect(panel(page).getByRole('alert')).toContainText('Plugin unavailable');await expect(panel(page).locator('.roster')).toHaveCount(0);await panel(page).getByRole('button',{name:'Details',exact:true}).click();await expect(panel(page).locator('#failure-details')).toContainText('required interfaces');
});

test('member names and vertical tree nodes open exact sessions through refresh and reload',async({page})=>{
 const ui=await launchTeam(page);const team=(await snapshot(page)).teams[0];
 const refreshes=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='rosterStatus').length);
 const capabilities=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='capabilities').length);
 await ui.locator('.roster tbody tr').nth(1).locator('.member-name').click();await expect(ui.locator('.success')).toContainText('Opened Worker-1’s session');
 await ui.locator('.organisation .org-node').last().click();await expect(ui.locator('.success')).toContainText('Opened Worker-3’s session');
 const check=async()=>{
  await expect(panel(page).getByRole('region',{name:'Member details'})).toHaveCount(0);
  await expect(panel(page).locator('main input, main select, main textarea')).toHaveCount(0);
  await expect(panel(page).locator('.roster button')).toHaveCount(4);
  await expect(panel(page).locator('.organisation button.org-node')).toHaveCount(4);
  const tree=panel(page).locator('.organisation .org-tree.root');
  await expect(tree.locator(':scope > li > .org-tree > li > .org-node > span:nth-child(2)')).toHaveText(['W1','W2','W3']);
  const nodes=await tree.locator('.org-node').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y};}));
  expect(nodes[1].x).toBeGreaterThan(nodes[0].x);
  for(let i=2;i<nodes.length;i++){expect(nodes[i].x).toBe(nodes[1].x);expect(nodes[i].y).toBeGreaterThan(nodes[i-1].y);}
  await expect(panel(page).getByRole('button',{name:'Open supervisor',exact:true})).toHaveCount(0);
  await expect(panel(page).locator('.team-card button')).toHaveCount(4);
  for(const name of ['Role and preferences','Session controls and diagnostics','Save role','Save preferences','Pause new assignments'])await expect(panel(page).getByText(name,{exact:true})).toHaveCount(0);
 };
 const opens=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='openMember').map(c=>c.params.teamWorker.args.params));
 expect(opens.map(o=>o.memberId)).toEqual([team.members[1].id,team.members[3].id]);
 expect(opens.every(o=>o.teamId===team.id&&o.requestId===team.launch.members[o.memberId].requestId)).toBe(true);
 await check();expect(await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='capabilities').length)).toBe(capabilities);
 await expect.poll(()=>page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='rosterStatus').length),{timeout:10000}).toBeGreaterThan(refreshes);
 expect((await snapshot(page)).teams[0]).toMatchObject({id:team.id,members:team.members,configuration:team.configuration,configVersion:team.configVersion});await page.reload();await expect(panel(page).locator('.roster tbody tr')).toHaveCount(4);await check();
 await ui.locator('.organisation .org-node').first().focus();await page.keyboard.press('Enter');await expect(ui.locator('.success')).toContainText('Opened Head’s session');
 const opened=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='openMember').at(-1).params.teamWorker.args.params);
 expect(opened).toMatchObject({teamId:team.id,memberId:team.members[0].id,requestId:team.launch.members[team.members[0].id].requestId});
});

test('failed supervisor navigation reports the error without launching or recovering a member',async({page})=>{
 const ui=await launchTeam(page);const before=await page.evaluate(()=>bridgeCalls.length);
 await page.route('**/rpc',async route=>{if(route.request().postDataJSON().message.args?.op==='openMember')await route.fulfill({json:{error:'Saved supervisor session is no longer available.'}});else await route.continue();});
 await ui.locator('.roster').getByRole('button',{name:'Open Head’s session',exact:true}).click();await expect(ui.getByRole('alert')).toContainText('Saved supervisor session is no longer available');
 const calls=await page.evaluate(offset=>bridgeCalls.slice(offset).map(c=>c.params?.teamWorker?.args?.op),before);expect(calls).toContain('openMember');expect(calls.some(op=>['launchSupervisor','recoverLaunch','wakeMember','replaceMember','requestReplacement'].includes(op))).toBe(false);
});

test('Add team opens a simple form and automatically loads separate CLI catalogs',async({page})=>{
 await page.goto('/?mode=capabilities-local');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();
 await expect(ui.getByRole('heading',{name:'New team',exact:true})).toBeVisible();
 await expect(ui.getByRole('group',{name:'Structure'})).toHaveCount(0);
 for(const text of ['Quick start','Head only','Preparation mode'])await expect(ui.getByText(text,{exact:false})).toHaveCount(0);
 await expect(ui.getByLabel('Head model',{exact:true}).locator('option[value="my-model"]')).toHaveCount(1);await expect(ui.locator('input[data-model]')).toHaveCount(0);
 await ui.getByLabel('Head model',{exact:true}).selectOption('my-model');await ui.getByLabel('Head effort',{exact:true}).selectOption('ultra');
 await ui.getByLabel('Head CLI',{exact:true}).selectOption('claude');await expect(ui.getByLabel('Head model',{exact:true})).toHaveValue('default');await expect(ui.getByLabel('Head effort',{exact:true})).toHaveValue('default');
 await expect(ui.getByLabel('Head model',{exact:true}).locator('option[value="my-model"]')).toHaveCount(0);await ui.getByLabel('Head model',{exact:true}).selectOption('claude-model');await expect(ui.getByLabel('Head effort',{exact:true}).locator('option')).toHaveText(['Default','low','max']);
 await ui.getByLabel('Leads',{exact:true}).selectOption('2');await expect(ui.getByLabel('Leads CLI',{exact:true})).toBeVisible();
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

test('lead count determines hierarchy and keeps workers independently adjustable',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 await expect(ui.getByRole('group',{name:'Structure'})).toHaveCount(0);await expect(ui.getByLabel('Leads',{exact:true})).toHaveValue('1');await expect(ui.getByLabel('Head',{exact:true})).toHaveCount(0);
 await ui.getByLabel('Workers per lead',{exact:true}).selectOption('4');await expect(ui.locator('#preview .count')).toHaveText('5 members · 1 head, 4 workers');
 await ui.getByLabel('Leads',{exact:true}).selectOption('2');await expect(ui.getByLabel('Workers per lead',{exact:true})).toHaveValue('4');await expect(ui.locator('#preview .count')).toHaveText('11 members · 1 head, 2 leads, 8 workers');
 await ui.getByLabel('Workers per lead',{exact:true}).selectOption('3');await expect(ui.getByLabel('Leads',{exact:true})).toHaveValue('2');await expect(ui.locator('#preview .count')).toHaveText('9 members · 1 head, 2 leads, 6 workers');
 await ui.getByLabel('Leads',{exact:true}).selectOption('1');await expect(ui.locator('#preview .count')).toHaveText('4 members · 1 head, 3 workers');await expect(ui.getByLabel('Leads CLI',{exact:true})).toHaveCount(0);
 for(const name of ['Project and execution host','Confirm project and host','Refresh workspace','Reports each','Levels','Structure'])await expect(ui.getByText(name,{exact:true})).toHaveCount(0);
});

test('changing the lead count keeps model preferences attached to their roles',async({page})=>{
 await page.goto('/?mode=capabilities-local');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 await ui.getByLabel('Workers CLI',{exact:true}).selectOption('claude');await ui.getByLabel('Workers model',{exact:true}).selectOption('claude-model');await ui.getByLabel('Workers effort',{exact:true}).selectOption('max');
 await ui.getByLabel('Leads',{exact:true}).selectOption('2');await expect(ui.getByLabel('Workers CLI',{exact:true})).toHaveValue('claude');await expect(ui.getByLabel('Workers model',{exact:true})).toHaveValue('claude-model');await expect(ui.getByLabel('Workers effort',{exact:true})).toHaveValue('max');
 await ui.getByLabel('Leads model',{exact:true}).selectOption('my-model');await ui.getByLabel('Leads effort',{exact:true}).selectOption('ultra');
 await ui.getByLabel('Leads',{exact:true}).selectOption('1');await expect(ui.getByLabel('Workers model',{exact:true})).toHaveValue('claude-model');await expect(ui.getByLabel('Leads CLI',{exact:true})).toHaveCount(0);
 await ui.getByLabel('Leads',{exact:true}).selectOption('3');await expect(ui.getByLabel('Leads model',{exact:true})).toHaveValue('my-model');await expect(ui.getByLabel('Leads effort',{exact:true})).toHaveValue('ultra');await expect(ui.getByLabel('Head model',{exact:true})).toHaveValue('default');
 await expect(ui.getByLabel('Workers model',{exact:true})).toHaveValue('claude-model');
});

test('launch captures the current project after a switch without manual confirmation',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();await ui.getByLabel('Workers per lead',{exact:true}).selectOption('1');
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

test('more than one lead saves and launches a three-level team with exactly one head',async({page})=>{
 await page.goto('/');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 await ui.getByLabel('Leads',{exact:true}).selectOption('2');await ui.getByLabel('Lead name',{exact:true}).fill('UI, Dev');await ui.getByLabel('Workers per lead',{exact:true}).selectOption('1');await ui.getByRole('button',{name:'Launch team',exact:true}).click();await expect(ui.locator('.roster tbody tr')).toHaveCount(5,{timeout:55000});
 const team=(await snapshot(page)).teams[0];expect(team.configuration).toMatchObject({levels:3,leadCount:2,workersPerLead:1});expect(team.members.filter(m=>m.role==='head')).toHaveLength(1);const leads=team.members.filter(m=>m.role==='lead');expect(leads).toHaveLength(2);for(const lead of leads)expect(team.members.filter(m=>m.boss===lead.id)).toHaveLength(1);expect(Object.keys(team.launch.members)).toHaveLength(5);
 expect(leads.map(m=>m.name)).toEqual(['UI','Dev']);expect(team.configuration.leadNames).toBe('UI, Dev');
 expect(team.members.filter(m=>m.role==='worker').map(m=>m.name)).toEqual(['UI-Worker-1','Dev-Worker-1']);
 await ui.locator('.organisation').getByRole('button',{name:'Open UI’s session',exact:true}).focus();await page.keyboard.press('Enter');await expect(ui.locator('.success')).toContainText('Opened UI’s session');
 const opened=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='openMember').at(-1).params.teamWorker.args.params);expect(opened).toMatchObject({teamId:team.id,memberId:leads[0].id,requestId:team.launch.members[leads[0].id].requestId});
});

test('lead names validate against the selected count and update the preview without moving input focus',async({page})=>{
 await page.goto('/?mode=capabilities-local');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 const names=ui.getByLabel('Lead name',{exact:true});await names.fill('UI, Dev, Review');await expect(names).toBeFocused();
 await expect(ui.locator('#lead-names-validation')).toContainText('match Leads; found 3');await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeDisabled();
 await ui.getByLabel('Leads',{exact:true}).selectOption('3');await expect(ui.locator('#preview .org-node.lead > span:nth-child(2)')).toHaveText(['UI','Dev','Review']);await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 await expect(ui.locator('#preview .org-node.worker > span:nth-child(2)')).toHaveText(['UI-Worker-1','UI-Worker-2','UI-Worker-3','Dev-Worker-1','Dev-Worker-2','Dev-Worker-3','Review-Worker-1','Review-Worker-2','Review-Worker-3']);
 await names.fill('UI, UI, Review');await expect(ui.locator('#lead-names-validation')).toHaveText('Lead names must be unique.');await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeDisabled();
 await names.fill('');await ui.getByLabel('Leads',{exact:true}).selectOption('1');await names.fill('Design');await expect(ui.locator('#preview .org-node.head > span:nth-child(2)')).toHaveText('Design');
 await expect(ui.locator('#preview .org-node.worker > span:nth-child(2)')).toHaveText(['Design-Worker-1','Design-Worker-2','Design-Worker-3']);
});

test('chosen models remain stable past discovery expiry and unchanged-project polling preserves the form DOM',async({page})=>{
 await page.clock.install();await page.goto('/?mode=capabilities-local');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();
 await ui.getByLabel('Head model',{exact:true}).selectOption('my-model');await ui.getByLabel('Head effort',{exact:true}).selectOption('ultra');
 await ui.getByLabel('Head model',{exact:true}).evaluate(e=>{window.originalModelPicker=e;});await ui.getByLabel('Lead name',{exact:true}).focus();
 const counts=await page.evaluate(()=>({caps:bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='capabilities').length,context:bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='context').length}));
 await page.clock.fastForward(360000);
 await expect.poll(()=>page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='context').length)).toBeGreaterThan(counts.context);
 await expect(ui.getByLabel('Head model',{exact:true})).toHaveValue('my-model');await expect(ui.getByLabel('Head effort',{exact:true})).toHaveValue('ultra');await expect(ui.getByLabel('Lead name',{exact:true})).toBeFocused();
 expect(await ui.getByLabel('Head model',{exact:true}).evaluate(e=>e===window.originalModelPicker)).toBe(true);
 expect(await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='capabilities').length)).toBe(counts.caps);
 await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
});

test('New team requires an existing project session even when Default is selected',async({page})=>{
 await page.goto('/?mode=capabilities-no-session');const ui=panel(page);await ui.getByRole('button',{name:'Add team',exact:true}).click();
 await expect(ui.getByText('Open a Codex or Claude Code session in this project before launching a team, then refresh models.',{exact:true})).toBeVisible();
 await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeDisabled();
 await expect(ui.getByLabel('Head model',{exact:true}).locator('option')).toHaveText(['Default · Orca settings']);
 expect(await page.evaluate(()=>bridgeCalls.some(c=>c.params?.teamWorker?.args?.op==='launchSupervisor'))).toBe(false);
});

for(const mode of ['', 'roster-live'])test(`worker navigation uses the bound ${mode?'structured':'terminal'} session`,async({page})=>{
 const ui=await launchTeam(page,{mode});const team=(await snapshot(page)).teams[0],member=team.members[2];
 await ui.locator('.roster').getByRole('button',{name:`Open ${member.name}’s session`,exact:true}).click();
 await expect(ui.locator('.success')).toContainText(`Opened ${member.name}’s session`);
 const opened=await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='openMember').at(-1).params.teamWorker.args.params);
 expect(opened).toEqual({teamId:team.id,memberId:member.id,requestId:team.launch.members[member.id].requestId});
});

test('terminal context shows provider counts and refreshes without inventing a window',async({page})=>{
 const ui=await launchTeam(page,{mode:'terminal-context',workersCLI:'claude'});
 await expect(ui.locator('.roster tbody tr').first().locator('.context-usage')).toHaveText('25%');
 await expect(ui.locator('.roster tbody tr').nth(1).locator('.context-usage')).toHaveText('≈40K tokens');
 await expect(ui.locator('.roster tbody tr').nth(1).locator('.context-usage')).toHaveAttribute('title',/Window size not reported/);
 await page.reload();await expect(panel(page).locator('.roster tbody tr').nth(1).locator('.context-usage')).toHaveText('≈40K tokens');
});

test('Claude context connects an existing statusline, reports 1M percentages and disconnects to transcript counts',async({page})=>{
 const ui=await launchTeam(page,{mode:'terminal-context',workersCLI:'claude'});
 await expect(ui.locator('.roster tbody tr').nth(1).locator('.context-usage')).toHaveText('≈40K tokens');
 await ui.getByRole('button',{name:'Settings',exact:true}).click();
 await ui.getByRole('button',{name:'Connect Claude context',exact:true}).click();
 await expect(ui.getByRole('button',{name:'Disconnect Claude context',exact:true})).toBeEnabled();
 await ui.getByRole('button',{name:'Roster',exact:true}).click();
 await expect(ui.locator('.roster tbody tr').nth(1).locator('.context-usage')).toHaveText('4%');
 await expect(ui.locator('.roster tbody tr').nth(1).locator('.context-usage')).toHaveAttribute('title',/40,000 tokens \/ 1,000,000/);
 await page.reload();await expect(panel(page).locator('.roster tbody tr').nth(1).locator('.context-usage')).toHaveText('4%');
 await panel(page).getByRole('button',{name:'Settings',exact:true}).click();await panel(page).getByRole('button',{name:'Disconnect Claude context',exact:true}).click();
 await expect(panel(page).getByRole('button',{name:'Connect Claude context',exact:true})).toBeEnabled();
 await panel(page).getByRole('button',{name:'Roster',exact:true}).click();
 await expect(panel(page).locator('.roster tbody tr').nth(1).locator('.context-usage')).toHaveText('≈40K tokens');
});
