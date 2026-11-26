/**
 * Assembles the single, zero-import Cloudflare Worker file (`cloudflare/worker.js`)
 * by embedding `public/styles.css` and all frontend JS files directly into `INDEX_HTML`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');

const jsOrder = [
  'public/api.js',
  'public/utils.js',
  'public/views/auth.js',
  'public/views/home.js',
  'public/views/track.js',
  'public/views/leaderboard.js',
  'public/views/friends.js',
  'public/views/groups.js',
  'public/views/profile.js',
  'public/views/runDetail.js',
  'public/views/sources.js',
  'public/views/resources.js',
  'public/views/privacy.js',
  'public/views/me.js',
  'public/app.js',
];

function stripModuleSyntax(code) {
  return code
    // Remove multi-line or single-line ES imports
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    // Convert exported declarations into normal top-level declarations inside the IIFE
    .replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
}

const bundledJs = [
  '(function () {',
  "'use strict';",
  ...jsOrder.map((rel) => {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return `// --- ${rel} ---\n${stripModuleSyntax(raw)}`;
  }),
  '})();',
].join('\n\n');

// Escape closing </script> tags defensively inside inline script
const safeInlineJs = bundledJs.replace(/<\/script/gi, '<\\/script');

const indexHtml = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="description" content="Isrunner — קהילת רצים בעברית: שיאים אישיים, דירוגים שקופים, חברים וקבוצות." />
  <meta name="theme-color" content="#f6f3ee" />
  <title>Isrunner — קהילת רצים בעברית</title>
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&family=Rubik:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
${css}
  </style>
</head>
<body>
  <div id="app" class="app-shell">
    <header class="top-header" id="top-header">
      <div class="header-inner">
        <div class="header-brand">
          <button id="header-back-btn" class="header-back-btn hidden" type="button" aria-label="חזרה">
            &#8594;&nbsp;חזרה
          </button>
          <a href="#/home" class="brand-link" aria-label="Isrunner דף הבית">
            <span class="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke-linecap="round">
                <path d="M5 16.5 L11 7.5" stroke="#ffffff" stroke-width="2.6" />
                <path d="M10.5 16.5 L16.5 7.5" stroke="#e2552f" stroke-width="2.6" />
                <path d="M16 16.5 L19 12" stroke="#ffffff" stroke-width="2.6" opacity="0.45" />
              </svg>
            </span>
            <span class="brand-name">Isrunner</span>
          </a>
        </div>
        <div class="header-right" id="header-right"></div>
      </div>
    </header>

    <nav class="desktop-nav hidden" id="desktop-nav" aria-label="ניווט ראשי"></nav>

    <main id="main-content" class="main-content" tabindex="-1">
      <div class="loading-box">טוען את Isrunner...</div>
    </main>

    <nav class="bottom-nav hidden" id="bottom-nav" aria-label="ניווט תחתון"></nav>

    <div id="toast-container" class="toast-container" role="status" aria-live="polite"></div>
    <div id="modal-root" class="modal-root hidden" role="dialog" aria-modal="true"></div>
  </div>

  <script>
${safeInlineJs}
  </script>
</body>
</html>`;

const iconSvg = fs.readFileSync(path.join(ROOT, 'public/icon.svg'), 'utf8');
const manifestJson = fs.readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8');

const core = fs.readFileSync(path.join(ROOT, 'cloudflare/worker-core.js'), 'utf8');
if (!core.includes('__ISRUNNER_INDEX_HTML__')) {
  throw new Error('Missing __ISRUNNER_INDEX_HTML__ placeholder in cloudflare/worker-core.js');
}

const finalWorker = core
  .replace('__ISRUNNER_ICON_SVG__', JSON.stringify(iconSvg))
  .replace('__ISRUNNER_MANIFEST_JSON__', JSON.stringify(manifestJson))
  .replace('__ISRUNNER_INDEX_HTML__', JSON.stringify(indexHtml));
const outPath = path.join(ROOT, 'cloudflare/worker.js');
fs.writeFileSync(outPath, finalWorker, 'utf8');

console.log(`Built ${outPath} (${(Buffer.byteLength(finalWorker, 'utf8') / 1024).toFixed(1)} KB, zero imports)`);
