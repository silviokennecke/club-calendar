import { describe, expect, it } from "vitest";
import { detectPlatform } from "../platform";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadOs:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("detectPlatform", () => {
  it.each([
    [UA.iphone, 5, "ios"],
    [UA.ipadOs, 5, "ios"],
    [UA.mac, 0, "macos"],
    [UA.android, 5, "android"],
    [UA.windows, 0, "windows"],
    [UA.windows, 10, "windows"],
    [UA.linux, 0, "other"],
    ["", 0, "other"],
  ])("%s (touch %i) -> %s", (ua, touch, expected) => {
    expect(detectPlatform(ua, touch)).toBe(expected);
  });
});
