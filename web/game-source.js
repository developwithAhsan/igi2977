// Per-file game source. Requests go through this site's Vercel reverse-proxy route so
// the browser sees a same-origin URL; this avoids the upstream host's missing CORS header.
// The route forwards /igi-data/<path> to https://igi.sagarinfosec.site/<path>.
window.RC_GAME_FILES_SOURCE = window.RC_GAME_FILES_SOURCE || '/igi-data/';

// Fallback package source: split ISO index.json with SHA-256 checksums.
// This remains available if the per-file source is unreachable.
window.RC_GAME_SOURCE = window.RC_GAME_SOURCE || 'https://igi-game.pages.dev/';
