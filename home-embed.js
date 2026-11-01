(function () {
  "use strict";

  /*
   * Set the Worker URL directly as the iframe source. The browser follows
   * ordinary HTTP 301/302/307/308 redirects inside the iframe automatically.
   * Do not fetch() the URL or intercept its Location header: that would break
   * navigation and cross-origin redirects.
   */
  var GAME_URL = "https://broken-salad-30b8.editingking-2977.workers.dev/";
  var stage = document.querySelector(".igi-launch-stage");
  var trigger = document.getElementById("igi-launch-trigger");
  var game = document.getElementById("igi-game-frame");
  var loading = document.getElementById("igi-game-loading");
  var detail = document.getElementById("igi-loader-detail");
  var retryButton = document.getElementById("igi-loader-retry");
  var retryTimer = 0;
  var retries = 0;
  var ready = false;
  var MAX_RETRIES = 3;
  var RETRY_AFTER_MS = 12000;

  function showRetryState() {
    if (ready || !stage) return;
    if (detail) detail.textContent = "> CONNECTING... RETRYING";
    if (retryButton) retryButton.hidden = false;
  }

  function loadGame(isRetry) {
    if (!game || ready) return;
    if (retryTimer) window.clearTimeout(retryTimer);
    if (isRetry) retries += 1;
    if (detail) detail.textContent = isRetry
      ? "> REDIRECT RETRY " + retries + "/" + MAX_RETRIES
      : "> FOLLOWING MISSION SERVER ROUTE...";
    if (retryButton) retryButton.hidden = true;

    /*
     * Assigning the URL to iframe.src lets the browser follow every redirect
     * in the response chain normally. No top-level navigation is performed.
     */
    var nextUrl = GAME_URL;
    if (isRetry) nextUrl += (nextUrl.indexOf("?") === -1 ? "?" : "&") + "r=" + Date.now();
    game.src = nextUrl;

    retryTimer = window.setTimeout(function () {
      if (ready) return;
      if (retries < MAX_RETRIES) {
        showRetryState();
        loadGame(true);
      } else {
        showRetryState();
      }
    }, RETRY_AFTER_MS);
  }

  function startGame() {
    if (!stage || !game || stage.classList.contains("is-loading")) return;
    stage.classList.add("is-loading");
    if (loading) loading.hidden = false;
    loadGame(false);
  }

  if (trigger) trigger.addEventListener("click", startGame);
  if (retryButton) retryButton.addEventListener("click", function () {
    if (ready) return;
    retries = 0;
    loadGame(true);
  });

  /*
   * The Worker relays this message after its proxied game page is actually
   * ready. Match the sending iframe window and message shape. Do not require
   * the final redirected page to keep the Worker's origin.
   */
  window.addEventListener("message", function (event) {
    if (!game || event.source !== game.contentWindow || !event.data ||
        event.data.type !== "igi-height") return;

    ready = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    if (loading) loading.hidden = true;

    var height = Number(event.data.height);
    if (Number.isFinite(height) && height > 0) {
      var clamped = Math.max(window.innerHeight, Math.min(12000, height));
      stage.style.height = clamped + "px";
      game.style.height = "100%";
    }
  });

  /* Preserve existing homepage comments lazy-loading behavior. */
  var comments = document.getElementById("disqus-frame");
  if (comments && comments.dataset.src) {
    comments.src = comments.dataset.src;
    comments.removeAttribute("data-src");
  }
})();
