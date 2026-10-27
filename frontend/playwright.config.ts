import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Refuses to run against anything but a local, isolated environment (see e2e/safety.ts).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  expect: {
    toHaveScreenshot: { pathTemplate: "{testDir}/../docs/screenshots/{projectName}/{arg}{ext}" },
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [
    // Docs screenshots are not tests: only run on demand (`npm run docs:screenshots`).
    { name: "chromium", testIgnore: "docs/**", use: { ...devices["Desktop Chrome"] } },
    ...(process.env.DOCS_SCREENSHOTS
      ? [
          // One project per language (project name = screenshot folder): --lang makes native date/time inputs follow the locale.
          ...(["de-DE", "en-US"] as const).map((lang) => ({
            name: lang.slice(0, 2),
            testMatch: "docs/*.docs.ts",
            grep: new RegExp(`\\(${lang.slice(0, 2)}\\)`),
            use: {
              ...devices["Desktop Chrome"],
              deviceScaleFactor: 1,
              launchOptions: {
                args: [
                  `--lang=${lang}`,
                  "--disable-gpu",
                  "--disable-lcd-text",
                  "--font-render-hinting=none",
                  "--force-color-profile=srgb",
                ],
              },
            },
          })),
        ]
      : []),
  ],
  // Don't start dev server automatically — run it separately
});
