import {test,expect} from '@playwright/test';
const panel=page=>page.frameLocator('#panel');
async function prepare(page){
 await page.goto('/?mode=dispatch-staffing');const ui=panel(page);
 await ui.getByRole('button',{name:/Squad/}).click();await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Save team',exact:true}).click();await ui.getByRole('button',{name:'Launch this team'}).click();await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');await ui.getByLabel('Total objective', {exact:true}).fill('Review staffing');await ui.getByRole('button',{name:'Submit total objective'}).click();return ui;
}
test('user adds a member in fixed Work, sees new roster and distinct manager delivery evidence after reload',async({page})=>{
 const ui=await prepare(page);await ui.getByRole('button',{name:'Add member',exact:true}).click();await ui.getByLabel('New member name').fill('Reviewer <script>');await ui.getByLabel('New member role description').fill('Review sources <script>');await ui.getByRole('button',{name:'Save new member',exact:true}).click();
 await expect(ui.locator('.roster')).toContainText('Reviewer <script>');await expect(ui.locator('.roster script')).toHaveCount(0);await expect(ui.getByRole('region',{name:'Staffing'})).toContainText('Native input: accepted · Manager processing: unconfirmed');await page.reload();await expect(panel(page).locator('.roster')).toContainText('Reviewer <script>');
});
test('native staffing proposal stays pending until user approves or rejects and decision survives reload',async({page})=>{
 const ui=await prepare(page);await ui.getByRole('button',{name:'Needs your attention (1)',exact:true}).click();await expect(ui.getByRole('region',{name:'Needs your attention',exact:true})).toContainText('Independent reviewer <script>');await ui.getByRole('button',{name:'Approve member',exact:true}).click();await expect(ui.getByRole('region',{name:'Needs your attention',exact:true})).toContainText('approved');await page.reload();await panel(page).getByRole('button',{name:'Needs your attention (0)',exact:true}).click();await expect(panel(page).getByRole('region',{name:'Needs your attention',exact:true})).toContainText('approved');
});

test('user rejection keeps staffing headcount unchanged',async({page})=>{const ui=await prepare(page);await ui.getByRole('button',{name:'Needs your attention (1)',exact:true}).click();await ui.getByRole('button',{name:'Reject proposal',exact:true}).click();await expect(ui.getByRole('region',{name:'Needs your attention',exact:true})).toContainText('rejected');await ui.getByRole('button',{name:'Roster',exact:true}).click();await expect(ui.locator('.roster tbody tr')).toHaveCount(4);});
