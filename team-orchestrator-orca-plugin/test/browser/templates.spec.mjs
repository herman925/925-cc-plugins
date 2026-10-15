import { test, expect } from '@playwright/test';
const panel = page => page.frameLocator('#panel');
async function saveSquad(page) {
 await page.goto('/'); const ui = panel(page);
 await ui.getByRole('button', { name: /Squad/ }).click();
 await ui.getByRole('button', { name: 'Confirm project and host' }).click();
 await ui.getByRole('button', { name: 'Save team', exact: true }).click();
 await expect(ui.getByRole('heading', { name: '@Squad' })).toBeVisible();
}
test('exported template previews and imports into another profile; copy creates another independent team', async ({ page, browser }) => {
 await saveSquad(page); const ui = panel(page);
 await ui.getByRole('button', { name: 'Head', exact: true }).click();
 await ui.getByLabel('Role description').fill('Review independently'); await ui.getByRole('button', { name: 'Save role' }).click();
 await expect(ui.getByRole('region', { name: 'Member details' })).toContainText('Role version 2');
 await ui.getByRole('button', { name: 'Export template', exact: true }).click();
 const exported = await ui.getByLabel('Template JSON').inputValue();
 expect(JSON.parse(exported).format).toBe('orca-team-template'); expect(exported).not.toContain('workspaceKey');
 const context = await browser.newContext(); const other = await context.newPage();
 try {
   await other.goto(new URL('?mode=folder', page.url()).href); const target = panel(other);
   await target.getByRole('button', { name: 'Templates', exact: true }).click();
   await target.getByLabel('Template JSON').fill(exported);
   await target.getByRole('button', { name: 'Preview template', exact: true }).click();
   await expect(target.getByRole('region', { name: 'Template preview' })).toContainText('4 members');
   await expect(target.getByRole('button', { name: 'Import as new team' })).toBeDisabled();
   await target.getByRole('button', { name: 'Confirm project and host' }).click();
   await target.getByRole('button', { name: 'Import as new team' }).click();
   await expect(target.getByRole('heading', { name: '@Squad' })).toBeVisible();
   await expect(target.locator('.team-card')).toContainText('Demo folder');
   await target.getByRole('button', { name: 'Head', exact: true }).click();
   await expect(target.getByLabel('Role description')).toHaveValue('Review independently');
   await target.getByRole('button', { name: 'Copy team', exact: true }).click();
   await target.getByRole('button', { name: 'Confirm project and host' }).click();
   await target.getByRole('button', { name: 'Import as new team' }).click();
   await expect(target.getByRole('heading', { name: '@Squad', exact: true })).toHaveCount(2);
   expect(await other.evaluate(() => bridgeCalls.filter(call => call.params?.teamWorker?.args?.op === 'start').length)).toBe(0);
 } finally { await context.close(); }
});
test('invalid templates and failed imports remain reviewable and leave the saved team untouched', async ({ page }) => {
 await saveSquad(page); const ui = panel(page);
 await ui.getByRole('button', { name: 'Export template', exact: true }).click();
 const template = JSON.parse(await ui.getByLabel('Template JSON').inputValue());
 await ui.getByLabel('Template JSON').fill(JSON.stringify({ ...template, version: 99 }));
 await ui.getByRole('button', { name: 'Preview template', exact: true }).click();
 await expect(ui.getByRole('alert')).toContainText('Unsupported team template');
 await expect(ui.getByRole('button', { name: 'Import as new team' })).toHaveCount(0);
 const bad = structuredClone(template); bad.team.members[1].boss = 'missing';
 await ui.getByLabel('Template JSON').fill(JSON.stringify(bad)); await ui.getByRole('button', { name: 'Preview template', exact: true }).click();
 await expect(ui.getByRole('alert')).toContainText('reporting relationship');
 await page.goto('/?mode=write-error'); const failure = panel(page);
 await failure.getByRole('button', { name: 'Copy team', exact: true }).click();
 await failure.getByRole('button', { name: 'Confirm project and host' }).click();
 await failure.getByRole('button', { name: 'Import as new team' }).click();
 await expect(failure.getByRole('alert')).toContainText('Disk full');
 await expect(failure.getByRole('region', { name: 'Template preview' })).toContainText('4 members');
 await failure.getByRole('button', { name: 'Roster', exact: true }).click();
 await expect(failure.getByRole('heading', { name: '@Squad', exact: true })).toHaveCount(1);
 expect(await page.evaluate(() => bridgeCalls.filter(call => call.params?.teamWorker?.args?.op === 'start').length)).toBe(0);
});
