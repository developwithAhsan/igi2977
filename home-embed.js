(function () {
  "use strict";

  /*
   * The game is embedded directly from PlayIGI in index.html.
   * No launch button, proxy, redirect handler, retry loop, or loader is needed.
   * Preserve the existing homepage comments lazy-loading behavior.
   */
  var comments = document.getElementById("disqus-frame");
  if (comments && comments.dataset.src) {
    comments.src = comments.dataset.src;
    comments.removeAttribute("data-src");
  }
})();
