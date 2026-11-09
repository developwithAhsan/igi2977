/* Audio slots for optional owner-provided files in /audio/. */
(function (w) {
  "use strict";
  w.IGI_SOUND_CONFIG = Object.freeze({
    defaultMasterVolume: 0.18,
    crossfadeMs: 750,
    uiPoolSize: 4,
    tracks: {
      home:     { file: "bg-home", volume: 0.80, loop: true },
      play:     { file: "bg-play", volume: 0.70, loop: true },
      missions: { file: "bg-missions", volume: 0.70, loop: true },
      info:     { file: "bg-info", volume: 0.65, loop: true },
      download: { file: "bg-download", volume: 0.70, loop: true },
      default:  { file: "bg-default", volume: 0.65, loop: true }
    },
    sounds: {
      click:  { file: "ui-click", volume: 0.62, loop: false },
      move:   { file: "ui-move", volume: 0.35, loop: false },
      hover:  { file: "ui-hover", volume: 0.18, loop: false, enabled: false },
      change: { file: "ui-change", volume: 0.55, loop: false },
      enter:  { file: "ui-enter", volume: 0.60, loop: false },
      error:  { file: "ui-error", volume: 0.55, loop: false }
    }
  });
})(window);
