/**
 * Safety net of the e2e suite: it registers users and deletes data, so it must never run against the
 * development API / database (`frontend/.env.local` points `VITE_API_URL` at https://api.club-calendar.test).
 * Pure functions, used by `global-setup.ts` and tested in `src/lib/__tests__/e2eSafety.test.ts`.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const E2E_HELP = [
  "Isolated e2e environment (own database, never the dev database):",
  "  1. DB:       docker compose up mysql_test -d, then create `club_calendar_e2e` on port 3360 (root/root),",
  "               run `php bin/console doctrine:migrations:migrate -n` and `doctrine:fixtures:load -n` with",
  "               DATABASE_URL=mysql://root:root@127.0.0.1:3360/club_calendar_e2e",
  "  2. Backend:  DATABASE_URL=… FRONTEND_URL=http://localhost:5199 MAILER_DSN=null://null \\",
  "               php -S 127.0.0.1:3001 -t backend/public",
  "  3. Frontend: VITE_API_URL=http://localhost:3001 npx vite --port 5199 (in frontend/)",
  "  4. Run:      PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend",
  "See frontend/AGENTS.md (E2E).",
].join("\n");

/** Messages for every target that is not local; empty = safe to run. */
export function unsafeTargets(targets: Record<string, string | undefined>): string[] {
  return Object.entries(targets)
    .filter(([, url]) => !!url && !isLocalUrl(url))
    .map(([name, url]) => `${name} = ${url}`);
}

/** Reads `VITE_API_URL` out of the dev server's module header (`import.meta.env = {...}`). */
export function apiUrlFromViteModule(source: string): string | undefined {
  return /"VITE_API_URL"\s*:\s*"([^"]*)"/.exec(source)?.[1];
}

export function unsafeMessage(bad: string[]): string {
  return [
    "E2E aborted: the tests must only run against a local, isolated environment, not the dev API / database.",
    ...bad.map((b) => `  not local: ${b}`),
    "",
    E2E_HELP,
  ].join("\n");
}
