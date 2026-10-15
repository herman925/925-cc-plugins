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

test('terminal objective keeps its verified Run and observed prompt after reopening',async({page})=>{
 const ui=await prepared(page,'terminal');await ui.getByLabel('Total objective').fill('Inspect terminal execution');
 await ui.getByRole('button',{name:'Submit total objective'}).click();
 const work=ui.getByRole('region',{name:'TeamWork'});
 await expect(work).toContainText('Input: accepted');await expect(work).toContainText('Processing: observed');await expect(work).toContainText('Run: verified');
 const runId=await work.getByText(/^Native Run:/).textContent();
 await page.reload();await expect(panel(page).getByRole('region',{name:'TeamWork'})).toContainText(runId);
 await panel(page).getByRole('button',{name:'Check work evidence'}).click();
 await expect(panel(page).getByRole('region',{name:'TeamWork'})).toContainText(runId);
 expect(await page.evaluate(()=>window.bridgeCalls.filter(row=>row.params?.teamWorker?.args?.op==='submitWork'))).toHaveLength(0);
});

test('accepted terminal input without a native Run stays unverified and reserved',async({page})=>{
 const ui=await prepared(page,'objective-no-run');await ui.getByLabel('Total objective').fill('Await supervisor-created Run');
 await ui.getByRole('button',{name:'Submit total objective'}).click();
 const work=ui.getByRole('region',{name:'TeamWork'});
 await expect(work).toContainText('Input: accepted');await expect(work).toContainText('Run: unverified');
 await expect(work).toContainText('supervisor must create its own Run');
 await expect(ui.getByRole('button',{name:'Submit total objective'})).toHaveCount(0);
 await expect(ui.getByRole('button',{name:'Retry unsent objective'})).toHaveCount(0);
 await ui.getByRole('button',{name:'Check work evidence'}).click();await expect(work).toContainText('Run: unverified');
 await page.reload();await expect(panel(page).getByRole('region',{name:'TeamWork'})).toContainText('Await supervisor-created Run');
 await expect(panel(page).getByRole('region',{name:'TeamWork'})).toContainText('Run: unverified');
});

test('unknown input can discover its Run without resending the objective',async({page})=>{
 const ui=await prepared(page,'objective-unknown');await ui.getByLabel('Total objective').fill('Recover uncertain objective');
 await ui.getByRole('button',{name:'Submit total objective'}).click();
 const work=ui.getByRole('region',{name:'TeamWork'});
 await expect(work).toContainText('Input: unknown');await expect(work).toContainText('Processing: unknown');
 await expect(work.getByRole('alert')).toContainText('Objective delivery outcome unknown');
 await expect(ui.getByRole('button',{name:'Retry unsent objective'})).toHaveCount(0);
 await ui.getByRole('button',{name:'Check work evidence'}).click();
 await expect(work).toContainText('Run: verified');await expect(work).toContainText('Input: unknown');await expect(work).toContainText('Processing: unknown');
 expect(await page.evaluate(()=>window.bridgeCalls.filter(row=>row.params?.teamWorker?.args?.op==='submitWork'))).toHaveLength(1);
 await page.reload();await expect(panel(page).getByRole('region',{name:'TeamWork'})).toContainText('Recover uncertain objective');
 await expect(panel(page).getByRole('region',{name:'TeamWork'})).toContainText('Input: unknown');
 await expect(panel(page).getByRole('button',{name:'Submit total objective'})).toHaveCount(0);
 expect(await page.evaluate(()=>window.bridgeCalls.filter(row=>['submitWork','retryObjective'].includes(row.params?.teamWorker?.args?.op)))).toHaveLength(0);
});
