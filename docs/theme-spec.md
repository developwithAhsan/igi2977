# Site-wide Project I.G.I. theme specification

## Verification status

The reference website could not be loaded by the available inspection tools. No reference CSS, JavaScript, font binaries, audio elements, media requests, or DevTools network capture was obtained. Therefore its exact fonts, CSS values, audio tracks, sound events, crossfade timings and page transitions remain unverified. This document distinguishes facts found in Site A from provisional values requested in the task.

## Existing Site A findings

- The repository is a static HTML/CSS/JavaScript site, not a Vite application. The homepage is root index.html, the player is web/play.html, and inner pages are static files under web/ with routes mapped in vercel.json.
- The homepage already used a CRT treatment in home.css. Its prior palette included phosphor #67f995, highlight #d4ffe0, muted green, dashed green borders, red #ff6656, and a dark green-black screen/bezel.
- Inner pages previously used root redesign.css, which declared a light cream/green palette with #F5F7EE background, white surfaces, dark olive text and green controls.
- The player page has its own inline styling and existing canvas, settings panel and game runtime scripts. The theme is loaded after its existing styles and does not replace game logic.
- Existing page-specific text, headings, canonical URLs, metadata, structured data, internal link destinations, sitemap.xml and robots.txt are not intentionally rewritten by this change.

## Provisional theme tokens

The following values are starting points supplied in the task brief, not independently verified against the reference site:

| Token | Provisional value |
|---|---|
| Background | #070806 |
| Inner screen | #020b05 |
| Phosphor text | #5dff8a |
| Highlight | #c8ffd8 |
| Muted text | rgba(93,255,138,.60) |
| Border | rgba(93,255,138,.30) |
| Secondary red | #ff4a3a |

The central file igi-theme.css contains these tokens, surface/glow/border variables and the font-family aliases. Both homepage and inner pages load the same CSS layer after their existing page styles. The theme-color meta values were left unchanged as requested by the SEO-preservation rule.

## Typography and licensing

The reported font-family names IGI Menu, IGI Tiny and IGI Small are configured as CSS aliases with crisp monospace fallbacks. No matching font files were present in the inspected Site A repository paths, and none could be retrieved from the reference. Consequently, the actual reference faces are not embedded yet.

No font file was copied. The licence for the alleged reference fonts is unknown. Before hosting any font binaries, confirm that their licence permits redistribution from this website or supply fonts you are authorised to host.

The external Google Fonts stylesheet and font preconnects were removed from the affected pages. This avoids third-party font requests, but it means the current visible typeface is the local/system monospace fallback until licensed local font files are supplied.

## Structure and effects

The shared theme restyles existing semantic headers/navigation, buttons, focus rings, page heroes, articles, cards, forms, tables, code blocks, tags, comments wrappers, footers, the 404 page, player toolbar, settings panel and stage frame. It adds decorative section-title prefixes through CSS pseudo-elements, leaving the actual heading text and HTML hierarchy intact.

The home page retains its existing CRT layer. Other pages receive a lightweight fixed scanline/vignette overlay with pointer-events disabled. The audio dock includes an FX toggle that persists the effects preference. Reduced-motion preferences reduce motion effects. No actual reference menu layout, corner-bracket measurements, loading-screen artwork, Agent status text, or file chips were copied because these could not be inspected.

## Audio engine

The engine is implemented without a third-party library. It uses Web Audio API gain nodes for background volume and fades, plus a small pool of HTMLAudioElement instances for interface effects.

The engine:
- waits for the first user entry gesture before enabling site audio;
- shows a dismissible CLICK TO ENTER layer once per session;
- reads MP3 first and OGG as fallback;
- skips missing files and logs at most one development-only warning per slot;
- stores mute and volume in localStorage;
- stores current background-track position in sessionStorage before navigation and resumes it when the same category is revisited;
- fades music in on a new full-page document and plays the page-change effect after internal navigation;
- pauses while the browser tab is hidden and resumes when visible;
- ducks the site track when the game stage is active, focused, fullscreen or holding pointer lock;
- excludes clicks within the game stage so its original sound/input logic is not intercepted;
- exposes accessible mute, volume and visual-effects controls.

Because this site uses full-page navigation, an audio context cannot survive between documents. Session playback position is restored and the new page fades in, but this is not a continuous cross-document crossfade. No audio files were created, fetched, copied or committed.

The reference audio could not be inspected, so the upload table defines the planned sound slots rather than asserting these sounds were observed on the reference.

## Remaining validation

Source-level validation can confirm file changes, preserved SEO snippets, script references, and deployment readiness. A full Chrome DevTools session, visual screenshots at the requested viewport sizes, Lighthouse scores, keyboard/screen-reader manual checks, and cross-browser/iOS audio testing are not available in this execution environment. Those checks remain outstanding and are not represented as completed.
