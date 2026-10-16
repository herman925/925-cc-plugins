import { test, expect } from '@playwright/test';
async function ready(page, mode) {
  page.on('response', async (response) => {
    if (response.url().endsWith('/rpc')) {
      const result = await response.json();
      if (result.ok === false) console.log('Fixture refusal:', result.error);
    }
  });
  await page.goto('/?mode=' + mode);
  const ui = page.frameLocator('#panel');
  await ui.getByRole('button', { name: /Squad/ }).click();
  await ui.getByLabel('Preparation mode').selectOption('all');
  await ui.getByRole('button', { name: 'Confirm project and host' }).click();
  await ui.getByRole('button', { name: 'Save team', exact: true }).click();
  await ui.getByRole('button', { name: 'Launch this team' }).click();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false', { timeout: 50000 });
  await ui
    .getByLabel('Total objective', { exact: true })
    .fill('Wait for the operator after desktop restart.');
  await ui.getByRole('button', { name: 'Submit total objective' }).click();
  await expect(ui.getByRole('region', { name: 'TeamWork' })).toContainText('Run: verified');
  await ui.getByRole('button', { name: 'Check work evidence' }).click();
  await expect(ui.getByRole('region', { name: 'TeamWork' })).toContainText('Run: unverified');
  return ui;
}
test('explicit existing-session reconnect restores the original work without a new objective or launch', async ({
  page,
}) => {
  const ui = await ready(page, 'runtime-reconnect'),
    before = await ui.getByText(/^Native Run:/).textContent();
  await ui.getByRole('button', { name: 'Reconnect existing team', exact: true }).click();
  await expect(ui.getByRole('region', { name: 'TeamWork' })).toContainText('Run: verified');
  await expect(ui.getByText(/^Native Run:/)).toHaveText(before);
  await expect(ui.getByRole('region', { name: 'TeamWork' })).toContainText(
    'Existing sessions reconnected',
  );
  await page.reload();
  await expect(page.frameLocator('#panel').getByRole('region', { name: 'TeamWork' })).toContainText(
    'Existing sessions reconnected',
  );
  const calls = await page.evaluate(() =>
    window.bridgeCalls.map((c) => c.params?.teamWorker?.args?.op),
  );
  expect(
    calls.filter((op) =>
      ['submitWork', 'launchSupervisor', 'retryObjective', 'reconnectWork'].includes(op),
    ),
  ).toHaveLength(0);
});
test('busy agent keeps reconnect unresolved and preserves the saved goal', async ({ page }) => {
  const ui = await ready(page, 'runtime-reconnect-busy');
  await ui.getByRole('button', { name: 'Reconnect existing team', exact: true }).click();
  await expect(ui.getByRole('alert').filter({ hasText: 'verified idle status' })).toBeVisible();
  await expect(ui.getByRole('region', { name: 'TeamWork' })).toContainText('Run: unverified');
  await expect(ui.getByRole('button', { name: 'Retry unsent objective' })).toHaveCount(0);
});
