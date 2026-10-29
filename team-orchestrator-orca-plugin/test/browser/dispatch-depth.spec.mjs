import {test,expect} from '@playwright/test';
import {panel,snapshot} from './helpers.mjs';

test('local multi-lead launch prepares dispatch depth before the first member and keeps the exact roster',async({page})=>{
 await page.goto('/?mode=depth-local');const ui=panel(page);
 await ui.getByRole('button',{name:'Add team',exact:true}).click();
 await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 await ui.getByLabel('Team name',{exact:true}).fill('Depth-check');
 await ui.getByLabel('Leads',{exact:true}).selectOption('2');await ui.getByLabel('Workers per lead',{exact:true}).selectOption('1');
 await ui.getByRole('button',{name:'Launch team',exact:true}).click();
 await expect(ui.locator('.roster tbody tr')).toHaveCount(5,{timeout:55000});
 const team=(await snapshot(page)).teams[0];expect(Object.keys(team.launch.members)).toHaveLength(5);expect(Object.values(team.launch.members).every(m=>m.status==='created')).toBe(true);
 await page.reload();await expect(panel(page).locator('.roster tbody tr')).toHaveCount(5);
 expect(await page.evaluate(()=>bridgeCalls.some(c=>c.params?.teamWorker?.args?.op==='launchSupervisor'))).toBe(false);
});

test('a rejected native depth setting stops the team immediately and explains the failure',async({page})=>{
 await page.goto('/?mode=depth-denied');const ui=panel(page);
 await ui.getByRole('button',{name:'Add team',exact:true}).click();await expect(ui.getByRole('button',{name:'Launch team',exact:true})).toBeEnabled();
 await ui.getByLabel('Leads',{exact:true}).selectOption('2');await ui.getByLabel('Workers per lead',{exact:true}).selectOption('1');
 await ui.getByRole('button',{name:'Launch team',exact:true}).click();
 await expect(ui.getByRole('alert')).toContainText('Could not prepare native dispatch depth');
 await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');
 expect(await page.evaluate(()=>bridgeCalls.filter(c=>c.params?.teamWorker?.args?.op==='launchSupervisor').length)).toBe(1);
 expect((await snapshot(page)).teams[0].launch).toBeUndefined();
});
