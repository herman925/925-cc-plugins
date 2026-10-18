import {expect} from '@playwright/test';
export const panel=page=>page.frameLocator('#panel');
export async function launchTeam(page,{mode=''}={}){
 await page.goto('/'+(mode?'?mode='+mode:''));const ui=panel(page);
 await ui.getByRole('button',{name:'New team',exact:true}).click();await ui.getByLabel('Team name',{exact:true}).fill('Squad');
 await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Launch team',exact:true}).click();
 await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false',{timeout:45000});return ui;
}
export const snapshot=page=>page.evaluate(async()=>{const r=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fixtureId:localStorage.getItem('fixtureId'),mode:new URLSearchParams(location.search).get('mode'),message:{protocol:1,commandId:'team.control',args:{op:'load'}}})});return (await r.json()).value.value;});
