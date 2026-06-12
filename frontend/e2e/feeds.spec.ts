import { test, expect, Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill('admin@example.com')
  await page.getByLabel(/password/i).fill('password123')
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL('**/clubs')
}

async function goToFeeds(page: Page) {
  await login(page)
  await page.getByText(/Schützenverein/i).click()
  await page.getByText(/Vereinskalender/i).click()
  await page.getByRole('link', { name: /feeds/i }).click()
  await page.waitForURL('**/settings/feeds')
}

test.describe('Feeds', () => {
  test('feeds page shows existing feeds', async ({ page }) => {
    await goToFeeds(page)
    await expect(page.getByText(/Öffentlicher Kalender/i)).toBeVisible()
  })

  test('public feed shows ICS URL', async ({ page }) => {
    await goToFeeds(page)
    // ICS URL should contain the backend URL
    await expect(page.getByText(/localhost:3001\/api\/feed/)).toBeVisible()
  })

  test('private feed shows shared secret toggle', async ({ page }) => {
    await goToFeeds(page)
    // Secret should be masked by default
    await expect(page.getByText('••••••••••••••••••••••••••••••••••••')).toBeVisible()
  })

  test('ICS URL from public feed returns valid calendar', async ({ page, request }) => {
    await goToFeeds(page)
    // Get the ICS URL from the page
    const codeEl = page.locator('code').first()
    const icsUrl = await codeEl.textContent()
    if (icsUrl && icsUrl.includes('/api/feed/')) {
      const response = await request.get(icsUrl)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('text/calendar')
    }
  })
})
