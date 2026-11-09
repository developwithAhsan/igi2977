const PAGE_ROUTES = new Map([
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
  ["/disqus-frame", "/disqus-frame.html"]
]);

const BLOG_ROUTES = new Map([
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
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const target = PAGE_ROUTES.get(path) || BLOG_ROUTES.get(path);
    if (target) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = target;
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return env.ASSETS.fetch(request);
  }
};
