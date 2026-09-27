import { test, expect } from '@playwright/test';

test('live workspace saves a shared project and its context across reloads', async ({ page }) => {
  const title = `真实项目-${crypto.randomUUID().slice(0, 8)}`;
  const openManager = async () => {
    if (await page.locator('#menu-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#menu-toggle').click();
    await page.locator('#manage-projects').click();
  };
  await page.goto('/live-index.html');
  await expect(page.locator('#auth-gate')).toBeHidden();
  await expect(page.getByText('秋季新品发布')).toHaveCount(0);
  await openManager();
  await page.locator('#add-project').click();
  await page.locator('#project-name').fill(title);
  await page.locator('#project-form').evaluate(form => form.requestSubmit());
  await expect(page.locator('#project-title')).toHaveText(title);
  await openManager();
  await page.getByRole('button', { name: '上下文' }).last().click();
  await page.locator('#context-content').fill('项目目标：真实团队进度查询。');
  await page.locator('#context-form').evaluate(form => form.requestSubmit());
  await page.locator('#close-projects').click();
  await page.reload();
  await page.locator('#menu-toggle').click();
  await page.locator('#project-list').getByRole('button', { name: title }).click();
  await expect(page.locator('#project-title')).toHaveText(title);
  await openManager();
  await page.locator('#managed-projects').locator('.managed-project').filter({ hasText: title }).getByRole('button', { name: '上下文' }).click();
  await expect(page.locator('#context-content')).toHaveValue('项目目标：真实团队进度查询。');
  await page.locator('#close-context').click();
  await openManager();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#managed-projects').locator('.managed-project').filter({ hasText: title }).getByRole('button', { name: '删除' }).click();
  await expect(page.locator('#managed-projects')).not.toContainText(title);
});
