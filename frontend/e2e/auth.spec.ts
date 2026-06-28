import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("login page is accessible", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/club calendar/i).first()).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("login with wrong credentials shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("wrong@example.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test("login with correct credentials redirects to clubs", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("admin@example.com");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL("**/clubs");
    await expect(page.getByText(/my clubs/i)).toBeVisible();
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/clubs");
    await page.waitForURL("**/login");
    await expect(page).toHaveURL(/\/login/);
  });
});
