// Apply the stored theme before first paint (no flash). Mirrors src/lib/theme.ts.
// External (not inline) so the CSP can stay `script-src 'self'`; loaded synchronously from <head>.
(function () {
  var pref = "system";
  try {
    var stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") pref = stored;
  } catch (_) {}
  var dark =
    pref === "dark" ||
    (pref === "system" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  // A forced theme must override the media-query theme-color metas from index.html.
  if (pref !== "system") {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute("content", dark ? "#0f1715" : "#f7f8f5");
      metas[i].removeAttribute("media");
    }
  }
})();
