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

    opened = true;
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}

    // This runs synchronously during the trusted click so browsers can allow the new tab.
    const tab = window.open(AD_URL, '_blank', 'noopener,noreferrer');
    if (!tab) console.info('[sponsor] Browser blocked the new tab; allow pop-ups for project-igi.online.');
  }, true);
})();
