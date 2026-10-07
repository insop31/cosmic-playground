import { expect, test, type Page } from '@playwright/test';

const bodiesInScene = (page: Page) => page.getByText(/^In the scene · \d+$/);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  // The intro offers both labs once the engine is up.
  await page.getByRole('dialog').getByRole('button', { name: /Spacetime Lab/ }).click({ timeout: 60_000 });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('the gravity sandbox loads with a running solar system', async ({ page }) => {
  await expect(bodiesInScene(page)).toHaveText('In the scene · 3');
  await expect(page.getByRole('region', { name: 'Objectives' })).toBeVisible();
  // The frame-rate readout in the top bar fills in with a live number.
  await expect(page.getByLabel('Frames per second')).toHaveText(/^\d+$/);
  // Simulated time advances.
  const elapsed = page.getByText('Time elapsed').locator('..');
  const first = await elapsed.textContent();
  await expect.poll(async () => elapsed.textContent(), { timeout: 20_000 }).not.toBe(first);
});

test('selecting a body shows its orbit in real units', async ({ page }) => {
  await page.getByTitle('Show details and follow').filter({ hasText: 'Earth' }).click();
  const inspector = page.getByRole('region', { name: 'Earth details' });
  await expect(inspector).toContainText('Bound');
  await expect(inspector).toContainText('AU');
  await expect(inspector).toContainText('Kepler: T² ÷ a³');
});

test('keyboard shortcuts pause, reset and switch labs', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Resume (Space)' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause (Space)' })).toBeVisible();

  // Clear the system (the button asks twice within 3 s, so use the keyboard: software
  // rendering on CI makes pointer clicks slow), then R restores the default one.
  await page.getByRole('button', { name: 'Clear all' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Click again to clear' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('The grid is empty.')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('r');
  await expect(bodiesInScene(page)).toHaveText('In the scene · 3');

  // Tab switches labs while nothing is focused.
  const rocketTab = page.getByRole('tab', { name: /Rocket Lab/ });
  await page.keyboard.press('Tab');
  await expect(rocketTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tab', { name: /Spacetime Lab/ })).toHaveAttribute('aria-selected', 'true');
});

test('a teacher pack loads its lesson setup', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Spacetime Lab course' }).click();
  await page.getByRole('option', { name: /Lesson: Kepler's Laws/ }).click();
  await expect(page.getByLabel('Teacher notes')).toContainText('T² ÷ a³');
  await page.getByRole('button', { name: 'Load lesson setup' }).click();
  await expect(bodiesInScene(page)).toHaveText('In the scene · 5');
  await expect(page.getByText("Kepler's Check")).toBeVisible();
});

test('display settings switch contrast, motion and quality', async ({ page }) => {
  await page.getByRole('button', { name: 'Help and settings (?)' }).click();
  await page.getByRole('switch', { name: 'High contrast' }).click();
  await expect(page.locator('html')).toHaveClass(/high-contrast/);
  await page.getByRole('radiogroup', { name: 'Motion' }).getByRole('radio', { name: 'Reduced' }).click();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await page.getByRole('radiogroup', { name: 'Graphics quality' }).getByRole('radio', { name: 'Low' }).click();

  // Preferences survive a reload (the intro is not shown again).
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/high-contrast/);
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await page.getByRole('button', { name: 'Help and settings (?)' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Graphics quality' }).getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true');
});

test('importing a file that is not an export explains the problem', async ({ page }) => {
  await page.getByRole('radiogroup', { name: 'Lab sections' }).getByRole('radio', { name: /Saved/ }).click();
  await page.getByLabel('Import file').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'something-else', version: 1 })),
  });
  await expect(page.getByText('This is not a Cosmic Playground export file.')).toBeVisible();
});
