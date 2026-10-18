import {test,expect} from '@playwright/test';
const panel=page=>page.frameLocator('#panel');
async function prepare(page,mode='dispatch-question'){
 await page.goto('/?mode='+mode);const ui=panel(page);
 await ui.getByRole('button',{name:/Squad/}).click();await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Save team',exact:true}).click();await ui.getByRole('button',{name:'Launch this team'}).click();await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');await ui.getByLabel('Total objective').fill('Resolve scope');await ui.getByRole('button',{name:'Submit total objective'}).click();return ui;
}
test('questions belong to the supervisor conversation; panel keeps escaped read-only history and an exact-session link',async({page})=>{
 const ui=await prepare(page);await expect(ui.getByRole('button',{name:/Needs your attention/})).toHaveCount(0);
 const region=ui.getByRole('region',{name:'Supervisor conversation'});await expect(region).toContainText('Discuss questions and staffing');
 await region.getByText('Conversation decision history',{exact:true}).click();await expect(region).toContainText('Choose scope <script>');await expect(region.locator('script')).toHaveCount(0);
 await expect(region.getByRole('textbox')).toHaveCount(0);await expect(ui.getByRole('button',{name:'Send answer',exact:true})).toHaveCount(0);
 await region.getByRole('button',{name:'Open supervisor session'}).click();await expect(ui.locator('.success')).toContainText('Opened the verified native session');
 await page.reload();await panel(page).getByText('Conversation decision history',{exact:true}).click();await expect(panel(page).getByRole('article',{name:'Question scope-choice'})).toContainText('pending');
});
test('legacy blocked answers remain readable after migration and are resolved in the supervisor session',async({page})=>{
 const ui=await prepare(page,'dispatch-report-question');await ui.getByText('Conversation decision history',{exact:true}).click();
 const region=ui.getByRole('region',{name:'Supervisor conversation'});await expect(region).toContainText('legacy-blocked-answer');await expect(region).toContainText('Native input: blocked');await expect(region).toContainText('Completion report');await expect(region.getByRole('textbox')).toHaveCount(0);
 await page.reload();await panel(page).getByText('Conversation decision history',{exact:true}).click();await expect(panel(page).getByRole('region',{name:'Supervisor conversation'})).toContainText('Native input: blocked');
});
