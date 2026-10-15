import {test,expect} from '@playwright/test';
const panel=page=>page.frameLocator('#panel');
async function prepared(page,mode='structured'){
 await page.goto('/?mode='+mode);const ui=panel(page);
 await ui.getByRole('button',{name:/Squad/}).click();await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Save team',exact:true}).click();
 await ui.getByRole('button',{name:'Launch this team'}).click();await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');return ui;
}
test('submit a separate total objective, verify native Run evidence and reload the same work',async({page})=>{
 const ui=await prepared(page);await ui.getByLabel('Total objective').fill('Audit checkout with evidence');
 await ui.getByRole('button',{name:'Submit total objective'}).click();
 await expect(ui.getByRole('region',{name:'TeamWork'})).toContainText('Run: verified');
 await expect(ui.getByRole('region',{name:'TeamWork'})).toContainText('Input: accepted');
 await expect(ui.getByRole('button',{name:'Submit total objective'})).toHaveCount(0);
 await page.reload();await expect(panel(page).getByRole('region',{name:'TeamWork'})).toContainText('Audit checkout with evidence');
 await panel(page).getByRole('button',{name:'Check work evidence'}).click();
 await expect(panel(page).getByRole('region',{name:'TeamWork'})).toContainText('Processing: observed');
});
