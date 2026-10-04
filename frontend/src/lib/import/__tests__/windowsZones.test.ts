import { describe, expect, it } from "vitest";
import { windowsZoneEntries, windowsZoneToIana } from "../windowsZones";

describe("windowsZoneToIana", () => {
  it.each([
    ["W. Europe Standard Time", "Europe/Berlin"],
    ["Central European Standard Time", "Europe/Warsaw"],
    ["GMT Standard Time", "Europe/London"],
    ["Eastern Standard Time", "America/New_York"],
    ["Pacific Standard Time", "America/Los_Angeles"],
    ["Romance Standard Time", "Europe/Paris"],
    ["E. Europe Standard Time", "Europe/Chisinau"],
    ["Russian Standard Time", "Europe/Moscow"],
    ["Tokyo Standard Time", "Asia/Tokyo"],
    ["China Standard Time", "Asia/Shanghai"],
    ["India Standard Time", "Asia/Kolkata"],
    ["UTC", "UTC"],
  ])("%s -> %s", (windows, iana) => {
    expect(windowsZoneToIana(windows)).toBe(iana);
  });

  it("ignores case and surrounding blanks, returns null for unknown names", () => {
    expect(windowsZoneToIana("  w. europe standard time ")).toBe("Europe/Berlin");
    expect(windowsZoneToIana("Customized Time Zone")).toBeNull();
    expect(windowsZoneToIana("")).toBeNull();
  });

  it("only maps to zones the browser knows (the backend needs real IANA names)", () => {
    const entries = windowsZoneEntries();
    expect(entries.length).toBeGreaterThanOrEqual(40);
    for (const [windows, iana] of entries) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: iana }), windows).not.toThrow();
    }
  });
});
