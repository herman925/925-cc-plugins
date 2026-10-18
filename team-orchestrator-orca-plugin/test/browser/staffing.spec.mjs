import {test,expect} from '@playwright/test';
const panel=page=>page.frameLocator('#panel');
async function prepare(page){
 await page.goto('/?mode=dispatch-staffing');const ui=panel(page);
 await ui.getByRole('button',{name:/Squad/}).click();await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Save team',exact:true}).click();await ui.getByRole('button',{name:'Launch this team'}).click();await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');await ui.getByLabel('Total objective', {exact:true}).fill('Review staffing');await ui.getByRole('button',{name:'Submit total objective'}).click();return ui;
}
test('staffing requests are visible as history while approval and additions stay in the supervisor session',async({page})=>{
 const ui=await prepare(page);await expect(ui.getByRole('button',{name:/Needs your attention/})).toHaveCount(0);
 await ui.getByText('Conversation decision history',{exact:true}).click();const proposal=ui.getByRole('article',{name:'Staffing proposal reviewer-proposal'});
 await expect(proposal).toContainText('Independent reviewer <script>');await expect(proposal).toContainText('pending');await expect(proposal.locator('script')).toHaveCount(0);
 for(const name of ['Approve member','Reject proposal','Add member'])await expect(ui.getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(ui.locator('.roster tbody tr')).toHaveCount(4);await page.reload();await panel(page).getByText('Conversation decision history',{exact:true}).click();await expect(panel(page).getByRole('article',{name:'Staffing proposal reviewer-proposal'})).toContainText('pending');
});
