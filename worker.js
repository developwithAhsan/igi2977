// Clean-URL routing and browser-runtime headers for the static site on Cloudflare Workers.
// Keep visitor-facing URLs unchanged; fetch the matching .html asset internally.
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

const DATA_PREFIX = "/igi-data/";
const DATA_ORIGIN = "https://igi.sagarinfosec.site";

// The old Vercel deployment proxied /igi-data/* to the game-file CDN.
// Keep that same-origin path on Cloudflare so the per-file downloader can
// fetch game/manifest.json and stream each authorized file into browser OPFS.
function dataRequestPath(pathname) {
  if (!pathname.startsWith(DATA_PREFIX)) return null;
  const suffix = pathname.slice(DATA_PREFIX.length);
  if (!suffix) return null;

  const segments = suffix.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || /%2f|%5c/i.test(part))) {
    return null;
  }

  let decoded;
  try {
    decoded = segments.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (decoded.some((part) => !part || part === "." || part === ".." || part.includes("/") || part.includes("\\"))) {
    return null;
  }

  return "/" + decoded.map((part) => encodeURIComponent(part)).join("/");
}

function withHeaders(response, additions) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(additions)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function proxyGameFile(request, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const upstreamPath = dataRequestPath(pathname);
  if (!upstreamPath) return new Response("Invalid game-file path", { status: 400 });

  const upstreamUrl = new URL(upstreamPath, DATA_ORIGIN);
  const upstreamRequest = new Request(upstreamUrl, request);
  try {
    return await fetch(upstreamRequest);
  } catch {
    return new Response("Game-file source is temporarily unavailable", {
      status: 502,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\\/+$/, "") || "/";

    if (path === "/igi-data" || path.startsWith(DATA_PREFIX)) {
      return proxyGameFile(request, path);
    }

    const target = ROUTES.get(path);
    if (target) url.pathname = target;

    const response = await env.ASSETS.fetch(new Request(url, request));

    // The browser game uses pthreads and shared WebAssembly memory. These are
    // the same COOP/COEP values previously configured for /play on Vercel.
    // Apply them only to the top-level game entry points, not every site page.
    if (path === "/" || path === "/index.html" ||
        path === "/play" || path === "/play.html") {
      return withHeaders(response, {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
      });
    }

    return response;
  }
};
