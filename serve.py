#!/usr/bin/env python3
"""Local server for the browser build (this machine only).

Threads in WebAssembly need SharedArrayBuffer, which browsers only enable on cross-origin isolated
pages, so every response carries COOP/COEP headers.

  /            web/ (the page)
  /build/      build_web/www (recomp.js / .wasm from build_web.sh)

Without --game the player picks their own game folder, which the browser copies into its private
storage. --game DIR serves a game folder at /game/ (with /game/manifest.json listing it); the page then
offers to download it into the browser instead (the only way in on phones and tablets, which can't pick
folders), and ?devgame downloads it without asking.

For a static host, --manifest DIR writes DIR/manifest.json; upload the folder as game/ next to the page
(with the same COOP/COEP headers).

Phones need a secure context for threads and WebGPU: http://localhost works, a LAN address
(--host 0.0.0.0) doesn't, so test a phone through HTTPS (a tunnel or a real host).

Usage: python3 web/serve.py [--port 8007] [--host 127.0.0.1] [--game DIR]
       python3 web/serve.py --manifest DIR
"""
import argparse
import http.server
import json
import os
import re
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(os.path.dirname(HERE), "build_web", "www")
GAME = None   # --game

# installer leftovers the game never reads (web/loader.js skips the same)
SKIP = re.compile(r"^(directx[^/]*/|.*\.(mp4|ds_store)$)|(^|/)\.DS_Store$|^manifest\.json$", re.I)


def manifest(folder):
    files = []
    for root, _, names in os.walk(folder):
        for n in names:
            full = os.path.join(root, n)
            rel = os.path.relpath(full, folder).replace(os.sep, "/")
            if not SKIP.search(rel):
                files.append({"path": rel, "size": os.path.getsize(full)})
    return sorted(files, key=lambda e: e["path"])


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm",
                      ".js": "text/javascript"}

    def do_GET(self):
        if GAME and urllib.parse.urlparse(self.path).path == "/game/manifest.json" and \
                not os.path.exists(os.path.join(GAME, "manifest.json")):
            body = json.dumps(manifest(GAME)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        p = urllib.parse.unquote(urllib.parse.urlparse(path).path)
        if p.startswith("/build/"):
            return os.path.join(BUILD, p[len("/build/"):])
        if GAME and p.startswith("/game/"):
            return os.path.join(GAME, p[len("/game/"):])
        return os.path.join(HERE, p.lstrip("/"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8007)
    ap.add_argument("--host", default="127.0.0.1", help="address to listen on (0.0.0.0: every interface)")
    ap.add_argument("--game", help="serve this game folder at /game/ for the page to download")
    ap.add_argument("--manifest", metavar="DIR", help="write DIR/manifest.json for a static host and exit")
    a = ap.parse_args()
    if a.manifest:
        files = manifest(a.manifest)
        with open(os.path.join(a.manifest, "manifest.json"), "w") as f:
            json.dump(files, f)
        print(f"{len(files)} files, {sum(e['size'] for e in files) / 1e6:.0f} MB")
        return
    global GAME
    GAME = os.path.abspath(a.game) if a.game else None
    srv = http.server.ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"http://localhost:{a.port}/")
    srv.serve_forever()


if __name__ == "__main__":
    main()
