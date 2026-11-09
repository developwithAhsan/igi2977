const EXTRA_ROUTES = new Map([
  ["/project-igi-1-online", "/project-igi-1-online.html"],
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
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const target = EXTRA_ROUTES.get(path);

    if (target) {
      url.pathname = target;
      return env.ASSETS.fetch(new Request(url, request));
    }

    // All standard page routes (including /play) are handled by _redirects.
    return env.ASSETS.fetch(request);
  }
};
