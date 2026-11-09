/* Project IGI page helpers.
 * Monetag OnClick is loaded once from each public page's <head>.
 * Do not open a competing sponsor popup or load the zone in a hidden iframe here.
 */
(() => {
  'use strict';
  const frame = document.getElementById('disqus-frame');
  const fallback = document.getElementById('disqus-fallback');
  if (!frame || !fallback) return;
  let loaded = false;

  const showFallback = (message) => {
    fallback.hidden = false;
    fallback.textContent = message + ' ';

    const link = document.createElement('a');
    link.href = 'https://igi-3.disqus.com/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open Disqus';
    fallback.appendChild(link);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry comments';
    retry.style.cssText = 'margin-inline-start:12px;padding:6px 10px;border:1px solid currentColor;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer';
    retry.addEventListener('click', () => {
      loaded = false;
      fallback.hidden = true;
      frame.hidden = false;
      const url = new URL(frame.src, location.href);
      url.searchParams.set('retry', String(Date.now()));
      frame.src = url.href;
    }, { once: true });
    fallback.appendChild(retry);
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
