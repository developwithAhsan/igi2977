(function () {
  "use strict";

  /* Preserve the existing lazy-loading behavior for homepage comments only. */
  var comments = document.getElementById("disqus-frame");
  if (comments && comments.dataset.src) {
    comments.src = comments.dataset.src;
    comments.removeAttribute("data-src");
  }
})();
