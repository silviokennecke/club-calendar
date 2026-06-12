# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar.spec.ts >> Calendar >> clicking New Event opens modal
- Location: e2e/calendar.spec.ts:34:7

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
  11 | test.describe('Calendar', () => {
  12 |   test('clubs page shows seeded club', async ({ page }) => {
  13 |     await login(page)
  14 |     await expect(page.getByText(/Schützenverein/i)).toBeVisible()
  15 |   })
  16 | 
  17 |   test('can navigate to calendar view', async ({ page }) => {
  18 |     await login(page)
  19 |     await page.getByText(/Schützenverein/i).click()
  20 |     await page.getByText(/Vereinskalender/i).click()
  21 |     // Should show FullCalendar
  22 |     await expect(page.locator('.fc')).toBeVisible()
  23 |   })
  24 | 
  25 |   test('calendar sidebar shows navigation items', async ({ page }) => {
  26 |     await login(page)
  27 |     await page.getByText(/Schützenverein/i).click()
  28 |     await page.getByText(/Vereinskalender/i).click()
  29 |     await expect(page.getByRole('link', { name: /templates/i })).toBeVisible()
  30 |     await expect(page.getByRole('link', { name: /feeds/i })).toBeVisible()
  31 |     await expect(page.getByRole('link', { name: /properties/i })).toBeVisible()
  32 |   })
  33 | 
  34 |   test('clicking New Event opens modal', async ({ page }) => {
  35 |     await login(page)
  36 |     await page.getByText(/Schützenverein/i).click()
  37 |     await page.getByText(/Vereinskalender/i).click()
  38 |     await page.getByRole('button', { name: /new event/i }).click()
  39 |     await expect(page.getByRole('dialog')).toBeVisible()
  40 |     await expect(page.getByRole('heading', { name: /new event/i })).toBeVisible()
  41 |   })
  42 | 
  43 |   test('can create and see a new event', async ({ page }) => {
  44 |     await login(page)
  45 |     await page.getByText(/Schützenverein/i).click()
  46 |     await page.getByText(/Vereinskalender/i).click()
  47 |     await page.getByRole('button', { name: /new event/i }).click()
  48 | 
  49 |     const dialog = page.getByRole('dialog')
  50 |     await dialog.getByLabel(/name/i).fill('E2E Test Event')
  51 |     await dialog.getByLabel(/date/i).fill('2026-09-15')
  52 |     // Uncheck draft — switch to published
  53 |     const publishSwitch = dialog.getByRole('switch')
  54 |     await publishSwitch.click()
  55 | 
  56 |     // Button label is "Create" in the new modal
  57 |     await dialog.getByRole('button', { name: /^create$/i }).click()
  58 |     await expect(dialog).not.toBeVisible({ timeout: 8000 })
  59 |   })
  60 | })
  61 | 
```