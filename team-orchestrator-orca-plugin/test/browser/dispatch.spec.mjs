import { test, expect } from '@playwright/test';
const panel = page => page.frameLocator('#panel');

// Real plugin service/SQLite, scripted native supervisor and provider boundary.
// These receipts do not establish live Orca or provider execution.
async function preparedDispatch(page, mode = 'dispatch-complete') {
  await page.goto('/?mode=' + mode); const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await ui.getByRole('button', { name: 'Confirm project and host' }).click();
  await ui.getByRole('combobox', { name: 'Head CLI' }).selectOption(mode === 'dispatch-reverse' ? 'claude' : 'codex');
  await ui.getByRole('combobox', { name: 'Workers CLI' }).selectOption(mode === 'dispatch-reverse' ? 'codex' : 'claude');
  await ui.getByRole('button', { name: 'Save team', exact: true }).click();
  await ui.getByRole('button', { name: 'Launch this team' }).click();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  await ui.getByLabel('Total objective').fill('Inspect checkout across providers');
  await ui.getByRole('button', { name: 'Submit total objective' }).click();
  return ui;
}

for (const mode of ['dispatch-complete', 'dispatch-reverse']) test(`${mode}: native execution result stays pending supervisor acceptance across reopening`, async ({ page }) => {
  const ui = await preparedDispatch(page, mode);
  const tasks = ui.getByRole('region', { name: 'Team tasks', exact: true });
  await expect(tasks).toContainText('Pending supervisor acceptance');
  await expect(tasks).toContainText('Native execution: succeeded');
  await expect(tasks).toContainText('Checkout evidence <b>verified</b>');
  await expect(tasks.locator('b, script')).toHaveCount(0);
  await expect(tasks.getByRole('article')).toHaveCount(1);
  await tasks.getByRole('button', { name: 'View member' }).click();
  const member = ui.getByRole('region', { name: 'Member details' });
  await expect(member).toContainText('inspect-checkout');
  await expect(member).toContainText('Pending supervisor acceptance');
  await expect(member).toContainText('Configuration 1 · Role 1');
  await expect(member.getByRole('button', { name: /accept|retry/i })).toHaveCount(0);
  await expect(member.getByRole('combobox', { name: 'Member agent' })).toHaveValue(mode === 'dispatch-reverse' ? 'codex' : 'claude');
  await page.reload();
  const restored = panel(page).getByRole('region', { name: 'Team tasks', exact: true });
  await expect(restored).toContainText('Pending supervisor acceptance');
  await expect(restored).toContainText('Checkout evidence <b>verified</b>');
  await panel(page).getByRole('button', { name: 'Check work evidence' }).click();
  await expect(restored.getByRole('article')).toHaveCount(1);
  await expect(restored).toContainText('Pending supervisor acceptance');
  expect(await page.evaluate(() => window.bridgeCalls.filter(row => ['submitWork', 'retryObjective', 'launchSupervisor'].includes(row.params?.teamWorker?.args?.op)))).toHaveLength(0);
});

test('unknown dispatch remains unresolved after checking and reopening without a retry action', async ({ page }) => {
  const ui = await preparedDispatch(page, 'dispatch-unknown');
  const tasks = ui.getByRole('region', { name: 'Team tasks', exact: true });
  await expect(tasks).toContainText('Outcome unknown');
  await expect(tasks).toContainText('Native execution: unconfirmed');
  await expect(tasks).toContainText('Native start evidence unavailable');
  await expect(tasks.getByRole('button', { name: /retry|launch|accept/i })).toHaveCount(0);
  await ui.getByRole('button', { name: 'Check work evidence' }).click();
  await expect(tasks).toContainText('Outcome unknown');
  await page.reload();
  const restored = panel(page).getByRole('region', { name: 'Team tasks', exact: true });
  await expect(restored).toContainText('Outcome unknown');
  await expect(restored).not.toContainText('Pending supervisor acceptance');
  expect(await page.evaluate(() => window.bridgeCalls.filter(row => ['submitWork', 'retryObjective', 'launchSupervisor'].includes(row.params?.teamWorker?.args?.op)))).toHaveLength(0);
});


test('native assignment is shown without claiming a completed or ready provider', async ({ page }) => {
  const ui = await preparedDispatch(page, 'dispatch-running');
  const tasks = ui.getByRole('region', { name: 'Team tasks', exact: true });
  await expect(tasks).toContainText('Native assignment observed');
  await expect(tasks).toContainText('Native execution: unconfirmed');
  await expect(tasks).not.toContainText('Pending supervisor acceptance');
  await page.reload();
  await expect(panel(page).getByRole('region', { name: 'Team tasks', exact: true })).toContainText('Native assignment observed');
});

test('native failed execution also awaits supervisor review', async ({ page }) => {
  const ui = await preparedDispatch(page, 'dispatch-failed');
  const tasks = ui.getByRole('region', { name: 'Team tasks', exact: true });
  await expect(tasks).toContainText('Pending supervisor acceptance');
  await expect(tasks).toContainText('Native execution: failed');
  await expect(tasks).toContainText('Checkout verification failed');
  await expect(tasks.getByRole('button', { name: /retry|launch|accept/i })).toHaveCount(0);
});
test('reopened task shows scoped recovery evidence and incomplete archive warnings as escaped text',async({page})=>{
 const ui=await preparedDispatch(page,'dispatch-running');await expect(ui.getByRole('region',{name:'Team tasks',exact:true})).toContainText('Native assignment observed');await page.reload();const tasks=panel(page).getByRole('region',{name:'Team tasks',exact:true});
 await expect(tasks).toContainText('Recovery: confirmed_effect');await expect(tasks).toContainText('Last observed:');await expect(tasks).toContainText('Observation or output is incomplete');await expect(tasks).toContainText('Output source is archived');await expect(tasks).toContainText('SSH output clipped <img src=x onerror=alert(1)>');await expect(tasks.locator('img,script')).toHaveCount(0);
 await expect(tasks.getByRole('button',{name:/retry|restart|replace/i})).toHaveCount(0);
 await tasks.getByRole('button',{name:'View member'}).click();await expect(panel(page).getByRole('region',{name:'Member details'})).toContainText('Recovery: confirmed_effect');
});

for(const [mode,label] of [['dispatch-accepted','Accepted by direct supervisor'],['dispatch-rework','Rework requested'],['dispatch-missing-review','Supervisor review evidence missing']])test(`${mode}: review and original evidence remain readable in task and member views`,async({page})=>{
 const ui=await preparedDispatch(page,mode),tasks=ui.getByRole('region',{name:'Team tasks',exact:true});
 await expect(tasks).toContainText(label);await expect(tasks).toContainText('Checkout evidence <b>verified</b>');
 if(mode!=='dispatch-missing-review'){await expect(tasks).toContainText('Supervisor checked <b>validation</b>.');await expect(tasks).toContainText('Reviewer:');await expect(tasks).toContainText('test:checkout');}
 await expect(tasks.locator('b,script')).toHaveCount(0);
 await tasks.getByRole('button',{name:'View member'}).click();await expect(ui.getByRole('region',{name:'Member details'})).toContainText(label);
 await page.reload();await expect(panel(page).getByRole('region',{name:'Team tasks',exact:true})).toContainText(label);
 await expect(panel(page).getByRole('button',{name:/accept task|approve task|rework task/i})).toHaveCount(0);
});

test('overlap queue reason is visible alongside independent active tasks and survives reload',async({page})=>{
 const ui=await preparedDispatch(page,'dispatch-scheduling'),tasks=ui.getByRole('region',{name:'Team tasks',exact:true});
 await expect(tasks.getByRole('article')).toHaveCount(3);await expect(tasks).toContainText('Write scope conflicts with edit-source');
 await expect(tasks.getByRole('article',{name:'Task independent-docs',exact:true})).toContainText('Native assignment observed');
 await expect(tasks.getByRole('article',{name:'Task overlap-source',exact:true})).toContainText('Queued');
 await expect(tasks).toContainText('not filesystem isolation');await page.reload();
 await expect(panel(page).getByRole('region',{name:'Team tasks',exact:true})).toContainText('Write scope conflicts with edit-source');
});

test('busy supervisor queue is distinct from member execution and never resends permits on check',async({page})=>{
 const ui=await preparedDispatch(page,'dispatch-queued'),tasks=ui.getByRole('region',{name:'Team tasks',exact:true});
 await expect(tasks).toContainText('Native host queued the permit for the busy supervisor');await expect(tasks).toContainText('Awaiting native start');await expect(tasks).not.toContainText('Native assignment observed');
 await ui.getByRole('button',{name:'Check work evidence'}).click();await expect(tasks.getByRole('article')).toHaveCount(1);await expect(tasks).toContainText('Native host queued');
});
