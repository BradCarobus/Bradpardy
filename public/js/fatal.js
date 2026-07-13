// Shows a visible red banner instead of a silent blank page when something
// fatal happens (bad firebase-config.js paste, a file that failed to load,
// an uncaught error). Plain script (not a module) so it runs even when the
// module graph itself fails to load.
(function () {
  function show(msg) {
    var el = document.getElementById("fatal-error");
    if (!el) {
      el = document.createElement("div");
      el.id = "fatal-error";
      el.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:9999;background:#b71c1c;" +
        "color:#fff;padding:12px 16px;font:14px/1.5 monospace;white-space:pre-wrap;" +
        "box-shadow:0 2px 12px rgba(0,0,0,.5);";
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent =
      "⚠ Something broke on this page:\n" +
      msg +
      "\n\nMost common causes:\n" +
      "  1. public/js/firebase-config.js wasn't filled in correctly — it must keep\n" +
      "     the line `export const firebaseConfig = { ... }` with your values inside.\n" +
      "  2. The Firestore database was never created in the Firebase console\n" +
      "     (Build > Firestore Database > Create database).\n" +
      "  3. An old version is deployed — run `firebase deploy` again.\n" +
      "Press F12 and check the Console tab for the full error.";
  }

  window.addEventListener(
    "error",
    function (e) {
      // resource-load failures (script/img/css 404s) arrive on the element
      if (e.target && e.target !== window && e.target.tagName) {
        var src = e.target.src || e.target.href || "";
        if (e.target.tagName === "SCRIPT" && src) show("Failed to load script: " + src);
        return;
      }
      show(e.message || "Unknown error");
    },
    true
  );

  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason || {};
    show(r.message || String(r));
  });
})();
