(function () {
  "use strict";
  var cfg = window.IGI_SOUND_CONFIG;
  if (!cfg) return;

  var KEY = {
    entered: "igiEnteredSession", muted: "igiAudioMuted", volume: "igiAudioVolume",
    effects: "igiEffectsOff", position: "igiTrackPosition", from: "igiFromPath"
  };
  var context = null, current = null, currentTrack = "", pools = Object.create(null);
  var poolIndex = Object.create(null), warned = Object.create(null);
  var master = cfg.defaultMasterVolume, muted = false, unlocked = false;
  var pageHidden = document.visibilityState === "hidden", gameActive = false;
  var gameInputUntil = 0, entry = null, dock = null, uiReady = false;
  var localStore = null, sessionStore = null;
  try { localStore = window.localStorage; } catch (_) {}
  try { sessionStore = window.sessionStorage; } catch (_) {}

  function get(store, key) { try { return store.getItem(key); } catch (_) { return null; } }
  function set(store, key, value) { try { store.setItem(key, value); } catch (_) {} }
  function remove(store, key) { try { store.removeItem(key); } catch (_) {} }
  function isReducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; }
  }
  try {
    var savedMute = get(localStore, KEY.muted);
    muted = savedMute === null ? isReducedMotion() : savedMute === "1";
    var savedVolume = Number(get(localStore, KEY.volume));
    if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) master = savedVolume;
  } catch (_) { muted = isReducedMotion(); }

  function devWarning(slot, file) {
    if (warned[slot]) return;
    warned[slot] = true;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1" ||
        /\.vercel\.app$/i.test(location.hostname)) {
      console.warn("[IGI audio] Optional file missing; skipped:", file);
    }
  }
  function url(name, extension) { return "/audio/" + name + "." + extension; }

  function trackForRoute() {
    var path = location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/") return "home";
    if (path === "/play" || path === "/play.html" || path === "/web/play.html") return "play";
    if (/\/missions?(?:\.html)?$/i.test(path)) return "missions";
    if (/\/download(?:\.html)?$/i.test(path)) return "download";
    if (/\/(?:about|controls|faq|blog)(?:\/|$)/i.test(path) || /\/blogs?\//i.test(path)) return "info";
    return "default";
  }
  function getContext() {
    if (context) return true;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    try { context = new AudioContextClass(); return true; } catch (_) { return false; }
  }
  function fade(gain, from, to, milliseconds) {
    if (!context || !gain) return;
    var now = context.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(0, from), now);
      gain.gain.linearRampToValueAtTime(Math.max(0, to), now + Math.max(0.05, milliseconds / 1000));
    } catch (_) { gain.gain.value = to; }
  }
  function musicTarget(item) {
    if (!item || muted || pageHidden) return 0;
    return Math.max(0, Math.min(1, master * item.track.volume * (gameActive ? 0.08 : 1)));
  }
  function dispose(item) {
    if (!item) return;
    try { item.audio.pause(); item.audio.removeAttribute("src"); item.audio.load(); } catch (_) {}
    try { if (item.source) item.source.disconnect(); if (item.gain) item.gain.disconnect(); } catch (_) {}
  }
  function savePosition() {
    if (!current || !current.audio) return;
    set(sessionStore, KEY.position, JSON.stringify({
      track: currentTrack, time: Number(current.audio.currentTime) || 0
    }));
  }
  function startTrack(name, resumeAt) {
    var track = cfg.tracks[name] || cfg.tracks.default;
    if (!track || !unlocked || muted || pageHidden || gameActive || !getContext()) return;
    if (current && currentTrack === name) return;
    var previous = current, audio = new Audio(), source, gain;
    audio.loop = track.loop !== false;
    audio.preload = "none";
    audio.crossOrigin = "same-origin";
    try {
      source = context.createMediaElementSource(audio);
      gain = context.createGain();
      source.connect(gain);
      gain.connect(context.destination);
      gain.gain.value = 0;
    } catch (_) { return; }
    var item = { audio: audio, source: source, gain: gain, track: track };
    var triedOgg = false;
    function tryOggOrSkip() {
      if (!triedOgg) {
        triedOgg = true;
        audio.src = url(track.file, "ogg");
        audio.load();
        audio.play().then(function () {
          if (Number.isFinite(resumeAt) && resumeAt > 0) {
            try { audio.currentTime = resumeAt; } catch (_) {}
          }
          fade(gain, 0, musicTarget(item), cfg.crossfadeMs);
        }).catch(function () {
          devWarning("track-" + name, track.file + ".mp3 / .ogg");
          dispose(item);
          if (current === item) current = null;
        });
      } else {
        devWarning("track-" + name, track.file + ".mp3 / .ogg");
        dispose(item);
        if (current === item) current = null;
      }
    }
    audio.addEventListener("error", tryOggOrSkip);
    audio.src = url(track.file, "mp3");
    audio.load();
    current = item;
    currentTrack = name;
    try { context.resume(); } catch (_) {}
    audio.play().then(function () {
      if (Number.isFinite(resumeAt) && resumeAt > 0) {
        try { audio.currentTime = resumeAt; } catch (_) {}
      }
      fade(gain, 0, musicTarget(item), cfg.crossfadeMs);
      if (previous && previous !== item) {
        fade(previous.gain, previous.gain.gain.value, 0, cfg.crossfadeMs);
        window.setTimeout(function () { if (current !== previous) dispose(previous); }, cfg.crossfadeMs + 100);
      }
    }).catch(function (error) {
      if (error && error.name === "NotAllowedError") {
        if (current === item) { current = previous; currentTrack = previous ? currentTrack : ""; }
        dispose(item);
      }
    });
  }
  function updateMusic() {
    if (!current || !current.gain || !context) return;
    if (gameActive && current.audio) savePosition();
    fade(current.gain, current.gain.gain.value, musicTarget(current), 180);
  }
  function preloadUi() {
    if (uiReady) return;
    uiReady = true;
    Object.keys(cfg.sounds).forEach(function (name) {
      var slot = cfg.sounds[name];
      if (name === "hover" || !slot || !slot.file) return;
      var pool = [];
      for (var i = 0; i < cfg.uiPoolSize; i++) {
        var audio = new Audio();
        audio.preload = "auto";
        audio.src = url(slot.file, "mp3");
        audio.volume = 0;
        audio.load();
        (function (el, soundName, soundSlot) {
          var triedOgg = false;
          el.addEventListener("error", function () {
            if (!triedOgg) { triedOgg = true; el.src = url(soundSlot.file, "ogg"); el.load(); }
            else devWarning("sfx-" + soundName, soundSlot.file + ".mp3 / .ogg");
          });
        })(audio, name, slot);
        pool.push(audio);
      }
      pools[name] = pool;
      poolIndex[name] = 0;
    });
  }
  function playSfx(name) {
    var slot = cfg.sounds[name], pool = pools[name];
    if (!unlocked || muted || pageHidden || !slot || !pool || !pool.length) return;
    if (name === "hover" && !slot.enabled) return;
    var audio = pool[poolIndex[name]++ % pool.length];
    try { audio.pause(); audio.currentTime = 0; audio.volume = Math.max(0, Math.min(1, master * slot.volume)); } catch (_) {}
    audio.play().catch(function () {});
  }
  function savePreferences() {
    set(localStore, KEY.muted, muted ? "1" : "0");
    set(localStore, KEY.volume, String(master));
    set(localStore, KEY.effects, document.body.classList.contains("igi-effects-off") ? "1" : "0");
  }
  function updateDock() {
    if (!dock) return;
    var mute = dock.querySelector("[data-igi-mute]");
    var slider = dock.querySelector("[data-igi-volume]");
    var effects = dock.querySelector("[data-igi-effects]");
    if (mute) {
      mute.textContent = muted ? "SOUND OFF" : "SOUND ON";
      mute.setAttribute("aria-pressed", String(!muted));
      mute.setAttribute("aria-label", muted ? "Unmute site audio" : "Mute site audio");
    }
    if (slider) {
      slider.value = String(Math.round(master * 100));
      slider.setAttribute("aria-valuetext", Math.round(master * 100) + " percent");
    }
    if (effects) {
      var off = document.body.classList.contains("igi-effects-off");
      effects.textContent = off ? "FX OFF" : "FX ON";
      effects.setAttribute("aria-pressed", String(!off));
    }
  }
  function createDock() {
    if (dock) return;
    dock = document.createElement("div");
    dock.className = "igi-audio-dock";
    dock.setAttribute("role", "group");
    dock.setAttribute("aria-label", "Audio and display effects");
    dock.innerHTML = '<button type="button" class="igi-audio-button" data-igi-mute aria-pressed="true">SOUND OFF</button>' +
      '<label class="igi-audio-label" for="igi-volume">VOL</label>' +
      '<input id="igi-volume" data-igi-volume type="range" min="0" max="100" step="1" value="18" aria-label="Site audio volume">' +
      '<button type="button" class="igi-audio-button" data-igi-effects aria-pressed="true">FX ON</button>';
    document.body.appendChild(dock);
    dock.addEventListener("click", function (event) {
      if (event.target.closest("[data-igi-mute]")) {
        muted = !muted;
        savePreferences();
        updateMusic();
        if (!muted && unlocked) { preloadUi(); if (!current && !gameActive) startTrack(trackForRoute(), 0); }
        updateDock();
      }
      if (event.target.closest("[data-igi-effects]")) {
        document.body.classList.toggle("igi-effects-off");
        savePreferences();
        updateDock();
        playSfx("click");
      }
    });
    dock.addEventListener("input", function (event) {
      if (event.target.matches("[data-igi-volume]")) {
        master = Number(event.target.value) / 100;
        savePreferences();
        updateMusic();
        updateDock();
      }
    });
    updateDock();
  }
  function enterSite(playEnterSound) {
    if (entry) { entry.remove(); entry = null; }
    set(sessionStore, KEY.entered, "1");
    unlocked = true;
    createDock();
    if (!muted && !pageHidden) {
      getContext();
      if (context) { try { context.resume(); } catch (_) {} }
      preloadUi();
      startTrack(trackForRoute(), 0);
      if (playEnterSound) playSfx("enter");
    }
    updateDock();
  }
  function showEntry() {
    if (get(sessionStore, KEY.entered) === "1") {
      unlocked = true;
      createDock();
      return;
    }
    entry = document.createElement("div");
    entry.className = "igi-entry-overlay";
    entry.setAttribute("role", "dialog");
    entry.setAttribute("aria-modal", "true");
    entry.setAttribute("aria-label", "Enter Project IGI Online");
    entry.innerHTML = '<div class="igi-entry-frame">' +
      '<div class="igi-entry-kicker">SYSTEM READY // AUDIO LOCKED</div>' +
      '<div class="igi-entry-title">CLICK TO ENTER</div>' +
      '<p class="igi-entry-copy">Activate the interface to enable optional site ambience and interface sounds.</p>' +
      '<button class="igi-entry-action" type="button">ENTER</button></div>';
    document.body.appendChild(entry);
    function finish() { enterSite(true); }
    entry.addEventListener("click", finish);
    entry.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); finish(); }
      if (event.key === "Escape") { event.preventDefault(); muted = true; savePreferences(); enterSite(false); }
    });
    var enterButton = entry.querySelector("button");
    enterButton.addEventListener("click", function (event) { event.stopPropagation(); finish(); });
    enterButton.focus();
  }
  function updateGameActivity() {
    var stage = document.getElementById("stage");
    var active = document.body.classList.contains("playing") ||
      !!document.pointerLockElement || !!document.fullscreenElement ||
      !!(stage && (stage === document.activeElement || stage.contains(document.activeElement))) ||
      Date.now() < gameInputUntil;
    if (active !== gameActive) {
      gameActive = active;
      updateMusic();
      if (!gameActive && unlocked && !muted && !pageHidden && !current) startTrack(trackForRoute(), 0);
    }
  }
  function recordGameInput(event) {
    if (!event.target || !event.target.closest || !event.target.closest("#stage")) return;
    gameInputUntil = Date.now() + 2000;
    updateGameActivity();
    window.setTimeout(updateGameActivity, 2100);
  }
  function loadSavedTrack() {
    var saved = null;
    try { saved = JSON.parse(get(sessionStore, KEY.position) || "null"); } catch (_) {}
    var track = trackForRoute();
    var resumeAt = saved && saved.track === track && Number.isFinite(saved.time) ? saved.time : 0;
    var previousPath = get(sessionStore, KEY.from);
    if (previousPath && previousPath !== location.pathname) playSfx("change");
    set(sessionStore, KEY.from, location.pathname);
    startTrack(track, resumeAt);
    remove(sessionStore, KEY.position);
  }
  function initListeners() {
    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ?
        event.target.closest("a[href],button,[role=button],input[type=submit],input[type=button]") : null;
      if (!target || target.closest("#stage") || target.closest(".igi-audio-dock") || target.closest(".igi-entry-overlay")) return;
      if (target.matches("a[href]")) {
        var destination;
        try { destination = new URL(target.href, location.href); } catch (_) {}
        if (destination && destination.origin === location.origin && destination.pathname !== location.pathname) {
          savePosition();
          set(sessionStore, KEY.from, location.pathname);
          return;
        }
      }
      playSfx("click");
    }, true);
    document.addEventListener("invalid", function (event) {
      if (event.target && event.target.form) playSfx("error");
    }, true);
    document.addEventListener("keydown", function (event) {
      var nav = event.target && event.target.closest && event.target.closest(".site-nav,.home-nav,[data-igi-menu]");
      if (!nav || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
      var links = Array.prototype.slice.call(nav.querySelectorAll("a[href]"));
      var index = links.indexOf(document.activeElement);
      if (index < 0 || !links.length) return;
      event.preventDefault();
      var next = (index + (event.key === "ArrowDown" ? 1 : links.length - 1)) % links.length;
      links[next].focus();
      playSfx("move");
    }, true);
    document.addEventListener("pointerdown", recordGameInput, true);
    document.addEventListener("touchstart", recordGameInput, {capture:true,passive:true});
    document.addEventListener("focusin", function (event) {
      if (event.target && event.target.closest && event.target.closest("#stage")) updateGameActivity();
    });
    document.addEventListener("pointerlockchange", updateGameActivity);
    document.addEventListener("fullscreenchange", updateGameActivity);
    var observer = new MutationObserver(updateGameActivity);
    observer.observe(document.body, {attributes:true,attributeFilter:["class"]});
    document.addEventListener("visibilitychange", function () {
      pageHidden = document.visibilityState === "hidden";
      if (pageHidden) {
        savePosition();
        if (current && current.audio) current.audio.pause();
        Object.keys(pools).forEach(function (key) { pools[key].forEach(function (audio) { audio.pause(); }); });
      } else {
        updateGameActivity();
        if (unlocked && !muted && !gameActive) {
          if (current && current.audio) {
            if (context) { try { context.resume(); } catch (_) {} }
            current.audio.play().catch(function () {});
            updateMusic();
          } else loadSavedTrack();
        }
      }
    });
    window.addEventListener("pagehide", savePosition);
    window.addEventListener("beforeunload", savePosition);
  }

  document.body.classList.toggle("igi-effects-off", get(localStore, KEY.effects) === "1");
  createDock();
  initListeners();
  if (get(sessionStore, KEY.entered) === "1") {
    unlocked = true;
    if (!muted) {
      preloadUi();
      loadSavedTrack();
    }
  } else showEntry();
  updateDock();
})();
