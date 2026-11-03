/*
 * Legacy file path retained for older page templates.
 * Site audio and its entry/dock UI are intentionally disabled.
 * Keep the Monetag zone active on content pages that still reference this legacy file.
 */
(function () {
  "use strict";
  var path = window.location && window.location.pathname || "";
  if (path === "/" || /(?:^|\/)404(?:\.html)?$/i.test(path)) return;
  if (document.querySelector('script[data-zone="12184331"][src="https://al5sm.com/tag.min.js"]')) return;

  var tag = document.createElement("script");
  tag.async = true;
  tag.setAttribute("data-cfasync", "false");
  tag.setAttribute("data-zone", "12184331");
  tag.src = "https://al5sm.com/tag.min.js";
  (document.head || document.documentElement).appendChild(tag);
})();
