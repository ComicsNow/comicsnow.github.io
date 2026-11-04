(function () {
  'use strict';

  const INSTALL_SNIPPETS = {
    compose: `services:
  comics-now:
    image: ghcr.io/comicsnow/comics-now:latest
    container_name: comics-now
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - /path/to/your/comics:/comics:ro
    restart: unless-stopped`,
    docker: `docker run -d \\
  --name comics-now \\
  -p 3000:3000 \\
  -v $(pwd)/data:/app/data \\
  -v /path/to/your/comics:/comics:ro \\
  --restart unless-stopped \\
  ghcr.io/comicsnow/comics-now:latest`,
    npx: `# Launch instantly with zero setup
npx comics-now --comics /path/to/your/comics --port 3000

# Or install globally via npm
npm install -g comics-now`
  };

  function initTerminalTabs() {
    const tabButtons = document.querySelectorAll('[data-install-tab]');
    const codeBlock = document.getElementById('install-code-content');
    const copyBtn = document.getElementById('copy-install-btn');
    if (!codeBlock || !tabButtons.length) return;

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-install-tab');
        tabButtons.forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        if (INSTALL_SNIPPETS[key]) {
          codeBlock.textContent = INSTALL_SNIPPETS[key];
        }
        if (window.umami && typeof window.umami.track === 'function') {
          try {
            window.umami.track('install-tab-switch', { tab: key });
          } catch (_e) {}
        }
      });
    });

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(codeBlock.textContent || '');
          copyBtn.textContent = 'COPIED!';
          if (window.umami && typeof window.umami.track === 'function') {
            try {
              window.umami.track('copy-install-command', {
                tab: document.querySelector('[data-install-tab].active')?.getAttribute('data-install-tab') || 'compose'
              });
            } catch (_e) {}
          }
          setTimeout(() => {
            copyBtn.textContent = 'COPY';
          }, 1800);
        } catch (_err) {
          copyBtn.textContent = 'SELECT & COPY';
        }
      });
    }
  }

  function initComparisonFilter() {
    const filterButtons = document.querySelectorAll('[data-compare-filter]');
    const rows = document.querySelectorAll('#comparison-tbody tr[data-category]');
    if (!filterButtons.length || !rows.length) return;

    filterButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const category = btn.getAttribute('data-compare-filter');
        filterButtons.forEach((b) => b.classList.toggle('active', b === btn));

        rows.forEach((row) => {
          const rowCategory = row.getAttribute('data-category');
          const visible = category === 'all' || rowCategory === category;
          row.style.display = visible ? '' : 'none';
        });
      });
    });
  }

  function initLiveAppDemo() {
    const actionBtns = document.querySelectorAll('[data-demo-action]');
    const readerFrame = document.getElementById('demo-reader-frame');
    const gveFrame = document.getElementById('demo-gve-frame');
    const hintBar = document.getElementById('demo-live-hint');
    if (!actionBtns.length || !readerFrame || !gveFrame) return;

    const HINTS = {
      'manga-reader':
        '📖 <strong>Live Comics Now! Reader:</strong> Reading <em>Give My Regards to Black Jack #001</em> (Shuho Sato — Open License Manga). Standard reader view with Panel Zoom and Bubble Zoom automatically off. (Click <strong>Fullscreen</strong> anytime to enter Fullscreen mode!)',
      'manga-panel-zoom':
        '🔲 <strong>Manga Panel Zoom (Fullscreen):</strong> Panel Zoom is automatically turned on! Tap any comic panel to zoom in with razor-sharp clarity. <em>(In Fullscreen UI: <strong>🔲 Square Icon</strong> = Panel Zoom, <strong>💬 Bubble Icon</strong> = Bubble Zoom)</em>',
      'western-bubble-zoom':
        '💬 <strong>Western Bubble Speech Zoom (Fullscreen):</strong> Reading <em>Zip Comics #001 (1940)</em>. Speech Bubble Zoom is automatically turned on! Tap any dialogue bubble. <em>(In Fullscreen UI: <strong>💬 Bubble Icon</strong> = Bubble Zoom, <strong>🔲 Square Icon</strong> = Panel Zoom)</em>',
      'library-grid':
        '📚 <strong>Full Comics Now! Library:</strong> Browse Publishers, Series, and Comics—or click the <strong>📚 Reading Lists</strong> button to explore multi-series reading orders!',
      'reading-list-dag':
        '🔀 <strong>Visual Crossover Reading Order Map:</strong> Drag to pan, scroll to zoom, and click any issue node across MLJ Magazines, Rural Home, and Dell Publishing to inspect or read it!',
      'gve-editor':
        '✏️ <strong>GVE Now! Visual Editor (Live Sync &amp; Share):</strong> Drag or resize any panel (blue) or speech bubble (gold), draw new polygon boxes, reorder reading steps, and click <strong>Save</strong> to sync live! Plus, use <strong>Import &amp; Export</strong> to easily share your custom GVE edits with friends!'
    };

    actionBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-demo-action');
        actionBtns.forEach((b) => b.classList.toggle('active', b === btn));
        if (hintBar && HINTS[action]) {
          hintBar.innerHTML = HINTS[action];
        }

        if (action === 'gve-editor') {
          readerFrame.classList.add('hidden');
          gveFrame.classList.remove('hidden');
        } else {
          gveFrame.classList.add('hidden');
          readerFrame.classList.remove('hidden');
          if (readerFrame.contentWindow) {
            readerFrame.contentWindow.postMessage(
              { target: 'comics-now-demo', action },
              '*'
            );
          }
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTerminalTabs();
    initComparisonFilter();
    initLiveAppDemo();
  });
})();
