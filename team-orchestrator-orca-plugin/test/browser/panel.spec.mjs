import { test, expect } from '@playwright/test';
const panel = page => page.frameLocator('#panel');
async function saveTeam(ui) { await ui.getByRole('button', { name: 'Confirm project and host' }).click(); await ui.getByRole('button', { name: 'Save team', exact: true }).click(); }
async function createAndLaunch(ui) { await saveTeam(ui); await ui.getByRole('button', { name: 'Launch this team' }).click(); }
test('create, inspect and restore a team inside the opaque sandbox', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const ui = panel(page);
  await expect(ui.getByRole('heading', { name: 'No team yet' })).toBeVisible();
  await ui.getByRole('button', { name: /Squad/ }).click();
  await expect(ui.locator('#preview')).toContainText('4 members');
  await ui.locator('#team-name').fill('QA');
  await ui.locator('#team-purpose').fill('Audit checkout');
  await ui.getByRole('button', { name: '3 · Head + leads + workers' }).click();
  await expect(ui.locator('#preview')).toContainText('13 members');
  await createAndLaunch(ui);
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false', { timeout: 45000 });
  await expect(ui.getByRole('heading', { name: '@QA' })).toBeVisible();
  await ui.getByRole('button', { name: 'Lead-1-1', exact: true }).click();
  await expect(ui.getByRole('region', { name: 'Member details' })).toContainText('Head');
  await expect(ui.getByRole('region', { name: 'Member details' })).toContainText('Created · startup brief supplied');
  await page.reload();
  await expect(panel(page).getByRole('heading', { name: '@QA' })).toBeVisible();
  expect(await page.locator('#panel').getAttribute('sandbox')).toBe('allow-scripts');
  const sends = await page.evaluate(() => bridgeCalls.filter(call => call.action === 'terminal.sendText'));
  expect(sends).toHaveLength(0); // Reload resets the test host's call log; the persisted request remains accepted.
  await expect(panel(page).locator('.team-card')).toContainText('actual session receipt');
  expect(errors).toEqual([]);
});
test('CEO flow, per-level choices, independent same-name teams and settings persistence', async ({ page }) => {
  await page.goto('/?mode=capabilities-local');
  const ui = panel(page);
  await ui.getByRole('button', { name: /All-Purpose Team/ }).click();
  await expect(ui.locator('#preview')).toContainText('11 members');
  await ui.locator('#team-name').fill('Organisation');
  await ui.locator('#team-groups').fill('Dev, QA');
  await ui.getByRole('button', { name: 'Confirm project and host' }).click();
  await ui.getByRole('combobox', { name: 'CEO model' }).fill('my-model');
  await ui.getByRole('combobox', { name: 'CEO model' }).press('Tab');
  await ui.getByRole('combobox', { name: 'CEO effort' }).selectOption('high');
  await ui.getByRole('combobox', { name: 'Heads CLI' }).selectOption('claude');
  await createAndLaunch(ui);
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false', { timeout: 45000 });
  await expect(ui.getByRole('heading', { name: '@Organisation' })).toBeVisible();
  await ui.getByRole('button', { name: 'New team', exact: true }).click();
  await saveTeam(ui);
  await expect(ui.getByRole('heading', { name: '@Organisation', exact: true })).toHaveCount(2);
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('checkbox', { name: 'Show organisation tree' }).uncheck();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(panel(page).locator('#app')).toHaveAttribute('aria-busy', 'false');
  await expect(panel(page).locator('.org-tree')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel(page).getByRole('checkbox', { name: 'Show organisation tree' })).not.toBeChecked();
});
test('unpatched host blocks launching instead of sending a coordinator workaround', async ({ page }) => {
  await page.goto('/?mode=unpatched');
  const ui = panel(page);
  await expect(ui.getByRole('alert')).toContainText('Plugin unavailable');
  await expect(ui.getByRole('navigation')).toHaveCount(0);
  await expect(ui.getByRole('heading', { name: 'No team yet' })).toHaveCount(0);
  await expect(ui.getByRole('button', { name: /Squad|Save team|New team/ })).toHaveCount(0);
  await expect(ui.getByText('Session-only', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => bridgeCalls.filter(call => call.params?.teamWorker?.args?.op === 'start').map(call => ({ action: 'terminal.createAgent', params: call.params.teamWorker.args.params })).length)).toBe(0);
});
test('save failure retains existing data and stays on the form', async ({ page }) => {
  await page.goto('/?mode=write-error');
  const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await saveTeam(ui);
  await expect(ui.getByRole('alert')).toContainText('Disk full');
  await expect(ui.getByRole('heading', { name: 'New team' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('team-definitions-v1'))).toBe(null);
});
test('unreadable stored data blocks writes and preserves the recovery error', async ({ page }) => {
  await page.goto('/?mode=read-error'); const ui = panel(page);
  await expect(ui.getByRole('alert')).toContainText('Your saved teams could not be loaded');
  await expect(ui.getByRole('button', { name: 'New team', exact: true })).toHaveCount(0);
  await ui.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(ui.locator('#failure-details')).toContainText('Original data has been preserved');
});
for (const width of [320, 960]) {
  test(`organisation chart stays inside a ${width}px panel`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const ui = panel(page);
    await ui.getByRole('button', { name: /Tech Team/ }).click();
      await createAndLaunch(ui);
    await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false', { timeout: 45000 });
  await expect(ui.getByRole('heading', { name: '@Tech-Team' })).toBeVisible();
    const frame = page.frames().find(frame => frame.url() === 'about:srcdoc');
    expect(await frame.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(ui.locator('.org-chart .org-node')).toHaveCount(21);
  });
}
test('Launch opens only the real highest supervisor and can focus its verified session', async ({ page }) => {
  await page.goto('/?mode=permission'); const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await createAndLaunch(ui);
  await expect(ui.getByRole('status').filter({ hasText: 'requested member sessions created' })).toContainText('1/1 requested member sessions created');
  expect(await page.evaluate(() => bridgeCalls.filter(call => call.params?.teamWorker?.args?.op === 'launchSupervisor').length)).toBe(1);
  await expect(ui.locator('.team-card')).toContainText('1 actual session receipt');
  await expect(ui.locator('.team-card')).toContainText('Observation: permission');
  await ui.getByRole('button', { name: 'Open verified session' }).click();
  await expect(ui.getByText('Opened the verified native session.')).toBeVisible();
});
test('native launch requires no pre-existing agent tabs', async ({ page }) => {
  await page.goto('/?mode=no-tabs'); const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await createAndLaunch(ui);
  await expect(ui.getByRole('status').filter({ hasText: 'requested member sessions created' })).toContainText('1/1 requested member sessions created', { timeout: 45000 });
});
test('unknown launch remains reserved after reload and never automatically creates a second session', async ({ page }) => {
  await page.goto('/?mode=launch-unknown'); const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click(); await createAndLaunch(ui);
  await expect(ui.locator('.team-card')).toContainText('unknown');
  await expect(ui.getByRole('button', { name: 'Check saved launch' })).toBeVisible();
  await page.reload();
  await expect(ui.locator('.team-card')).toContainText('unknown');
  await expect(ui.getByRole('button', { name: 'Launch this team' })).toHaveCount(0);
  expect(await page.evaluate(() => bridgeCalls.filter(call => call.params?.teamWorker?.args?.op === 'launchSupervisor').length)).toBe(0);
});
test('structured supervisor keeps prompt acceptance separate from provider observation and opens its exact chat', async ({ page }) => {
  await page.goto('/?mode=structured'); const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click(); await createAndLaunch(ui);
  await expect(ui.locator('.team-card')).toContainText('structured');
  await expect(ui.locator('.team-card')).toContainText('Input: journaled · Observation: unknown');
  await ui.getByRole('button', { name: 'Open verified session' }).click();
  await expect(ui.getByText('Opened the verified native session.')).toBeVisible();
});

test('connection test verifies a nonce and sends only worker envelopes', async ({ page }) => {
  await page.goto('/'); const ui = panel(page);
  await expect(ui.getByRole('heading', { name: 'No team yet' })).toBeVisible();
  await expect(ui.locator('.notice')).toHaveCount(0);
  await expect(ui.getByRole('button', { name: 'Test connection' })).toHaveCount(0);
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Test connection' }).click();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  const calls = await page.evaluate(() => bridgeCalls);
  expect(calls.every(call => call.action === 'workspace.readContext' && call.params.teamWorker.protocol === 1)).toBe(true);
  expect(calls.filter(call => call.params.teamWorker.args.op === 'ping')).toHaveLength(2);
});

test('connection diagnostics separate panel, worker and adapter; retry uses the declared native command', async ({ page }) => {
  await page.goto('/');
  const ui = panel(page);
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  const connection = ui.getByRole('region', { name: 'Connection', exact: true });
  await connection.getByText('Technical details', { exact: true }).click();
  await expect(connection).toContainText('Panel loaded · worker activated · compatibility layer available');
  await expect(connection).toContainText('agent readiness not verified');
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  await ui.getByRole('button', { name: 'Test connection' }).click();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  await expect(connection).toContainText('Connected to Orca');
  expect(await page.evaluate(() => bridgeCalls.some(call => call.params?.teamWorker?.commandId === 'team.initialise'))).toBe(true);
});

test('unsupported build shows actionable diagnostics with worker active and launch disabled', async ({ page }) => {
  await page.goto('/?mode=unsupported-build');
  const ui = panel(page);
  await expect(ui.getByRole('alert')).toContainText('Plugin unavailable');
  await expect(ui.getByRole('navigation')).toHaveCount(0);
  await expect(ui.getByRole('heading', { name: 'No team yet' })).toHaveCount(0);
  await ui.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(ui.locator('#failure-details')).toContainText('Unsupported Orca build');
});
test('host model choices and individual mixed-provider preferences persist with effective model unknown', async ({ page }) => {
 await page.goto('/?mode=capabilities-local'); const ui = panel(page);
 await ui.getByRole('button', { name: /Squad/ }).click();
 await ui.getByRole('button', { name: 'Confirm project and host' }).click();
 await expect(ui.getByText('Capabilities verified for this project')).toBeVisible();
 await ui.getByRole('combobox', { name: 'Workers CLI' }).selectOption('claude');
 await ui.getByRole('combobox', { name: 'Workers model' }).fill('claude-model');
 await ui.getByRole('combobox', { name: 'Workers model' }).press('Tab');
 await ui.getByRole('combobox', { name: 'Workers effort' }).selectOption('max');
 await ui.getByRole('button', { name: 'Save team', exact: true }).click();
 await ui.getByRole('button', { name: 'Worker-1', exact: true }).click();
 await ui.getByRole('combobox', { name: 'Member agent' }).selectOption('codex');
 await ui.getByRole('combobox', { name: 'Member model' }).fill('my-model');
 await ui.getByRole('combobox', { name: 'Member model' }).press('Tab');
 await ui.getByRole('combobox', { name: 'Member effort' }).selectOption('ultra');
 await ui.getByRole('button', { name: 'Save preferences', exact: true }).click();
 await expect(ui.getByText('Requested preferences saved. Effective model remains unknown until Orca reports it.')).toBeVisible();
 await expect(ui.getByRole('region', { name: 'Member details' })).toContainText('Effective model: unknown');
 await page.reload();
 await ui.getByRole('button', { name: 'Worker-1', exact: true }).click();
 await expect(ui.getByRole('combobox', { name: 'Member model' })).toHaveValue('my-model');
 await ui.getByRole('button', { name: 'Use level default' }).click();
 await expect(ui.getByRole('combobox', { name: 'Member model' })).toHaveValue('claude-model');
});

test('all-at-start prepares four saved members and keeps independent successes after partial failure',async({page})=>{
 await page.goto('/?mode=roster-partial');const ui=panel(page);await ui.getByRole('button',{name:/Squad/}).click();
 await ui.getByRole('combobox',{name:'Preparation mode'}).selectOption('all');await createAndLaunch(ui);
 await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false',{timeout:45000});
 await expect(ui.getByRole('status').filter({hasText:'requested member sessions created'})).toContainText('3/4 requested member sessions created');
 await expect(ui.locator('.team-card')).toContainText('Worker-1 · unknown');await expect(ui.locator('.team-card')).toContainText('3 actual session receipt');
 expect(await page.evaluate(()=>bridgeCalls.filter(row=>row.params?.teamWorker?.args?.op==='launchSupervisor').length)).toBe(4);
 await page.reload();await expect(panel(page).locator('.team-card')).toContainText('3 actual session receipt');
});

test('repo-backed composite folder is presented and saved as a folder', async ({ page }) => {
  await page.goto('/?mode=composite-folder');
  const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await expect(ui.getByRole('heading', { name: 'Project and execution host' }).locator('..')).toContainText('folder');
  await saveTeam(ui);
  await expect(ui.locator('.team-card')).toContainText('folder');
  await page.reload();
  await expect(panel(page).locator('.team-card')).toContainText('folder');
});

test('successful launch removes an in-flight ledger warning from the panel and survives reload',async({page})=>{
 await page.goto('/?mode=launch-reconciled');const ui=panel(page);
 await ui.getByRole('button',{name:/Squad/}).click();await createAndLaunch(ui);
 await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');
 await ui.getByRole('button',{name:'Head',exact:true}).click();
 await expect(ui.getByRole('region',{name:'Member details'})).toContainText('Created');
 await expect(ui.locator('#app')).not.toContainText('Original native launch ledger row is absent');
 await page.reload();await panel(page).getByRole('button',{name:'Head',exact:true}).click();
 await expect(panel(page).getByRole('region',{name:'Member details'})).toContainText('Created');
 await expect(panel(page).locator('#app')).not.toContainText('Original native launch ledger row is absent');
});
