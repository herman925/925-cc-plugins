import {test,expect} from '@playwright/test';
import {panel,snapshot} from './helpers.mjs';
test('initial staffing and per-level CLI/model/effort choices persist without member editors',async({page})=>{
 await page.goto('/?mode=capabilities-local');const ui=panel(page);await ui.getByRole('button',{name:'New team',exact:true}).click();await ui.getByLabel('Team name',{exact:true}).fill('Squad');await ui.getByRole('button',{name:'Confirm project and host'}).click();
 await ui.getByLabel('Head CLI',{exact:true}).selectOption('codex');await ui.getByLabel('Head model',{exact:true}).selectOption('my-model');await ui.getByLabel('Head effort',{exact:true}).selectOption('ultra');
 await ui.getByLabel('Workers CLI',{exact:true}).selectOption('claude');await ui.getByLabel('Workers model',{exact:true}).selectOption('claude-model');await ui.getByLabel('Workers effort',{exact:true}).selectOption('max');
 await ui.getByRole('button',{name:'Launch team',exact:true}).click();await expect(ui.locator('.roster tbody tr')).toHaveCount(4,{timeout:45000});
 const team=(await snapshot(page)).teams[0];expect(team.members[0]).toMatchObject({agent:'codex',model:'my-model',effort:'ultra'});for(const member of team.members.slice(1))expect(member).toMatchObject({agent:'claude',model:'claude-model',effort:'max'});
 await page.reload();await expect(panel(page).locator('.roster tbody tr').first()).toContainText('my-model');await expect(panel(page).locator('.roster tbody tr').nth(1)).toContainText('claude-model');expect((await snapshot(page)).teams[0]).toMatchObject({id:team.id,members:team.members,configuration:team.configuration,configVersion:team.configVersion});
 await expect(panel(page).locator('main input, main select, main textarea')).toHaveCount(0);
});
test('failed save keeps the new-team form and never launches a member',async({page})=>{
 await page.goto('/?mode=write-error');const ui=panel(page);await ui.getByRole('button',{name:'New team',exact:true}).click();await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Launch team',exact:true}).click();await expect(ui.getByRole('alert')).toContainText('Disk full');await expect(ui.getByRole('heading',{name:'New team',exact:true})).toBeVisible();expect(await page.evaluate(()=>bridgeCalls.some(c=>c.params?.teamWorker?.args?.op==='launchSupervisor'))).toBe(false);
});
test('storage recovery stays behind unavailable-state Details',async({page})=>{
 await page.goto('/?mode=read-error');const ui=panel(page);await expect(ui.getByRole('alert')).toContainText('could not be loaded');await expect(ui.locator('.roster')).toHaveCount(0);await ui.getByRole('button',{name:'Details',exact:true}).click();await ui.getByRole('button',{name:'Inspect recovery details'}).click();await expect(ui.getByRole('region',{name:'Storage recovery'})).toContainText('Found / supported schema');
});
