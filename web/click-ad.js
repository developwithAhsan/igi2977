/* Project IGI direct sponsor link.
 * Opens one sponsor tab on the first meaningful site-control click per browser tab session.
 * The original control action is not cancelled; gameplay/touch HUD controls are excluded.
 */
(() => {
  'use strict';
  const AD_URL = 'https://uplcm.com/4/11141016';
  const SESSION_KEY = 'igi-direct-ad-opened-v1';
  let opened = false;

  try { opened = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (_) {}

  // Monetag runs inside a credentialless same-origin frame so its third-party
  // requests do not violate the game page's COEP=require-corp isolation.
  (() => {
    const supported = 'credentialless' in HTMLIFrameElement.prototype;
    if (window.crossOriginIsolated && !supported) {
      console.info('[ads] Monetag skipped: this browser lacks credentialless iframe support; game isolation is kept intact.');
      return;
    }
    const frame = document.createElement('iframe');
    if (supported) frame.credentialless = true;
    frame.title = 'Advertisement';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-2px;top:-2px;opacity:0;pointer-events:none;border:0';
    frame.src = '/web/monetag-frame.html';
    (document.body || document.documentElement).appendChild(frame);
  })();

  // Reliable Disqus parent-side status, sizing and fallback handling.
  (() => {
    const frame = document.getElementById('disqus-frame');
    const fallback = document.getElementById('disqus-fallback');
    if (!frame || !fallback) return;
    let loaded = false;

    const showFallback = (message) => {
      fallback.hidden = false;
      fallback.textContent = message + ' ';
      if (!fallback.querySelector('a')) {
        const link = document.createElement('a');
        link.href = 'https://igi-3.disqus.com/';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open Disqus';
        fallback.appendChild(link);
      }
    };

    if (!('credentialless' in HTMLIFrameElement.prototype)) {
      frame.hidden = true;
      showFallback('This browser cannot securely embed third-party comments. Open the discussion directly:');
      return;
    }

    frame.credentialless = true;
    frame.setAttribute('credentialless', '');
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow || !event.data) return;
      const data = event.data;
      if (data.type === 'igi-disqus-height') {
        const height = Number(data.height);
        if (Number.isFinite(height)) frame.style.height = Math.max(420, Math.min(5000, height)) + 'px';
      } else if (data.type === 'igi-disqus-ready' || data.type === 'igi-disqus-rendered') {
        loaded = true;
        fallback.hidden = true;
      } else if (data.type === 'igi-disqus-error') {
        showFallback(data.message || 'Comments could not connect. Open the discussion directly:');
      }
    });

    frame.addEventListener('error', () => showFallback('The comments frame could not load. Open the discussion directly:'));
    window.setTimeout(() => {
      if (!loaded) showFallback('Comments are taking too long to connect. Check your connection or open the discussion directly:');
    }, 35000);
  })();

  document.addEventListener('click', (event) => {
    const el = event.target && event.target.closest
      ? event.target.closest('a, button, [role="button"], input[type="button"], input[type="submit"]')
      : null;
    if (!el || opened) return;

    // Keep moment-to-moment game controls and settings inputs usable.
    if (el.closest('#touch') && !el.matches('#touch .b-gear')) return;
    if (el.closest('#kbd, #tguide, #booting, [data-no-ad-popup]')) return;
    if (el.hasAttribute('download')) return;

    // Do not open the same direct sponsor link twice.
    if (el.matches('a[href]')) {
      try {
        const href = new URL(el.href, location.href);
        if (href.hostname === 'uplcm.com' && href.pathname.startsWith('/4/11141016')) return;
      } catch (_) {}
    }

    // This runs synchronously during the trusted click so browsers can allow the new tab.
    // Do not pass "noopener" to window.open here: browsers may return null by design.
    const tab = window.open(AD_URL, '_blank');
    if (tab) {
      try { tab.opener = null; } catch (_) {}
      opened = true;
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}
    } else {
      console.info('[sponsor] Browser blocked the new tab; allow pop-ups for project-igi.online.');
    }
  }, true);
})();
