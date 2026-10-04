import { expect, test } from '@playwright/test';

test('a predicted launch ends with a debrief and a notebook entry', async ({ page }) => {
  // The flight runs in real time; software rendering on CI can make it slow.
  test.setTimeout(300_000);
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole('dialog').getByRole('button', { name: /Rocket Lab/ }).click({ timeout: 60_000 });
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('radio', { name: 'Falls back' }).click();
  await page.getByRole('button', { name: 'Ignite' }).click();
  // Skip the countdown with Enter (its button relabels every second), then fly at 4×.
  await expect(page.getByRole('button', { name: /Activate to launch now/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Activate to launch now/ })).toBeHidden();
  await page.getByRole('radiogroup', { name: 'Simulation speed' }).getByRole('radio', { name: '4×', exact: true }).click();

  // The default single-stage rocket climbs and falls back.
  const report = page.getByRole('region', { name: 'Mission report' });
  await expect(report).toContainText('Suborbital flight', { timeout: 240_000 });
  await expect(report).toContainText(/You predicted “Falls back”: correct!/);
  const debrief = page.getByLabel('Flight debrief');
  await expect(debrief).toContainText('Try next');
  await expect(report).toContainText('Δv budget');

  await report.getByRole('button', { name: 'Notebook' }).click();
  await expect(page.getByRole('dialog')).toContainText('Fell back');
  await expect(page.getByRole('dialog')).toContainText('predicted Fell back ✓');
});
