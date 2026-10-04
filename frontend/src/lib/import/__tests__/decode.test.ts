import { describe, expect, it } from "vitest";
import { decodeIcsBytes } from "../decode";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("decodeIcsBytes", () => {
  it("reads UTF-8 (umlauts, euro sign) strictly", () => {
    expect(decodeIcsBytes(utf8("SUMMARY:Schützenfest für 5 €"))).toEqual({
      text: "SUMMARY:Schützenfest für 5 €",
      encoding: "utf-8",
    });
  });

  it("drops a UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("BEGIN:VCALENDAR")]);
    expect(decodeIcsBytes(bytes)).toEqual({ text: "BEGIN:VCALENDAR", encoding: "utf-8" });
  });

  it("falls back to windows-1252 when the bytes are not valid UTF-8", () => {
    // "Schützenfest für 5 €" in windows-1252: ü = 0xFC, € = 0x80
    const bytes = new Uint8Array([
      ...utf8("SUMMARY:Sch"),
      0xfc,
      ...utf8("tzenfest f"),
      0xfc,
      ...utf8("r 5 "),
      0x80,
    ]);
    expect(decodeIcsBytes(bytes)).toEqual({
      text: "SUMMARY:Schützenfest für 5 €",
      encoding: "windows-1252",
    });
  });

  it("reads UTF-16 with a byte order mark", () => {
    const le = new Uint8Array([0xff, 0xfe, ...[..."Hü"].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeIcsBytes(le)).toEqual({ text: "Hü", encoding: "utf-16" });
    const be = new Uint8Array([0xfe, 0xff, ...[..."Hü"].flatMap((c) => [0, c.charCodeAt(0)])]);
    expect(decodeIcsBytes(be)).toEqual({ text: "Hü", encoding: "utf-16" });
  });

  it("handles an empty file", () => {
    expect(decodeIcsBytes(new Uint8Array())).toEqual({ text: "", encoding: "utf-8" });
  });
});
