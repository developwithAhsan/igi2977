export default {
  async fetch(request, env) {
    // Cloudflare Static Assets applies the clean-URL rewrites from _redirects.
    // Keep routing in one place to avoid duplicate rewrite loops.
    return env.ASSETS.fetch(request);
  }
};
