(function () {
  'use strict';

  window.module = { exports: {} };

  const DEMO_BASE_PATH = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
  window.API_BASE_URL = DEMO_BASE_PATH;
  window.APP_CONFIG = {
    baseUrl: DEMO_BASE_PATH,
    libraries: [
      {
        id: 'lib_0',
        name: 'Comics & Manga Demo Library',
        path: '/comics',
        hierarchyMode: 'metadata'
      }
    ]
  };

  const MANGA_COMIC_ID = '526643c2796492c2c7ad1f59706129453670129e';
  const WESTERN_COMIC_ID = 'f0d80d4e11db885d08f0572991e6f287185e4646';

  try {
    if (localStorage.getItem('gve_schema_version') !== '12') {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('gve_doc_') || k.startsWith('gve_sidecar_')) {
          localStorage.removeItem(k);
        }
      });
      localStorage.setItem('gve_schema_version', '12');
    }
  } catch (_e) {}

  const urlParams = new URLSearchParams(window.location.search);
  const initialMode = urlParams.get('mode') || 'manga-reader';
  if (initialMode === 'library-grid' || initialMode === 'reading-list-dag') {
    window.__DEMO_RELATIVE_PATH__ = '/library';
  } else if (initialMode === 'western-reader' || initialMode === 'western-bubble-zoom') {
    window.__DEMO_RELATIVE_PATH__ = `/comic/${WESTERN_COMIC_ID}/page/6`;
  } else {
    window.__DEMO_RELATIVE_PATH__ = `/comic/${MANGA_COMIC_ID}/page/7`;
  }

  // Keep browser URL at index.html so static servers never 404 on SPA routes
  const origPushState = window.history.pushState.bind(window.history);
  const origReplaceState = window.history.replaceState.bind(window.history);

  function extractRelativeRoute(urlStr) {
    if (!urlStr) return '/';
    try {
      const u = new URL(urlStr, window.location.origin);
      let p = u.pathname;
      if (DEMO_BASE_PATH && p.startsWith(DEMO_BASE_PATH)) {
        p = p.substring(DEMO_BASE_PATH.length);
      }
      if (!p || p === '/index.html') p = '/';
      return p;
    } catch (_e) {
      return '/';
    }
  }

  window.history.pushState = function (stateObj, title, url) {
    if (url && !window._isAppInitializing) {
      window.__DEMO_RELATIVE_PATH__ = extractRelativeRoute(String(url));
    }
    return origPushState(stateObj, title, window.location.pathname + window.location.search);
  };

  window.history.replaceState = function (stateObj, title, url) {
    if (url && !window._isAppInitializing) {
      window.__DEMO_RELATIVE_PATH__ = extractRelativeRoute(String(url));
    }
    return origReplaceState(stateObj, title, window.location.pathname + window.location.search);
  };

  // Disable service worker registration inside the static demo
  if ('serviceWorker' in navigator) {
    const dummyReg = {
      update: function () {},
      unregister: function () { return Promise.resolve(true); },
      addEventListener: function () {}
    };
    navigator.serviceWorker.register = function () {
      return Promise.resolve(dummyReg);
    };
    try {
      Object.defineProperty(navigator.serviceWorker, 'ready', {
        get: function () { return Promise.resolve(dummyReg); },
        configurable: true
      });
    } catch (_e) {}
  }

  function getDb() {
    return window.STATIC_ECOSYSTEM_DB || { comics: [], sidecars: {}, gveDocs: {}, pageDims: {} };
  }

  function decodeBase64Path(b64) {
    if (!b64) return '';
    try {
      const raw = atob(decodeURIComponent(b64));
      try {
        return decodeURIComponent(raw);
      } catch (_e) {
        return raw;
      }
    } catch (_err) {
      return '';
    }
  }

  function findComicByPathOrId(pathOrId) {
    const db = getDb();
    if (!pathOrId) return db.comics[0];
    const norm = String(pathOrId).replace(/^\/+/, '');
    return (
      db.comics.find(
        (c) =>
          c.id === pathOrId ||
          c.path === pathOrId ||
          c.path.replace(/^\/+/, '') === norm ||
          c.rawPath === pathOrId ||
          c.path.endsWith(norm) ||
          norm.endsWith(c.name)
      ) || db.comics[0]
    );
  }

  function rewriteApiImageUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return urlStr;
    if (urlStr.includes('/api/v1/comics/pages/image')) {
      try {
        const u = new URL(urlStr, window.location.origin);
        const p = decodeBase64Path(u.searchParams.get('path') || '');
        const page = u.searchParams.get('page') || 'page_001.jpg';
        const comic = findComicByPathOrId(p);
        if (comic) {
          return `${DEMO_BASE_PATH}/../assets/golden-pages/${comic.id}/${page}`;
        }
      } catch (_e) {}
    }
    return urlStr;
  }

  // Intercept <img src="..."> for comic pages & thumbnails
  const imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (imgSrcDesc && imgSrcDesc.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      set: function (val) {
        imgSrcDesc.set.call(this, rewriteApiImageUrl(val));
      },
      get: function () {
        return imgSrcDesc.get.call(this);
      },
      configurable: true
    });
  }

  const origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') {
      return origSetAttr.call(this, name, rewriteApiImageUrl(value));
    }
    return origSetAttr.call(this, name, value);
  };

  function buildLibraryResponse() {
    const db = getDb();
    const publishers = {};
    for (const c of db.comics) {
      if (!publishers[c.publisher]) {
        publishers[c.publisher] = {
          logoUrl: `thumbnails/${c.id}.jpg`,
          logoNeedsBackground: false,
          logoNeedsDarkBackground: true,
          series: {}
        };
      }
      if (!publishers[c.publisher].series[c.series]) {
        publishers[c.publisher].series[c.series] = [];
      }
      const savedPage = Number(localStorage.getItem('cn_demo_page_' + c.id) || 0);
      publishers[c.publisher].series[c.series].push({
        id: c.id,
        name: c.name,
        path: c.path,
        thumbnailPath: `${c.id}.jpg`,
        progress: { lastReadPage: savedPage, totalPages: c.totalPages },
        updatedAt: c.updatedAt,
        convertedAt: null,
        metadata: {
          Number: c.metadata.Number,
          Series: c.metadata.Series,
          Title: c.metadata.Title,
          Year: c.metadata.Year,
          Month: c.metadata.Month,
          Day: '',
          CoverDate: `${c.metadata.Year}-${String(c.metadata.Month).padStart(2, '0')}-01`
        },
        series: c.series,
        publisher: c.publisher,
        mangaMode: !!c.mangaMode,
        continuousMode: false,
        guidedViewStatus: 'completed',
        libraryMode: 'metadata',
        tagStatus: 'tagged'
      });
    }
    return {
      lib_0: {
        hierarchyMode: 'metadata',
        publishers
      }
    };
  }

  function jsonResponse(obj, status = 200) {
    return Promise.resolve(
      new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    const u = new URL(rawUrl, window.location.origin);
    const pathname = u.pathname;
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    if (pathname.includes('/api/v1/comics/pages/image')) {
      return origFetch(rewriteApiImageUrl(rawUrl), init);
    }

    if (pathname.endsWith('/api/v1/health')) {
      return jsonResponse({ ok: true, status: 'ok' });
    }

    if (pathname.endsWith('/api/v1/user/me')) {
      return jsonResponse({
        ok: true,
        user: {
          userId: 'default-user',
          email: 'comicsnowdev@gmail.com',
          name: 'Comics Now! Demo',
          role: 'admin'
        }
      });
    }

    if (pathname.endsWith('/api/v1/settings')) {
      return jsonResponse({
        ok: true,
        comicsDirectory: '/comics',
        libraries: [{ id: 'lib_0', name: 'Comics & Manga Demo Library', path: '/comics', hierarchyMode: 'metadata' }],
        delete_cbr_after_conversion: false,
        delete_pdf_after_conversion: false,
        libraryMode: 'metadata',
        guided_engine: 'local'
      });
    }

    if (pathname.endsWith('/api/v1/user/library-preferences')) {
      return jsonResponse({
        ok: true,
        preferences: {
          default_manga_mode: false,
          default_continuous_mode: false,
          delete_cbr_after_conversion: false,
          delete_pdf_after_conversion: false
        }
      });
    }

    if (pathname.endsWith('/api/v1/manga-mode-preference')) {
      return jsonResponse({ ok: true, mangaMode: false });
    }

    if (pathname.endsWith('/api/v1/comics/structure')) {
      return jsonResponse({ ok: false }, 404);
    }

    if (pathname.endsWith('/api/v1/comics')) {
      return jsonResponse(buildLibraryResponse());
    }

    if (pathname.endsWith('/api/v1/comics/pages')) {
      const p = decodeBase64Path(u.searchParams.get('path') || '');
      const comic = findComicByPathOrId(p);
      return jsonResponse({
        pages: comic ? comic.pagesList : [],
        id: comic ? comic.id : '',
        guidedViewStatus: 'completed',
        guidedMode: 1,
        bubbleMode: 1,
        hotZoomMode: 1,
        mangaBubbleHotMode: 1,
        landscapeMode: 0,
        fullImageMode: 0
      });
    }

    if (pathname.endsWith('/api/v1/comics/info')) {
      const p = decodeBase64Path(u.searchParams.get('path') || '');
      const comic = findComicByPathOrId(p);
      return jsonResponse({
        ok: true,
        info: comic ? comic.metadata : {},
        metadata: comic ? comic.metadata : {},
        id: comic ? comic.id : ''
      });
    }

    const gvMatch = pathname.match(/\/api\/v1\/comics\/([^/]+)\/guided-view$/);
    if (gvMatch) {
      const id = gvMatch[1];
      const custom = localStorage.getItem('gve_sidecar_' + id);
      if (custom) {
        try {
          return jsonResponse(JSON.parse(custom));
        } catch (_e) {}
      }
      const db = getDb();
      if (db.sidecars[id]) {
        return jsonResponse(db.sidecars[id]);
      }
      return jsonResponse({ ok: false, message: 'Not found' }, 404);
    }

    if (pathname.endsWith('/api/v1/reading-lists')) {
      const db = getDb();
      const westernComics = db.comics.filter((c) => !c.mangaMode);
      const firstId = westernComics[0] ? westernComics[0].id : '';
      return jsonResponse({
        ok: true,
        lists: [
          {
            id: 'golden-age-crossover-demo',
            userId: 'default-user',
            name: 'Golden Age Legends (1940–1954 Crossover)',
            description: 'Multi-publisher Golden Age crossover anthology spanning MLJ Magazines, Rural Home, and Dell Publishing. Click the DAG button (🔀) above to view the interactive crossover timeline map!',
            sortOrder: 0,
            totalComics: westernComics.length,
            seriesCount: 4,
            publishers: ['MLJ Magazines', 'Rural Home', 'Dell Publishing'],
            readComics: 0,
            inProgressComics: 1,
            unreadComics: westernComics.length - 1,
            progressPercent: 16,
            thumbnailPath: firstId ? `${firstId}.jpg` : null
          }
        ]
      });
    }

    if (pathname.endsWith('/api/v1/reading-lists/golden-age-crossover-demo/dag')) {
      const db = getDb();
      const westernComics = db.comics.filter((c) => !c.mangaMode);
      const laneColors = ['#f59e0b', '#3b82f6', '#ec4899', '#10b981'];
      const seriesList = ['Blue Ribbon Comics', 'Blazing Comics', 'Zip Comics', 'Four Color Comics'];
      const seriesLanes = seriesList.map((s, idx) => ({
        series: s,
        lane: idx,
        count: westernComics.filter((c) => c.series === s).length,
        color: laneColors[idx % laneColors.length]
      }));
      const laneMap = new Map(seriesLanes.map((l) => [l.series, l.lane]));
      const nodes = westernComics.map((c, idx) => ({
        id: c.id,
        step: idx + 1,
        sortOrder: idx,
        name: c.name,
        series: c.series,
        number: c.metadata.Number,
        publisher: c.publisher,
        thumbnailPath: `${c.id}.jpg`,
        summary: c.metadata.Summary,
        year: Number(c.metadata.Year),
        totalPages: c.totalPages,
        lastReadPage: idx === 0 ? 2 : 0,
        readStatus: idx === 0 ? 'in-progress' : 'unread',
        progressPercent: idx === 0 ? 12 : 0,
        lane: laneMap.get(c.series) ?? 0,
        isCore: (laneMap.get(c.series) ?? 0) === 0
      }));
      const edges = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({
          id: `edge-step-${i}`,
          from: nodes[i].id,
          to: nodes[i + 1].id,
          type: 'reading-order'
        });
      }
      return jsonResponse({
        ok: true,
        list: {
          id: 'golden-age-crossover-demo',
          name: 'Golden Age Legends (1940–1954 Crossover)',
          description: 'Multi-publisher Golden Age crossover anthology spanning MLJ Magazines, Rural Home, and Dell Publishing.'
        },
        totalIssues: nodes.length,
        readCount: 0,
        inProgressCount: 1,
        nodes,
        edges,
        seriesLanes
      });
    }

    if (pathname.endsWith('/api/v1/reading-lists/golden-age-crossover-demo')) {
      const db = getDb();
      const westernComics = db.comics.filter((c) => !c.mangaMode);
      return jsonResponse({
        ok: true,
        list: {
          id: 'golden-age-crossover-demo',
          userId: 'default-user',
          name: 'Golden Age Legends (1940–1954 Crossover)',
          description: 'Multi-publisher Golden Age crossover anthology spanning MLJ Magazines, Rural Home, and Dell Publishing.'
        },
        items: westernComics.map((c, idx) => ({
          comicId: c.id,
          addedAt: Date.now() - (10 - idx) * 60000,
          sortOrder: idx,
          lastReadPage: Number(localStorage.getItem('cn_demo_page_' + c.id) || (idx === 0 ? 1 : 0)),
          totalPages: c.totalPages
        }))
      });
    }

    if (pathname.includes('/api/v1/sync/') || pathname.includes('/api/v1/comics/status') || pathname.includes('/api/v1/device')) {
      if (method === 'POST' && init && init.body) {
        try {
          const body = JSON.parse(init.body);
          if (body.comicId && typeof body.lastReadPage === 'number') {
            localStorage.setItem('cn_demo_page_' + body.comicId, String(body.lastReadPage));
          }
        } catch (_e) {}
      }
      return jsonResponse({ ok: true, devices: [], upToDate: true });
    }

    if (pathname.includes('/api/')) {
      return jsonResponse({ ok: true, logs: [], errors: [], users: [], devices: [], models: [] });
    }

    return origFetch(input, init);
  };

  // Clear GuidedView cache whenever GVE Now! updates localStorage
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('gve_')) {
      if (window.GuidedView && window.GuidedView.cache) {
        window.GuidedView.cache.clear();
      }
    }
  });

  async function runDemoAction(action) {
    if (window.GuidedView && window.GuidedView.cache) {
      window.GuidedView.cache.clear();
    }

    const closeModalsAndFullscreen = async () => {
      if (typeof window.closeReadingListModal === 'function') {
        try { window.closeReadingListModal(); } catch (_e) {}
      }
      const rlModal = document.getElementById('reading-list-modal');
      if (rlModal) rlModal.classList.add('hidden');
      if (typeof window.closeFullscreen === 'function') {
        try { await window.closeFullscreen(); } catch (_e) {}
      }
    };

    const ensureComicOpen = async (comicId, pageNum) => {
      if (!window.currentComic || window.currentComic.id !== comicId || window.currentView !== 'comic') {
        if (window.router) {
          window.router.navigate(`/comic/${comicId}/page/${pageNum}`, true);
          await new Promise((r) => setTimeout(r, 400));
        }
      } else if (typeof window.goToPage === 'function' && window.currentPageIndex !== pageNum - 1) {
        await window.goToPage(pageNum - 1);
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    // Update active state on our standalone top bar
    document.querySelectorAll('[data-cn-demo-btn]').forEach((btn) => {
      const isMatch = btn.getAttribute('data-cn-demo-btn') === action;
      btn.style.background = isMatch ? '#fb4d3d' : '#2a241b';
      btn.style.borderColor = isMatch ? '#ff7b6e' : '#3a3226';
      btn.style.color = isMatch ? '#ffffff' : '#d1d5db';
    });

    if (action === 'manga-reader') {
      await closeModalsAndFullscreen();
      await ensureComicOpen(MANGA_COMIC_ID, 7);
    } else if (action === 'manga-panel-zoom') {
      await closeModalsAndFullscreen();
      await ensureComicOpen(MANGA_COMIC_ID, 7);
      if (typeof window.openFullscreen === 'function') {
        window.openFullscreen();
        await new Promise((r) => setTimeout(r, 250));
        if (window.GuidedView && typeof window.GuidedView.enable === 'function') {
          await window.GuidedView.enable();
          const mode = window.GuidedView.ModeRegistry?.getActiveMode?.();
          if (mode && typeof mode.tryAdvance === 'function') {
            mode.tryAdvance(1);
          }
        }
        if (typeof window.showFullscreenControls === 'function') {
          window.showFullscreenControls(false);
        }
      }
    } else if (action === 'western-bubble-zoom') {
      await closeModalsAndFullscreen();
      await ensureComicOpen(WESTERN_COMIC_ID, 6);
      if (typeof window.openFullscreen === 'function') {
        window.openFullscreen();
        await new Promise((r) => setTimeout(r, 250));
        if (window.GuidedView && typeof window.GuidedView.enableBubble === 'function') {
          await window.GuidedView.enableBubble();
          const mode = window.GuidedView.ModeRegistry?.getActiveMode?.();
          if (mode && typeof mode.tryAdvance === 'function') {
            mode.tryAdvance(1);
          }
        }
        if (typeof window.showFullscreenControls === 'function') {
          window.showFullscreenControls(false);
        }
      }
    } else if (action === 'library-grid') {
      await closeModalsAndFullscreen();
      if (typeof window.showPublisherList === 'function') {
        window.showPublisherList('lib_0', { force: true });
      } else if (window.router) {
        window.router.navigate('/library?rootFolder=lib_0', true);
      }
    } else if (action === 'reading-list-dag') {
      if (typeof window.closeFullscreen === 'function') {
        try { await window.closeFullscreen(); } catch (_e) {}
      }
      const rlModal = document.getElementById('reading-list-modal');
      if (rlModal) rlModal.classList.remove('hidden');
      if (typeof window.showReadingListDetail === 'function') {
        await window.showReadingListDetail(
          'golden-age-crossover-demo',
          'Golden Age Legends (1940–1954 Crossover)',
          'dag'
        );
      }
    }
  }

  window.runComicsNowDemoAction = runDemoAction;

  // Inject standalone Demo Switcher Bar at the top of the page
  function injectStandaloneDemoBar() {
    if (document.getElementById('cn-standalone-demo-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'cn-standalone-demo-bar';
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:10050;background:#15120e;border-bottom:2px solid #fb4d3d;padding:6px 14px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.6);';

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;';

    const homeLink = document.createElement('a');
    homeLink.href = '../index.html';
    homeLink.textContent = '← Back to Website';
    homeLink.style.cssText =
      'background:#2a241b;border:1px solid #ffce3a;color:#ffce3a;text-decoration:none;font-size:12px;font-weight:700;padding:5px 10px;border-radius:5px;margin-right:4px;';
    left.appendChild(homeLink);

    const modes = [
      { id: 'manga-reader', label: '📖 1. Manga Reader Page' },
      { id: 'manga-panel-zoom', label: '🔍 2. Manga Panel Zoom (Fullscreen)' },
      { id: 'western-bubble-zoom', label: '💬 3. Western Speech Bubble Zoom' },
      { id: 'library-grid', label: '📚 4. Full Library Grid' },
      { id: 'reading-list-dag', label: '🔀 5. Crossover Reading Map' }
    ];

    modes.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-cn-demo-btn', m.id);
      btn.textContent = m.label;
      const isInitial = m.id === initialMode;
      btn.style.cssText = `background:${isInitial ? '#fb4d3d' : '#2a241b'};border:1px solid ${isInitial ? '#ff7b6e' : '#3a3226'};color:${isInitial ? '#ffffff' : '#d1d5db'};font-size:12px;font-weight:700;padding:5px 10px;border-radius:5px;cursor:pointer;`;
      btn.addEventListener('click', () => runDemoAction(m.id));
      left.appendChild(btn);
    });

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const gveLink = document.createElement('a');
    gveLink.href = '../demo-gve/index.html';
    gveLink.textContent = '✏️ Switch to GVE Now! Visual Editor →';
    gveLink.style.cssText =
      'background:#0055ff;border:1px solid #60a5fa;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;padding:5px 12px;border-radius:5px;';
    right.appendChild(gveLink);

    bar.appendChild(left);
    bar.appendChild(right);
    document.body.prepend(bar);
    document.body.style.paddingTop = '56px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStandaloneDemoBar);
  } else {
    injectStandaloneDemoBar();
  }

  // Trigger initial mode once libraryReady becomes true
  const bootPoll = setInterval(() => {
    if (window.libraryReady && window.router && !window._isAppInitializing) {
      clearInterval(bootPoll);
      runDemoAction(initialMode);
    }
  }, 100);
  setTimeout(() => clearInterval(bootPoll), 8000);

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.target !== 'comics-now-demo') return;
    await runDemoAction(data.action);
  });
})();
