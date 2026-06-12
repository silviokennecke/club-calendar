# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: feeds.spec.ts >> Feeds >> ICS URL from public feed returns valid calendar
- Location: e2e/feeds.spec.ts:37:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /log in/i })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]: 📅
        - generic [ref=e7]: Club Calendar
      - generic [ref=e8]: Sign in
    - generic [ref=e9]:
      - generic [ref=e10]:
        - generic [ref=e11]:
          - generic [ref=e12]: Email
          - textbox "Email" [ref=e13]: admin@example.com
        - generic [ref=e14]:
          - generic [ref=e15]: Password
          - textbox "Password" [active] [ref=e16]: password123
        - button "Sign in" [ref=e17]
      - button "🔑 Sign in with passkey" [ref=e18]
    - paragraph [ref=e20]:
      - text: No account?
      - link "Sign up" [ref=e21] [cursor=pointer]:
        - /url: /signup
  - button "Open Next.js Dev Tools" [ref=e27] [cursor=pointer]:
    - img [ref=e28]
  - alert [ref=e31]
```

# Test source

```ts
  1  | import { test, expect, Page } from '@playwright/test'
  2  | 
  3  | async function login(page: Page) {
  4  |   await page.goto('/login')
  5  |   await page.getByLabel(/email/i).fill('admin@example.com')
  6  |   await page.getByLabel(/password/i).fill('password123')
> 7  |   await page.getByRole('button', { name: /log in/i }).click()
     |                                                       ^ Error: locator.click: Test timeout of 30000ms exceeded.
  8  |   await page.waitForURL('**/clubs')
  9  | }
  10 | 
  11 | async function goToFeeds(page: Page) {
  12 |   await login(page)
  13 |   await page.getByText(/Schützenverein/i).click()
  14 |   await page.getByText(/Vereinskalender/i).click()
  15 |   await page.getByRole('link', { name: /feeds/i }).click()
  16 |   await page.waitForURL('**/settings/feeds')
  17 | }
  18 | 
  19 | test.describe('Feeds', () => {
  20 |   test('feeds page shows existing feeds', async ({ page }) => {
  21 |     await goToFeeds(page)
  22 |     await expect(page.getByText(/Öffentlicher Kalender/i)).toBeVisible()
  23 |   })
  24 | 
  25 |   test('public feed shows ICS URL', async ({ page }) => {
  26 |     await goToFeeds(page)
  27 |     // ICS URL should contain the backend URL
  28 |     await expect(page.getByText(/localhost:3001\/api\/feed/).first()).toBeVisible()
  29 |   })
  30 | 
  31 |   test('private feed shows shared secret toggle', async ({ page }) => {
  32 |     await goToFeeds(page)
  33 |     // Secret should be masked by default
  34 |     await expect(page.getByText('••••••••••••••••••••••••••••••••••••')).toBeVisible()
  35 |   })
  36 | 
  37 |   test('ICS URL from public feed returns valid calendar', async ({ page, request }) => {
  38 |     await goToFeeds(page)
  39 |     // Get the ICS URL from the page
  40 |     const codeEl = page.locator('code').first()
  41 |     const icsUrl = await codeEl.textContent()
  42 |     if (icsUrl && icsUrl.includes('/api/feed/')) {
  43 |       const response = await request.get(icsUrl)
  44 |       expect(response.status()).toBe(200)
  45 |       expect(response.headers()['content-type']).toContain('text/calendar')
  46 |     }
  47 |   })
  48 | })
  49 | 
```