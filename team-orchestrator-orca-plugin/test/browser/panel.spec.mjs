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
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false', { timeout: 25000 });
  await expect(ui.getByRole('heading', { name: '@QA' })).toBeVisible();
  await ui.getByRole('button', { name: 'Lead-1-1', exact: true }).click();
  await expect(ui.getByRole('region', { name: 'Member details' })).toContainText('Head');
  await expect(ui.getByRole('region', { name: 'Member details' })).toContainText('On demand');
  await page.reload();
  await expect(panel(page).getByRole('heading', { name: '@QA' })).toBeVisible();
  expect(await page.locator('#panel').getAttribute('sandbox')).toBe('allow-scripts');
  const sends = await page.evaluate(() => bridgeCalls.filter(call => call.action === 'terminal.sendText'));
  expect(sends).toHaveLength(0); // Reload resets the test host's call log; the persisted request remains accepted.
  await expect(panel(page).locator('.team-card')).toContainText('actual tab receipt');
  expect(errors).toEqual([]);
});
test('CEO flow, per-level choices, independent same-name teams and settings persistence', async ({ page }) => {
  await page.goto('/');
  const ui = panel(page);
  await ui.getByRole('button', { name: /All-Purpose Team/ }).click();
  await expect(ui.locator('#preview')).toContainText('11 members');
  await ui.locator('#team-name').fill('Organisation');
  await ui.locator('#team-groups').fill('Dev, QA');
  await ui.getByRole('combobox', { name: 'CEO model' }).fill('my-model');
  await ui.getByRole('combobox', { name: 'CEO model' }).press('Tab');
  await ui.getByRole('combobox', { name: 'CEO effort' }).selectOption('high');
  await ui.getByRole('combobox', { name: 'Heads CLI' }).selectOption('claude');
  await ui.locator('[data-launch-mode]').selectOption('all');
  await createAndLaunch(ui);
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false', { timeout: 25000 });
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
  await expect(ui.getByRole('status').filter({ hasText: 'Session-only' })).toContainText('Session-only');
  await ui.getByRole('button', { name: /Squad/ }).click();
  await expect(ui.getByRole('button', { name: 'Save team', exact: true })).toBeDisabled();
  await expect(ui.getByRole('alert').first()).toContainText('connection');
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
  await expect(ui.getByRole('alert')).toContainText('Original data has been preserved');
  await ui.getByRole('button', { name: 'New team', exact: true }).click();
  await expect(ui.getByRole('button', { name: 'Save team', exact: true })).toBeDisabled();
});
for (const width of [320, 960]) {
  test(`organisation chart stays inside a ${width}px panel`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const ui = panel(page);
    await ui.getByRole('button', { name: /Tech Team/ }).click();
      await createAndLaunch(ui);
    await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false', { timeout: 25000 });
  await expect(ui.getByRole('heading', { name: '@Tech-Team' })).toBeVisible();
    const frame = page.frames().find(frame => frame.url() === 'about:srcdoc');
    expect(await frame.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(ui.locator('.org-chart .org-node')).toHaveCount(21);
  });
}
test('all-at-create opens four named Codex tabs without selecting or messaging a coordinator', async ({ page }) => {
  await page.goto('/'); const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await expect(ui.getByRole('combobox', { name: 'Coordinator agent tab' })).toHaveCount(0);
  await ui.locator('[data-launch-mode]').selectOption('all');
  await createAndLaunch(ui);
  await expect(ui.getByRole('status').filter({ hasText: 'Orca created' })).toContainText('Orca created 4 tab(s)', { timeout: 25000 });
  const calls = await page.evaluate(() => bridgeCalls.filter(call => call.params?.teamWorker?.args?.op === 'start').map(call => ({ action: 'terminal.createAgent', params: call.params.teamWorker.args.params })));
  expect(calls).toHaveLength(4);
  expect(calls.every(call => call.action === 'terminal.createAgent')).toBe(true);
  expect(calls.map(call => call.params.title)).toEqual(['Squad/Head', 'Squad/Worker-1', 'Squad/Worker-2', 'Squad/Worker-3']);
  expect(calls.every(call => call.params.agent === 'codex')).toBe(true);
  await expect(ui.locator('.team-card')).toContainText('4 actual tab receipts');
  await expect(ui.getByRole('button', { name: 'Launch this team' })).toHaveCount(0);
});
test('native launch requires no pre-existing agent tabs', async ({ page }) => {
  await page.goto('/?mode=no-tabs'); const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await createAndLaunch(ui);
  await expect(ui.getByRole('status').filter({ hasText: 'Orca created' })).toContainText('Orca created 1 tab(s)', { timeout: 25000 });
});
test('partial launch preserves the head handle and stops the remaining workers', async ({ page }) => {
  await page.goto('/?mode=partial'); const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await ui.locator('[data-launch-mode]').selectOption('all');
  await createAndLaunch(ui);
  await expect(ui.getByRole('alert')).toContainText('no automatic retry', { timeout: 25000 });
  await expect(ui.locator('.team-card')).toContainText('created-member-1');
  expect(await page.evaluate(() => bridgeCalls.filter(call => call.params?.teamWorker?.args?.op === 'start').length)).toBe(2);
  await page.reload();
  await expect(panel(page).locator('.team-card')).toContainText('created-member-1');
  await expect(panel(page).getByRole('button', { name: 'Launch this team' })).toHaveCount(0);
});

test('connection test verifies a nonce and sends only worker envelopes', async ({ page }) => {
  await page.goto('/'); const ui = panel(page);
  await expect(ui.getByRole('status').filter({ hasText: 'compatibility layer available' })).toBeVisible();
  await ui.getByRole('button', { name: 'Test connection' }).click();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  const calls = await page.evaluate(() => bridgeCalls);
  expect(calls.every(call => call.action === 'workspace.readContext' && call.params.teamWorker.protocol === 1)).toBe(true);
  expect(calls.filter(call => call.params.teamWorker.args.op === 'ping')).toHaveLength(2);
});

test('connection diagnostics separate panel, worker and adapter; retry uses the declared native command', async ({ page }) => {
  await page.goto('/');
  const ui = panel(page);
  await expect(ui.getByRole('status').first()).toContainText('Panel loaded · worker activated · compatibility layer available');
  await expect(ui.getByRole('status').first()).toContainText('agent readiness not verified');
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  await ui.getByRole('button', { name: 'Test connection' }).click();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  await expect(ui.getByRole('status').first()).toContainText('compatibility layer available');
  expect(await page.evaluate(() => bridgeCalls.some(call => call.params?.teamWorker?.commandId === 'team.initialise'))).toBe(true);
});

test('unsupported build shows actionable diagnostics with worker active and launch disabled', async ({ page }) => {
  await page.goto('/?mode=unsupported-build');
  const ui = panel(page);
  await expect(ui.getByRole('status').first()).toContainText('worker activated · compatibility layer unavailable');
  await expect(ui.getByRole('alert').first()).toContainText('Unsupported Orca build');
  await ui.getByRole('button', { name: /Squad/ }).click();
  await expect(ui.getByRole('button', { name: 'Save team', exact: true })).toBeDisabled();
});
