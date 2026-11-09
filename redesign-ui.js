/* UI-only helpers. This file does not access or modify game runtime state. */
(function () {
  'use strict';
  var menu = document.getElementById('menu-toggle');
  var nav = document.getElementById('site-nav');
  if (menu && nav) {
    menu.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('open');
        menu.setAttribute('aria-expanded', 'false');
      });
    });
  }

  var toolbarFullscreen = document.getElementById('toolbar-fullscreen');
  var existingFullscreen = document.getElementById('fs');
  if (toolbarFullscreen && existingFullscreen) {
    toolbarFullscreen.addEventListener('click', function () { existingFullscreen.click(); });
  }

  var controls = document.getElementById('kbd');
  var closeSettings = document.getElementById('kbd-close');
  var previousFocus = null;

  function openSettings(event) {
    if (!controls) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    previousFocus = document.activeElement;
    controls.classList.add('is-open');
    controls.setAttribute('aria-hidden', 'false');
    document.body.classList.add('settings-open');
    controls.style.setProperty('display', 'grid', 'important');
    controls.style.setProperty('visibility', 'visible', 'important');
    controls.style.setProperty('opacity', '1', 'important');
    controls.style.setProperty('pointer-events', 'auto', 'important');
    if (closeSettings) closeSettings.focus();
  }

  function hideSettings() {
    if (!controls) return;
    controls.classList.remove('is-open');
    controls.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('settings-open');
    controls.style.removeProperty('display');
    controls.style.removeProperty('visibility');
    controls.style.removeProperty('opacity');
    controls.style.removeProperty('pointer-events');
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  // Delegation survives toolbar redraws and covers desktop, touch, and launcher entry points.
  document.addEventListener('click', function (event) {
    var settingsButton = event.target.closest && event.target.closest('#toolbar-settings,#stage-settings');
    if (settingsButton) { openSettings(event); return; }
    if (event.target.closest && event.target.closest('#kbd-close')) { event.preventDefault(); hideSettings(); return; }
    if (controls && event.target === controls) hideSettings();
  }, true);

  if (closeSettings) closeSettings.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    hideSettings();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && controls && controls.classList.contains('is-open')) hideSettings();
  });
})();
