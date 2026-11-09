const PAGE_ROUTES = new Map([
  ["/play", "/web/play.html"],
  ["/controls", "/web/controls.html"],
  ["/faq", "/web/faq.html"],
  ["/about", "/web/about.html"],
  ["/contact", "/web/contact.html"],
  ["/privacy", "/web/privacy.html"],
  ["/terms", "/web/terms.html"],
  ["/dmca", "/web/dmca.html"],
  ["/disclaimer", "/web/disclaimer.html"],
  ["/cookie-policy", "/web/cookie-policy.html"],
  ["/blog", "/web/blogs/index.html"],
  ["/blogs", "/web/blogs/index.html"],
  ["/project-igi-3-online-does-it-exist", "/web/project-igi-3-online-does-it-exist.html"],
  ["/is-project-igi-online-safe", "/web/is-project-igi-online-safe.html"]
]);

const BLOG_ROUTES = new Map([
  ["/blog/getting-started", "/web/blogs/getting-started.html"],
  ["/blog/browser-performance", "/web/blogs/browser-performance.html"],
  ["/blog/stealth-tactics", "/web/blogs/stealth-tactics.html"],
  ["/blogs/getting-started", "/web/blogs/getting-started.html"],
  ["/blogs/browser-performance", "/web/blogs/browser-performance.html"],
  ["/blogs/stealth-tactics", "/web/blogs/stealth-tactics.html"]
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Internal 200 rewrite: keep the clean public URL and canonical unchanged.
    const target = PAGE_ROUTES.get(path) || BLOG_ROUTES.get(path);
    if (target) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = target;
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    // Leave the homepage, static assets, game engine and all other paths untouched.
    return env.ASSETS.fetch(request);
  }
};
