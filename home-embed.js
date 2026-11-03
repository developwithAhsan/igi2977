(function () {
  "use strict";
  // Prevent scripts that focus controls during startup from opening the homepage at its footer.
  // Respect hash links and normal browser back/forward restoration.
  var navigation = window.performance && performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
  if (!window.location.hash && !(navigation && navigation.type === "back_forward")) {
    window.addEventListener("pageshow", function (event) {
      if (!event.persisted && !window.location.hash) window.scrollTo(0, 0);
    }, { once: true });
  }
  var frame = document.getElementById("disqus-frame");
  var fallback = document.getElementById("disqus-fallback");
  if (!frame) return;
  if (!("credentialless" in HTMLIFrameElement.prototype)) {
    frame.hidden = true;
    if (fallback) fallback.hidden = false;
    return;
  }
  var source = frame.dataset.src;
  if (source) {
    frame.src = source;
    frame.removeAttribute("data-src");
  }
  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow || !event.data || event.data.type !== "igi-disqus-height") return;
    var height = Number(event.data.height);
    if (Number.isFinite(height)) frame.style.height = Math.max(420, Math.min(5000, height)) + "px";
  });
})();
