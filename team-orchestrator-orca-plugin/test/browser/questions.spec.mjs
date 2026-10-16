import {test,expect} from '@playwright/test';
const panel=page=>page.frameLocator('#panel');
async function prepare(page,mode='dispatch-question'){
 await page.goto('/?mode='+mode);const ui=panel(page);
 await ui.getByRole('button',{name:/Squad/}).click();await ui.getByRole('button',{name:'Confirm project and host'}).click();await ui.getByRole('button',{name:'Save team',exact:true}).click();await ui.getByRole('button',{name:'Launch this team'}).click();await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');await ui.getByLabel('Total objective').fill('Resolve scope');await ui.getByRole('button',{name:'Submit total objective'}).click();return ui;
}
test('pending count, saved answer and explicit supplement survive panel reopening',async({page})=>{
 const ui=await prepare(page);await ui.getByRole('button',{name:'Needs your attention (1)',exact:true}).click();const region=ui.getByRole('region',{name:'Needs your attention',exact:true});
 await expect(region).toContainText('Choose scope <script>');await expect(region.locator('script')).toHaveCount(0);await region.getByLabel('Your answer').fill('Focused scope');await region.getByRole('button',{name:'Send answer',exact:true}).click();await expect(region).toContainText('Native input: accepted');await expect(region).toContainText('Manager processing: unconfirmed');
 await page.reload();await panel(page).getByRole('button',{name:'Needs your attention (1)',exact:true}).click();const reopened=panel(page).getByRole('region',{name:'Needs your attention',exact:true});await expect(reopened).toContainText('Focused scope');await reopened.getByLabel('Your supplement').fill('Include tests');await reopened.getByRole('button',{name:'Send supplement',exact:true}).click();await expect(reopened).toContainText('Include tests');
});
test('unknown user answer is durable with no resend action',async({page})=>{
 const ui=await prepare(page,'dispatch-question-unknown');await ui.getByRole('button',{name:'Needs your attention (1)',exact:true}).click();const region=ui.getByRole('region',{name:'Needs your attention',exact:true});await region.getByLabel('Your answer').fill('Focused');await region.getByRole('button',{name:'Send answer',exact:true}).click();await expect(region).toContainText('Native input: unknown');await page.reload();await panel(page).getByRole('button',{name:'Needs your attention (1)',exact:true}).click();await expect(panel(page).getByRole('region',{name:'Needs your attention',exact:true})).toContainText('Native input: unknown');
});

test('verified completion decision shows the old blocked answer and explicit supplement supersession without auto resend',async({page})=>{
 const ui=await prepare(page,'dispatch-report-question');await ui.getByRole('button',{name:'Needs your attention (1)',exact:true}).click();const region=ui.getByRole('region',{name:'Needs your attention',exact:true});
 await expect(region).toContainText('legacy-blocked-answer');await expect(region).toContainText('Native input: blocked');await expect(region).toContainText('Completion report');
 await page.reload();await panel(page).getByRole('button',{name:'Needs your attention (1)',exact:true}).click();const reopened=panel(page).getByRole('region',{name:'Needs your attention',exact:true});
 await expect(reopened).toContainText('Native input: blocked');await expect(reopened).not.toContainText('Native input: accepted');await reopened.getByLabel('Your supplement').fill('Accept the observed QA result without another attempt');await reopened.getByRole('button',{name:'Send supplement',exact:true}).click();
 await expect(reopened).toContainText('Native input: blocked');await expect(reopened).toContainText('Native input: accepted');await expect(reopened).toContainText('Manager processing: unconfirmed');await expect(reopened).toContainText('legacy-blocked-answer');await expect(reopened).toContainText('Explicit supplement for unsent blocked answers');
});
