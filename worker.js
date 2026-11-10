// Clean-URL routing for the static site on Cloudflare Workers.
// Keep the visitor-facing URL unchanged; fetch the matching .html asset internally.
const ROUTES = new Map([
  ["/play", "/play.html"],
  ["/controls", "/controls.html"],
  ["/faq", "/faq.html"],
  ["/about", "/about.html"],
  ["/contact", "/contact.html"],
  ["/privacy", "/privacy.html"],
  ["/terms", "/terms.html"],
  ["/dmca", "/dmca.html"],
  ["/disclaimer", "/disclaimer.html"],
  ["/cookie-policy", "/cookie-policy.html"],

  ["/blog", "/blogs/index.html"],
  ["/blogs", "/blogs/index.html"],

  ["/project-igi-1-online", "/project-igi-1-online.html"],
  ["/project-igi-3-online-does-it-exist", "/project-igi-3-online-does-it-exist.html"],
  ["/is-project-igi-online-safe", "/is-project-igi-online-safe.html"],
  ["/disqus-frame", "/disqus-frame.html"],

  ["/blog/getting-started", "/blogs/getting-started.html"],
  ["/blog/browser-performance", "/blogs/browser-performance.html"],
  ["/blog/stealth-tactics", "/blogs/stealth-tactics.html"],
  ["/blogs/getting-started", "/blogs/getting-started.html"],
  ["/blogs/browser-performance", "/blogs/browser-performance.html"],
  ["/blogs/stealth-tactics", "/blogs/stealth-tactics.html"]
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\\/+$/, "") || "/";
    const target = ROUTES.get(path);

    if (target) {
      url.pathname = target;
      return env.ASSETS.fetch(new Request(url, request));
    }

    // Root, files (CSS/JS/images), and already explicit file paths pass through unchanged.
    return env.ASSETS.fetch(request);
  }
};
