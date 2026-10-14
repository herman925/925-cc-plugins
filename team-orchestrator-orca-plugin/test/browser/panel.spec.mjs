import { test, expect } from '@playwright/test';
const panel = page => page.frameLocator('#panel');
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
  await ui.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(ui.getByRole('heading', { name: '@QA' })).toBeVisible();
  await ui.getByRole('button', { name: 'Lead-1-1', exact: true }).click();
  await expect(ui.getByRole('region', { name: 'Member details' })).toContainText('Head');
  await expect(ui.getByRole('region', { name: 'Member details' })).toContainText('Unassigned');
  await page.reload();
  await expect(panel(page).getByRole('heading', { name: '@QA' })).toBeVisible();
  expect(await page.locator('#panel').getAttribute('sandbox')).toBe('allow-scripts');
  expect(await page.evaluate(() => bridgeCalls.every(call => call.action.startsWith('storage.')))).toBe(true);
  expect(errors).toEqual([]);
});
test('CEO flow, per-level choices, duplicate prevention and settings persistence', async ({ page }) => {
  await page.goto('/');
  const ui = panel(page);
  await ui.getByRole('button', { name: /All-Purpose Team/ }).click();
  await expect(ui.locator('#preview')).toContainText('11 members');
  await ui.locator('#team-name').fill('Organisation');
  await ui.locator('#team-groups').fill('Dev, QA');
  await ui.getByRole('combobox', { name: 'CEO model' }).fill('my-model');
  await ui.getByRole('combobox', { name: 'CEO model' }).press('Tab');
  await ui.getByRole('combobox', { name: 'CEO effort' }).selectOption('high');
  await ui.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(ui.getByRole('heading', { name: '@Organisation' })).toBeVisible();
  await ui.getByRole('button', { name: 'New team', exact: true }).click();
  await ui.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(ui.getByRole('alert')).toContainText('already exists');
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('checkbox', { name: 'Show organisation tree' }).uncheck();
  await page.reload();
  await expect(panel(page).locator('.org-tree')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel(page).getByRole('checkbox', { name: 'Show organisation tree' })).not.toBeChecked();
});
test('unpatched Orca remains honest about session-only creation', async ({ page }) => {
  await page.goto('/?mode=unpatched');
  const ui = panel(page);
  await expect(ui.getByRole('status')).toContainText('Session-only');
  await ui.getByRole('button', { name: /Squad/ }).click();
  await ui.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(ui.getByRole('heading', { name: '@Squad' })).toBeVisible();
  await page.reload();
  await expect(panel(page).getByRole('heading', { name: 'No team yet' })).toBeVisible();
});
test('save failure retains existing data and stays on the form', async ({ page }) => {
  await page.goto('/?mode=write-error');
  const ui = panel(page);
  await ui.getByRole('button', { name: /Squad/ }).click();
  await ui.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(ui.getByRole('alert')).toContainText('Disk full');
  await expect(ui.getByRole('heading', { name: 'New team' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('team-definitions-v1'))).toBe(null);
});
test('invalid stored data is preserved and blocks writes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('team-definitions-v1', '{"version":9,"teams":[]}'));
  await page.reload();
  const ui = panel(page);
  await expect(ui.getByRole('alert')).toContainText('unsupported format');
  await ui.getByRole('button', { name: 'New team', exact: true }).click();
  await expect(ui.getByRole('button', { name: 'Create team', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('team-definitions-v1'))).toBe('{"version":9,"teams":[]}');
});
for (const width of [320, 960]) {
  test(`organisation chart stays inside a ${width}px panel`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const ui = panel(page);
    await ui.getByRole('button', { name: /Tech Team/ }).click();
    await ui.getByRole('button', { name: 'Create team', exact: true }).click();
    await expect(ui.getByRole('heading', { name: '@Tech-Team' })).toBeVisible();
    const frame = page.frames().find(frame => frame.url() === 'about:srcdoc');
    expect(await frame.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(ui.locator('.org-chart .org-node')).toHaveCount(21);
  });
}
