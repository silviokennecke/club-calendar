import { describe, expect, it } from "vitest";
import type { Calendar } from "@/lib/types";
import { pickCalendar } from "../pickCalendar";

const cal = (id: string, archived = false) =>
  ({
    id,
    name: id,
    clubId: "c1",
    archivedAt: archived ? "2026-01-01T00:00:00Z" : null,
  }) as Calendar;
const list = [cal("old", true), cal("k1"), cal("k2")];

describe("pickCalendar", () => {
  it("prefers the calendar last used in the club (membership)", () => {
    expect(pickCalendar(list, "c1", null, null, "k2")?.id).toBe("k2");
    expect(pickCalendar(list, "c1", "c1", "k1", "k2")?.id).toBe("k2");
  });

  it("ignores remembered ids that are unknown, deleted or archived", () => {
    expect(pickCalendar(list, "c1", null, null, "gone")?.id).toBe("k1");
    expect(pickCalendar(list, "c1", null, null, "old")?.id).toBe("k1");
  });

  it("falls back to the account's last calendar of its last club, then the first active one", () => {
    expect(pickCalendar(list, "c1", "c1", "k2")?.id).toBe("k2");
    expect(pickCalendar(list, "c1", "c9", "k2")?.id).toBe("k1");
    expect(pickCalendar([cal("old", true)], "c1")?.id).toBe("old");
    expect(pickCalendar([], "c1")).toBeUndefined();
  });
});
