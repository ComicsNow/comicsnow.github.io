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

  // ------------------------------------------------------------------
  // Umami analytics: privacy-safe payloads, queued boot events, debug mirror
  // ------------------------------------------------------------------
  const analyticsState = {
    startedAt: Date.now(),
    comics: new Set(),
    pages: new Set(),
    modes: new Set(),
    completed: new Set(),
    fullscreenUsed: false,
    maxPagePct: 0
  };
  const analyticsQueue = [];
  const seenPageTurns = new Set();
  const seenCompletions = new Set();
  const recentComicOpens = new Map();
  let pageviewSent = false;
  let pageviewPending = false;
  let entrySent = false;
  let exitSent = false;
  let currentMode = null;
  let entryMarker = null;
  let markerLoaded = false;

  function sanitizeEventData(data) {
    const clean = {};
    if (!data) return clean;
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (typeof value === 'string') clean[key] = value.slice(0, 120);
      else if (typeof value === 'number' && isFinite(value)) clean[key] = value;
      else if (typeof value === 'boolean') clean[key] = value;
    });
    return clean;
  }

  function safeToken(value, fallback) {
    return typeof value === 'string' && /^[a-z0-9-]{1,24}$/.test(value) ? value : fallback;
  }

  function safeMode(value) {
    return typeof value === 'string' && /^[a-z0-9-]{1,32}$/.test(value) ? value : 'unknown';
  }

  function mirrorEvent(name, data) {
    try {
      if (localStorage.getItem('cn_analytics_debug') === '1') {
        const events = window.__cnEvents || (window.__cnEvents = []);
        events.push({ name, data, ts: Date.now() });
        if (events.length > 200) events.splice(0, events.length - 200);
      }
    } catch (_e) {}
  }

  function sendEvent(name, data) {
    if (!window.umami || typeof window.umami.track !== 'function') return false;
    try {
      const result = window.umami.track(name, data);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_e) {}
    return true;
  }

  function cnPageview() {
    if (pageviewSent) return;
    if (!window.umami || typeof window.umami.track !== 'function') {
      pageviewPending = true;
      return;
    }
    try {
      // A no-argument track() is a pageview; a named call would be an event.
      const result = window.umami.track();
      if (result && typeof result.catch === 'function') result.catch(() => {});
      pageviewSent = true;
    } catch (_e) {
      pageviewPending = true;
    }
  }

  function flushAnalytics() {
    if (!window.umami || typeof window.umami.track !== 'function') return;
    if (pageviewPending && !pageviewSent) {
      pageviewPending = false;
      cnPageview();
    }
    while (analyticsQueue.length) {
      const event = analyticsQueue.shift();
      sendEvent(event.name, event.data);
    }
  }

  function cnTrack(name, data) {
    const payload = sanitizeEventData(data);

    if (name === 'reader-page-turn') {
      const key = String(payload.comic_id) + ':' + String(payload.page);
      if (seenPageTurns.has(key)) return;
      seenPageTurns.add(key);
    }
    if (name === 'reader-comic-complete') {
      const key = String(payload.comic_id);
      if (seenCompletions.has(key)) return;
      seenCompletions.add(key);
    }
    if (name === 'reader-comic-open' && payload.comic_id != null) {
      // Router and boot can both announce the same open within a frame or two.
      const key = String(payload.comic_id);
      const now = Date.now();
      if (now - (recentComicOpens.get(key) || 0) < 1500) return;
      recentComicOpens.set(key, now);
      analyticsState.comics.add(key);
    }
    if (name === 'reader-page-turn') {
      if (payload.comic_id != null) {
        analyticsState.pages.add(String(payload.comic_id) + ':' + String(payload.page));
      }
      const pct = Number(payload.pct);
      if (isFinite(pct)) {
        analyticsState.maxPagePct = Math.max(
          analyticsState.maxPagePct,
          Math.min(100, Math.round(pct))
        );
      }
    }
    if (name === 'reader-comic-complete' && payload.comic_id != null) {
      analyticsState.completed.add(String(payload.comic_id));
    }
    if (name === 'reader-fullscreen-open') analyticsState.fullscreenUsed = true;
    if (name === 'reader-guided-toggle' && payload.action === 'on' && payload.mode) {
      analyticsState.modes.add(String(payload.mode));
    }
    if (name === 'demo-mode-switch' && payload.mode) {
      analyticsState.modes.add(String(payload.mode));
    }
    if (name === 'reader-entry' && payload.mode) {
      analyticsState.modes.add(String(payload.mode));
    }

    mirrorEvent(name, payload);
    if (!sendEvent(name, payload)) analyticsQueue.push({ name, data: payload });
  }
  window.cnTrack = cnTrack;

  function takeEntryMarker() {
    if (markerLoaded) return entryMarker;
    markerLoaded = true;
    try {
      const raw = sessionStorage.getItem('cn_entry');
      sessionStorage.removeItem('cn_entry');
      if (!raw) return null;
      const marker = JSON.parse(raw);
      if (!marker || marker.v !== 1 || marker.app !== 'reader') return null;
      if (typeof marker.ts !== 'number' || !isFinite(marker.ts)) return null;
      const age = Date.now() - marker.ts;
      if (age < -60000 || age > 30 * 60 * 1000) return null;
      entryMarker = marker;
      return marker;
    } catch (_e) {
      return null;
    }
  }

  function writeEntryMarker(app, mode, source, from) {
    try {
      sessionStorage.setItem(
        'cn_entry',
        JSON.stringify({
          v: 1,
          app: app,
          mode: safeMode(mode),
          source: safeToken(source, 'direct'),
          from: safeToken(from, 'landing'),
          ts: Date.now()
        })
      );
    } catch (_e) {}
  }
  window.cnWriteEntry = writeEntryMarker;

  function cnEmitEntry(mode) {
    if (entrySent) return;
    entrySent = true;
    cnPageview();

    const marker = takeEntryMarker();
    const payload = { mode: safeMode(mode || initialMode) };
    if (marker) {
      payload.source = safeToken(marker.source, 'landing');
      payload.from = safeToken(marker.from, 'landing');
      payload.via = 'referral';
      payload.entry_age_s = Math.max(0, Math.round((Date.now() - marker.ts) / 1000));
    } else {
      payload.source = 'direct';
      payload.from = 'direct';
      payload.via = 'direct';
    }
    cnTrack('reader-entry', payload);
  }
  window.cnReaderEntry = cnEmitEntry;

  function cnEmitExit(dest) {
    if (exitSent) return;
    exitSent = true;
    cnTrack('reader-exit', {
      dest: safeToken(dest, 'pagehide'),
      dwell_s: Math.max(0, Math.round((Date.now() - analyticsState.startedAt) / 1000)),
      comics_opened: analyticsState.comics.size,
      pages_viewed: analyticsState.pages.size,
      modes_used: analyticsState.modes.size,
      fullscreen_used: analyticsState.fullscreenUsed,
      max_page_pct: analyticsState.maxPagePct,
      completed: analyticsState.completed.size
    });
  }
  window.cnReaderExit = cnEmitExit;

  function currentComicId() {
    const comic = window.currentComic;
    return comic && comic.id != null ? String(comic.id).slice(0, 120) : '';
  }

  const FULLSCREEN_CONTROLS = {
    'fullscreen-orientation-btn': {
      control: 'orientation',
      state: (btn) => (btn.getAttribute('aria-pressed') === 'true' ? 'landscape' : 'portrait')
    },
    'fullscreen-eink-toggle-btn': {
      control: 'eink',
      state: (btn) =>
        btn.classList.contains('active-color')
          ? 'color'
          : btn.classList.contains('active-monochrome')
            ? 'monochrome'
            : 'off'
    },
    'fullscreen-manga-mode-btn': {
      control: 'manga-mode',
      state: (btn) => (btn.classList.contains('active') ? 'on' : 'off')
    },
    'fullscreen-continuous-mode-btn': {
      control: 'continuous-mode',
      state: (btn) => (btn.classList.contains('active') ? 'on' : 'off')
    },
    'fullscreen-full-image-btn': {
      control: 'full-image',
      state: (btn) => (btn.classList.contains('active') ? 'on' : 'off')
    },
    'fullscreen-zoom-toggle-btn': {
      control: 'zoom',
      state: (btn) => (btn.getAttribute('aria-pressed') === 'true' ? 'on' : 'off')
    }
  };

  function viewSource() {
    return safeToken(String(window.currentView || ''), 'library');
  }

  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted) return;
      const target = event.target && event.target.closest ? event.target.closest('button, [role="tab"]') : null;
      if (!target || target.disabled) return;
      const id = target.id || '';

      if (FULLSCREEN_CONTROLS[id]) {
        const entry = FULLSCREEN_CONTROLS[id];
        const comicId = currentComicId();
        window.setTimeout(() => {
          const btn = document.getElementById(id);
          if (!btn) return;
          cnTrack('reader-toggle', {
            control: entry.control,
            state: entry.state(btn),
            comic_id: comicId
          });
        }, 400);
        return;
      }

      if (id.indexOf('settings-tab-') === 0) {
        cnTrack('reader-settings-tab', { tab: safeToken(id.slice('settings-tab-'.length), 'unknown') });
        return;
      }
      if (id.indexOf('ct-tab-') === 0) {
        cnTrack('reader-tagger-tab', { tab: safeToken(id.slice('ct-tab-'.length), 'unknown') });
        return;
      }
      if (id === 'settings-button') {
        cnTrack('reader-settings-open', { source: viewSource() });
        return;
      }
      if (id === 'ct-button') {
        cnTrack('reader-tagger-open', { source: viewSource() });
        return;
      }
      if (id === 'reading-list-button') {
        cnTrack('reader-reading-list-open', { source: viewSource() });
        return;
      }
      if (id === 'downloads-button') {
        cnTrack('reader-downloads-open', { source: viewSource() });
      }
    },
    true
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', flushAnalytics);
  } else {
    flushAnalytics();
  }
  window.addEventListener('load', flushAnalytics);
  window.addEventListener('pagehide', () => cnEmitExit('pagehide'));
  // If the demo boot fails, still record one pageview and an entry event.
  window.setTimeout(() => cnEmitEntry(initialMode), 3000);

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

  async function runDemoAction(action, source) {
    const mode = safeMode(action);
    const from = currentMode || 'none';
    currentMode = mode;
    cnTrack('demo-mode-switch', {
      mode: mode,
      source: safeToken(source, 'demo-bar'),
      from: from,
      to: mode
    });

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
      try {
        localStorage.setItem(`guided_pref_${MANGA_COMIC_ID}`, 'none');
        localStorage.setItem('guided_pref_global_active', 'false');
      } catch (_e) {}
      if (window.GuidedView && window.GuidedView.ModeRegistry) {
        window.GuidedView.ModeRegistry.disableAll({ persist: true });
      }
      await ensureComicOpen(MANGA_COMIC_ID, 7);
      if (window.GuidedView && window.GuidedView.ModeRegistry) {
        window.GuidedView.ModeRegistry.disableAll({ persist: true });
      }
    } else if (action === 'manga-panel-zoom') {
      await closeModalsAndFullscreen();
      try {
        localStorage.setItem(`guided_pref_${MANGA_COMIC_ID}`, 'manga-panel-zoom');
        localStorage.setItem('guided_pref_global_active', 'true');
        localStorage.setItem('guided_pref_last_mode', 'manga-panel-zoom');
      } catch (_e) {}
      await ensureComicOpen(MANGA_COMIC_ID, 7);
      if (typeof window.openFullscreen === 'function') {
        window.openFullscreen();
        await new Promise((r) => setTimeout(r, 250));
        if (window.GuidedView && typeof window.GuidedView.enableMangaPanelZoom === 'function') {
          await window.GuidedView.enableMangaPanelZoom();
        } else if (window.GuidedView?.ModeRegistry) {
          await window.GuidedView.ModeRegistry.enable('manga-panel-zoom');
        }
        if (typeof window.showFullscreenControls === 'function') {
          window.showFullscreenControls(false);
        }
      }
    } else if (action === 'western-bubble-zoom') {
      await closeModalsAndFullscreen();
      try {
        localStorage.setItem(`guided_pref_${WESTERN_COMIC_ID}`, 'western-speech-zoom');
        localStorage.setItem('guided_pref_global_active', 'true');
        localStorage.setItem('guided_pref_last_mode', 'western-speech-zoom');
      } catch (_e) {}
      await ensureComicOpen(WESTERN_COMIC_ID, 6);
      if (typeof window.openFullscreen === 'function') {
        window.openFullscreen();
        await new Promise((r) => setTimeout(r, 250));
        if (window.GuidedView && typeof window.GuidedView.enableWesternSpeechZoom === 'function') {
          await window.GuidedView.enableWesternSpeechZoom();
        } else if (window.GuidedView?.ModeRegistry) {
          await window.GuidedView.ModeRegistry.enable('western-speech-zoom');
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
      'position:fixed;top:0;left:0;right:0;z-index:40;background:#15120e;border-bottom:2px solid #fb4d3d;padding:calc(6px + env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) 6px max(14px, env(safe-area-inset-left));display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.6);';

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;';

    const homeLink = document.createElement('a');
    homeLink.href = '../index.html';
    homeLink.textContent = '← Back to Website';
    homeLink.dataset.full = '← Back to Website';
    homeLink.dataset.short = '← Website';
    homeLink.style.cssText =
      'background:#2a241b;border:1px solid #ffce3a;color:#ffce3a;text-decoration:none;font-size:12px;font-weight:700;padding:5px 10px;border-radius:5px;margin-right:4px;';
    left.appendChild(homeLink);
    homeLink.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      cnEmitExit('website');
    });

    const modes = [
      { id: 'manga-reader', label: '📖 1. Manga Reader (Zoom Off)', short: '📖 1. Manga' },
      { id: 'manga-panel-zoom', label: '🔲 2. Manga Panel Zoom', short: '🔲 2. Panels' },
      { id: 'western-bubble-zoom', label: '💬 3. Western Speech Bubble Zoom', short: '💬 3. Bubbles' },
      { id: 'library-grid', label: '📚 4. Full Library Grid', short: '📚 4. Library' },
      { id: 'reading-list-dag', label: '🔀 5. Crossover Reading Map', short: '🔀 5. Map' }
    ];

    modes.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-cn-demo-btn', m.id);
      btn.textContent = m.label;
      btn.dataset.full = m.label;
      btn.dataset.short = m.short;
      const isInitial = m.id === initialMode;
      btn.style.cssText = `background:${isInitial ? '#fb4d3d' : '#2a241b'};border:1px solid ${isInitial ? '#ff7b6e' : '#3a3226'};color:${isInitial ? '#ffffff' : '#d1d5db'};font-size:12px;font-weight:700;padding:5px 10px;border-radius:5px;cursor:pointer;`;
      btn.addEventListener('click', () => runDemoAction(m.id, 'demo-bar'));
      left.appendChild(btn);
    });

    const legend = document.createElement('div');
    legend.id = 'cn-demo-bar-legend';
    legend.style.cssText =
      'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#d1d5db;background:#1e1a14;border:1px solid #3a3226;border-radius:5px;padding:3px 8px;margin-left:4px;';
    legend.innerHTML =
      '<span style="color:#ffce3a;font-weight:700;">💡 Fullscreen UI:</span> ' +
      '<span style="color:#ffffff;"><strong>🔲 Square Icon</strong> = Panel Zoom</span> <span style="color:#6b7280;">|</span> ' +
      '<span style="color:#ffffff;"><strong>💬 Bubble Icon</strong> = Bubble Zoom</span> ' +
      '<span style="color:#9ca3af;font-style:italic;">(visible in Fullscreen mode)</span>';
    left.appendChild(legend);

    const right = document.createElement('div');
    right.id = 'cn-demo-bar-right';
    right.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const gveLink = document.createElement('a');
    gveLink.href = '../demo-gve/index.html';
    gveLink.textContent = '✏️ Switch to GVE Now! Visual Editor →';
    gveLink.dataset.full = '✏️ Switch to GVE Now! Visual Editor →';
    gveLink.dataset.short = '✏️ GVE Editor →';
    gveLink.style.cssText =
      'background:#0055ff;border:1px solid #60a5fa;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;padding:5px 12px;border-radius:5px;';
    right.appendChild(gveLink);
    gveLink.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      writeEntryMarker('gve', 'editor', 'reader-bar', 'reader');
      cnEmitExit('editor');
    });

    bar.appendChild(left);
    bar.appendChild(right);
    document.body.prepend(bar);

    if (!document.getElementById('cn-demo-bar-styles')) {
      const barStyles = document.createElement('style');
      barStyles.id = 'cn-demo-bar-styles';
      barStyles.textContent = `
        @media (max-width: 640px) {
          #cn-standalone-demo-bar {
            padding: calc(4px + env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left)) !important;
            gap: 5px !important;
          }
          #cn-standalone-demo-bar a,
          #cn-standalone-demo-bar button {
            font-size: 10px !important;
            padding: 4px 7px !important;
            min-height: 30px !important;
          }
          #cn-demo-bar-legend { display: none !important; }
          #cn-demo-bar-right { margin-left: auto; }
        }
      `;
      document.head.appendChild(barStyles);
    }

    const narrowBar = window.matchMedia('(max-width: 640px)');
    const applyBarLabels = () => {
      bar.querySelectorAll('[data-full][data-short]').forEach((el) => {
        el.textContent = narrowBar.matches ? el.dataset.short : el.dataset.full;
      });
    };
    applyBarLabels();
    if (narrowBar.addEventListener) narrowBar.addEventListener('change', applyBarLabels);

    const syncReaderDemoBarSpace = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      document.body.style.paddingTop = height + 8 + 'px';
    };
    syncReaderDemoBarSpace();
    if (window.ResizeObserver) new ResizeObserver(syncReaderDemoBarSpace).observe(bar);
    window.addEventListener('resize', syncReaderDemoBarSpace);
    window.addEventListener('orientationchange', syncReaderDemoBarSpace);
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
      runDemoAction(initialMode, 'boot').finally(() => cnEmitEntry(initialMode));
    }
  }, 100);
  setTimeout(() => clearInterval(bootPoll), 8000);

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.target !== 'comics-now-demo') return;
    await runDemoAction(data.action, 'postmessage');
  });
})();
