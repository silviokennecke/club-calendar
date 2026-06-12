# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Authentication >> login with correct credentials redirects to clubs
- Location: e2e/auth.spec.ts:19:7

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
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Authentication', () => {
  4  |   test('login page is accessible', async ({ page }) => {
  5  |     await page.goto('/login')
  6  |     await expect(page.getByText(/club calendar/i).first()).toBeVisible()
  7  |     await expect(page.getByLabel(/email/i)).toBeVisible()
  8  |     await expect(page.getByLabel(/password/i)).toBeVisible()
  9  |   })
  10 | 
  11 |   test('login with wrong credentials shows error', async ({ page }) => {
  12 |     await page.goto('/login')
  13 |     await page.getByLabel(/email/i).fill('wrong@example.com')
  14 |     await page.getByLabel(/password/i).fill('wrongpassword')
  15 |     await page.getByRole('button', { name: /log in/i }).click()
  16 |     await expect(page.getByText(/invalid email or password/i)).toBeVisible()
  17 |   })
  18 | 
  19 |   test('login with correct credentials redirects to clubs', async ({ page }) => {
  20 |     await page.goto('/login')
  21 |     await page.getByLabel(/email/i).fill('admin@example.com')
  22 |     await page.getByLabel(/password/i).fill('password123')
> 23 |     await page.getByRole('button', { name: /log in/i }).click()
     |                                                         ^ Error: locator.click: Test timeout of 30000ms exceeded.
  24 |     await page.waitForURL('**/clubs')
  25 |     await expect(page.getByText(/my clubs/i)).toBeVisible()
  26 |   })
  27 | 
  28 |   test('unauthenticated user is redirected to login', async ({ page }) => {
  29 |     await page.goto('/clubs')
  30 |     await page.waitForURL('**/login')
  31 |     await expect(page).toHaveURL(/\/login/)
  32 |   })
  33 | })
  34 | 
```