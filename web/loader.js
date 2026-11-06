// Project I.G.I. in the browser: copies the player's own game folder into OPFS (once; it never leaves the
// computer), starts the recompiled build (build/recomp.js), replays its frames with WebGPU and feeds it
// input and audio.
//
// URL options: ?mute (no audio) ?fps (frame rate in the console) ?log (host log) ?autoplay
//              ?devgame (download the hosted game folder without asking; testing)
//              ?touch (on-screen controls even without a touch screen) ?touchsens=<x> (extra look factor; the
//              settings sheet on the phone is the normal way)
//              ?exe=<name> (the executable inside the game folder, if not the profile's default)
//              ?pads=N (game controllers to expose, default 1, at most 4)
//              ?queue=1 (frames queued ahead of the display, default 2: 1 cuts 16 ms of input latency online
//              on a machine that simulates a frame well within 16 ms, else it hitches)
//              ?netplay=<url> (the room server for online play, see server/; default: this page's origin)
//              ?join=<room code>
//
// Online play (netplay.js, host/netplay.c): players meet in a room on the server; when the host starts,
// every page boots the game in deterministic lockstep mode with fresh saves, and only pad inputs travel.
// Each player's keyboard and first gamepad merge into one local pad; mouse and raw keys are off.
'use strict';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// A public, CORS-enabled source may be configured once in web/game-source.js, or supplied with
// ?gamesource=https://cdn.example.com/igi/. The default remains this site's /game/ directory.
function configuredGameSource() {
  const raw = params.get('gamesource') || window.RC_GAME_SOURCE || '/game/';
  try {
    const url = new URL(raw, location.href);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
        (location.protocol === 'https:' && url.protocol !== 'https:')) throw new Error('Unsupported game source URL');
    url.search = '';
    url.hash = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch (err) {
    console.warn('Invalid configured game source; using /game/:', err.message);
    return new URL('/game/', location.href);
  }
}
const GAME_SOURCE = configuredGameSource();
function configuredGameFilesSource() {
  const raw = params.get('gamefilessource') || window.RC_GAME_FILES_SOURCE || '';
  if (!raw) return null;
  try {
    const url = new URL(raw, location.href);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
        (location.protocol === 'https:' && url.protocol !== 'https:')) {
      throw new Error('Unsupported game-file source URL');
    }
    url.search = '';
    url.hash = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch (error) {
    console.warn('Invalid per-file game source; it will be skipped:', errorMessage(error));
    return null;
  }
}
const GAME_FILES_SOURCE = configuredGameFilesSource();
function gameSourceURL(path) {
  return new URL(path.split('/').map(encodeURIComponent).join('/'), GAME_SOURCE).href;
}
const OPFS_DIR = 'rcgame';
const MARKER = '.installed.json';   // { version } once every file is copied
const NETPLAY_BASE = new URL(params.get('netplay') || './', location.href).href.replace(/\/?$/, '/');
const status = (t) => { $('status').textContent = t; };
const setLoadingProgress = (phase, fraction) => {
  const value = Math.max(0, Math.min(1, Number(fraction) || 0));
  const percent = Math.round(value * 100);
  const display = $('progress-display');
  if (display) display.classList.remove('hidden');
  const bar = $('progress');
  if (bar) { bar.value = value; bar.setAttribute('aria-valuenow', String(percent)); }
  const label = $('progress-percent');
  if (label) label.textContent = percent + '%';
  status(phase);
};
// Errors can be Error objects, browser resource events, or rejected values without a message.
// Never render "undefined": preserve the useful detail and give resource failures a clear fallback.
function errorMessage(error, fallback = 'The browser stopped the operation without an error message.') {
  if (error instanceof Error) return error.message || error.name || fallback;
  if (typeof error === 'string') return error.trim() || fallback;
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
    if (error.reason !== undefined) return errorMessage(error.reason, fallback);
    const target = error.target || error.currentTarget;
    const url = target && (target.src || target.href);
    if (url) return 'The browser could not load ' + url;
    if (error.type) return 'A browser "' + error.type + '" event interrupted the operation.';
    try {
      const detail = JSON.stringify(error);
      if (detail && detail !== '{}') return detail;
    } catch { /* not serializable */ }
  }
  return fallback;
}
// the launcher's screens (index.html): loading, home, online, lobby
const show = (view) => { for (const v of document.querySelectorAll('#panel .view')) v.classList.toggle('hidden', v.id !== 'view-' + view); };
const fail = (error) => {
  const message = errorMessage(error, 'Unknown error while starting the game.');
  const gpuStartupFailure = /webgpu|gpu adapter|requestadapter|requestdevice|gpu device|graphics adapter|no adapter|adapter.*found|device.*lost/i.test(message);
  console.error('Game startup failed:', error);
  if (/webgpu|gpu adapter|requestadapter|requestdevice|gpu device|graphics adapter|no adapter|adapter.*found|device.*lost|webgl|graphics context|renderer/i.test(message) && retryRenderer(message)) return;
  hideBoot();
  document.body.classList.remove('playing');
  $('panel').classList.remove('hidden');
  if (gpuStartupFailure) {
    const note = $('crashnote');
    if (note) {
      note.textContent = 'Graphics startup failed: ' + message;
      note.classList.remove('hidden');
    }
    show('home');
    return;
  }
  status('Game could not start: ' + message);
  show('loading');
  if (/compiled game engine is missing or could not be loaded|recomp[.]wasm|webassembly.*(fetch|instantiate)|failed to load.*wasm/i.test(message)) {
    let fallback = $('engine-fallback');
    if (!fallback) {
      fallback = document.createElement('div');
      fallback.id = 'engine-fallback';
      fallback.className = 'home-import-actions';
      const note = document.createElement('p');
      note.className = 'home-import-help';
      note.textContent = 'The matching browser engine is missing from this deployment. It needs both /web/build/recomp.js and /web/build/recomp.wasm, generated together with build_web.sh from the project source and a legally obtained game executable. The site cannot recreate these compiled files from the game folder download.';
      fallback.append(note);
      $('status').insertAdjacentElement('afterend', fallback);
    }
  }
};

// Retry a WebGPU launch with the already-compiled WebGL 2 renderer. This handles browsers
// that expose an adapter but fail when the device or renderer is actually initialized.
function showStartupNotice(message) {
  const box = $('booting');
  if (!box) { status(message); return; }
  showBoot();
  for (const k of ['t1', 't2', 't3', 't4']) clearTimeout(showBoot[k]);
  if (stopBootTips) { stopBootTips(); stopBootTips = null; }
  box.querySelector('.tips')?.classList.add('hidden');
  const phase = box.querySelector('.boot-phase');
  if (phase) phase.textContent = message;
}
function retryWithWebGL(reason) {
  if (window.RC_RENDERER !== 'gpu' || params.has('rendererFallback') || !webgl2Available()) return false;
  try { localStorage.setItem('igi-renderer-gl', String(Date.now())); } catch { /* storage may be blocked */ }
  const url = new URL(location.href);
  url.searchParams.set('renderer', 'gl');
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('rendererFallback', '1');
  console.error('WebGPU did not produce a usable game picture; retrying with WebGL 2:', reason);
  showStartupNotice('WebGPU could not start the game picture. Retrying with WebGL 2…');
  setTimeout(() => location.replace(url.href), 900);
  return true;
}
// ChromeOS may select WebGL 2 first, but some drivers initialise it without ever drawing.
// Give WebGPU one controlled retry too; never bounce between renderers indefinitely.
function retryWithWebGPU(reason) {
  if (window.RC_RENDERER !== 'gl' || params.has('rendererFallback') ||
      !navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return false;
  const url = new URL(location.href);
  url.searchParams.set('renderer', 'gpu');
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('rendererFallback', '1');
  console.error('WebGL 2 did not produce a usable game picture; retrying with WebGPU:', reason);
  showStartupNotice('WebGL 2 could not draw the game. Retrying with WebGPU…');
  setTimeout(() => location.replace(url.href), 900);
  return true;
}
function retryRenderer(reason) {
  return retryWithWebGL(reason) || retryWithWebGPU(reason);
}

// The WebGL renderer already measures its own back buffer (GL readback is more reliable
// than sampling a preserveDrawingBuffer:false canvas). Surface those diagnostics to the
// page and use a confirmed all-black back buffer to trigger the one-time WebGPU fallback.
window.rcGlRenderer = () =>
  navigator.userAgent + ' | platform=' + (navigator.platform || 'unknown') + ' | WebGL2=' + webgl2Available();

window.rcGlDiag = (raw) => {
  let diag;
  try { diag = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (err) { console.warn('[GL diagnostics] unreadable report:', raw, err); return; }
  window.RC_GL_DIAGNOSTICS = diag;
  console.warn('[GL diagnostics]', diag);

  // A mission report is useful for debugging a later black screen, but must not reboot
  // a player's session while they are already in a level.
  if (diag && diag.ph === 'm') return;
  const blackBackBuffer = Number(diag?.avg) === 0 && Number(diag?.max) === 0;
  const incompleteFramebuffer = Number.isFinite(Number(diag?.fbo)) && Number(diag.fbo) !== 36053;
  if (!blackBackBuffer && !incompleteFramebuffer) return;

  const reason = incompleteFramebuffer
    ? 'WebGL 2 reports an incomplete framebuffer (status ' + diag.fbo + ').'
    : 'WebGL 2 is presenting frames, but its internal back buffer is completely black.';
  if (!retryRenderer(reason)) {
    showStartupFailure(reason + ' Graphics details: ' + JSON.stringify(diag) +
      '. Restart Chrome completely and check hardware acceleration, then reload this page.');
  }
};
function showStartupFailure(message) {
  showStartupNotice(message);
  const box = $('booting');
  const inner = box?.querySelector('.boot-inner');
  if (!inner) return;
  let button = $('boot-reload');
  if (!button) {
    button = document.createElement('button');
    button.id = 'boot-reload';
    button.type = 'button';
    button.className = 'btn';
    button.textContent = 'Reload game';
    inner.append(button);
  }
  button.onclick = () => location.reload();
}
const mb = (n) => (n / 1e6).toFixed(0);

// Rotating "intel" tips: a one-time 500 MB download and the first-mission load both take a minute, so the
// wait gets real game tips and a little lore instead of a bare progress bar. Each tip fades to the next.
const TIPS = [
  'FIELD INTEL · David Llewellyn Jones is an ex-SAS operative working alone behind enemy lines.',
  'MAP COMPUTER · Press C to check the tactical map and track mission information.',
  'STEALTH · A silenced pistol and knife can help you stay quieter than loud weapons.',
  'ALARM WATCH · Find and disable alarm systems before guards can call for backup.',
  'AIMING · Crouching can help steady your aim and keep a lower profile.',
  'RECON · Use binoculars to scout patrols before crossing exposed ground.',
  'WEAPON INTEL · Choose your weapon for the situation; a loud firefight can alert nearby guards.',
  'MISSION TIP · Grenades can clear dangerous positions, but watch your throw and blast radius.',
  'MISSION CONTROL · Anya provides mission guidance while Jones operates in the field.',
  'CLASSIC PC CHEAT NOTE · Some demo versions enable cheats after typing NADA at the main menu; retail support varies.',
  'CHEAT INTEL · ALLAMMO is listed as an unlimited-ammo code for demo builds; it may not work in every version.',
  'GOD MODE INTEL · ALLGOD is another code documented for demo builds, not guaranteed in retail releases.',
  'HIDDEN ROUTE · Players have reported a wall-jump shortcut in the Re-supply mission near the green containers.',
  'WEAPON INTEL · The game includes pistols, submachine guns, rifles, shotguns, grenades and heavier equipment.',
  'INSTALL NOTE · Your installed game files are stored locally in this browser for repeat launches.',
  'BUG REPORT · Found a problem? Message @ahsan0world on Instagram and tell us what happened.',
  'COMMUNITY · Leave a comment below the game to report bugs, share tips or suggest improvements.',
];
function startTips(box) {
  if (!box) return () => {};
  const textEl = box.querySelector('.tip-text');
  box.classList.remove('hidden');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = Math.floor(Math.random() * TIPS.length);
  const render = () => { textEl.textContent = TIPS[i % TIPS.length]; i++; };
  render();
  const next = () => {
    if (reduce) { render(); return; }
    box.style.opacity = '0';
    setTimeout(() => { render(); box.style.opacity = '1'; }, 350);
  };
  const id = setInterval(next, 4800);
  return () => { clearInterval(id); box.classList.add('hidden'); box.style.opacity = ''; };
}

// Boot overlay (index.html #booting): between the Play click and the first rendered frame the canvas is a
// black void while the game loads a mission into memory. Cover it with a radar, a phase line that escalates
// if it runs long, and tips, then remove it the moment the first frame is presented (run()).
let stopBootTips = null;
function showBoot() {
  const b = $('booting');
  if (!b) return;
  const phase = b.querySelector('.boot-phase');
  phase.textContent = 'Starting the game…';
  b.classList.remove('hidden');
  stopBootTips = startTips(b.querySelector('.tips'));
  showBoot.t1 = setTimeout(() => { phase.textContent = 'Loading the game into memory…'; }, 12000);
  showBoot.t2 = setTimeout(() => { phase.textContent = 'The first launch is the slow one — almost there…'; }, 45000);
  showBoot.t3 = setTimeout(() => { phase.textContent = 'Still working — a slow phone can take a couple of minutes…'; }, 90000);
  showBoot.t4 = setTimeout(hideBoot, 300000);   // safety: never trap the player behind the cover
  // A tap or click on the cover must NOT dismiss it (it used to: the canvas behind is still black, so the
  // player saw the loading screen "turn black"). It only answers with a reassuring line.
  b.onpointerdown = () => { phase.textContent = 'Still loading — nothing is stuck, the game is being set up…'; };
}
function hideBoot() {
  try { if (typeof gtag === 'function') gtag('event', 'game_start'); } catch { /* analytics blocked */ }
  const b = $('booting');
  for (const k of ['t1', 't2', 't3', 't4']) clearTimeout(showBoot[k]);
  if (stopBootTips) { stopBootTips(); stopBootTips = null; }
  if (b) { b.classList.add('hidden'); b.onpointerdown = null; }
}

// Mid-game loading cover: after boot, the game blocks hard (no frames presented) while it loads a selected
// mission or the next level — up to a couple of minutes on a phone, a black screen that looks frozen. The
// frame loop (run()) watches for that stall and shows this, then hides it the moment frames stream again.
let stopLoadTips = null;
function showLoading() {
  const b = $('booting');
  if (!b) return;
  const phase = b.querySelector('.boot-phase');
  phase.textContent = 'Loading mission…';
  b.classList.remove('hidden');
  stopLoadTips = startTips(b.querySelector('.tips'));
  showLoading.t1 = setTimeout(() => { phase.textContent = 'Loading mission… a phone can take a minute or two.'; }, 15000);
  showLoading.t2 = setTimeout(() => { phase.textContent = 'Still loading — hang tight, almost there…'; }, 50000);
  // A load that long is suspicious, but a slow phone loading a big level can take it: the game is only called
  // stuck once it has also opened or read no file for a minute (rc_io_activity, kernel32.c), which no load
  // does. Then, rather than a black screen that never ends, say so and offer the way out.
  let lastIo = -1, lastIoAt = performance.now();
  const t0 = performance.now();
  showLoading.t3 = setInterval(() => {
    const M = window.recomp, io = M && M._rc_io_activity ? M._rc_io_activity() : -1;
    const now = performance.now();
    if (io !== lastIo) { lastIo = io; lastIoAt = now; }
    if (now - t0 < 150000 || now - lastIoAt < 60000) {
      if (now - t0 > 150000) phase.textContent = 'Still loading — a big level on a slow phone. Hang tight…';
      return;
    }
    clearInterval(showLoading.t3);
    phase.innerHTML = 'The game has stopped responding. <button id="stuck-reload" style="font:inherit;padding:6px 16px;' +
      'border-radius:8px;border:0;background:#45cf79;color:#000;font-weight:700;margin-left:8px">Reload the game</button>';
    $('stuck-reload').onclick = () => location.reload();
  }, 10000);
}
function hideLoading() {
  const b = $('booting');
  for (const k of ['t1', 't2']) clearTimeout(showLoading[k]);
  clearInterval(showLoading.t3);
  if (stopLoadTips) { stopLoadTips(); stopLoadTips = null; }
  if (b) b.classList.add('hidden');
}

// On-screen diagnostics for phones (no devtools): ?debug shows a log overlay capturing errors, warnings,
// unhandled rejections and lost-GPU events, so a remote tester can screenshot exactly what failed (e.g. a
// mission that won't load). Harmless when off.
const DEBUG = params.has('debug');
(function setupDebugLog() {
  if (!DEBUG) return;
  const box = document.createElement('div');
  box.id = 'debuglog';
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;z-index:99999;' +
    'background:rgba(0,0,0,.85);color:#9fe6b0;font:11px/1.4 ui-monospace,Menlo,monospace;padding:8px 10px;' +
    'white-space:pre-wrap;word-break:break-word;border-top:2px solid #2ecc71';
  const add = (tag, args) => {
    const line = document.createElement('div');
    line.textContent = tag + ' ' + args.map((a) => (a && a.stack) || (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (tag === 'ERR') line.style.color = '#ff8b8b';
    box.appendChild(line); box.scrollTop = box.scrollHeight;
    while (box.childElementCount > 300) box.firstChild.remove();
  };
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(box));
  if (document.body) document.body.appendChild(box);
  const oe = console.error, ow = console.warn, oi = console.info, ol = console.log;
  console.error = (...a) => { add('ERR', a); oe.apply(console, a); };
  console.warn = (...a) => { add('WARN', a); ow.apply(console, a); };
  console.info = (...a) => { add('INFO', a); oi.apply(console, a); };
  console.log = (...a) => { add('log', a); ol.apply(console, a); };
  window.addEventListener('error', (e) => add('ERR', [e.message, e.filename + ':' + e.lineno]));
  window.addEventListener('unhandledrejection', (e) => add('ERR', ['unhandled rejection:', e.reason]));
  add('log', ['debug log on · ' + navigator.userAgent]);
  add('log', ['threading: crossOriginIsolated=' + !!window.crossOriginIsolated +
    ' SharedArrayBuffer=' + (typeof SharedArrayBuffer !== 'undefined') +
    ' Worker=' + (typeof Worker === 'function') +
    ' hardwareConcurrency=' + (navigator.hardwareConcurrency || 'unknown')]);
})();

// WebGPU can expose an adapter but still fail to create its device on older/unstable drivers.
// The native WebGPU callback only logs that initial failure, leaving the game thread waiting with
// no frames to pump. During startup, switch to the compiled WebGL 2 renderer instead of a black screen.
function fallbackFromGpuStartup(reason) {
  if (!window.RC_GPU_STARTUP_ACTIVE || window.RC_RENDERER !== 'gpu') return;
  window.RC_GPU_STARTUP_ACTIVE = false;
  console.error('WebGPU startup failed; trying WebGL 2:', reason);
  window.setTimeout(() => {
    if (window.RC_RENDERER !== 'gpu') return;
    if (!retryWithWebGL(reason)) {
      showStartupFailure(reason + ' WebGL 2 is unavailable on this browser/device. Open this page with ?debug for details.');
    }
  }, 0);
}

// Surface WebGPU failures (console.error, so the ?debug overlay shows them): GPU device creation failures,
// driver errors and device loss should never leave the boot cover waiting on an empty frame queue.
if (navigator.gpu) {
  const gpuProto = Object.getPrototypeOf(navigator.gpu);
  if (gpuProto && typeof gpuProto.requestAdapter === 'function') {
    const requestAdapter = gpuProto.requestAdapter;
    let startupAdapterMisses = 0;
    gpuProto.requestAdapter = async function (options) {
      try {
        const adapter = await requestAdapter.call(this, options);
        if (!adapter && window.RC_GPU_STARTUP_ACTIVE && window.RC_RENDERER === 'gpu') {
          startupAdapterMisses++;
          if (startupAdapterMisses >= 3) fallbackFromGpuStartup('WebGPU could not find a usable adapter after its compatibility retries.');
        } else if (adapter) startupAdapterMisses = 0;
        return adapter;
      } catch (e) {
        if (window.RC_GPU_STARTUP_ACTIVE && window.RC_RENDERER === 'gpu')
          fallbackFromGpuStartup('WebGPU adapter request failed: ' + errorMessage(e));
        throw e;
      }
    };
  }
  if (typeof GPUAdapter !== 'undefined' && GPUAdapter.prototype.requestDevice) {
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (desc) {
      try {
        const dev = await requestDevice.call(this, desc);
        try {
          dev.addEventListener('uncapturederror', (e) => console.error('WebGPU uncaptured error:', e.error?.message || e.error));
          dev.lost.then((info) => console.error('WebGPU device lost:', info.reason, info.message));
        } catch {}
        return dev;
      } catch (e) {
        console.error('WebGPU requestDevice failed:', errorMessage(e));
        fallbackFromGpuStartup('WebGPU could not create a graphics device: ' + errorMessage(e));
        throw e;
      }
    };
  }
}

// ------------------------------------------------------------------ game files in OPFS

async function gameDir(create) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create });
}

async function readMarker(expectedManifest = null) {
  try {
    const dir = await gameDir(false);
    const f = await (await dir.getFileHandle(MARKER)).getFile();
    const m = JSON.parse(await f.text());
    // Check the required root folders first; OPFS can evict game data while leaving its marker.
    if (typeof dir.keys === 'function') {
      const rootEntries = new Set();
      for await (const name of dir.keys()) rootEntries.add(name.toLowerCase());
      if (!rootEntries.has('igi.exe') || !rootEntries.has('common') || !rootEntries.has('missions')) {
        console.warn('[storage] installed marker exists but a required root game entry is missing');
        return null;
      }
    }
    // A root-only check misses deleted mission/map files. When a hosted manifest is available,
    // verify every expected path and byte size before allowing the engine to launch.
    const expected = Array.isArray(expectedManifest) ? expectedManifest :
      (Array.isArray(expectedManifest?.files) ? expectedManifest.files : null);
    if (expected?.length) {
      for (const entry of expected) {
        let file;
        try { file = await (await fileHandle(dir, entry.path, false)).getFile(); }
        catch (error) {
          console.info('[storage] installed game needs repair; missing file:', entry.path);
          return null;
        }
        if (file.size !== entry.size) {
          console.warn('[storage] installed game file has wrong size:', entry.path,
            file.size, 'expected', entry.size);
          return null;
        }
      }
    }
    return m;
  } catch (error) {
    // A missing OPFS directory or marker is normal on the first visit, not a game error.
    if (error?.name !== 'NotFoundError') {
      console.info('[storage] installed-game marker could not be read:', error?.message || error);
    }
    return null;
  }
}

async function writeMarker(version) {
  const fh = await (await gameDir(true)).getFileHandle(MARKER, { create: true });
  const w = await openWriter(fh, OPFS_DIR + '/' + MARKER);
  await w.write(JSON.stringify({ version, at: new Date().toISOString() }));
  await w.close();
}

async function fileHandle(dir, relPath, create) {
  const parts = relPath.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\\\'))) {
    throw new Error('Unsafe game-file path: ' + relPath);
  }
  // OPFS may evict a directory between reads. Recreate each parent when importing;
  // callers doing validation pass create=false and receive NotFoundError normally.
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: !!create });
  return dir.getFileHandle(parts[parts.length - 1], { create: !!create });
}

function opfsWriterWorker() {
  const open = new Map();   // id -> { h, at }
  const run = async (m) => {
    if (m.op === 'open') {
      let dir = await navigator.storage.getDirectory();
      const parts = m.path.split('/');
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      const h = await (await dir.getFileHandle(parts[parts.length - 1], { create: true })).createSyncAccessHandle();
      await h.truncate(0);   // Safari 15-16: these return promises; later ones return at once (await is harmless)
      open.set(m.id, { h, at: 0 });
      return;
    }
    const s = open.get(m.id);
    if (!s) throw new Error('file not open');
    if (m.op === 'write') {
      let d = m.data;
      if (typeof d === 'string') d = new TextEncoder().encode(d);
      if (d instanceof Blob) {   // a picked file: in pieces, not all of it in memory at once
        for (let o = 0; o < d.size; o += 4 << 20) {
          const piece = new Uint8Array(await d.slice(o, o + (4 << 20)).arrayBuffer());
          s.at += await s.h.write(piece, { at: s.at });
        }
      } else s.at += await s.h.write(d, { at: s.at });
      return;
    }
    open.delete(m.id);   // close or abort: release the file either way (a held handle locks it)
    try { if (m.op === 'close') await s.h.flush(); } finally { await s.h.close(); }
  };
  onmessage = (e) => run(e.data).then(() => postMessage({ seq: e.data.seq }),
    (err) => postMessage({ seq: e.data.seq, err: (err && err.name || 'Error') + ': ' + (err && err.message || err) }));
}
let opfsWorker = null, opfsSeq = 0;
const opfsWaiting = new Map();
function opfsCall(m, transfer) {
  if (!opfsWorker) {
    opfsWorker = new Worker(URL.createObjectURL(new Blob(['(' + opfsWriterWorker.toString() + ')()'], { type: 'text/javascript' })));
    opfsWorker.onmessage = (e) => {
      const p = opfsWaiting.get(e.data.seq);
      opfsWaiting.delete(e.data.seq);
      if (p) e.data.err ? p.no(new Error(e.data.err)) : p.ok();
    };
  }
  return new Promise((ok, no) => {
    m.seq = ++opfsSeq;
    opfsWaiting.set(m.seq, { ok, no });
    opfsWorker.postMessage(m, transfer || []);
  });
}
const noWritable = params.has('nowritable');
async function openWriter(fh, path) {
  if (!noWritable && typeof fh.createWritable === 'function') {
    const w = await fh.createWritable();
    return { write: (d) => w.write(d), close: () => w.close(), abort: () => w.abort().catch(() => {}) };
  }
  const id = ++opfsSeq;
  await opfsCall({ op: 'open', id, path });
  return {
    write: (d) => opfsCall({ op: 'write', id, data: d },
      d instanceof Uint8Array && d.byteOffset === 0 && d.byteLength === d.buffer.byteLength ? [d.buffer] : []),
    close: () => opfsCall({ op: 'close', id }),
    abort: () => opfsCall({ op: 'abort', id }).catch(() => {}),
  };
}


// installer leftovers the game never reads: not worth copying into the browser
const SKIP = /^(directx[^/]*\/|.*\.(mp4|ds_store)$)|(^|\/)(\.DS_Store|SETUPREG\.EXE)$/i;

async function importFromPicker(fileList) {
  const selected = Array.from(fileList || []);
  if (!selected.length) throw new Error('No game files were selected.');

  // A file-only picker strips directory names. Flattening a 3D game folder makes COMMON/MISSIONS
  // unreadable by the game, so require the relative paths returned by the folder picker.
  const entries = selected.map((f) => ({
    f,
    parts: String(f.webkitRelativePath || '').split('/').filter(Boolean),
  })).filter((e) => e.parts.length);
  if (!entries.length || !selected.some((f) => String(f.webkitRelativePath || '').includes('/'))) {
    throw new Error('Your browser did not preserve the game folder structure. Please use “Choose game folder” and select the folder containing igi.exe. Selecting files one by one flattens subfolders, so the game cannot run.');
  }

  // Find the actual game root from igi.exe. This also handles selecting a parent folder that
  // contains the Project I.G.I. folder, instead of requiring that exact folder to be selected.
  const exe = entries.find((e) => e.parts[e.parts.length - 1].toLowerCase() === 'igi.exe');
  if (!exe) throw new Error('No igi.exe was found. Select the installed Project I.G.I. folder, not its installer or archive.');
  const rootParts = exe.parts.slice(0, -1);
  const isInsideGameRoot = (parts) => rootParts.every((part, i) => (parts[i] || '').toLowerCase() === part.toLowerCase());
  const list = entries.map((e) => ({
    f: e.f,
    dest: isInsideGameRoot(e.parts) ? e.parts.slice(rootParts.length).join('/') : '',
  })).filter((e) => e.dest && !SKIP.test(e.dest));

  const topFolders = new Set(list.map((e) => e.dest.split('/')[0].toLowerCase()));
  if (!list.some((e) => e.dest.toLowerCase() === 'igi.exe')) {
    throw new Error('The selected folder does not place igi.exe at the game root. Select the folder that contains igi.exe, COMMON and MISSIONS.');
  }
  if (!topFolders.has('common') || !topFolders.has('missions')) {
    throw new Error('The selected folder is incomplete or its subfolders were not preserved. The game root must contain igi.exe, COMMON and MISSIONS. Use “Choose game folder”.');
  }
  const seen = new Set();
  for (const e of list) {
    const key = e.dest.toLowerCase();
    if (seen.has(key)) throw new Error('The selected folder contains duplicate file paths: ' + e.dest);
    seen.add(key);
  }
  const total = list.reduce((sum, e) => sum + e.f.size, 0);
  if (!total) throw new Error('The selected game folder contains no readable files.');

  // Do not remove the previous install until the selected folder passes all structural checks.
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(OPFS_DIR, { recursive: true }); } catch {}
  await navigator.storage.persist?.();
  const dir = await gameDir(true);
  let done = 0;
  $('progress-display')?.classList.remove('hidden');
  $('progress').value = 0;
  for (const e of list) {
    setLoadingProgress('Installing game files', done / total);
    const fh = await fileHandle(dir, e.dest, true);
    const w = await openWriter(fh, OPFS_DIR + '/' + e.dest);
    try {
      await w.write(e.f);
      await w.close();
    } catch (error) {
      try { await w.abort(); } catch { /* writable may already be closed */ }
      throw new Error('Could not save ' + e.dest + ': ' + errorMessage(error));
    }
    done += e.f.size;
    setLoadingProgress('Installing game files', done / total);
  }
  const sig = list.map((e) => e.dest + ':' + e.f.size).sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sig));
  await writeMarker([...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join(''));
  $('progress-display')?.classList.add('hidden');
}
const CD_FILES = ['ymbe.afp', 'anys.afp', 'mpzm.afp'];

// A folder the player picks: the installed game (IGI.exe at its top) or the disc itself (the game in pc/)
function folderFiles(fileList) {
  // the whole folder, minus its own name: <picked>/a/b.dat -> a/b.dat
  return [...fileList].map((f) => ({ f, dest: f.webkitRelativePath.split('/').slice(1).join('/') })).filter((e) => e.dest);
}

// The disc image (.iso): ISO 9660, read in place, with Joliet's long names when the image has them. Each file
// is a slice of the image, so nothing is held in memory.
async function isoFiles(file) {
  const SEC = 2048;
  const bytes = async (off, n) => new Uint8Array(await file.slice(off, off + n).arrayBuffer());
  const u32 = (b, at) => b[at] | b[at + 1] << 8 | b[at + 2] << 16 | (b[at + 3] << 24 >>> 0);
  let root = null, joliet = false;
  for (let s = 16; s < 32; s++) {   // volume descriptors: 1 primary, 2 supplementary (Joliet), 255 the end
    const d = await bytes(s * SEC, SEC);
    if (String.fromCharCode(...d.subarray(1, 6)) !== 'CD001' || d[0] === 255) break;
    const isJoliet = d[0] === 2 && d[88] === 0x25 && d[89] === 0x2f && [0x40, 0x43, 0x45].includes(d[90]);
    if ((d[0] === 1 && !root) || isJoliet) { root = { lba: u32(d, 158), size: u32(d, 166) }; joliet = isJoliet; }
  }
  if (!root) throw new Error('That file is not a CD image (.iso).');
  const name = (b) => {
    if (joliet) { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] << 8 | b[i + 1]); return s.replace(/;\d+$/, ''); }
    return String.fromCharCode(...b).replace(/;\d+$/, '').replace(/\.$/, '').toLowerCase();
  };
  const list = [], seen = new Set();
  const walk = async (dir, prefix) => {
    if (seen.has(dir.lba) || seen.size > 4096) return;
    seen.add(dir.lba);
    const d = await bytes(dir.lba * SEC, dir.size);
    for (let at = 0; at < d.length;) {
      const len = d[at];
      if (!len) { at = (Math.floor(at / SEC) + 1) * SEC; continue; }   // records don't cross a sector
      const n = d[at + 32], raw = d.subarray(at + 33, at + 33 + n);
      const entry = { lba: u32(d, at + 2), size: u32(d, at + 10) };
      if (!(n === 1 && raw[0] <= 1)) {   // not . or ..
        const path = prefix + name(raw);
        if (d[at + 25] & 2) await walk(entry, path + '/');
        else list.push({ f: file.slice(entry.lba * SEC, entry.lba * SEC + entry.size), dest: path });
      }
      at += len;
    }
  };
  await walk(root, '');
  return list;
}

async function importFiles(list) {
  // the disc's layout: the game in pc/, the check files at the root
  const lower = (e) => e.dest.toLowerCase();
  if (list.some((e) => lower(e) === 'pc/igi.exe'))
    list = list.filter((e) => lower(e).startsWith('pc/')).map((e) => ({ f: e.f, dest: e.dest.slice(3) }))
      .concat(list.filter((e) => CD_FILES.includes(lower(e))));
  if (!list.some((e) => lower(e).endsWith('.exe')))
    throw new Error('No IGI.exe there: choose the IGI disc image (.iso), the disc itself, or your installed IGI folder.');
  const names = new Set(list.map((e) => e.dest.split('/').pop().toLowerCase()));
  const cd = CD_FILES.filter((n) => !names.has(n));
  if (cd.length) throw new Error(`Copy ${cd.map((n) => n.toUpperCase()).join(', ')} from the root of the IGI disc into that folder, ` +
    'next to IGI.exe: the game checks for them. Or choose the disc image (.iso) instead.');
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(OPFS_DIR, { recursive: true }); } catch {}
  await navigator.storage.persist?.();
  const dir = await gameDir(true);
  const total = list.reduce((s, e) => s + e.f.size, 0);
  let done = 0;
  $('progress').classList.remove('hidden');
  for (const e of list) {
    setLoadingProgress('Installing game files', done / total);
    const w = await (await fileHandle(dir, e.dest, true)).createWritable();
    await w.write(e.f);
    await w.close();
    done += e.f.size;
    setLoadingProgress('Installing game files', done / total);
  }
  const sig = list.map((e) => `${e.dest}:${e.f.size}`).sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sig));
  await writeMarker([...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join(''));
  $('progress').classList.add('hidden');
}

// ------------------------------------------------------------------ a game the site hosts
// Off unless the site was built with one (deploy_web.sh GAME=<disc image>), which is only for a game the site
// may share: one whose rights holder agreed in writing, or a freely redistributable demo. The image sits beside
// the page in parts (tools/gameparts.py), listed in the file <meta name="rc-game"> names:
//   { version, name, size, parts: [{ file, size, sha256 }] }
// The parts are downloaded into OPFS (DL_DIR, resumed part by part after a reload), each checked, then the image
// is installed as a picked one would be and the download deleted.
const DL_DIR = 'rcdownload';
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// null when the site hosts no game; { unreachable: host } when it does but its list can't be fetched (a network
// that blocks the host, or the host down), so the page can say so instead of only offering the player's own copy
async function hostedGame() {
  const url = document.querySelector('meta[name="rc-game"]')?.content;
  if (!url) return null;
  const abs = new URL(url, location.href);
  try {
    const r = await fetch(abs, { cache: 'no-cache' });
    if (r.ok) return { ...(await r.json()), base: new URL('.', abs).href };
  } catch {}
  return { unreachable: abs.host };
}

async function fetchPart(url, size, progress) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Could not download ${url.split('/').pop()} (${r.status}). Check your connection and reload the page: it carries on where it stopped.`);
  const buf = new Uint8Array(size);
  let n = 0;
  for (const reader = r.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > size) throw new Error('A part of the download is larger than expected: reload the page to try again.');
    buf.set(value, n);
    n += value.length;
    progress(n);
  }
  if (n !== size) throw new Error('The download stopped early. Check your connection and reload the page: it carries on where it stopped.');
  return buf;
}

async function downloadGame(game) {
  const root = await navigator.storage.getDirectory();
  await navigator.storage.persist?.();
  let dl = await root.getDirectoryHandle(DL_DIR, { create: true });
  let state = null;
  try { state = JSON.parse(await (await (await dl.getFileHandle('state.json')).getFile()).text()); } catch {}
  if (state?.version !== game.version) {   // a download of another version starts over
    await root.removeEntry(DL_DIR, { recursive: true });
    dl = await root.getDirectoryHandle(DL_DIR, { create: true });
    state = { version: game.version, done: 0 };
  }
  const image = await dl.getFileHandle('image.iso', { create: true });
  let at = game.parts.slice(0, state.done).reduce((s, p) => s + p.size, 0);
  $('progress').classList.remove('hidden');
  $('eta').classList.add('hidden');
  setLoadingProgress('Downloading game package', at / game.size);
  for (let i = state.done; i < game.parts.length; i++) {
    const p = game.parts[i];
    const shown = (n) => {
      setLoadingProgress('Downloading game package', (at + n) / game.size);
    };
    shown(0);
    const buf = await fetchPart(game.base + p.file, p.size, shown);
    if (hex(await crypto.subtle.digest('SHA-256', buf)) !== p.sha256)
      throw new Error('Part of the download arrived damaged. Reload the page to try again.');
    const w = await image.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: at, data: buf });
    await w.close();
    at += p.size;
    state.done = i + 1;
    const s = await (await dl.getFileHandle('state.json', { create: true })).createWritable();
    await s.write(JSON.stringify(state));
    await s.close();
  }
  setLoadingProgress('Verifying and installing game', 1);
  await importFiles(await isoFiles(await image.getFile()));
  // importFiles writes a content fingerprint for manually imported folders; hosted installs must retain
  // the published package version so the next visit recognises this exact package and does not redownload it.
  await writeMarker(game.version);
  await root.removeEntry(DL_DIR, { recursive: true });
}

// A hosted copy of the game folder: web/serve.py --game DIR serves it at game/, with game/manifest.json
// listing [{ path, size }]. Each file streams straight into OPFS (a phone couldn't hold 500 MB in memory),
// and files already there at the right size are kept, so an interrupted download resumes where it stopped.
async function hostedManifest() {
  // Prefer a folder manifest: one HTTP request per original game asset. This makes every
  // mission/config/map file visible in DevTools > Network and streams each file directly
  // into OPFS. The split-ISO package remains a fallback for sources without this manifest.
  // Only the per-file CDN has game/manifest.json. The pages.dev fallback is an ISO
  // package and is discovered via index.json below; probing its nonexistent manifest caused
  // a predictable 404 on every fresh visit.
  const fileSources = GAME_FILES_SOURCE ? [GAME_FILES_SOURCE] : [];
  const tried = new Set();
  for (const base of fileSources) {
    const sourceBase = new URL(base.href || base, location.href);
    if (tried.has(sourceBase.href)) continue;
    tried.add(sourceBase.href);
    try {
      const manifestURL = new URL('game/manifest.json', sourceBase);
      const response = await fetch(manifestURL, {
        cache: 'no-store', mode: 'cors', credentials: 'omit'
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const manifest = await response.json();
      const rawFiles = Array.isArray(manifest) ? manifest :
        (Array.isArray(manifest?.files) ? manifest.files : null);
      if (!rawFiles?.length) throw new Error('The folder manifest has no files array.');

      const seen = new Set();
      const files = [];
      let total = 0;
      for (const entry of rawFiles) {
        if (!entry || typeof entry.path !== 'string' || !Number.isSafeInteger(entry.size) ||
            entry.size < 0) throw new Error('The folder manifest contains an invalid file entry.');
        const path = entry.path;
        const parts = path.split('/');
        if (!path || path.startsWith('/') || path.includes('\\') ||
            parts.some((part) => !part || part === '.' || part === '..')) {
          throw new Error('The folder manifest contains an unsafe path: ' + path);
        }
        if (SKIP.test(path)) continue;
        const key = path.toLowerCase();
        if (seen.has(key)) throw new Error('The folder manifest contains a duplicate path: ' + path);
        seen.add(key);
        total += entry.size;
        if (!Number.isSafeInteger(total)) throw new Error('The folder manifest total size is invalid.');
        files.push({ path, size: entry.size });
      }
      const lower = (path) => path.toLowerCase();
      if (!files.some((entry) => lower(entry.path) === 'igi.exe') ||
          !files.some((entry) => lower(entry.path).startsWith('common/')) ||
          !files.some((entry) => lower(entry.path).startsWith('missions/')) || total <= 0) {
        throw new Error('The folder manifest must contain igi.exe, COMMON and MISSIONS.');
      }

      const signature = files.map((entry) => entry.path + ':' + entry.size).sort().join('\n');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
      const fingerprint = [...new Uint8Array(digest)].slice(0, 6)
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const version = typeof manifest?.version === 'string' && manifest.version
        ? manifest.version : fingerprint;

      console.info('[download] Using per-file game manifest:', manifestURL.href,
        '| files:', files.length, '| size:', total);
      return {
        format: 'files', files, total, version,
        base: sourceBase.href, prefix: 'game/'
      };
    } catch (error) {
      console.warn('[download] Per-file manifest unavailable at', sourceBase.href,
        '— checking the next source:', errorMessage(error));
    }
  }

  // Existing fallback: a split ISO with SHA-256 checksums, downloaded part-by-part.
  try {
    const indexURL = new URL('index.json', GAME_SOURCE);
    const r = await fetch(indexURL, { cache: 'no-store', mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(`Game package index returned HTTP ${r.status}`);
    const game = await r.json();
    if (!game || typeof game.version !== 'string' || !Array.isArray(game.parts) ||
        !Number.isSafeInteger(game.size) || game.size <= 0) throw new Error('The game package index has an invalid format.');
    let total = 0;
    const parts = game.parts.map((part) => {
      if (!part || typeof part.file !== 'string' || !Number.isSafeInteger(part.size) || part.size <= 0 ||
          typeof part.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(part.sha256)) {
        throw new Error('The game package index contains an invalid download part.');
      }
      const file = part.file.replace(/^\/+/, '');
      const segments = file.split('/');
      if (!file || file.includes('\\') || segments.some((x) => !x || x === '.' || x === '..')) {
        throw new Error('The game package index contains an unsafe file path.');
      }
      total += part.size;
      return { file, size: part.size, sha256: part.sha256.toLowerCase() };
    });
    if (!parts.length || total !== game.size) throw new Error('The game package size does not match its parts.');
    console.info('[download] Using split-ISO fallback:', indexURL.href,
      '| parts:', parts.length, '| size:', total);
    return { ...game, parts, base: new URL('.', indexURL).href, format: 'iso' };
  } catch (error) {
    console.warn('Hosted game package unavailable:', error);
    return null;
  }
}
// The game folder is served through a CDN. A pool of workers makes one request per
// original asset; each response streams directly into OPFS and can resume after a reload.
// Keep the number of simultaneous requests modest: 10 parallel OPFS writers can
// overwhelm ChromeOS storage/network scheduling and leave the final few files stalled.
const DL_CONCURRENCY = 4;
async function importFromServer(source, force = false) {
  const list = Array.isArray(source) ? source : source?.files;
  const base = source?.base || GAME_SOURCE.href;
  const prefix = source?.prefix || '';
  if (!Array.isArray(list) || !list.length) throw new Error('The game file manifest is empty.');

  const stopTips = startTips($('tips'));
  try {
    try { await importFromServerInner(list, base, prefix, source?.version || '', force); }
    catch (err) {
      // Repair missing OPFS paths without deleting the player's completed multi-GB files.
      if (!(err && (err.name === 'NotFoundError' || /could not be found/.test(err.message || '')))) throw err;
      console.warn('[storage] repairing missing OPFS entries:', err.message);
      await importFromServerInner(list, base, prefix, source?.version || '', false);
    }
  } finally {
    stopTips();
  }
}
async function importFromServerInner(list, base, prefix = '', version = '', force = false) {
  await navigator.storage.persist?.();
  const dir = await gameDir(true);
  const total = list.reduce((s, e) => s + e.size, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('The game manifest has an invalid total size.');
  let done = 0, doneFiles = 0, shownAt = 0, lastFile = '';
  const startT = performance.now();
  let baseDone = null, baseT = 0;
  $('progress').classList.remove('hidden');
  $('eta').classList.add('hidden');
  const etaText = (secs) => {
    secs = Math.round(secs);
    if (secs >= 110) return `about ${Math.round(secs / 60)} minutes left`;
    if (secs >= 50) return 'about a minute left';
    if (secs >= 18) return `about ${Math.round(secs / 10) * 10} seconds left`;
    return 'a few seconds left';
  };
  const shown = (forceUpdate) => {
    const now = performance.now();
    if (!forceUpdate && now - shownAt < 120) return;
    shownAt = now;
    setLoadingProgress(lastFile
      ? `Downloading game files · ${doneFiles}/${list.length} · ${lastFile}`
      : `Checking game files · ${doneFiles}/${list.length}`, done / total);
    if (baseDone === null && now - startT > 1500) { baseDone = done; baseT = now; }
    if (baseDone !== null && done < total) {
      const rate = (done - baseDone) / Math.max(0.5, (now - baseT) / 1000);
      if (rate > 60000) {
        $('eta').textContent = etaText((total - done) / rate);
        $('eta').classList.remove('hidden');
      }
    }
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const queue = list.slice().sort((a, b) => b.size - a.size);
  const OPERATION_TIMEOUT = 60000;
  let stopWorkers = false;

  const fetchInto = async (entry, fh) => {
    const ac = new AbortController();
    let reader = null, writer = null, closed = false;
    const within = (promise, label) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ac.abort();
        try { reader?.cancel(); } catch {}
        reject(new Error(`${label} timed out after ${OPERATION_TIMEOUT / 1000}s for ${entry.path}`));
      }, OPERATION_TIMEOUT);
      Promise.resolve(promise).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
    try {
      const url = new URL((prefix + entry.path).split('/').map(encodeURIComponent).join('/'), base).href;
      const response = await within(fetch(url, {
        cache: 'no-store', mode: 'cors', credentials: 'omit', signal: ac.signal
      }), 'Request');
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${entry.path}`);
        error.status = response.status;
        throw error;
      }
      if (!response.body) throw new Error('The response has no readable stream for ' + entry.path);
      const lengthHeader = Number(response.headers.get('content-length'));
      if (Number.isFinite(lengthHeader) && lengthHeader > 0 && lengthHeader !== entry.size) {
        throw new Error(`Content-Length mismatch for ${entry.path}: ${lengthHeader}/${entry.size}`);
      }
      writer = await within(openWriter(fh, OPFS_DIR + '/' + entry.path), 'Storage open');
      reader = response.body.getReader();
      let wrote = 0;
      for (;;) {
        const { done: end, value } = await within(reader.read(), 'Network read');
        if (end) break;
        if (!value?.byteLength) continue;
        if (wrote + value.byteLength > entry.size) {
          throw new Error(`File is larger than the manifest for ${entry.path}: exceeds ${entry.size} bytes`);
        }
        await within(writer.write(value), 'Storage write');
        wrote += value.byteLength;
        aliveProgress();
      }
      if (wrote !== entry.size) {
        throw new Error(`Short download for ${entry.path}: received ${wrote}/${entry.size} bytes`);
      }
      await within(writer.close(), 'Storage close');
      closed = true;
      writer = null;
    } catch (error) {
      try { await reader?.cancel(); } catch {}
      if (writer && !closed) {
        try { await writer.abort(); } catch {}
      }
      throw error;
    } finally {
      try { reader?.releaseLock(); } catch {}
    }
    function aliveProgress() { /* progress is committed only after the complete file closes */ }
  };

  const worker = async () => {
    try {
      for (;;) {
        if (stopWorkers) return;
        const entry = queue.shift();
        if (!entry) return;
        lastFile = entry.path;
        shown(true);
        const fh = await fileHandle(dir, entry.path, true);
        // A file is complete only when its local size matches the manifest.
        let localSize = -1;
        try { localSize = (await fh.getFile()).size; }
        catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
          console.info('[storage] recreating missing local game file:', entry.path);
        }
        if (!force && localSize === entry.size) {
          done += entry.size; doneFiles++; shown();
          continue;
        }
        let ok = false, lastErr;
        for (let attempt = 0; attempt < 5 && !ok; attempt++) {
          try {
            await fetchInto(entry, fh);
            ok = true;
          } catch (error) {
            lastErr = error;
            const statusCode = Number(error?.status);
            const permanentHttpError = statusCode >= 400 && statusCode < 500 &&
              ![408, 409, 425, 429].includes(statusCode);
            if (permanentHttpError || attempt === 4) break;
            await sleep(700 * (attempt + 1));
          }
        }
        if (!ok) {
          stopWorkers = true;
          throw new Error(`Download failed at ${entry.path} (${lastErr?.message || 'network/storage error'}). Your completed files are preserved; reload to retry only incomplete files.`);
        }
        done += entry.size;
        doneFiles++;
        shown();
      }
    } catch (error) {
      stopWorkers = true;
      throw error;
    }
  };

  // Wait for every active worker to stop before reporting a failure. Promise.all rejects
  // immediately and can leave other writers running in the background after the UI fails.
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(DL_CONCURRENCY, list.length) }, () => worker())
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  shown(true);
  if (doneFiles !== list.length || done !== total) {
    throw new Error(`Game file verification did not finish: ${doneFiles}/${list.length} files, ${done}/${total} bytes.`);
  }
  const signature = list.map((entry) => entry.path + ':' + entry.size).sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
  const fingerprint = [...new Uint8Array(digest)].slice(0, 6).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await writeMarker(version || fingerprint);
  $('progress').classList.add('hidden');
  $('eta').classList.add('hidden');
}

// ------------------------------------------------------------------ input

// KeyboardEvent.code -> USB HID usage (what host/input.c's key table uses)
const HID = {};
for (let i = 0; i < 26; i++) HID['Key' + String.fromCharCode(65 + i)] = 4 + i;
for (let i = 1; i <= 9; i++) HID['Digit' + i] = 29 + i;
HID.Digit0 = 39;
Object.assign(HID, {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
  Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, Numpad0: 98, NumpadDecimal: 99,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
});
for (let i = 1; i <= 12; i++) HID['F' + i] = 57 + i;
for (let i = 1; i <= 9; i++) HID['Numpad' + i] = 88 + i;

// Netplay: the keyboard drives this player's pad (the game itself gets no keys or mouse, which would desync).
// Bit 4 is LB, which the game sees as L1: its modifier for lofted shots (the in-game tutorial: "L1 + shot
// button" to hit a six; on the keyboard that's Shift), so Shift holds it as well as Q. The game pauses only
// on the keyboard's Esc, not the pad's Start, so Esc is bit 20: host/netplay.c applies it to the DirectInput
// keyboard on every peer, with the pad inputs (NP_KEY_ESC). Backspace is B, back in menus.
const NET_KEYS = {   // KeyboardEvent.code -> standard-gamepad bit (20: Esc key)
  Enter: 0, Space: 0, KeyS: 0, Escape: 20, Backspace: 1, KeyD: 1, KeyA: 2, KeyW: 3, KeyQ: 4, KeyE: 5,
  ShiftLeft: 4, ShiftRight: 4,
  Digit1: 6, Digit3: 7, Tab: 8, KeyP: 9, ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15,
};
let netKeyBits = 0;
let netKeyPressed = 0;   // keys pressed since the last poll, so a tap shorter than a frame still counts

// ---- Single-player key remapping ----------------------------------------------------------------
// The game's own control bindings (its config.qvm) stay at their defaults; here we translate the
// player's chosen physical keys onto the game's default key for each action, entirely in the browser
// and saved per browser (localStorage), so keys can be rebound without touching the game. Netplay is
// unaffected: online, the keyboard only drives the pad (above), never raw keys.
// Two layouts ("presets"): the game's ORIGINAL keys (arrows, Right Shift, Right Ctrl, numpad; what the game's
// own Configuration screen shows, and what players of the 2000 game remember) and a MODERN WASD layout. The
// original one is the default for new players, as the game ships; a few extra keys stand in for the numpad
// and Right Ctrl that laptops don't have. Keys not listed here reach the game unchanged in both layouts.
// id, label, { original, modern }: default physical KeyboardEvent.code per preset (null = unbound), the game's
// default key for that action (its code), group
const CONTROLS = [
  ['forward', 'Move forward',   { original: 'ArrowUp',      modern: 'KeyW' },        'ArrowUp',      'Movement'],
  ['back',    'Move backward',  { original: 'ArrowDown',    modern: 'KeyS' },        'ArrowDown',    'Movement'],
  ['left',    'Strafe left',    { original: 'ArrowLeft',    modern: 'KeyA' },        'ArrowLeft',    'Movement'],
  ['right',   'Strafe right',   { original: 'ArrowRight',   modern: 'KeyD' },        'ArrowRight',   'Movement'],
  ['walkrun', 'Walk / run',     { original: 'KeyW',         modern: 'ShiftLeft' },   'KeyW',         'Movement'],
  ['crouch',  'Crouch',         { original: 'ControlRight', modern: 'ControlLeft' }, 'ControlRight', 'Movement'],
  ['crouch2', 'Crouch (alt)',   { original: 'ControlLeft',  modern: null },          'ControlRight', 'Movement'],
  ['jump',    'Jump',           { original: 'Numpad0',      modern: 'Space' },       'Numpad0',      'Movement'],
  ['jump2',   'Jump (alt)',     { original: 'KeyX',         modern: null },          'Numpad0',      'Movement'],
  ['peek',    'Peek',           { original: 'Numpad1',      modern: 'KeyQ' },        'Numpad1',      'Movement'],
  ['peek2',   'Peek (alt)',     { original: 'KeyQ',         modern: 'KeyE' },        'Numpad1',      'Movement'],
  ['reload',  'Reload',         { original: 'Enter',        modern: 'KeyR' },        'Enter',        'Weapons & action'],
  ['zoomin',  'Zoom in',        { original: 'PageUp',       modern: 'Digit1' },      'PageUp',       'Weapons & action'],
  ['zoomout', 'Zoom out',       { original: 'PageDown',     modern: 'Digit3' },      'PageDown',     'Weapons & action'],
  ['use',     'Use / activate', { original: 'ShiftRight',   modern: 'Tab' },         'ShiftRight',   'Weapons & action'],
  ['bino',    'Binoculars',     { original: 'Space',        modern: 'KeyB' },        'Space',        'Weapons & action'],   // in the modern layout Space is Jump
];
const PRESETS = { original: 'Original (as the game ships)', modern: 'Modern (WASD)' };
const CONTROL_STORE = 'igi-controls';
const PRESET_STORE = 'igi-preset';
let preset = 'original';
// how a KeyboardEvent.code reads on screen
function keyLabel(code) {
  if (!code) return '—';
  const m = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', AltLeft: 'L-Alt', AltRight: 'R-Alt', Space: 'Space',
    Enter: 'Enter', NumpadEnter: 'Num ⏎', Tab: 'Tab', Escape: 'Esc', Backspace: '⌫', CapsLock: 'Caps',
    PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins', Delete: 'Del',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  };
  if (m[code]) return m[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
let userKeys = {};   // id -> physical KeyboardEvent.code
let keyRemap = {};   // physical code -> HID usage to send to the game
function rebuildRemap() {
  keyRemap = {};
  for (const [id, , , target] of CONTROLS) {
    const phys = userKeys[id], u = HID[target];
    if (phys && u !== undefined) keyRemap[phys] = u;
  }
}
function loadControls() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONTROL_STORE) || '{}') || {}; } catch { saved = {}; }
  try { if (PRESETS[localStorage.getItem(PRESET_STORE)]) preset = localStorage.getItem(PRESET_STORE); } catch { /* storage blocked */ }
  userKeys = {};
  for (const [id, , def] of CONTROLS) userKeys[id] = typeof saved[id] === 'string' || saved[id] === null ? saved[id] : def[preset];
  rebuildRemap();
}
function saveControls() {
  try { localStorage.setItem(CONTROL_STORE, JSON.stringify(userKeys)); localStorage.setItem(PRESET_STORE, preset); } catch { /* storage blocked */ }
}
function applyPreset(name) {
  preset = PRESETS[name] ? name : 'original';
  for (const [id, , def] of CONTROLS) userKeys[id] = def[preset];
  saveControls(); rebuildRemap();
}
// Players from before the layouts existed (the site remapped to WASD then, with no choice) keep WASD: their
// saved keys, or, with none saved, the modern preset when the game was already installed in this browser
// (boot() calls this once it knows). New players get the game's own keys.
function migratePreset(installed) {
  let had = false;
  try { had = localStorage.getItem(PRESET_STORE) !== null; } catch { /* storage blocked */ }
  if (had) return;
  let custom = false;
  try { custom = localStorage.getItem(CONTROL_STORE) !== null; } catch { /* storage blocked */ }
  if (custom) { preset = 'modern'; saveControls(); loadControls(); }
  else if (installed) applyPreset('modern');
  else applyPreset('original');
  setupControls.render?.();
}
loadControls();

// The keyboard panel (index.html #kbd) doubles as the rebind UI: click a key, then press the new one.
function setupControls() {
  // This modal contains only game settings. Keyboard reference/rebinding remains outside it.
  const displayHost = $('settings-display');
  const mouseHost = $('settings-mouse');
  const touchHost = $('settings-touch');
  const C = RcControls;
  if (!displayHost && !mouseHost && !touchHost) return;

  const fmt = (value) => Number(value).toFixed(1) + '×';
  const slider = (label, key, min, max, step, value) =>
    '<label class="setting-slider"><span>' + label +
    '<output data-output="' + key + '">' + fmt(value) + '</output></span>' +
    '<input type="range" min="' + min + '" max="' + max + '" step="' + step +
    '" value="' + value + '" data-setting="' + key + '" aria-label="' + label + '"></label>';

  const render = () => {
    const s = C.get();

    if (displayHost) {
      displayHost.innerHTML =
        '<p class="settings-help">Choose how the 3D game view fits your screen. The original menus remain in their native 4:3 layout.</p>' +
        '<div class="settings-segment" data-choice="wide">' +
          '<button type="button" data-value="1"' + (s.wide ? ' class="selected" aria-pressed="true"' : ' aria-pressed="false"') + '>Widescreen</button>' +
          '<button type="button" data-value="0"' + (!s.wide ? ' class="selected" aria-pressed="true"' : ' aria-pressed="false"') + '>Original 4:3</button>' +
        '</div>';
      displayHost.querySelectorAll('[data-choice="wide"] button').forEach((button) => {
        button.addEventListener('click', () => { C.set('wide', button.dataset.value === '1'); render(); });
      });
    }

    if (mouseHost) {
      const select = (button) => '<select data-mouse-button="' + button + '" aria-label="Mouse button ' + button + '">' +
        C.MOUSE_CHOICES.map((action) => '<option value="' + action + '"' +
          (s.mouse[button] === action ? ' selected' : '') + '>' + C.ACTIONS[action].label + '</option>').join('') + '</select>';
      mouseHost.innerHTML =
        '<div class="settings-subsection"><h3>Mouse buttons</h3>' +
          '<div class="setting-select-row"><label>Left button' + select(0) + '</label>' +
          '<label>Middle button' + select(1) + '</label>' +
          '<label>Right button' + select(2) + '</label></div>' +
        '</div>' +
        '<div class="settings-subsection"><h3>Mouse &amp; aiming sensitivity</h3>' +
          slider('Mouse sensitivity', 'mouseSens', 0.2, 3, 0.1, s.mouseSens) +
          slider('Sensitivity while scoped', 'scopeSens', 0.3, 3, 0.1, s.scopeSens) +
        '</div>';
      mouseHost.querySelectorAll('select[data-mouse-button]').forEach((selectEl) => {
        selectEl.addEventListener('change', () => C.setMouse(Number(selectEl.dataset.mouseButton), selectEl.value));
      });
      mouseHost.querySelectorAll('input[type="range"]').forEach((range) => {
        range.addEventListener('input', () => {
          C.set(range.dataset.setting, Number(range.value));
          const output = mouseHost.querySelector('[data-output="' + range.dataset.setting + '"]');
          if (output) output.textContent = fmt(range.value);
        });
      });
    }

    if (touchHost) {
      const gyroModes = [['off', 'Off'], ['scope', 'Scoped only'], ['on', 'Always']];
      const zooms = [2, 4, 6, 8];
      touchHost.innerHTML =
        '<div class="settings-subsection"><h3>Touch aiming</h3>' +
          slider('Swipe sensitivity', 'look', 0.3, 3, 0.1, s.look) +
          '<div class="setting-choice-row"><span>Scope button zoom level</span><div class="settings-segment compact" data-choice="scopeZoom">' +
          zooms.map((zoom) => '<button type="button" data-value="' + zoom + '"' +
            (s.scopeZoom === zoom ? ' class="selected" aria-pressed="true"' : ' aria-pressed="false"') + '>' + zoom + '×</button>').join('') +
          '</div></div>' +
        '</div>' +
        '<div class="settings-subsection"><h3>Gyroscope</h3>' +
          '<div class="setting-choice-row"><span>Gyroscope aiming</span><div class="settings-segment" data-choice="gyro">' +
          gyroModes.map(([value, label]) => '<button type="button" data-value="' + value + '"' +
            (s.gyro === value ? ' class="selected" aria-pressed="true"' : ' aria-pressed="false"') + '>' + label + '</button>').join('') +
          '</div></div>' +
          slider('Gyroscope sensitivity', 'gyroSens', 0.2, 3, 0.1, s.gyroSens) +
          '<div class="settings-checks">' +
            '<label><input type="checkbox" data-setting-check="gyroInvY"' + (s.gyroInvY ? ' checked' : '') + '> Invert up / down</label>' +
            '<label><input type="checkbox" data-setting-check="gyroInvX"' + (s.gyroInvX ? ' checked' : '') + '> Invert left / right</label>' +
          '</div><p class="settings-help" id="gyro-status"></p>' +
        '</div>';
      touchHost.querySelectorAll('input[type="range"]').forEach((range) => {
        range.addEventListener('input', () => {
          C.set(range.dataset.setting, Number(range.value));
          const output = touchHost.querySelector('[data-output="' + range.dataset.setting + '"]');
          if (output) output.textContent = fmt(range.value);
        });
      });
      touchHost.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.addEventListener('change', () => C.set(checkbox.dataset.settingCheck, checkbox.checked));
      });
      touchHost.querySelectorAll('[data-choice="scopeZoom"] button').forEach((button) => {
        button.addEventListener('click', () => { C.set('scopeZoom', Number(button.dataset.value)); render(); });
      });
      touchHost.querySelectorAll('[data-choice="gyro"] button').forEach((button) => {
        button.addEventListener('click', async () => {
          C.set('gyro', button.dataset.value);
          render();
          if (button.dataset.value !== 'off') {
            await C.gyroEnable();
            window.setTimeout(render, 1600);
          }
        });
      });
      const gyroStatus = touchHost.querySelector('#gyro-status');
      if (gyroStatus) {
        const state = C.gyroState();
        gyroStatus.textContent = s.gyro === 'off' ? 'Gyroscope aiming is off.'
          : state === 'denied' ? 'Motion permission was denied. Allow motion access in browser site settings and try again.'
          : state === 'none' ? 'No gyroscope was detected on this device.'
          : state === 'on' ? (s.gyro === 'scope' ? 'Aiming activates while scoped.' : 'Gyroscope aiming is enabled.')
          : 'Waiting for motion permission or the first sensor reading.';
      }
    }
  };

  const reset = $('kbd-reset');
  if (reset) reset.addEventListener('click', () => { C.reset(); render(); });
  render();
}
function hookInput(M, net) {
  const canvas = $('canvas');
  if (net) {
    const key = (down) => (e) => {
      const bit = NET_KEYS[e.code];
      if (bit === undefined) return;
      e.preventDefault();
      if (down) { netKeyBits |= 1 << bit; netKeyPressed |= 1 << bit; } else netKeyBits &= ~(1 << bit);
      pollLocalPad(M);   // straight to the game: waiting for the next animation frame would add up to 16 ms
    };
    window.addEventListener('keydown', key(true));
    window.addEventListener('keyup', key(false));
    window.addEventListener('blur', () => { netKeyBits = 0; pollLocalPad(M); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    return;
  }
  const C = RcControls;
  C.attach(M);
  const key = (down) => (e) => {
    const u = keyRemap[e.code] !== undefined ? keyRemap[e.code] : HID[e.code];
    if (u === undefined || e.repeat) return;
    if (!(e.metaKey && !down)) e.preventDefault();
    C.keyUsage(u, down);   // a weapon key drops the scope state (controls.js)
    M._input_key_hid(u, down ? 1 : 0);
  };
  window.addEventListener('keydown', key(true));
  window.addEventListener('keyup', key(false));
  // The game draws its own cursor and reads relative motion. Lock the pointer when the browser allows
  // it (then the system cursor can't leave the game); without a lock, motion over the canvas still works.
  // Each button does the action the player bound to it (controls.js; the Controls panel): in a mission
  // only, the menus always get the plain click. The action a press started is what its release ends, even
  // if the binding or the mission state changed in between.
  const held = {};
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) {
      const p = canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    }
    if (held[e.button]) C.act(held[e.button], false);
    held[e.button] = C.mouseAction(e.button);
    C.act(held[e.button], true);
  });
  window.addEventListener('mouseup', (e) => { if (held[e.button]) { C.act(held[e.button], false); held[e.button] = null; } });
  // Without the pointer lock the mouse stops at the window's edge, so the view can only turn so far ("the
  // mouse only works 180 degrees"). Esc (the game's menu) always releases the lock, and not every player
  // clicks again afterwards: take it back on the next key press (a user gesture, which the lock needs) while
  // a mission is running, and say so on screen meanwhile.
  const relock = () => {
    if (!C.inMission() || C.paused() || document.pointerLockElement === canvas) return;
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  };
  window.addEventListener('keydown', (e) => { if (!e.repeat && e.code !== 'Escape') relock(); });
  const locktip = $('locktip');
  if (locktip && !RcTouch.wanted()) setInterval(() => {
    locktip.classList.toggle('hidden', !(C.inMission() && !C.paused() && document.pointerLockElement !== canvas && document.hasFocus()));
  }, 500);
  // Relative motion, scaled by the mouse sensitivity setting in a mission (fractions carry over, so 1 = the
  // raw counts as before). The engine (dinput.c) inverts look-Y only during a mission, so the 2D menus keep
  // their normal cursor direction.
  canvas.addEventListener('mousemove', (e) => {
    if (!C.inMission()) { M._input_mouse_move(e.movementX, e.movementY); return; }
    const k = C.get().mouseSens * C.lookScale();   // slower while scoped, in step with the zoom
    C.look(e.movementX * k, e.movementY * k);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // Mouse wheel cycles weapons: up = next (the game's right-click), down = previous (its O key). A short
  // lock keeps a fast flick from stacking presses; each is held ~100 ms so a game frame samples it.
  let wheelLock = 0;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelLock = now + 140;
    C.weaponChanged();
    if (e.deltaY < 0) { M._input_mouse_button(1, 1); setTimeout(() => M._input_mouse_button(1, 0), 100); }
    else { M._input_key_hid(18, 1); setTimeout(() => M._input_key_hid(18, 0), 100); }
  }, { passive: false });
}

// Gamepads (Gamepad API, polled every animation frame). Browsers only expose a pad after a button press
// on it. The game sees each pad as a DirectInput "Logitech Dual Action USB" (host/dinput.c); ?pads=N exposes
// N of them (default 1, at most 4). Like the native feeder (host/window.c), slots are DirectInput pad
// numbers handed out in connection order, not the browser's gamepad.index (which can start above 0, e.g.
// after a reconnect), and a pad keeps its slot until it is unplugged.
// With mapping 'standard' buttons and axes are already in the layout input_gamepad() takes. Other pads
// (older DirectInput-era ones such as the Logitech Precision) report buttons in HID order, as Windows
// DirectInput presents them and as the game's controltypes.csv expects; their axes are indexed by HID
// usage (X Y Z Rx Ry Rz ...), so the right stick is Z/Rz and Chrome puts the hat switch at axes[9].
const PAD_SLOTS = 4;
const padLast = Array.from({ length: PAD_SLOTS }, () => '');
const padSlotIndex = Array(PAD_SLOTS).fill(-1);   // slot -> gamepad.index
const padHats = new Set();   // gamepad.index of pads whose axes[9] is a hat switch
// raw button n -> standard-layout bit that host/dinput.c turns back into DirectInput button n
const STD_FOR_RAW = [2, 0, 1, 3, 4, 5, 6, 7, 9, 8, 10, 11];
// Chrome's hat axis: -1 = up, then clockwise in steps of 2/7; anything outside [-1, 1] is centred
const HAT_DIRS = [1 << 12, (1 << 12) | (1 << 15), 1 << 15, (1 << 13) | (1 << 15), 1 << 13, (1 << 13) | (1 << 14), 1 << 14, (1 << 12) | (1 << 14)];
const axis16 = (v) => Math.round(Math.max(-1, Math.min(1, v || 0)) * 32767);

function readPad(g) {
  let buttons = 0;
  if (g.mapping === 'standard') {
    g.buttons.forEach((b, i) => { if (i < 17 && (b.pressed || b.value > 0.3)) buttons |= 1 << i; });
    return { buttons, ax: [0, 1, 2, 3].map((i) => axis16(g.axes[i])) };
  }
  g.buttons.forEach((b, i) => { if (i < STD_FOR_RAW.length && (b.pressed || b.value > 0.3)) buttons |= 1 << STD_FOR_RAW[i]; });
  // axes[9] is only taken as a hat once it has shown the centred value, so a plain axis resting at 0 isn't
  // read as d-pad down
  const hat = g.axes[9];
  if (hat > 1.1) padHats.add(g.index);
  else if (padHats.has(g.index) && hat >= -1.01) buttons |= HAT_DIRS[Math.round((hat + 1) * 3.5) % 8];
  const ry = g.axes.length > 5 ? g.axes[5] : g.axes[3];
  return { buttons, ax: [axis16(g.axes[0]), axis16(g.axes[1]), axis16(g.axes[2]), axis16(ry)] };
}

// Netplay: one local pad, the first connected gamepad merged with the keyboard (host/netplay.c sends it).
// Called from the key handlers and from a 1 ms timer (not just the animation frame), so a change reaches
// the game thread within a few ms wherever it is in its frame.
let netLast = '';
function pollLocalPad(M) {
  const g = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find((p) => p && p.connected);
  const { buttons, ax } = g ? readPad(g) : { buttons: 0, ax: [0, 0, 0, 0] };
  const b = buttons | netKeyBits | netKeyPressed;
  netKeyPressed = 0;
  const key = `${b}:${ax.join(',')}`;
  if (key === netLast) return;
  netLast = key;
  M._input_gamepad(0, 1, b, ax[0], ax[1], ax[2], ax[3]);
}

function pollGamepads(M) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((g) => g && g.connected) : [];
  // free the slots of unplugged pads, then give new pads the lowest free slot
  for (let s = 0; s < PAD_SLOTS; s++)
    if (padSlotIndex[s] >= 0 && !pads.some((g) => g.index === padSlotIndex[s])) { padHats.delete(padSlotIndex[s]); padSlotIndex[s] = -1; }
  for (const g of pads) {
    if (padSlotIndex.includes(g.index)) continue;
    const s = padSlotIndex.indexOf(-1);
    if (s < 0) break;
    padSlotIndex[s] = g.index;
    console.log(`gamepad ${g.index} -> pad ${s}: ${g.id} (${g.mapping || 'non-standard'} mapping, ${g.buttons.length} buttons, ${g.axes.length} axes)`);
  }
  for (let slot = 0; slot < PAD_SLOTS; slot++) {
    const g = pads.find((p) => p.index === padSlotIndex[slot]);
    const { buttons, ax } = g ? readPad(g) : { buttons: 0, ax: [0, 0, 0, 0] };
    const connected = g ? 1 : 0;
    const key = `${connected}:${buttons}:${ax.join(',')}`;
    if (key === padLast[slot]) continue;
    padLast[slot] = key;
    M._input_gamepad(slot, connected, buttons, ax[0], ax[1], ax[2], ax[3]);
  }
}

// ------------------------------------------------------------------ audio

// The context is made by run() while the Play click still counts as a user gesture, so it usually starts
// right away. Otherwise (?autoplay, a browser that wants a gesture on the game itself) it waits for the next
// click or key on the page, and a hint says so.
function newAudioContext() {
  if (params.has('mute') || !window.AudioContext) return null;
  try { return new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' }); } catch { return null; }
}

async function startAudio(M, ctx) {
  if (!ctx) return;
  await ctx.audioWorklet.addModule('audio-worklet.js');
  const node = new AudioWorkletNode(ctx, 'rc-ring', { outputChannelCount: [2] });
  node.port.postMessage({ memory: M.wasmMemory, ring: M._rc_audio_ring() });
  node.connect(ctx.destination);
  const tip = $('soundtip');
  const sync = () => tip.classList.toggle('hidden', ctx.state === 'running' || ctx.state === 'closed');
  const resume = () => { if (ctx.state !== 'running') ctx.resume().then(sync, sync); };
  // capture phase, so no other handler can keep the gesture from reaching here
  for (const ev of ['pointerdown', 'mousedown', 'keydown', 'touchend'])
    window.addEventListener(ev, resume, { capture: true });
  ctx.onstatechange = () => { sync(); if (ctx.state === 'interrupted') resume(); };   // Safari: interrupted
  resume();
  sync();
}

// ------------------------------------------------------------------ run

const isWebKit = () => /AppleWebKit\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);
// The compact layout (runtime.c RC_MEM_COMPACT) is now the default everywhere, not only on WebKit: with the
// full layout the engine's memory is grown to ~1.8 GB at start (reserved for the game's 32-bit address space,
// mostly never touched), and on Windows that whole size counts as committed memory, which is what pushes an
// 8 GB machine with other things open into paging (the field reports' minute-long whole-process freezes).
// Compact keeps it at ~0.5 GB and grows it only as the game allocates. ?mem=full restores the old layout.
function compactMemory() {
  const want = params.get('mem');
  return want !== 'full';
}

// The browser dropped the WebGPU device (its GPU process died, or the page was pushed out of memory): the
// game can't draw any more (render_wgpu.c calls this). Say so instead of leaving a frozen picture.
let gpuLostAt = 0, gpuFailTimer = 0;
function gpuReloadPrompt(msg) {
  if ($('gpulost')) return;
  $('gpurestore')?.remove();
  const d = document.createElement('div');
  d.id = 'gpulost';
  d.style.cssText = 'position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(0,0,0,.92);color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px';
  const card = document.createElement('div');
  const heading = document.createElement('p');
  heading.textContent = 'The graphics device could not be restored';
  heading.style.cssText = 'font-size:20px;margin:0 0 8px';
  const detail = document.createElement('p');
  detail.textContent = 'The browser stopped the game renderer' + (msg ? ' (' + String(msg).slice(0,160) + ')' : '') + '. Reload the game to try again.';
  detail.style.cssText = 'opacity:.8;margin:0 0 18px';
  const button = document.createElement('button');
  button.textContent = 'Reload the game';
  button.style.cssText = 'font:inherit;padding:10px 22px;border-radius:8px;border:0;background:#45cf79;color:#000;font-weight:700';
  button.onclick = () => location.reload();
  card.append(heading, detail, button); d.appendChild(card); document.body.appendChild(d);
}
window.rcDeviceLost = (msg) => {
  if (!gpuLostAt) gpuLostAt = performance.now();
  if (!$('gpurestore')) {
    const n = document.createElement('div');
    n.id = 'gpurestore';
    n.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:49;padding:8px 14px;border-radius:9px;background:rgba(8,14,10,.9);border:1px solid rgba(255,255,255,.22);color:#fff;font:13px system-ui,sans-serif';
    n.textContent = 'Restoring graphics…';
    document.body.appendChild(n);
  }
  const check = () => {
    if (!gpuLostAt) return;
    if (document.hidden) { gpuFailTimer = setTimeout(check, 1000); return; }
    if (performance.now() - gpuLostAt > 20000) { gpuReloadPrompt(msg); return; }
    gpuFailTimer = setTimeout(check, 1000);
  };
  clearTimeout(gpuFailTimer); gpuFailTimer = setTimeout(check, 1000);
};
window.rcDeviceRestored = () => {
  gpuLostAt = 0; clearTimeout(gpuFailTimer); $('gpurestore')?.remove();
};
window.rcRecoverFailed = (final) => {
  if (final) { clearTimeout(gpuFailTimer); gpuReloadPrompt(''); }
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gpuLostAt) gpuLostAt = performance.now();
});

function sizeCanvas() {
  const canvas = $('canvas');
  const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(640, Math.round(r.width * dpr));
  canvas.height = Math.max(480, Math.round(r.height * dpr));
}

// On a phone the stage is fixed to the viewport (index.html: body.coarse #stage). If the page ends up zoomed
// or scrolled (iOS does that around rotation and fullscreen, Android when the browser's zoom setting is on),
// a fixed box is laid out to the layout viewport and overflows the screen: the picture is cropped and the
// touch controls land off-screen. Size and place the stage on the VISUAL viewport instead whenever the two
// differ; with no zoom and no offset this sets exactly the box the stylesheet gives it.
function followVisualViewport(stage) {
  const vv = window.visualViewport;
  if (!vv) return;
  let applied = false;
  const apply = () => {
    const zoomed = Math.abs(vv.scale - 1) > 0.01 || vv.offsetLeft > 0.5 || vv.offsetTop > 0.5 ||
      Math.abs(vv.width - innerWidth) > 1 || Math.abs(vv.height - innerHeight) > 1;
    if (!zoomed && !applied) return;
    applied = zoomed;
    if (!zoomed) { stage.style.cssText = ''; return; }
    stage.style.cssText = `position:fixed;inset:auto;left:${vv.offsetLeft}px;top:${vv.offsetTop}px;width:${vv.width}px;` +
      `height:${vv.height}px;aspect-ratio:auto;border-radius:0;box-shadow:none`;
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 300));
  apply();
}

// A netplay session: every peer starts from the same empty saves folder, kept apart from this browser's
// normal saves (one per player slot, so two tabs of one browser can play each other).
const netSaves = (session) => `rcnetplay-${session.you}`;
async function clearNetSaves(session) {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(netSaves(session), { recursive: true }); } catch { /* not there yet */ }
}

function showNetStatus(M, session) {
  const el = $('netstatus');
  el.classList.remove('hidden');
  let lastFrame = 0, lastT = performance.now();
  setInterval(() => {
    const frame = M._netplay_status(0), desync = M._netplay_status(2), stalls = M._netplay_status(3);
    const now = performance.now();
    // the game thread always idles until the next frame's inputs arrive; it's only "waiting" when that
    // holds the game below full speed
    const fps = ((frame - lastFrame) * 1000) / Math.max(1, now - lastT);
    lastFrame = frame; lastT = now;
    el.classList.toggle('bad', !!desync);
    // the round trip the inputs ride on, and how many frames the delay failed to cover (a stall is a
    // frame that waited over 10 ms for the others' inputs: the game froze that long)
    const trips = session.client.trips();
    const path = trips.direct ? `direct ${trips.direct} ms` : `relayed ${trips.room} ms`;
    el.textContent = desync ? `Out of sync since frame ${desync}: restart the session`
      : `Online · player ${session.you + 1} of ${session.players} · delay ${session.delay}` +
        ` · ${path}` + (stalls ? ` · ${stalls} stalls` : '') +
        (session.reconnecting ? ' · reconnecting…' : frame > 300 && fps < 50 ? ' · waiting for players' : '') +
        (session.left?.size ? ` · ${session.left.size} left` : '');
  }, 1000);
}

function webgl2Available() {
  // Ask for the browser's normal WebGL 2 context first. Some ChromeOS drivers reject a
  // high-performance hint even though their default OpenGL ES 3.0 context works.
  // Use a fresh throwaway canvas for each attempt and explicitly release a successful
  // probe context so the real game canvas can obtain its own context afterwards.
  const attempts = [
    undefined,
    { failIfMajorPerformanceCaveat: false },
    { failIfMajorPerformanceCaveat: false, powerPreference: 'low-power' },
  ];
  for (const attributes of attempts) {
    const test = document.createElement('canvas');
    let gl = null;
    try {
      gl = attributes ? test.getContext('webgl2', attributes) : test.getContext('webgl2');
      if (!gl) continue;
      const version = gl.getParameter(gl.VERSION) || 'WebGL 2';
      const renderer = gl.getParameter(gl.RENDERER) || 'unknown renderer';
      if (!webgl2Available.reported) {
        webgl2Available.reported = true;
        console.info('[renderer] WebGL 2 probe succeeded:', renderer, '|', version);
      }
      try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* probe cleanup is best-effort */ }
      return true;
    } catch (error) {
      console.warn('[renderer] WebGL 2 probe attempt failed:', errorMessage(error));
    }
  }
  console.warn('[renderer] WebGL 2 is unavailable on this browser/device.');
  return false;
}
function isChromeOSDevice() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /\bCrOS\b/i.test(ua) || /^Chrome OS$/i.test(platform);
}
async function webgpuDeviceAvailable() {
  const gpu = navigator.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return false;

  // Do not treat the presence of navigator.gpu (or an adapter object alone) as proof
  // that the device can actually be created. Some ChromeOS/Android drivers expose the
  // API but reject device creation; the C renderer would otherwise wait without a frame.
  const requests = [{ powerPreference: 'high-performance' }, undefined];
  for (const options of requests) {
    let adapter = null;
    try { adapter = await gpu.requestAdapter(options); } catch { adapter = null; }
    if (!adapter) continue;
    let device = null;
    try {
      device = await adapter.requestDevice();
      if (device) {
        device.destroy();
        return true;
      }
    } catch (err) {
      console.warn('[renderer] WebGPU adapter could not create a device; checking fallback:', errorMessage(err));
    }
  }
  return false;
}
async function chooseRendererForLaunch() {
  const forced = params.get('renderer');
  const hasGL = webgl2Available();

  // A URL-selected renderer is used only for the one controlled fallback attempt.
  if (forced === 'gpu') {
    if (await webgpuDeviceAvailable()) return 'gpu';
    if (hasGL) {
      console.warn('[renderer] Requested WebGPU is not usable; falling back to WebGL 2.');
      return 'gl';
    }
    return 'gpu';
  }
  if (forced === 'gl') {
    if (hasGL) {
      console.info('[renderer] WebGL 2 was explicitly requested; using the OpenGL ES 3.0 path.');
      return 'gl';
    }
    console.warn('[renderer] WebGL 2 was explicitly requested but is unavailable; checking WebGPU.');
    return 'gpu';
  }

  // Keep a previously successful WebGL fallback for this browser.
  try {
    const saved = localStorage.getItem('igi-renderer-gl');
    if (saved && hasGL) {
      console.info('[renderer] Reusing the WebGL 2 renderer that previously worked in this browser.');
      return 'gl';
    }
  } catch { /* storage blocked */ }

  // Match the known-good reference path on ChromeOS: WebGL 2 / OpenGL ES 3.0.
  // The GL executor is already included in recomp.wasm. If it presents a black frame,
  // the existing one-time recovery path retries WebGPU; this avoids an endless renderer loop.
  if (isChromeOSDevice() && hasGL) {
    console.info('[renderer] ChromeOS detected: starting with WebGL 2 / OpenGL ES 3.0.');
    return 'gl';
  }

  // Elsewhere, require a real WebGPU device, not just navigator.gpu or an adapter handle.
  if (await webgpuDeviceAvailable()) {
    console.info('[renderer] WebGPU adapter and device are available; starting with WebGPU.');
    return 'gpu';
  }

  if (hasGL) {
    console.info('[renderer] WebGPU could not create a device; starting with WebGL 2 / OpenGL ES 3.0.');
    return 'gl';
  }
  console.error('[renderer] Neither a usable WebGPU device nor a WebGL 2 context is available.');
  return 'gpu';
}

// These hashes identify the exact committed JavaScript/WebAssembly pair. The assets are
// served immutable, so both URLs must change whenever either compiled file is replaced.
const ENGINE_BUILD_VERSION = 'c5fd0c40-fa14e4e0';

function assertThreadedWasmSupport() {
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined' || typeof Worker !== 'function') {
    throw new Error('This page is not ready for the threaded WebAssembly game engine. The browser requires a secure, cross-origin-isolated page with COOP: same-origin and COEP: require-corp headers. Reload the official https://project-igi.online/play page; do not use an unisolated mirror or embedded preview.');
  }
  try {
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  } catch (error) {
    throw new Error('This browser cannot create shared WebAssembly memory required by the game engine: ' + errorMessage(error));
  }
}

async function run(session) {
  assertThreadedWasmSupport();
  const audio = newAudioContext();   // first, while the click that called run() is still a user gesture
  const touch = !session && RcTouch.wanted();
  if (touch) RcTouch.goFullscreen($('stage'));   // also needs the gesture
  $('panel').classList.add('hidden');
  document.body.classList.add('playing');   // enables the touch re-fullscreen pill (index.html)
  showBoot();   // cover the black canvas until the first frame renders (see frame loop below)
  window.RC_RENDERER = await chooseRendererForLaunch();   // adapter selection happens only after Play, never as a startup gate
  console.info('[renderer] selected launch backend:', window.RC_RENDERER,
    '| ChromeOS:', isChromeOSDevice(), '| crossOriginIsolated:', !!window.crossOriginIsolated,
    '| WebGPU API:', !!navigator.gpu, '| deviceMemory:', navigator.deviceMemory || 'unknown');
  if (touch) {
    // on a phone the game starts fullscreen; if the player later leaves it, #refull gets them back in
    $('refull').onclick = () => RcTouch.goFullscreen($('stage'), true);
  } else { fullscreenTip(); controlsTip(); }
  if (session) await clearNetSaves(session);
  sizeCanvas();
  const script = document.createElement('script');
  // Load the files from their actual deployed location. This avoids a rewrite-dependent WASM URL
  // and makes Emscripten's scriptDirectory point at the matching recomp.wasm beside this script.
  script.src = '/web/build/recomp.js?v=' + ENGINE_BUILD_VERSION;
  await new Promise((resolve, reject) => {
    script.onload = () => {
      if (typeof createRecomp !== 'function') {
        reject(new Error('The browser engine script loaded but did not provide createRecomp. The deployed build files may be incomplete or mismatched.'));
        return;
      }
      resolve();
    };
    script.onerror = () => reject(new Error('The compiled game engine is missing or could not be loaded from /web/build/recomp.js. Imported game files are only the game data; the website also needs its generated recomp.js and matching WebAssembly file.'));
    document.head.appendChild(script);
  });
  const M = await createRecomp({
    arguments: ['/opfs/' + OPFS_DIR],
    locateFile: (path, prefix) => path.endsWith('recomp.wasm') ? '/web/build/recomp.wasm?v=' + ENGINE_BUILD_VERSION : prefix + path,
    print: (t) => console.log(t),
    printErr: (t) => console.error('[engine]', t),
    preRun: [(m) => {
      if (params.has('mute')) m.ENV.RC_NO_AUDIO = '1';
      if (params.get('exe')) m.ENV.RC_EXE = params.get('exe');
      if (params.has('log')) m.ENV.RC_LOG = '1';
      if (params.has('pads')) m.ENV.RC_PADS = params.get('pads');
      if (params.has('input')) m.ENV.RC_INPUT = params.get('input');   // testing: scripted input (host/input.c)
      if (params.has('noyield')) m.ENV.RC_NO_YIELD = '1';               // testing: the game's poll spins unyielded (host/user32.c)
      if (params.has('peeklog')) m.ENV.RC_PEEK_LOG = '1';               // testing: poll interval log in the console
      if (params.has('poke')) m.ENV.RC_POKE = params.get('poke');      // testing: memory pokes (host/input.c)
      if (params.has('queue')) m.ENV.RC_QUEUE = params.get('queue');
      if (params.has('gpuskip')) m.ENV.RC_GPU_SKIP = '1';   // diagnostics: the executor issues no draws
      if (RcControls.get().wide) m.ENV.RC_WIDE_DISPLAY = '1';
      if (session) Object.assign(m.ENV, RcNetplay.gameEnv(session), { RC_USERDATA: '/opfs/' + netSaves(session) });
      m.ENV.RC_LOG_FPS = params.has('fps') ? '1' : '';
      if (!params.has('fps')) delete m.ENV.RC_LOG_FPS;
      // WebKit (Safari, and every browser on an iPhone or iPad) keeps a wasm memory resident in full from the
      // moment it is allocated and kills the page past ~2 GB, so there the guest memory is packed and grows
      // only as the game allocates (runtime.c, RC_MEM_COMPACT). ?mem=compact / ?mem=full force it either way.
      if (compactMemory()) m.ENV.RC_MEM_COMPACT = '1';
      // and there the frame's vertex/uniform uploads go up in one writeBuffer per batch instead of two per
      // draw (render_wgpu.c): WebKit's WebGPU holds a page-sized IPC copy per call for a while, which added
      // 1-2 GB to the page. ?gpu=coalesce / ?gpu=direct force it either way.
      const gpu = params.get('gpu');
      if (gpu === 'coalesce' || (gpu !== 'direct' && isWebKit())) m.ENV.RC_GPU_COALESCE = '1';
    }],
  });
  const canvas = $('canvas');
  window.RC_GPU_STARTUP_ACTIVE = window.RC_RENDERER === 'gpu';
  if (window.RC_RENDERER === 'gl') {
    window.RC_GPU_STARTUP_ACTIVE = false;
    console.info('[renderer] initializing the compiled WebGL 2 executor on #canvas:', canvas.width + 'x' + canvas.height);
    if (typeof M._rc_gl_init !== 'function') {
      throw new Error('This deployed WebAssembly build does not export the WebGL 2 renderer (_rc_gl_init).');
    }
    if (!M._rc_gl_init(canvas.width, canvas.height)) {
      throw new Error('The compiled WebGL 2 renderer failed during initialization. Check the [gl] shader/context messages above.');
    }
    console.info('[renderer] WebGL 2 executor initialized; entering the shared DirectDraw frame pump.');
  } else {
    console.info('[renderer] initializing the WebGPU executor on #canvas:', canvas.width + 'x' + canvas.height);
    M._rc_gpu_init(canvas.width, canvas.height);
  }
  new ResizeObserver(() => { sizeCanvas(); M._rc_set_canvas_size(canvas.width, canvas.height); }).observe(canvas);
  hookInput(M, !!session);
  subtitles(M, touch);
  if (touch) { RcTouch.attach(M, $('stage'), canvas); followVisualViewport($('stage')); }
  if (session) { session.client.attach(M); showNetStatus(M, session); }
  crashWatch(M, touch);
  startAudio(M, audio).catch((e) => console.warn('audio unavailable:', e));
  const poll = session ? pollLocalPad : pollGamepads;
  // Online, present at most 60 times a second: every Present is a lockstep frame, and the input delay and
  // the time a frame has to simulate are counted in those (netplay.js: autoDelay), so following a 120 Hz
  // display would halve both. Solo play follows the display. A frame is due every 1/60 s, with a little
  // tolerance so a 60 Hz display's own jitter doesn't skip one.
  let due = 0, booted = false, shownFrames = 0, lastPresent = 0, loading = false;
  const launchStartedAt = performance.now();
  let firstFrameRecoveryChecked = false;
  // Detect a renderer that keeps presenting completely black frames. After a sustained black picture,
  // remember WebGL2 for this browser and restart once in that renderer (never before Play).
  const pic = { el: null, cx: null, lit: 0, samples: 0, until: 0, done: false, f: 0 };
  const picCheck = () => {
    if (pic.done || ++pic.f % 15) return;
    try {
      if (!pic.el) { pic.el = document.createElement('canvas'); pic.el.width = 16; pic.el.height = 12; pic.cx = pic.el.getContext('2d', { willReadFrequently: true }); }
      if (!pic.cx) { pic.done = true; return; }
      pic.cx.clearRect(0, 0, 16, 12);
      pic.cx.drawImage($('canvas'), 0, 0, 16, 12);
      const pixels = pic.cx.getImageData(0, 0, 16, 12).data;
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 24) lit++;
      pic.samples++; pic.lit = Math.max(pic.lit, lit);
    } catch (err) { pic.done = true; console.warn('picture check unavailable:', err.message); return; }
    if (pic.lit >= 4) { pic.done = true; return; }
    if (!pic.until) pic.until = performance.now() + 20000;
    if (performance.now() < pic.until || session) return;
    pic.done = true;
    if (!retryRenderer('The selected graphics renderer presented a sustained black picture.')) {
      showStartupFailure('The game is still producing a black picture. WebGL 2 was already selected or is unavailable. Check that the selected folder is a complete installed game copy, then reload. For a diagnostic report, open this page with ?debug.');
    }
  };
  const frame = (t) => {
    poll(M);
    if (!booted && !firstFrameRecoveryChecked && t - launchStartedAt >= 60000) {
      firstFrameRecoveryChecked = true;
      const message = 'The game has not produced its first frame after 60 seconds.';
      if (!retryRenderer(message)) {
        showStartupFailure(message + ' The selected WebGL 2 renderer has not started the game. The imported folder may be incomplete or incompatible, or the browser graphics driver may be blocking this port. Reload and check the browser diagnostic log with ?debug.');
      }
    }
    if (!session || t >= due - 4) {
      const n = M._rc_gpu_pump(1);
      if (n) {
        window.RC_GPU_STARTUP_ACTIVE = false;
        due = Math.max(due + 1000 / 60, t - 4);
        lastPresent = t;
        if (booted && !pic.done) picCheck();
        // Drop the boot cover only once the game is actually STREAMING frames (its menu/mission is up), not
        // on the first frame: while the game loads a cold install it submits nothing for up to ~2 minutes,
        // then a stray clear-frame, then the real render loop. Counting to a couple dozen frames waits for
        // that render loop so the cover never lifts onto a still-black screen.
        if (!booted) { shownFrames += n; if (shownFrames >= 24) { booted = true; hideBoot(); } }
        else if (loading) { loading = false; hideLoading(); }   // frames resumed: level finished loading
      } else if (booted && !loading && !session && lastPresent && t - lastPresent > 2500) {
        // Booted and running, but no frame for 2.5 s: the game is blocked loading a mission/level. Cover the
        // frozen black screen so it doesn't look crashed (solo only — online must never stall the loop).
        loading = true; showLoading();
      }
    } else M._rc_gpu_pump(0);   // mid-frame readbacks only
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // readbacks mid-frame are answered without waiting for vsync; online, the pad is also sampled here
  // (8 ms, not 1: the browser clamps nested 1 ms timers to 4 ms anyway, and the game reads pixels back only for
  // screenshots, so a few ms of readback latency cost nothing while halving the page thread's idle wake-ups)
  setInterval(() => { if (session) poll(M); M._rc_gpu_pump(0); }, 8);
  // Online, a hidden tab still has to present frames (browsers pause requestAnimationFrame there), or the
  // lockstep would freeze every other player with it.
  if (session) setInterval(() => { if (document.hidden) { poll(M); M._rc_gpu_pump(1); } }, 16);
  canvas.focus();
  window.recomp = M;
}

// Players report the game going black mid-mission and the page coming back on the landing screen: that is
// the browser killing the page (out of memory, usually) and reloading it, which no code here can catch as it
// happens. So the running game leaves a heartbeat in sessionStorage (kept across a browser reload, gone when
// the tab closes) and clears it on an orderly unload; a start that finds a fresh heartbeat is the reload after
// such a kill. The player gets a note on the landing screen, and the site a report (crash.php: the device,
// its memory, how long the game ran, whether it was in a mission or in the background) to find the pattern.
const RUN_STORE = 'igi-run';
function crashWatch(M, touch) {
  const t0 = Date.now();
  // The heartbeat also keeps the state just before a freeze (the field reports show whole-process freezes
  // that no watchdog report precedes): the frame rate over the last beat, the page's memory (wasm, JS, GPU
  // copies: measureUserAgentSpecificMemory, sampled every 30 s), the threads' phases and the longest task.
  let lastFrames = -1, fps = 0, pageMB = 0, longTask = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > longTask) longTask = e.duration; }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask support */ }
  const counters = () => {
    try { return M && M._rc_watch_addr ? Array.from(new Int32Array(M.wasmMemory.buffer, M._rc_watch_addr(), 7)) : []; } catch { return []; }
  };
  const beat = () => {
    try {
      const w = counters();
      if (w.length) { if (lastFrames >= 0) fps = Math.round((w[2] - lastFrames) / 5); lastFrames = w[2]; }
      sessionStorage.setItem(RUN_STORE, JSON.stringify({ t: Date.now(), t0, m: RcControls.inMission() ? 1 : 0, touch: touch ? 1 : 0, bg: document.hidden ? 1 : 0,
        fps, page: pageMB, lt: Math.round(longTask), pp: w[0], gp: w[1], gf: w[4], io: M && M._rc_io_activity ? M._rc_io_activity() : 0 }));
    } catch { /* storage blocked */ }
  };
  const measure = () => {
    try { if (performance.measureUserAgentSpecificMemory) performance.measureUserAgentSpecificMemory().then((r) => { pageMB = r.bytes >> 20; }).catch(() => {}); } catch { /* unsupported */ }
  };
  beat(); measure();
  setInterval(beat, 5000);
  setInterval(measure, 60000);   // the measurement waits for a garbage collection: once a minute is plenty
  window.addEventListener('pagehide', () => { try { sessionStorage.removeItem(RUN_STORE); } catch { /* storage blocked */ } });
  hangWatch(M, touch);
}

// Watchdog worker. Players report two freezes the heartbeat above can't explain: the page thread stops
// answering (Chrome's "Page unresponsive" dialog; the heartbeat stops with it, so the reload after it shows
// a gap of a minute or more), and the picture stops while the page still answers. A worker keeps its own
// clock: the page thread posts a beat every second (and on visibility changes), and the worker reads the
// host's watchdog counters straight from the shared wasm memory (host/win32.h RcWatch: what the page thread
// and the game thread were doing). After 15 s without a beat in the foreground it reports a hang, and after
// 20 s with no frame presented and no file read in a running mission a stall, to crash.php, with those
// counters; the end of either is reported too, so a hang that recovers is told from one that lasts.
function hangWorker() {
  let mem = null, addr = 0, info = {}, t0 = Date.now(), last = 0, st = null, lastBg = 0;
  let hangAt = 0, hangSent = false, stallAt = 0, stallSent = false, lastFrames = -1, lastIo = -1, lastMoveT = 0, fpsBefore = 0;
  const counters = () => {
    if (!mem || !addr) return {};
    const a = new Int32Array(mem.buffer, addr, 7);
    return { pp: a[0], gp: a[1], frames: a[2], queued: a[3], gf: a[4], beat: a[5], rb: a[6] };
  };
  const hist = [];   // (time, frames presented) over the last 10 s, for the frame rate before a freeze
  const fps = () => {
    const w = counters();
    if (w.frames === undefined) return 0;
    const now = Date.now();
    hist.push([now, w.frames]);
    while (hist.length > 1 && now - hist[0][0] > 10000) hist.shift();
    const a = hist[0];
    return now - a[0] >= 1000 ? Math.round((w.frames - a[1]) * 1000 / (now - a[0])) : 0;
  };
  const report = (type, dur) => {
    const body = Object.assign({ type, dur, played: Math.round((Date.now() - t0) / 1000), wasm: mem ? mem.buffer.byteLength >> 20 : 0, fps: fpsBefore },
      info, st ? { mission: st.m, paused: st.p, bg: st.bg, io: st.io, lt: st.lt } : {}, counters());
    try { fetch('crash.php', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {}); } catch { /* offline */ }
    postMessage({ warn: 'watchdog: ' + JSON.stringify(body), ga: type });
  };
  onmessage = (e) => {
    const d = e.data;
    if (d.init) { mem = d.memory; addr = d.addr; info = d.info; t0 = Date.now(); return; }
    last = Date.now(); st = d;
  };
  let lastTick = 0;
  setInterval(() => {
    if (!last) return;
    const now = Date.now(), quiet = now - last, bg = st && st.bg;
    // this worker itself didn't run for a while: the whole process was paused (the device slept, the browser
    // froze the tab or the system paged it out), which is not a hang of the page thread; reported apart,
    // and the page thread's silence over that time is not counted as a hang
    const jump = lastTick ? now - lastTick : 0;
    lastTick = now;
    if (jump > 8000) { report('pause', Math.round(jump / 1000)); last = now; return; }
    const f = fps();
    if (quiet < 3000 && !bg) fpsBefore = f;   // the frame rate while the page still answered
    if (bg !== lastBg) { lastBg = bg; lastMoveT = now; }   // frames stop in a hidden tab: not a stall
    if (!bg && quiet > 10000) {
      if (!hangAt) hangAt = last;
      if (!hangSent && quiet > 15000) { hangSent = true; report('hang', Math.round(quiet / 1000)); }
    } else if (hangAt) {
      if (hangSent) report('hangend', Math.round((now - hangAt) / 1000));
      hangAt = 0; hangSent = false;
    }
    const w = counters();
    if (w.frames === undefined || !st || bg || quiet > 3000) return;
    if (w.frames !== lastFrames || st.io !== lastIo) {
      lastFrames = w.frames; lastIo = st.io; lastMoveT = now;
      if (stallAt) { if (stallSent) report('stallend', Math.round((now - stallAt) / 1000)); stallAt = 0; stallSent = false; }
    } else if (st.m && !st.p && lastMoveT && now - lastMoveT > 20000) {
      if (!stallAt) stallAt = lastMoveT;
      if (!stallSent) { stallSent = true; report('stall', Math.round((now - lastMoveT) / 1000)); }
    }
  }, 1000);
}
function hangWatch(M, touch) {
  if (!M || !M.wasmMemory || !M._rc_watch_addr || typeof Worker !== 'function') return;
  let w;
  try { w = new Worker(URL.createObjectURL(new Blob(['(' + hangWorker.toString() + ')()'], { type: 'text/javascript' }))); }
  catch (e) { console.warn('watchdog worker unavailable:', e); return; }
  w.onmessage = (e) => {
    if (!e.data) return;
    if (e.data.warn) console.warn(e.data.warn);
    try { if (e.data.ga && typeof gtag === 'function') gtag('event', 'freeze_' + e.data.ga); } catch { /* analytics blocked */ }
  };
  w.postMessage({ init: 1, memory: M.wasmMemory, addr: M._rc_watch_addr(), info: {
    v: 20, ua: navigator.userAgent, mem: navigator.deviceMemory || 0, cores: navigator.hardwareConcurrency || 0,
    touch: touch ? 1 : 0, screen: `${screen.width}x${screen.height}@${devicePixelRatio}` } });
  // the longest task the page thread ran (ms): a hang that ends shows as one long task; a stutter as many
  let lt = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > lt) lt = e.duration; }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask support */ }
  const beat = () => {
    try { w.postMessage({ t: Date.now(), m: RcControls.inMission() ? 1 : 0, p: RcControls.paused() ? 1 : 0, bg: document.hidden ? 1 : 0, io: M._rc_io_activity ? M._rc_io_activity() : 0, lt: Math.round(lt) }); }
    catch { /* the game is gone */ }
  };
  beat();
  setInterval(beat, 1000);
  document.addEventListener('visibilitychange', beat);
}
function crashCheck() {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem(RUN_STORE) || 'null'); sessionStorage.removeItem(RUN_STORE); } catch { r = null; }
  if (!r || typeof r.t !== 'number' || Date.now() - r.t > 120000) return;   // not the reload right after a running game
  const info = {
    v: 20, type: 'reload', ua: navigator.userAgent, mem: navigator.deviceMemory || 0, cores: navigator.hardwareConcurrency || 0,
    played: Math.round((r.t - r.t0) / 1000), gap: Math.round((Date.now() - r.t) / 1000), mission: r.m, touch: r.touch, bg: r.bg,
    nav: performance.getEntriesByType('navigation')[0]?.type || '', screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    fps: r.fps, page: r.page, lt: r.lt, pp: r.pp, gp: r.gp, gf: r.gf, io: r.io,   // the state at the last beat before the end
  };
  console.warn('the previous run ended without unloading (the browser killed the page?)', info);
  try { navigator.sendBeacon('crash.php', new Blob([JSON.stringify(info)], { type: 'application/json' })); } catch { /* no beacon */ }
  if (!r.bg) $('crashnote')?.classList.remove('hidden');   // a kill in the background is the OS reclaiming a hidden tab, not a crash
}

// Follow gate (index.html #iggate): the first Play shows a prompt to follow the site's Instagram; Play is
// enabled once the Follow link has been tapped (or "already following"), and the choice is remembered in
// this browser. A follow can't be checked from a website, so this is a prompt, not a lock. Test runs
// (?autoplay) skip it.
const FOLLOW_STORE = 'igi-ig-follow';
function followGate(next) {
  let done = false;
  try { done = localStorage.getItem(FOLLOW_STORE) === '1' || params.has('autoplay'); } catch { done = params.has('autoplay'); }
  const gate = $('iggate');
  if (done || !gate) { next(); return; }
  const play = $('ig-play');
  const unlock = () => { try { localStorage.setItem(FOLLOW_STORE, '1'); } catch { /* storage blocked */ } gate.classList.add('hidden'); next(); };
  $('ig-follow').onclick = () => { setTimeout(() => { play.disabled = false; play.focus(); }, 1500); };   // link opens in a new tab
  $('ig-already').onclick = (e) => { e.preventDefault(); unlock(); };
  play.onclick = unlock;
  gate.classList.remove('hidden');
}

async function boot() {
  // Do not preflight WebGPU or block Play. Try to launch the real game first;
  // the engine itself will initialize graphics and report a failure only if it cannot proceed.
  const storageAvailable = !!navigator.storage?.getDirectory;
  let onlineReady = false;
  const goOnline = () => {
    if (!onlineReady) { setupOnline(); onlineReady = true; }
    show('online');
    ($('np-code').value ? $('np-join') : $('np-name')).focus();
  };
  const ready = () => {
    show('home');
    crashCheck();
    // Game launch is always attempted; the engine decides whether graphics can initialize.
    $('play').disabled = false;
    $('play').removeAttribute('title');
    if (params.get('join')) goOnline();
    if (params.has('autoplay')) $('play').click();
  };
  migratePreset(!!(await readMarker()));   // the keyboard layout for players from before the layouts existed
  $('play').onclick = () => followGate(() => run().catch(fail));
  $('go-online').onclick = () => followGate(goOnline);
  for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => show(b.dataset.go);
  const handlePickedFiles = async (input) => {
    const files = input.files;
    if (!files || !files.length) return;
    if (!storageAvailable) {
      status('This browser cannot save imported game files because local Origin Private File System storage is unavailable. The file chooser is working, but import needs a supported browser profile.');
      input.value = '';
      return;
    }
    try {
      await importFromPicker(files);
      ready();
    } catch (err) {
      status('Import failed: ' + errorMessage(err));
    } finally {
      // Let the same folder be selected again after a failed import.
      input.value = '';
    }
  };
  $('folder').onchange = (e) => handlePickedFiles(e.target);
  const filesInput = $('game-files');
  if (filesInput) filesInput.onchange = (e) => handlePickedFiles(e.target);
  const homeFolder = $('home-folder');
  const homeFiles = $('home-files');
  if (homeFolder) homeFolder.onchange = (e) => handlePickedFiles(e.target);
  if (homeFiles) homeFiles.onchange = (e) => handlePickedFiles(e.target);
  const showPicker = (msg) => {
    status(msg);
    $('pick').classList.remove('hidden');
    $('pick-files')?.classList.remove('hidden');
    $('help').classList.remove('hidden');
  };

  // A hosted, authorised game folder is installed automatically on first visit.
  // ?devgame forces the same automatic install/refresh even when this browser already has an install marker.
  const hosted = await hostedManifest();
  const installed = await readMarker(hosted?.format === 'files' ? hosted : null);
  const forceHostedDownload = params.has('devgame');
  if (hosted) $('reset').textContent = 'Reload the game again';
  const offerDownload = (msg) => {
    status(msg);
    $('download').textContent = 'Download the game (one time)';
    $('download').classList.remove('hidden');
    // If the hosted download is unavailable, keep the player's own-folder import available too.
    $('pick').classList.remove('hidden');
    $('pick-files')?.classList.remove('hidden');
    $('help').classList.remove('hidden');
  };
  // The browser's private storage refused: Safari's private windows and some locked-down profiles have none
  // ("The operation failed for an unknown transient reason", QuotaExceededError), and the game can't be kept.
  const storageProblem = (err) => {
    const m = String(err && err.message || ''), n = err && err.name || '';
    if (!/transient|quota|storage|NotAllowed|Security|UnknownError/i.test(m + ' ' + n)) return '';
    return 'This browser window can\'t store the game (a private window, or the browser\'s storage is full or blocked). ' +
           'Open the site in a normal window with some free space and try again.';
  };
  $('download').onclick = async () => {
    $('download').classList.add('hidden');
    const stopDownloadTips = hosted ? startTips($('tips')) : () => {};
    try {
      if (!storageAvailable) throw new Error('This browser cannot store game files locally. Open this page in a supported, non-private Chrome/Edge browser profile.');
      if (!hosted) throw new Error('The authorised game package index could not be reached. Check your connection and reload the page, or choose your own legally obtained game folder.');
      if (hosted.format === 'iso') await downloadGame(hosted);
      else await importFromServer(hosted, forceHostedDownload);
      ready();
    }
    catch (err) { offerDownload(storageProblem(err) || errorMessage(err, 'The automatic game download failed.')); }
    finally { stopDownloadTips(); }
  };
  $('reset').onclick = (e) => {
    e.preventDefault();
    show('loading');
    showPicker('Choose your Project I.G.I. folder. Your selected files are copied only into this browser on your device.');
    if (hosted) {
      $('download').textContent = 'Or download the hosted game again';
      $('download').classList.remove('hidden');
    }
  };
  if (!storageAvailable) {
    showPicker('This browser does not support the local storage needed to import game files. You can still open the chooser, but use a current Chrome/Edge browser in a normal (not private) window to complete the import.');
    return;
  }
  if (hosted && (forceHostedDownload || !installed || installed.version !== hosted.version)) {
    status(forceHostedDownload || installed ? 'Updating your automatic game package…' : 'Preparing your automatic game download…');
    $('download').textContent = forceHostedDownload || installed ? 'Update game files automatically' : 'Download game automatically';
    $('download').classList.remove('hidden');
    $('download').click();
    return;
  }
  if (!installed) {
    showPicker(forceHostedDownload
      ? 'The authorised automatic game package could not be reached. Check your connection and reload, or choose your own legally obtained game folder.'
      : 'The authorised automatic game package could not be reached. Check your connection and reload, or choose your own legally obtained Project I.G.I. folder.');
    return;
  }
  // ISO installs already contain the shipped config. The legacy folder refresh only accepts a files list.
  // A config refresh is optional: it must never prevent an installed game from reaching the Play screen.
  if (hosted && hosted.format !== 'iso') {
    try { await refreshConfig(hosted); }
    catch (err) { console.warn('Optional config refresh skipped:', errorMessage(err)); }
  }
  ready();
}

// config.qvm holds the game's own key bindings. The game rewrites it when a mission ends, and a tap or two in
// its Controls menu rebinds keys by accident (a phone's tap is a mouse click to it), which then came back on
// every visit and fought the page's own key layout. On every start the shipped copy is fetched again (3.7 KB)
// over the one in storage, so the game always starts with its default bindings; keys are changed in the
// page's panel. A failed fetch keeps whatever is there, so an offline start still works.
// Refresh the game's shipped mission config without losing player-adjusted in-game mouse options.
const CONFIG_REV = 2;
function keepPlayerMouse(saved, fresh) {
  const find = (b, name, type) => {
    const at = [];
    for (let i = 0; i + 17 < b.length; i++)
      if (b[i] === 0x0d && b[i + 1] === name && b[i + 2] === 0x18 && b[i + 3] === 1 && b[i + 4] === 0 && b[i + 5] === 0 && b[i + 6] === 0 &&
          b[i + 11] === 0x14 && b[i + 12] === type && b[i + 13] === 0 && b[i + 14] === 0 && b[i + 15] === 0) at.push(i + 16);
    return at;
  };
  const out = fresh.slice();
  const sensS = find(saved, 5, 6), sensF = find(out, 5, 6);
  if (sensS.length && sensS.length === sensF.length)
    sensS.forEach((o, k) => {
      if (saved[o] !== 0x05) return;
      const v = new DataView(saved.buffer, saved.byteOffset + o + 1, 4).getFloat32(0, true);
      if (v > 0.02 && v < 3 && out[sensF[k]] === 0x05) out.set(saved.subarray(o, o + 5), sensF[k]);
    });
  const invS = find(saved, 4, 2), invF = find(out, 4, 2);
  if (invS.length && invS.length === invF.length)
    invS.forEach((o, k) => { if (saved[o] === 0x0f || saved[o] === 0x10) out[invF[k]] = saved[o]; });
  return out;
}
async function refreshConfig(source) {
  // The automatic ISO package is an index object with parts, not the older folder-manifest
  // array of { path, size } entries. Never call Array.find on that object: it aborts boot()
  // after a successful install and leaves the player on a black/loading screen.
  const list = Array.isArray(source) ? source
    : Array.isArray(source?.files) ? source.files : [];
  const e = list.find((f) => f && typeof f.path === 'string' && f.path.toLowerCase() === 'config.qvm');
  if (!e) return;
  try {
    const assetBase = source?.base || GAME_SOURCE.href;
    const assetPrefix = source?.prefix || 'game/';
    const configURL = new URL((assetPrefix + e.path).split('/').map(encodeURIComponent).join('/'), assetBase);
    configURL.searchParams.set('rev', String(CONFIG_REV));
    const r = await fetch(configURL, { cache: 'no-cache', mode: 'cors', credentials: 'omit' });
    if (!r.ok) return;
    const buf = await r.arrayBuffer();
    if (buf.byteLength !== e.size) return;
    const fh = await fileHandle(await gameDir(true), e.path, true);
    let fresh = new Uint8Array(buf);
    try { fresh = keepPlayerMouse(new Uint8Array(await (await fh.getFile()).arrayBuffer()), fresh); } catch { /* no saved copy yet */ }
    const w = await openWriter(fh, OPFS_DIR + '/' + e.path);
    try { await w.write(fresh); await w.close(); } catch (err) { await w.abort(); throw err; }
  } catch (err) { console.warn('config.qvm refresh skipped:', err.message); }
}

function subtitles(M, touch) {
  const box = $('subcap');
  if (!box || !M._rc_subtitle || !touch) return;
  let last = '', lastSeen = 0, lastBox = '';
  const dec = new TextDecoder('latin1');
  const canvas = $('canvas'), stage = $('stage');
  setInterval(() => {
    let text = '', b = null, col = 0;
    try {
      if (RcControls.get().subs) {
        const p = M._rc_subtitle(), mem = new Uint8Array(M.wasmMemory.buffer, p, 512);
        const end = mem.indexOf(0);
        text = dec.decode(mem.slice(0, end < 0 ? 512 : end));
        if (text && M._rc_subtitle_box) { b = Array.from(new Float32Array(M.wasmMemory.buffer, M._rc_subtitle_box(), 5)); col = M._rc_subtitle_color() >>> 0; }
      }
    } catch { text = ''; }
    const now = performance.now();
    if (text) lastSeen = now;
    if (!text) { if (last && now - lastSeen > 500) { last = ''; box.classList.add('hidden'); } return; }
    // the game's 640x480-style screen is a 4:3 box centred in the canvas (letterboxed, or the HUD box in wide mode)
    const r = canvas.getBoundingClientRect(), S = stage.getBoundingClientRect();
    const h = Math.min(r.height, (r.width * 3) / 4), w = (h * 4) / 3;
    const ox = r.left - S.left + (r.width - w) / 2, oy = r.top - S.top + (r.height - h) / 2;
    const geo = b ? b.map((v) => v.toFixed(3)).join() + '|' + Math.round(w) : '';
    if (text === last && geo === lastBox) return;
    last = text; lastBox = geo;
    const rgb = [(col >> 16) & 255, (col >> 8) & 255, col & 255];
    const green = rgb[1] > 120 && rgb[1] > rgb[0] * 1.4;   // in play the game writes in green in a green panel
    box.className = green ? 'panel' : 'band';
    box.style.color = col ? `rgb(${rgb.join()})` : '';
    const fs = Math.max(14, Math.min(22, h * 0.04));        // about twice the game's size on a phone
    box.style.fontSize = `${fs}px`;
    let x0 = ox + w * 0.05, y0 = oy + h * 0.85, width = w * 0.9, room = h * 0.15;
    if (b && b[2] > b[0]) {
      x0 = Math.max(ox, ox + b[0] * w - 4); y0 = Math.max(oy, oy + b[1] * h - 3);
      width = Math.min(w - (x0 - ox) - 2, Math.max((b[2] - b[0]) * w + 8, w * 0.5));
      // the room the game's own block leaves: to the bottom of the picture on the cutscene band, else twice its height
      room = green ? Math.max((b[3] - b[1]) * h * 2.2, h * 0.16) : oy + h - y0;
    }
    box.style.left = `${x0}px`; box.style.top = `${y0}px`; box.style.width = `${width}px`; box.style.transform = 'none';
    box.textContent = text.replace(/\n/g, ' ');
    // as large as fits that room (about twice the game's size when it fits), never below 14 px (then it grows upwards)
    for (let f = fs; f >= 14; f -= 1) { box.style.fontSize = `${f}px`; if (box.scrollHeight <= room + 1) break; }
    if (box.scrollHeight > room + 1 && !green) box.style.top = `${Math.max(oy, oy + h - box.scrollHeight)}px`;   // still too tall: grow upwards
  }, 120);
}

// ------------------------------------------------------------------ fullscreen

// The stage (game + overlays) goes fullscreen; the canvas grows with it and the game letterboxes its 4:3
// picture inside. Alt+Enter (Option+Enter on a Mac) toggles it, as in PC games of the time; it is caught
// before the game's own key handling so Enter doesn't also reach a menu.
function setupFullscreen() {
  const stage = $('stage');
  const active = () => document.fullscreenElement || document.webkitFullscreenElement;
  // body.fs drives the touch re-fullscreen pill (index.html): shown only when playing and NOT fullscreen.
  // Registered unconditionally (even where the desktop button is unavailable) so the pill is always right.
  const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  const syncFsClass = () => document.body.classList.toggle('fs', !!active() || standalone());
  document.addEventListener('fullscreenchange', syncFsClass);
  document.addEventListener('webkitfullscreenchange', syncFsClass);
  syncFsClass();
  const toggle = () => {
    if (active()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage)?.catch?.(() => {});
    $('canvas').focus();
  };
  if (!stage.requestFullscreen && !stage.webkitRequestFullscreen) { $('fs').classList.add('hidden'); return; }
  $('fs').onclick = toggle;
  const swallow = (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (!e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'keydown' && !e.repeat) toggle();
  };
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', swallow, true);
  const sync = () => {
    $('fs-icon').setAttribute('d', active() ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
    $('fs').title = active() ? 'Exit fullscreen (Alt+Enter or Esc)' : 'Fullscreen (Alt+Enter)';
  };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  // the button shows while the mouse moves over the stage and fades after a few still seconds
  let idle;
  const wake = () => { stage.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => stage.classList.remove('awake'), 2500); };
  stage.addEventListener('mousemove', wake);
  stage.addEventListener('mouseleave', () => stage.classList.remove('awake'));
  wake();
}

// once the game starts: a short hint, so players learn the shortcut
function fullscreenTip() {
  const tip = $('fstip');
  if (document.fullscreenElement || document.webkitFullscreenElement || $('fs').classList.contains('hidden')) return;
  tip.classList.remove('hidden');
  tip.style.opacity = '1';
  setTimeout(() => { tip.style.opacity = '0'; }, 5000);
  setTimeout(() => tip.classList.add('hidden'), 5500);
}

// and, a moment later, the controls that differ from what players of other shooters expect
function controlsTip() {
  const tip = $('ctltip');
  if (!tip) return;
  const C = RcControls.get(), right = RcControls.ACTIONS[C.mouse[2]]?.label || 'nothing';
  const k = (id) => `<kbd>${keyLabel(userKeys[id])}</kbd>`;
  tip.innerHTML = preset === 'original'
    ? `Original keys: arrows move · ${k('walkrun')} walk/run · ${k('crouch')} crouch · ${k('jump')} jump · ${k('zoomin')}/${k('zoomout')} zoom · right click: <b>${right}</b> — WASD and more in the Controls panel`
    : `Right click: <b>${right}</b> · scroll: weapon · ${k('walkrun')} walk/run · ${k('crouch')} crouch · ${k('jump')} jump — change them in the Controls panel`;
  setTimeout(() => { tip.classList.remove('hidden'); tip.style.opacity = '1'; }, 6000);
  setTimeout(() => { tip.style.opacity = '0'; }, 16000);
  setTimeout(() => tip.classList.add('hidden'), 16500);
}

// ------------------------------------------------------------------ online lobby

async function buildVersion() {
  // peers must run the same build and game files, or their simulations diverge
  const marker = await readMarker();
  const wasm = await fetch('build/recomp.wasm', { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  // the ETag comes back weak (W/"...") when the response is compressed: compare only its value
  const etag = (wasm?.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, '');
  return `${marker?.version || 'local'}:${etag || wasm?.headers.get('Content-Length') || '?'}`;
}

function setupOnline() {
  const msg = (t) => { $('np-msg').textContent = t; $('np-lobbymsg').textContent = t; };
  try {
    $('np-name').value = localStorage.getItem('rc-name') || '';
    const region = localStorage.getItem('rc-region');
    if ([...$('np-region').options].some((o) => o.value === region)) $('np-region').value = region;
  } catch { /* storage blocked */ }
  if (params.get('join')) $('np-code').value = params.get('join').toUpperCase();
  let client = null;
  let lastPlayers = [];

  // create: the host's first connection, which places the room in `region` (the Worker's location hint)
  async function enter(code, create) {
    if (client) return;
    const name = $('np-name').value.trim() || 'Player';
    try { localStorage.setItem('rc-name', name); localStorage.setItem('rc-region', $('np-region').value); } catch { /* storage blocked */ }
    msg('Connecting…');
    let iceServers;   // from the first ticket (TURN credentials last a day)
    const roomUrl = async () => {   // a fresh ticket each time (they expire after an hour)
      const res = await fetch(NETPLAY_BASE + '_netplay_ticket', { cache: 'no-store' });
      if (!res.ok) throw new Error('Online play is not available on this server.');
      const { ticket, iceServers: ice } = await res.json();
      iceServers ??= ice;
      const url = new URL(`netplay/${code}?ticket=${encodeURIComponent(ticket)}`, NETPLAY_BASE);
      if (create) { url.searchParams.set('create', '1'); url.searchParams.set('region', $('np-region').value); create = false; }
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return url.href;
    };
    let url;
    try { url = await roomUrl(); } catch (e) { msg(e.message); return; }
    const invite = new URL(location.href);
    invite.search = `?join=${code}` + (params.get('netplay') ? `&netplay=${encodeURIComponent(params.get('netplay'))}` : '');
    $('np-room').textContent = code;
    $('invite').textContent = invite.href;
    const version = await buildVersion();
    let session = null;
    const left = new Set();
    const me = client = RcNetplay.connect({
      url, name, version, reconnectUrl: roomUrl, iceServers, relayOnly: params.get('turn') === 'only',
      onReconnect(state) { if (session) session.reconnecting = state === 'connecting'; },
      onLobby(l) {
        if (client !== me) return;   // a room this page already left
        if (l.started) { msg('That game has already started.'); leave(); return; }
        if ($('view-lobby').classList.contains('hidden')) { msg(''); show('lobby'); }
        $('np-colo').textContent = l.colo ? `Server in ${l.colo}` : '';
        $('np-players').innerHTML = '';
        const mine = l.players.find((p) => p.slot === l.you);
        const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
        for (const p of l.players) {
          const li = el('li');
          const direct = p.slot === l.you ? 0 : Math.max(mine?.p2p?.[p.slot] || 0, p.p2p?.[l.you] || 0);
          const link = p.slot === l.you ? (p.rtt ? `${p.rtt} ms to the room` : 'Connected')
            : direct ? `Direct connection · ${direct} ms` : 'Connected through the room';
          const who = el('div', 'who');
          who.append(el('b', null, p.name), el('small', null, link));
          li.append(el('div', 'avatar', (p.name || '?').trim().charAt(0).toUpperCase() || '?'), who);
          if (p.slot === 0) li.append(el('span', 'tag', 'Host'));
          if (p.slot === l.you) li.append(el('span', 'tag', 'You'));
          $('np-players').appendChild(li);
        }
        if (l.players.length < 2) {
          const li = el('li', 'empty');
          li.append(el('div', 'avatar', '?'), el('div', 'who', 'Waiting for your friend to join…'));
          $('np-players').appendChild(li);
        }
        $('np-hostctl').classList.toggle('hidden', !l.host);
        $('np-start').disabled = l.players.length !== 2;
        if (l.players.length > 2) msg('This is a 1v1 game: only two players can be in the room.');
        lastPlayers = l.players;
        const auto = RcNetplay.autoDelay(l.players);
        $('np-delay').options[0].textContent = `Auto (${auto} frames, ${Math.round(auto * 1000 / 60)} ms)`;
        $('np-wait').classList.toggle('hidden', l.host);
      },
      onStart(s) {
        session = { ...s, client, left };
        run(session).catch(fail);
      },
      onLeft(slot) { left.add(slot); },
      onError(e) { msg(e); setTimeout(() => { if ($('np-msg').textContent === e) msg(''); }, 8000); },
      onClose() { if (!session && client === me) { client = null; show('online'); msg('Disconnected from the room.'); } },
    });
  }
  function leave() {
    const c = client;
    client = null;
    c?.close();
    show('online');
  }
  $('np-leave').onclick = () => { leave(); msg(''); };
  $('np-copy').onclick = async () => {
    const b = $('np-copy');
    try { await navigator.clipboard.writeText($('invite').textContent); b.textContent = 'Link copied'; }
    catch { b.textContent = 'Copy failed: share the code instead'; }
    setTimeout(() => { b.textContent = 'Copy invite link'; }, 2000);
  };

  const code5 = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  $('np-host').onclick = () => enter(code5(), true).catch((e) => msg(e.message));
  $('np-join').onclick = () => {
    const code = $('np-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) { msg('Enter the room code from the host.'); return; }
    enter(code).catch((e) => msg(e.message));
  };
  $('np-start').onclick = () => {
    const v = $('np-delay').value;
    client?.start(v === 'auto' ? RcNetplay.autoDelay(lastPlayers) : Number(v));
  };
}

// Keyboard cheat sheet beside the stage: in-game prompts use controller glyphs (triangle/circle/×/square,
// L1, R1), so keyboard players need a reference. The CSS (index.html) reserves the panel's space on
// viewports wide enough and shrinks the stage to match; the body's .kbd-off class (set when the player
// dismisses the panel, remembered in localStorage) hides the panel and lets the stage reclaim the space.
function setupKbdHelp() {
  const off = () => { try { return localStorage.getItem('rc-kbd') === 'hide'; } catch { return false; } };
  const save = (v) => { try { localStorage.setItem('rc-kbd', v); } catch { /* storage blocked */ } };
  const apply = () => document.body.classList.toggle('kbd-off', off());
  // The Settings modal owns #kbd-close; this helper only controls the separate reference rail.
  $('kbd-show').onclick = () => { save('show'); apply(); };
  apply();
}

// The device choice on the landing screen (index.html #device): touch controls + gyroscope, or keyboard and
// mouse. Preselected from the browser (a coarse pointer on a touch screen), remembered in this browser, and
// applied right away: the page's phone layout (body.coarse) and the hints follow it, and run() asks
// RcTouch.wanted() when the game starts.
function setupDevice() {
  const box = $('device');
  if (!box) return;
  const sync = () => {
    const touch = RcTouch.wanted();
    document.body.classList.toggle('coarse', touch);
    // iPhone Safari has no fullscreen for a page, and its toolbars slide in over the page when a swipe starts
    // at the screen's edge (looking down starts one at the top): the viewport shrinks, and a stage fixed to
    // it would resize the game's picture every time. There the stage keeps the largest viewport's size
    // instead (index.html body.nofs #stage); the toolbar overlaps the bottom until it hides again.
    document.body.classList.toggle('nofs', touch && !document.fullscreenEnabled && !document.webkitFullscreenEnabled);
    // the on-screen controls exist from here on (hidden until the game runs), so their settings and layout can
    // be set up on the landing screen and while the game loads
    if (touch) {
      RcTouch.setup($('stage'), $('canvas'));
      $('home-controls').onclick = () => RcTouch.openSettings();
      $('boot-controls').onclick = () => RcTouch.openSettings();
    }
    for (const b of box.querySelectorAll('button')) {
      const on = (b.dataset.device === 'touch') === touch;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };
  for (const b of box.querySelectorAll('button')) b.onclick = () => {
    try { localStorage.setItem('igi-device', b.dataset.device); } catch { /* storage blocked */ }
    sync();
  };
  sync();
}
setupDevice();
setupFullscreen();
setupKbdHelp();
setupControls();
boot().catch(fail);
