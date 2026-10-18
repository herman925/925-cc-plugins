import {test,expect} from '@playwright/test';
const panel=page=>page.frameLocator('#panel');

test('a bridge error shows one warning without navigation, false empty state or internal diagnostics',async({page})=>{
 await page.route('**/rpc',route=>route.fulfill({json:{ok:false,errorCode:'invalid_params',error:'(root): Unrecognized key: "teamWorker"'}}));
 await page.goto('/');const ui=panel(page);
 await expect(ui.getByRole('alert')).toHaveCount(1);await expect(ui.getByRole('alert')).toContainText('Plugin unavailable');
 await expect(ui.getByRole('navigation')).toHaveCount(0);await expect(ui.locator('.welcome,.team-card,footer,.notice')).toHaveCount(0);
 await expect(ui.getByText('Unrecognized key',{exact:false})).toHaveCount(0);
 await ui.getByRole('button',{name:'Details',exact:true}).click();await expect(ui.locator('#failure-details')).toContainText('Unrecognized key: "teamWorker"');
 await ui.getByRole('button',{name:'Hide details',exact:true}).click();await expect(ui.locator('#failure-details')).toHaveCount(0);
});

test('failed reload hides cached teams; retry reveals them only after storage succeeds',async({page})=>{
 await page.goto('/');const ui=panel(page);
 await ui.getByRole('button',{name:'New team',exact:true}).click();await ui.getByLabel('Team name',{exact:true}).fill('Squad');await ui.getByRole('button',{name:'Launch team',exact:true}).click();
 await expect(ui.getByRole('heading',{name:'@Squad',exact:true})).toBeVisible({timeout:45000});
 await page.route('**/rpc',route=>route.request().postDataJSON().message.args?.op==='load'?route.fulfill({json:{ok:false,error:'Storage temporarily unavailable'}}):route.continue());
 await ui.getByRole('button',{name:'Settings',exact:true}).click();await ui.getByRole('button',{name:'Test connection'}).click();
 await expect(ui.getByRole('alert')).toContainText('Your saved teams could not be loaded');await expect(ui.locator('.team-card,.welcome,nav,footer')).toHaveCount(0);
 await page.unroute('**/rpc');
 let release,started;const requested=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 await page.route('**/rpc',async route=>{if(route.request().postDataJSON().message.args?.op==='load'){started();await pending;}await route.continue();});
 try{
  await ui.getByRole('button',{name:'Retry',exact:true}).click();await requested;
  await expect(ui.getByRole('status')).toContainText('Connecting to Orca');await expect(ui.locator('.team-card,.welcome,nav,footer')).toHaveCount(0);
 }finally{release();}
 await expect(ui.getByRole('heading',{name:'@Squad',exact:true})).toBeVisible({timeout:45000});await expect(ui.locator('.notice,.unavailable')).toHaveCount(0);
 expect(await page.evaluate(()=>bridgeCalls.filter(c=>c.params.teamWorker.args?.op==='createTeam').length)).toBe(1);
 expect(await page.evaluate(()=>bridgeCalls.filter(c=>c.params.teamWorker.args?.op==='launchSupervisor').length)).toBe(4);
});
