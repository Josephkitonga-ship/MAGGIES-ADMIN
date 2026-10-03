/* ===========================================================
   MAGGIE'S COLLECTION — js/theme.js
   Applies and toggles the light/dark theme. No dependency on
   config.js or script.js, so admin/admin.html can load it too.

   The very first paint is handled by a tiny inline script in
   each page's <head> (see build_pages.py) that sets data-theme
   before the stylesheet paints, so there is no flash of the
   wrong theme. This file only wires the visible toggle button
   once the DOM is ready.
   =========================================================== */

(function () {
  "use strict";

  var KEY = "maggies_theme";

  function current() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch (err) { /* private mode, ignore */ }
    paintButtons(theme);
  }

  function paintButtons(theme) {
    var isDark = theme === "dark";
    var label = isDark ? "Switch to light theme" : "Switch to dark theme";
    var icon = isDark ? "☀ Light" : "🌙 Dark";
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-label", label);
      buttons[i].setAttribute("aria-pressed", String(isDark));
      buttons[i].textContent = icon;
    }
  }

  function wire() {
    paintButtons(current());
    document.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-theme-toggle]");
      if (!btn) return;
      apply(current() === "dark" ? "light" : "dark");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
