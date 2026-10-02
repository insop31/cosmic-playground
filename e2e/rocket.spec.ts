import { expect, test } from '@playwright/test';

test('a predicted launch ends with a debrief and a notebook entry', async ({ page }) => {
  // The flight runs in real time; software rendering on CI can make it slow.
  test.setTimeout(300_000);
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Rocket', exact: true }).click();
  await expect(page.getByText('LAUNCH CONTROL')).toBeVisible();

  await page.getByRole('radio', { name: 'Falls back' }).click();
  await page.getByRole('button', { name: '4x' }).click();
  await page.getByRole('button', { name: /IGNITE/ }).click();

  // The default single-stage rocket climbs and falls back.
  await expect(page.getByText('SUBORBITAL TRAJECTORY')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText(/You predicted “Falls back”: correct!/)).toBeVisible();
  const debrief = page.getByLabel('Flight debrief');
  await expect(debrief).toContainText('Try next');
  await expect(debrief).toContainText('Δv budget');

  await page.getByRole('button', { name: /Notebook \(1\)/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Fell back');
  await expect(page.getByRole('dialog')).toContainText('predicted Fell back ✓');
});
