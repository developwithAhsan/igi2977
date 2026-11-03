# Project I.G.I. in the browser

[Project I.G.I.](https://en.wikipedia.org/wiki/Project_I.G.I.) (Innerloop Studios / Eidos, 2000) running in a
browser tab, on desktop and on supported phones and tablets. The public site is **https://project-igi.online**.
Players must import their own legally obtained game folder; this repository contains the browser port and host/runtime code, but no copyrighted commercial game data.

This is a port of [Dhaiwat Pandya's cricket07-browser](https://github.com/Dhaiwat10/cricket07-browser), a
static x86-to-C-to-WebAssembly recompiler with a Windows API layer, to a different game. What it adds:

- **DirectDraw 7 / Direct3D 7** (`host/ddraw7.c`), which this game uses instead of Direct3D 8, on the same
  WebGPU renderer, plus the few extra Windows calls the game makes (`host/mm.c`, registry, timers, threads).
- **Phones and tablets**: on-screen stick and buttons laid out like mobile shooters (`web/touch.js`: a big
  FIRE with jump / crouch / scope around it, a second FIRE above the stick, walk/run and binoculars toggles),
  a sprint lock on the stick (push forward and slide the thumb onto the runner above it to keep running with
  the thumb off the screen, tap the stick to stop), a layout editor (drag any button or
  the stick where you want it, size overall and per button, opacity, saved in the browser, usable on the
  landing screen and while the game loads), a scope button that raises the sniper rifle's
  scope and snaps it to a chosen zoom and back (through the binoculars when the weapon has no scope), a
  "mission failed, tap Restart Mission" note when the game's menu opens on its own, tap-to-hold crouch and
  walk, gyroscope aiming (turn the phone to fine-aim while scoped, or always; invert either axis), swipe /
  scope / gyro sensitivity settings, a first-start controls guide, taps that work in the game's menus
  including the Esc menu, fullscreen and landscape, the stage following the visual viewport so a zoomed or
  scrolled page never crops the picture.
- **Keyboard and mouse**: the game's original keys by default with a one-click Modern (WASD) layout, every key
  rebindable from the page, mouse buttons bindable to any action (right click toggles the sniper scope), a
  mouse sensitivity setting; all saved in the browser (`web/controls.js`). The landing screen asks whether
  you play on a phone or with keyboard and mouse (remembered).
- **Input fidelity** (`host/dinput.c`, `host/render_rec.c`): the game accelerates the mouse (a slow move turns
  half as far per count as a fast one, and the feel changed with the frame rate); the host sends the inverse
  curve so the response is linear (0.21° per count), carries motion beyond the game's per-frame limit into the
  next frame, and keeps every press until the game has sampled it, so taps are never lost at a phone's frame
  rate. The scope toggle reads the real zoom of the view (the world's projection) and holds the game's Zoom
  keys until the view is there. The Esc menu over a paused mission is told apart from play by the game's
  clock standing still, so its cursor is never inverted and phone taps reach its items.
- **Widescreen**: the game is offered display modes as wide as the window and picks one itself, so its
  viewport, its HUD layout and its own transform and clipping of the polygons nearest the camera (it submits
  those pre-transformed, clipped to its screen) all follow; its field of view is widened by the same factor
  through a one-line post-translation patch (`ports/project-igi/patch.sh`, a runtime factor read where the
  game reads its camera's tangent), and the renderer draws its 2D layer back into 4:3 proportions. Frames
  under the sniper scope or the binoculars, the 2D menus, and widescreen off are the game's 4:3 picture
  squeezed back into a 4:3 box (`host/render_rec.c` `g_frame_wide`, `host/render_wgpu.c`, `host/ddraw7.c`;
  a setting on the page, on by default). An earlier version only widened the projection, and looking down
  showed sky at the sides where the game had clipped the near ground to 4:3.
- **Loading time**: the game reads thousands of files per mission and maps every path case-insensitively, and
  in the browser each file-system call is a round trip to the OPFS thread. The host reads each file whole on
  open and serves it from memory, and keeps directory listings (`host/kernel32.c`, `host/core.c`), which cut
  the mission load (and the reload after a death) from 4-7 s to 1.5 s in headless Chrome.
- **Safari / iOS**: WebKit keeps far more memory per page than Chromium (its baseline WebAssembly JIT alone
  holds about 1.6 GB for this game) and iPhones kill a tab near 2 GB. The guest memory is laid out
  compactly and grown on demand, host thread stacks are small, and GPU uploads are coalesced per batch
  (`RC_MEM_COMPACT`, `RC_GPU_COALESCE`, set by `web/loader.js` on WebKit only). Measured in the first
  mission: 2.8 GB before, 1.5 GB after.
- **Rendering fixes**: back-face culling mapped correctly for Dawn (Chrome) and wgpu-native, x87 rounding
  details in `runtime/cpu.h`, a draw-signature harness (`RC_INPUT=...:sig`) for comparing native and browser
  frames draw by draw.
- A hosted-game flow (`web/serve.py --manifest`, `?devgame`), scripted input for headless testing
  (`host/input.c`), and the site's own extras (visitor counter, affiliate card, and an AdSense slot that
  works inside the cross-origin-isolated page through an `<iframe credentialless>` around `web/ad.html`).
- **Stall detection**: a mission load presents no frames for a while; the loading cover shows meanwhile, and
  the game is only called stuck (with a reload button) once it has also opened or read no file for a minute
  (`rc_io_activity`). On a PC the pointer lock is taken back on the next key press after Esc released it, so
  the view keeps turning all the way round.
- **Light on the CPU**: the game paces itself by spinning on PeekMessage between frames (6.7 million polls a
  second natively, 99.97% of them under 2 us apart), a busy-wait that burned a whole core on every device. Every
  128th poll in a row that finds no message now sleeps a millisecond (`host/user32.c`): natively 35% of a core
  instead of 102% at the same 30 fps, on the web 78 thousand polls a second instead of 3 million. Small files
  the game reopens again and again (its ambient sounds, every few seconds in a mission) keep their contents
  after they are closed and are served from memory on the next open (`host/kernel32.c`, 48 MB at most),
  which spares phones a storage round trip per open. The compact memory layout is the default in every
  browser now: the engine's memory stays near 0.5 GB and grows as the game allocates, instead of 1.8 GB
  grown at start (`web/loader.js`, `?mem=full` restores the old layout).
- **Long sessions**: DirectSound buffers had no destroy, so every sound the game created or duplicated stayed
  in the COM object table (65536 slots) and in the mixer's list for the whole session, about 56 a second in a
  mission: after some 16 minutes the engine aborted with "too many live COM objects" and the picture froze
  (the reported "stuck in mission 3 / 6"). Buffers and their notify / 3D views are now released when the game
  releases them (`host/dsound.c`, sample memory shared between a buffer and its duplicates by count), and a
  texture's view object is recycled with its surface (`host/ddraw7.c`, `com_free`). `RC_COM_LOG=1` prints live
  objects per interface. Verified: 17 minutes of mission 6 natively and 20 minutes unattended in the browser.
- **Crash reports**: a browser that runs out of memory kills the page and reloads it (a black screen, then
  the landing page). The running game keeps a heartbeat in `sessionStorage`, cleared on an orderly unload;
  a start that finds one tells the player what happened and posts the device, memory, time played and
  mission state to `web/crash.php`, which appends it to a log above the web root (`?view=KEY` lists it).
  A watchdog worker (`web/loader.js` `hangWorker`) keeps its own clock: the page thread posts it a beat
  every second, and the host keeps counters in shared memory (`host/win32.h` `RcWatch`: what the page thread
  and the game thread are doing, frames presented, the game loop's turns, file reads). 15 s without a beat
  in the foreground is reported as a hang with those counters, 20 s without a frame or a file read in a
  running mission as a stall, each with its end; a jump of the worker's own clock (the device slept, the tab
  was frozen) is reported apart, and so is a lost WebGPU device. A game folder the browser evicted files from
  (the marker left, the executable gone, or a not-found error while downloading over it) is downloaded again
  from scratch instead of waiting forever at "Starting the game".

The game profile is `ports/project-igi/profile.h`; build with `PROFILE=ports/project-igi/profile.h` in the
commands below. Everything below this line is the original project's README, which still applies.

---

# Cricket 07 in the browser

EA Sports Cricket 07 (2006, Windows) running in a browser tab, with game controllers and online 1v1
multiplayer. This repo has no game files and no game code, so you need your own copy of the game.

## How it was made

The game's executable was translated from x86 machine code to C. Ghidra finds the functions, and
`translator/x86toc.py` turns each one into a C function: 31,547 functions, about 1.3 million
instructions. That C is compiled to WebAssembly with Emscripten, or to a native Mac app with clang.

The translated game still expects Windows, so `host/` provides the parts it uses. Direct3D 8 is
rebuilt on WebGPU, DirectSound plays through Web Audio, DirectInput reads browser keyboard and mouse
events and gamepads, and file, thread and timer calls map onto their browser equivalents. In the
browser, the game files live in the browser's private storage, copied in once from a folder you pick.

Online play works without any changes to the game: both players run the same simulation, and only
their controller inputs travel between them. The deterministic scheduler and lockstep netplay were
adapted from an earlier browser port of Rugby 06, which also contributed the controller support.

## Using this repo

You need macOS on Apple Silicon, Python 3 with `capstone` and `pefile`,
[Ghidra](https://ghidra-sre.org) 12, SDL2 (`brew install sdl2`),
[wgpu-native](https://github.com/gfx-rs/wgpu-native) in `third_party/wgpu`, and
[Emscripten](https://emscripten.org).

```bash
# 1. Export the function list from your copy's executable (once)
GHIDRA=~/ghidra_12.1.4_PUBLIC ghidra/export.sh /path/to/game.exe work/functions.json

# 2. Set your executable's name and install path
cp host/profile.h work/profile.h      # then edit it

# 3. Translate and build the native app, then run it
PROFILE=work/profile.h ./build.sh /path/to/game.exe work/functions.json
build/recomp /path/to/game-folder

# 4. Build the browser version and serve it
PROFILE=work/profile.h ./build_web.sh
python3 web/serve.py --game /path/to/Project_IGI_folder  # first visit downloads the hosted folder automatically

# 5. Optional, for online play: deploy the room server (see server/README.md)
cd server && npx wrangler deploy && npx wrangler secret put NETPLAY_SECRET
# then open the page with ?netplay=https://cricket07-netplay.<your-subdomain>.workers.dev
```

Controls: a game controller, or the keyboard (arrow keys to move, **S** to select, mouse for the
cursor). Use `RC_NO_AUDIO=1` to mute the native app, or `?mute` on the page. Both players in an online
match need the same build and the same game files.


## Automatic first-run download and browser engine

The launcher automatically imports a hosted game folder on a first visit when `/game/manifest.json` is present and lists the files served under `/game/`. The manifest can be generated locally with `python3 web/serve.py --manifest /path/to/your-legal-game-folder`; this only writes the manifest and does not upload or publish the files. For a local test, use `python3 web/serve.py --game /path/to/your-legal-game-folder`. Add `?devgame` to force an automatic refresh from that configured source.

The browser engine is separate from the game folder. `build_web.sh` generates a matching `recomp.js` and `recomp.wasm` in `build_web/www/`; the website serves those at `/build/recomp.js` and `/build/recomp.wasm`. They must be built together and deployed together. The engine build itself requires the owner's legally obtained `igi.exe`, the Ghidra function export, the translated `out_all/` sources, and Emscripten. Those inputs and generated outputs are intentionally not stored in this repository. The original commercial game files must not be uploaded or published without the necessary rights.

A browser cannot silently read a visitor's local disk. Without a configured, authorised hosted game source, the first import therefore requires the player to choose their own legally obtained game folder once; after import, the browser keeps it in its private local storage.

## Technical notes

- **Memory keeps its original layout.** The executable is loaded at its original address, so every
  pointer and C++ vtable in the game works unchanged. The stack is real too: `call` pushes the actual
  return address.
- **Some code only exists at run time.** The sound engine stores small x86 programs inside its
  sound banks and calls them, so `runtime/interp.c` interprets those.
- **Shaders are converted twice over.** Vertex shaders (`vs.1.1`) run on the CPU. Pixel shaders
  (`ps.1.1`) are translated to WGSL, and the old fixed-function pipeline becomes one large WGSL
  shader.
- **WebGPU can only draw from the page's thread**, but the game renders from its own thread. The
  game thread records each frame as a list of commands, and the page replays them every animation
  frame.
- **WebAssembly has 4 GB of memory for everything**, and the game expects a 4 GB address space of its
  own. Its heap and allocations are squeezed into a 1.25 GB window.
- **WebAssembly stacks have no guard page**, so an overflow silently corrupts memory instead of
  crashing. Game threads get 64 MB stacks.
- **The browser clock counts from 1970.** Timer values that large broke the game's timer code, so
  the clock starts near zero instead.
- **A tight lock/unlock loop in the sound code starved the timer thread** in the browser. Releasing a
  mutex now hands it straight to a waiting thread.
- **Online play is lockstep.** A deterministic scheduler (`host/sched.c`) runs one game thread at a
  time on a virtual clock, so a match depends only on its inputs. Each frame, both games wait for both
  players' inputs and apply them together (`host/netplay.c`), and they compare a hash of the game's
  memory every few frames to catch any drift.
- **Recompiled functions keep registers in local variables** and write them back only around calls,
  which made the build about 30% faster and the WebAssembly file about a quarter smaller.
- **Translation is tested against the original.** `tests/difftest.py` runs each function in a CPU
  emulator and in translated form on the same random inputs, then compares every register and every
  byte of memory touched.

MIT licensed. Cricket 07 and EA Sports are trademarks of Electronic Arts, which is not involved with
this project.
