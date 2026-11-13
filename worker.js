// Cloudflare Worker for Project IGI static assets and the same-origin game-file proxy.
// Let Cloudflare's auto-trailing-slash HTML handling resolve ordinary .html pages.
// Do not rewrite /page to /page.html here: that causes an HTML redirect loop.
const DATA_PREFIX = "/igi-data/";
const DATA_ORIGIN = "https://igi.sagarinfosec.site";

function dataRequestPath(pathname) {
  if (!pathname.startsWith(DATA_PREFIX)) return null;
  const suffix = pathname.slice(DATA_PREFIX.length);
  if (!suffix) return null;
  const segments = suffix.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || /%2f|%5c/i.test(part))) return null;
  let decoded;
  try { decoded = segments.map((part) => decodeURIComponent(part)); }
  catch { return null; }
  if (decoded.some((part) => !part || part === "." || part === ".." || part.includes("/") || part.includes("\\\\"))) return null;
  return "/" + decoded.map((part) => encodeURIComponent(part)).join("/");
}

function withHeaders(response, additions) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(additions)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function proxyGameFile(request, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const upstreamPath = dataRequestPath(pathname);
  if (!upstreamPath) return new Response("Invalid game-file path", { status: 400 });
  try {
    return await fetch(new Request(new URL(upstreamPath, DATA_ORIGIN), request));
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
    const originalPath = url.pathname;
    if (originalPath === "/igi-data" || originalPath.startsWith(DATA_PREFIX)) {
      return proxyGameFile(request, originalPath);
    }

    // Old templates reference /web/click-ad.js although the file is at the root.
    // Strip only this legacy asset prefix; never rewrite page URLs to .html.
    if (url.pathname.startsWith("/web/")) url.pathname = url.pathname.slice(4);

    // Aliases map to clean page paths; Cloudflare then resolves the .html asset.
    const cleanPath = url.pathname.replace(/\\/+$/, "") || "/";
    if (cleanPath === "/about-us") url.pathname = "/about";
    if (cleanPath === "/contact-us") url.pathname = "/contact";

    const response = await env.ASSETS.fetch(new Request(url, request));
    const headerPath = url.pathname.replace(/\\/+$/, "") || "/";
    if (headerPath === "/" || headerPath === "/index.html" || headerPath === "/play") {
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
