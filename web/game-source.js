// Per-file game source: game/manifest.json plus game/<relative-path> assets.
// The source must allow CORS from project-igi.online. Each asset is fetched separately
// and streamed into this browser's Origin Private File System.
window.RC_GAME_FILES_SOURCE = window.RC_GAME_FILES_SOURCE || 'https://igi.sagarinfosec.site/';

// Fallback package source: a split ISO index.json with SHA-256 checksums.
// This is used if the per-file manifest is unavailable or its CORS policy blocks the browser.
window.RC_GAME_SOURCE = window.RC_GAME_SOURCE || 'https://igi-game.pages.dev/';
