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
