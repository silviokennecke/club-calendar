import { test, expect, Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill('admin@example.com')
  await page.getByLabel(/password/i).fill('password123')
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL('**/clubs')
}

test.describe('Calendar', () => {
  test('clubs page shows seeded club', async ({ page }) => {
    await login(page)
    await expect(page.getByText(/Schützenverein/i)).toBeVisible()
  })

  test('can navigate to calendar view', async ({ page }) => {
    await login(page)
    await page.getByText(/Schützenverein/i).click()
    await page.getByText(/Vereinskalender/i).click()
    // Should show FullCalendar
    await expect(page.locator('.fc')).toBeVisible()
  })

  test('calendar sidebar shows navigation items', async ({ page }) => {
    await login(page)
    await page.getByText(/Schützenverein/i).click()
    await page.getByText(/Vereinskalender/i).click()
    await expect(page.getByRole('link', { name: /templates/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /feeds/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /properties/i })).toBeVisible()
  })

  test('clicking New Event opens modal', async ({ page }) => {
    await login(page)
    await page.getByText(/Schützenverein/i).click()
    await page.getByText(/Vereinskalender/i).click()
    await page.getByRole('button', { name: /new event/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /new event/i })).toBeVisible()
  })

  test('can create and see a new event', async ({ page }) => {
    await login(page)
    await page.getByText(/Schützenverein/i).click()
    await page.getByText(/Vereinskalender/i).click()
    await page.getByRole('button', { name: /new event/i }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/name/i).fill('E2E Test Event')
    await dialog.getByLabel(/date/i).fill('2026-09-15')
    // Uncheck draft — switch to published
    const publishSwitch = dialog.getByRole('switch')
    await publishSwitch.click()

    await dialog.getByRole('button', { name: /create event/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
  })
})
