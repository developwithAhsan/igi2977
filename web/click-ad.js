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
