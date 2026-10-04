import { describe, expect, it } from "vitest";
import {
  apiUrlFromViteModule,
  isLocalUrl,
  unsafeMessage,
  unsafeTargets,
} from "../../../e2e/safety";

describe("e2e safety", () => {
  it("accepts localhost targets only", () => {
    expect(isLocalUrl("http://localhost:5199")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:3001")).toBe(true);
    expect(isLocalUrl("https://api.club-calendar.test")).toBe(false);
    expect(isLocalUrl("https://localhost.evil.example")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });

  it("flags every non-local target and ignores unset ones", () => {
    expect(
      unsafeTargets({
        baseURL: "http://localhost:5199",
        VITE_API_URL: "https://api.club-calendar.test",
        E2E_API_URL: undefined,
      }),
    ).toEqual(["VITE_API_URL = https://api.club-calendar.test"]);
    expect(unsafeTargets({ a: "http://localhost:1", b: "http://127.0.0.1:2" })).toEqual([]);
  });

  it("reads the API url out of the dev server module header", () => {
    const source =
      'import.meta.env = {"BASE_URL":"/","VITE_API_URL":"https://api.club-calendar.test","MODE":"development"};';
    expect(apiUrlFromViteModule(source)).toBe("https://api.club-calendar.test");
    expect(apiUrlFromViteModule("nothing here")).toBeUndefined();
  });

  it("explains how to start the isolated environment", () => {
    const message = unsafeMessage(["VITE_API_URL = https://api.club-calendar.test"]);
    expect(message).toContain("not local: VITE_API_URL");
    expect(message).toContain("club_calendar_e2e");
    expect(message).toContain("vite --port 5199");
  });
});
