import type { FullConfig } from "@playwright/test";
import { apiUrlFromViteModule, unsafeMessage, unsafeTargets } from "./safety";

/**
 * Aborts before the first test when the base URL, the e2e API URL or the API URL the running frontend
 * was built with (`VITE_API_URL`, read from the dev server) is not on localhost.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const targets: Record<string, string | undefined> = {
    "PLAYWRIGHT_BASE_URL (baseURL)": baseURL,
    E2E_API_URL: process.env.E2E_API_URL,
    VITE_API_URL: process.env.VITE_API_URL,
  };
  try {
    const res = await fetch(new URL("/src/lib/api.ts", baseURL));
    const api = res.ok ? apiUrlFromViteModule(await res.text()) : undefined;
    if (api) targets["VITE_API_URL of the running frontend"] = api;
  } catch {
    // The frontend is not reachable (or a production build is served): the tests fail on their own.
  }
  const bad = unsafeTargets(targets);
  if (bad.length > 0) throw new Error(unsafeMessage(bad));
}
