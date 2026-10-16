import {test,expect} from '@playwright/test';
test('corrected malformed intent remains visible as retained history, not an execution failure',async({page})=>{
 await page.goto('/?mode=dispatch-withdrawal');const ui=page.frameLocator('#panel');
 await ui.getByRole('button',{name:/Squad/}).click();await ui.getByRole('button',{name:'Confirm project and host'}).click();
 await ui.getByRole('button',{name:'Save team',exact:true}).click();await ui.getByRole('button',{name:'Launch this team'}).click();
 await expect(ui.locator('#app')).toHaveAttribute('aria-busy','false');
 await ui.getByLabel('Total objective').fill('Correct the task instructions');await ui.getByRole('button',{name:'Submit total objective'}).click();
 await expect(ui.getByText('Corrected task intents (1)')).toBeVisible();
 await ui.getByText('Corrected task intents (1)').click();
 await expect(ui.getByRole('region',{name:'Team tasks',exact:true})).toContainText('Original malformed-fixture → Replacement native-task-fixture-0');
 await expect(ui.getByRole('region',{name:'Team tasks',exact:true})).toContainText('These corrections are not execution failures');
 await page.reload();await expect(page.frameLocator('#panel').getByText('Corrected task intents (1)')).toBeVisible();
});
