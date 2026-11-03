import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Picker } from "emoji-mart";

// emoji-mart injects its fixed stylesheet as a <style> into the picker's shadow root; the CSP
// (docker/Caddyfile, backend/public/.htaccess) allows exactly its hash. A library upgrade that changes the
// stylesheet fails here: put the printed hash into both files, OPERATIONS.md and CLAUDE.md.
describe("CSP style-src hash for emoji-mart", () => {
  it("is allowed by the policy", () => {
    const picker = new Picker({
      data: { categories: [], emojis: {}, aliases: {}, sheet: { cols: 1, rows: 1 } },
    });
    const style = (picker as unknown as HTMLElement).shadowRoot?.querySelector("style");
    expect(style?.textContent?.length).toBeGreaterThan(1000);
    const hash = `'sha256-${createHash("sha256").update(style!.textContent!).digest("base64")}'`;

    const caddy = readFileSync(path.resolve(__dirname, "../../../../docker/Caddyfile"), "utf8");
    const htaccess = readFileSync(
      path.resolve(__dirname, "../../../../backend/public/.htaccess"),
      "utf8",
    );
    for (const config of [caddy, htaccess]) {
      const styleSrc = /style-src ([^;"]*)/.exec(config)?.[1] ?? "";
      expect(styleSrc.split(" "), `style-src must allow ${hash}`).toContain(hash);
    }
  });
});
