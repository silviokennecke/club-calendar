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
})();
