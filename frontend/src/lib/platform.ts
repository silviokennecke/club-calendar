export type Platform = "ios" | "macos" | "android" | "windows" | "other";

/** Pure: pass the values of `navigator`; iPadOS reports as Macintosh but has a touch screen. */
export function detectPlatform(
  ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Mac OS X/i.test(ua)) return maxTouchPoints > 1 ? "ios" : "macos";
  if (/Windows/i.test(ua)) return "windows";
  return "other";
}
