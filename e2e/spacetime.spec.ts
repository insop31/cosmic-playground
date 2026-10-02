import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('the gravity sandbox loads with a running solar system', async ({ page }) => {
  await expect(page.getByText('Bodies:')).toContainText('3');
  await expect(page.getByText('Mission Progress')).toBeVisible();
  // Simulated time advances.
  const elapsed = page.getByText(/Time elapsed/);
  const first = await elapsed.textContent();
  await expect.poll(async () => elapsed.textContent(), { timeout: 20_000 }).not.toBe(first);
});

test('keyboard shortcuts pause, reset and switch labs', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  // Clear the system, then R restores the default one.
  await page.getByRole('button', { name: /Clear all|Remove all/i }).click();
  await expect(page.getByText('Bodies:')).toContainText('0');
  await page.keyboard.press('r');
  await expect(page.getByText('Bodies:')).toContainText('3');

  // Tab switches labs while the 3D view has focus.
  await page.getByLabel('Spacetime 3D view').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByText('Rocket Simulator')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByText('Gravity Sandbox')).toBeVisible();
});

test('a teacher pack loads its lesson setup', async ({ page }) => {
  await page.locator('select').filter({ hasText: 'Core Lab' }).selectOption({ label: "Lesson: Kepler's Laws" });
  await expect(page.getByLabel('Teacher notes')).toContainText('T² ÷ a³');
  await page.getByRole('button', { name: 'Load lesson setup' }).click();
  await expect(page.getByText('Bodies:')).toContainText('5');
  await expect(page.getByText("Kepler's Check")).toBeVisible();
});

test('display settings switch contrast and quality', async ({ page }) => {
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByLabel('High contrast').check();
  await expect(page.locator('html')).toHaveClass(/high-contrast/);
  await page.getByRole('button', { name: 'Low', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/high-contrast/);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await expect(page.getByRole('button', { name: 'Low', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('importing a file that is not an export explains the problem', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'something-else', version: 1 })),
  });
  await expect(page.getByText('This is not a Cosmic Playground export file.')).toBeVisible();
});
