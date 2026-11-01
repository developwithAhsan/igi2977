(function () {
  "use strict";

  /* Load the game in the homepage only after the visitor presses Play. */
  var stage = document.querySelector(".igi-launch-stage");
  var trigger = document.getElementById("igi-launch-trigger");
  var game = document.getElementById("igi-game-frame");
  var loading = document.getElementById("igi-game-loading");

  if (stage && trigger && game) {
    trigger.addEventListener("click", function () {
      if (stage.classList.contains("is-loading")) return;
      stage.classList.add("is-loading");
      if (loading) loading.hidden = false;
      game.src = "https://broken-salad-30b8.editingking-2977.workers.dev/";
    });

    game.addEventListener("load", function () {
      if (loading) loading.hidden = true;
    });
  }

  /* Preserve the existing lazy-loading behavior for homepage comments only. */
  var comments = document.getElementById("disqus-frame");
  if (comments && comments.dataset.src) {
    comments.src = comments.dataset.src;
    comments.removeAttribute("data-src");
  }
})();
