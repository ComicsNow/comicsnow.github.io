(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Umami analytics: privacy-safe payloads, queued boot events, debug mirror
  // ------------------------------------------------------------------
  const analyticsState = {
    startedAt: Date.now(),
    saves: 0,
    exports: 0,
    resets: 0,
    undo_count: 0,
    redo_count: 0,
    autosorts: 0,
    items_added: 0,
    comics_opened: 0,
    mode_changes: 0,
    pagesTouched: new Set()
  };
  const COUNTER_KEYS = new Set([
    'saves',
    'exports',
    'resets',
    'undo_count',
    'redo_count',
    'autosorts',
    'items_added',
    'comics_opened',
    'mode_changes'
  ]);
  const analyticsQueue = [];
  let pageviewSent = false;
  let pageviewPending = false;
  let entrySent = false;
  let exitSent = false;
  let entryMarker = null;
  let markerLoaded = false;
  let lastComicId = '';
  let pendingDest = 'pagehide';
  let pendingDestTimer = 0;

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

    if (name === 'gve-save' && payload.result === 'ok') analyticsState.saves += 1;
    if (name === 'gve-export') analyticsState.exports += 1;
    if (name === 'gve-reset' && payload.result === 'ok') analyticsState.resets += 1;
    if (name === 'gve-comic-open' && payload.result === 'ok') {
      analyticsState.comics_opened += 1;
      if (payload.comic_id) lastComicId = String(payload.comic_id);
    }

    mirrorEvent(name, payload);
    if (!sendEvent(name, payload)) analyticsQueue.push({ name, data: payload });
  }
  window.cnTrack = cnTrack;

  window.cnGveCount = function (key) {
    if (COUNTER_KEYS.has(key)) analyticsState[key] += 1;
  };

  window.cnGveTouchPage = function (name) {
    if (name != null) analyticsState.pagesTouched.add(String(name).slice(0, 120));
  };

  function takeEntryMarker() {
    if (markerLoaded) return entryMarker;
    markerLoaded = true;
    try {
      const raw = sessionStorage.getItem('cn_entry');
      sessionStorage.removeItem('cn_entry');
      if (!raw) return null;
      const marker = JSON.parse(raw);
      if (!marker || marker.v !== 1 || marker.app !== 'gve') return null;
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

  function currentViewName() {
    const active = document.querySelector('.nav-btn.active');
    if (active && active.id && active.id.indexOf('nav-') === 0) {
      return safeToken(active.id.slice(4), 'editor');
    }
    return 'editor';
  }

  function cnEmitEntry() {
    if (entrySent) return;
    entrySent = true;
    cnPageview();

    const marker = takeEntryMarker();
    const payload = { mode: currentViewName() };
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
    cnTrack('gve-entry', payload);
  }

  function cnEmitExit() {
    if (exitSent) return;
    exitSent = true;
    cnTrack('gve-exit', {
      dest: safeToken(pendingDest, 'pagehide'),
      dwell_s: Math.max(0, Math.round((Date.now() - analyticsState.startedAt) / 1000)),
      saves: analyticsState.saves,
      exports: analyticsState.exports,
      resets: analyticsState.resets,
      undo_count: analyticsState.undo_count,
      redo_count: analyticsState.redo_count,
      autosorts: analyticsState.autosorts,
      items_added: analyticsState.items_added,
      comics_opened: analyticsState.comics_opened,
      pages_touched: analyticsState.pagesTouched.size,
      mode_changes: analyticsState.mode_changes
    });
  }

  function setPendingDest(dest) {
    pendingDest = safeToken(dest, 'pagehide');
    window.clearTimeout(pendingDestTimer);
    pendingDestTimer = window.setTimeout(() => {
      pendingDest = 'pagehide';
    }, 10000);
  }

  window.cnGveReady = function () {
    cnPageview();
    cnEmitEntry();
  };

  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted) return;
      const target = event.target && event.target.closest ? event.target.closest('button') : null;
      if (!target || target.disabled) return;

      if (target.classList.contains('undo')) {
        window.cnGveCount('undo_count');
        return;
      }
      if (target.classList.contains('redo')) {
        window.cnGveCount('redo_count');
        return;
      }
      if (target.classList.contains('autosort')) {
        window.cnGveCount('autosorts');
        return;
      }
      if (target.classList.contains('mode-btn')) {
        cnTrack('gve-mode', { mode: safeToken(target.dataset.mode, 'unknown') });
        return;
      }
      if (target.classList.contains('export')) {
        const row = target.closest('.comic-row');
        cnTrack('gve-export', {
          source: row ? 'library' : 'toolbar',
          comic_id: row && row.dataset.id ? String(row.dataset.id) : lastComicId
        });
        return;
      }
      if (target.classList.contains('page-btn') && target.closest('#page-list')) {
        const buttons = Array.prototype.slice.call(target.parentNode.querySelectorAll('.page-btn'));
        const index = Number(target.dataset.pageIndex);
        cnTrack('gve-page-select', {
          page: isFinite(index) && index > 0 ? index : buttons.indexOf(target) + 1
        });
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.repeat) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const tag = (event.target && event.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.target && event.target.isContentEditable) return;
      const key = event.key ? event.key.toLowerCase() : '';
      if (key === 'z') {
        window.cnGveCount(event.shiftKey ? 'redo_count' : 'undo_count');
      } else if (key === 'y') {
        window.cnGveCount('redo_count');
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
  window.addEventListener('pagehide', cnEmitExit);
  // If the demo boot fails, still record one pageview and an entry event.
  window.setTimeout(cnEmitEntry, 3000);

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

  function getDb() {
    return window.STATIC_ECOSYSTEM_DB || { comics: [], sidecars: {}, gveDocs: {}, pageDims: {} };
  }

  function rewriteGvePageImageUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return urlStr;
    const m = urlStr.match(/api\/comics\/([^/]+)\/page-image\?page=([^&]+)/);
    if (m) {
      const id = m[1];
      const page = decodeURIComponent(m[2]);
      return `../assets/golden-pages/${id}/${page}`;
    }
    return urlStr;
  }

  const imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (imgSrcDesc && imgSrcDesc.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      set: function (val) {
        imgSrcDesc.set.call(this, rewriteGvePageImageUrl(val));
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
      return origSetAttr.call(this, name, rewriteGvePageImageUrl(value));
    }
    return origSetAttr.call(this, name, value);
  };

  function jsonResponse(obj, status = 200) {
    return Promise.resolve(
      new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  }

  function convertGveDocToComicsNowSidecar(comicId, doc) {
    const pagesOut = {};
    const type = (doc && doc.type) === 'manga' ? 'manga' : 'western';
    const docPages = (doc && doc.pages) || {};
    for (const [pageName, p] of Object.entries(docPages)) {
      const items = Array.isArray(p.items) ? p.items : [];
      const order = Array.isArray(p.order) ? p.order : items.map((i) => i.id);
      const itemMap = new Map(items.map((i) => [i.id, i]));
      const orderedItems = order.map((id) => itemMap.get(id)).filter(Boolean);
      for (const it of items) {
        if (!orderedItems.includes(it)) orderedItems.push(it);
      }
      const panelItems = orderedItems.filter((i) => i.kind === 'panel');
      const bubbleItems = orderedItems.filter((i) => i.kind === 'bubble');
      const panels = panelItems.map((i) => i.box);
      const bubbles = bubbleItems.map((i) => i.box);
      const sequence = type === 'manga'
        ? orderedItems.map((i) => i.box)
        : (bubbles.length > 0 ? bubbles : panels);
      const outPage = { panels, bubbles, sequence };
      const roundPoints = (it) => (it.points ? it.points.map(([x, y]) => [Math.round(x), Math.round(y)]) : null);
      const panelPoints = panelItems.map(roundPoints);
      if (panelPoints.some(Boolean)) outPage.panelPoints = panelPoints;
      const bubblePoints = bubbleItems.map(roundPoints);
      if (bubblePoints.some(Boolean)) outPage.bubblePoints = bubblePoints;
      pagesOut[pageName] = outPage;
    }
    return {
      comicId,
      type,
      pages: pagesOut
    };
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    const u = new URL(rawUrl, window.location.origin);
    const pathname = u.pathname;
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const db = getDb();

    if (pathname.endsWith('/api/health')) {
      return jsonResponse({ ok: true, version: '1.1.3' });
    }

    if (pathname.endsWith('/api/settings')) {
      return jsonResponse({
        config: {
          comicsNowRoot: '/opt/comics-now',
          dbPath: '/opt/comics-now/comics-now.db',
          guidedViewDir: '/opt/comics-now/metadata/guided_view',
          backupDir: '/opt/comics-now/metadata/guided_view/.backups',
          pageCacheDir: '/opt/comics-now/page-cache',
          port: 3100,
          bind: '127.0.0.1',
          ffmpegBin: 'ffmpeg',
          prefsUserId: 'default-user'
        },
        errors: [],
        warnings: []
      });
    }

    if (pathname.endsWith('/api/comics')) {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const statusFilter = u.searchParams.get('status') || '';
      const list = db.comics
        .map((c) => ({
          id: c.id,
          publisher: c.publisher,
          series: c.series,
          name: c.name,
          path: c.rawPath,
          totalPages: c.totalPages,
          guidedViewStatus: 'completed',
          guidedViewPath: c.guidedViewPath,
          mangaMode: !!c.mangaMode
        }))
        .filter((c) => {
          if (statusFilter && c.guidedViewStatus !== statusFilter) return false;
          if (!q) return true;
          return `${c.series} ${c.name} ${c.publisher}`.toLowerCase().includes(q);
        });
      return jsonResponse({ comics: list, total: list.length, limit: 100, offset: 0 });
    }

    const pagesMatch = pathname.match(/\/api\/comics\/([^/]+)\/pages$/);
    if (pagesMatch) {
      const id = pagesMatch[1];
      const comic = db.comics.find((c) => c.id === id);
      if (!comic) return jsonResponse({ error: 'Not found' }, 404);
      const dims = db.pageDims[id] || {};
      const pages = comic.pagesList.map((name, index) => ({
        index,
        name,
        width: (dims[name] && dims[name].width) || 1000,
        height: (dims[name] && dims[name].height) || 1400
      }));
      return jsonResponse({
        comicId: id,
        pages,
        sidecarType: comic.mangaMode ? 'manga' : 'western',
        hasSidecar: true
      });
    }

    const guidedMatch = pathname.match(/\/api\/comics\/([^/]+)\/guided$/);
    if (guidedMatch) {
      const id = guidedMatch[1];
      if (method === 'PUT' && init && init.body) {
        const doc = JSON.parse(init.body);
        localStorage.setItem('gve_doc_' + id, JSON.stringify({ ...doc, comicId: id, warnings: [] }));
        const cnSidecar = convertGveDocToComicsNowSidecar(id, doc);
        localStorage.setItem('gve_sidecar_' + id, JSON.stringify(cnSidecar));
        return jsonResponse({
          ok: true,
          warnings: [],
          backupPath: `/opt/comics-now/metadata/guided_view/.backups/${id}-${Date.now()}.json`,
          sidecarPath: `/opt/comics-now/metadata/guided_view/${id}.json`
        });
      }

      const savedDoc = localStorage.getItem('gve_doc_' + id);
      if (savedDoc) {
        try {
          return jsonResponse(JSON.parse(savedDoc));
        } catch (_e) {}
      }
      if (db.gveDocs[id]) {
        return jsonResponse(db.gveDocs[id]);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const resetMatch = pathname.match(/\/api\/comics\/([^/]+)\/guided\/reset$/);
    if (resetMatch && method === 'POST') {
      const id = resetMatch[1];
      localStorage.removeItem('gve_doc_' + id);
      localStorage.removeItem('gve_sidecar_' + id);
      return jsonResponse({ ok: true });
    }

    const singleMatch = pathname.match(/\/api\/comics\/([^/]+)$/);
    if (singleMatch) {
      const id = singleMatch[1];
      const c = db.comics.find((x) => x.id === id);
      if (!c) return jsonResponse({ error: 'Not found' }, 404);
      return jsonResponse({
        comic: {
          id: c.id,
          publisher: c.publisher,
          series: c.series,
          name: c.name,
          path: c.rawPath,
          totalPages: c.totalPages,
          guidedViewStatus: 'completed',
          guidedViewPath: c.guidedViewPath
        },
        mangaMode: !!c.mangaMode
      });
    }

    return origFetch(input, init);
  };

  function injectStandaloneGveDemoBar() {
    if (document.getElementById('gve-standalone-demo-bar')) return;

    const style = document.createElement('style');
    style.textContent = `
      #gve-standalone-demo-bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        min-height: 44px;
        background: #0d0f14;
        border-bottom: 2px solid #3b82f6;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: env(safe-area-inset-top) max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
        font-family: 'Roboto Mono', monospace, sans-serif;
        font-size: 12px;
        color: #f5f2eb;
        gap: 8px;
        overflow-x: auto;
        white-space: nowrap;
        box-sizing: border-box;
        -webkit-overflow-scrolling: touch;
      }
      body.has-gve-demo-bar {
        padding-top: var(--gve-demo-bar-height, 44px);
      }
      .gve-bar-group {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .gve-bar-btn {
        background: #181b24;
        color: #f5f2eb;
        border: 1px solid #2d3343;
        border-radius: 4px;
        padding: 5px 10px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.15s ease;
      }
      .gve-bar-btn:hover {
        border-color: #3b82f6;
        background: #232836;
      }
      .gve-bar-btn.active {
        background: #3b82f6;
        color: #ffffff;
        border-color: #3b82f6;
      }
      .gve-bar-btn.reader-link {
        background: #ff3b1d;
        color: #ffffff;
        border-color: #ff3b1d;
      }
      .gve-bar-btn.reader-link:hover {
        background: #e02e12;
      }
      .gve-bar-btn.back-link {
        background: transparent;
        border-color: #4b5563;
        color: #e5e7eb;
      }
      @media (max-width: 640px) {
        #gve-standalone-demo-bar {
          padding-left: max(8px, env(safe-area-inset-left));
          padding-right: max(8px, env(safe-area-inset-right));
          gap: 5px;
        }
        .gve-bar-btn {
          font-size: 10px;
          padding: 4px 7px;
          min-height: 30px;
        }
      }
    `;
    document.head.appendChild(style);
    document.body.classList.add('has-gve-demo-bar');

    const bar = document.createElement('div');
    bar.id = 'gve-standalone-demo-bar';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'gve-bar-group';

    const backLink = document.createElement('a');
    backLink.href = '../index.html#demo';
    backLink.className = 'gve-bar-btn back-link';
    backLink.textContent = '← Back to Website';
    backLink.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      setPendingDest('website');
    });
    leftGroup.appendChild(backLink);

    const presets = [
      {
        id: 'manga',
        label: '✏️ 1. Edit Manga Panels (Black Jack #001 - Page 7)',
        comicId: '526643c2796492c2c7ad1f59706129453670129e',
        page: 'page_007.jpg',
        readerMode: 'manga-panel-zoom'
      },
      {
        id: 'western',
        label: '💬 2. Edit Western Speech Bubbles (Zip Comics #001 - Page 6)',
        comicId: 'f0d80d4e11db885d08f0572991e6f287185e4646',
        page: 'page_006.jpg',
        readerMode: 'western-bubble-zoom'
      },
      {
        id: 'library',
        label: '📚 3. All 7 Comics in GVE Library',
        action: 'library'
      }
    ];

    let activeReaderMode = 'manga-panel-zoom';
    const rightGroup = document.createElement('div');
    rightGroup.className = 'gve-bar-group';

    const readerLink = document.createElement('a');
    readerLink.href = '../demo-reader/index.html?mode=manga-panel-zoom';
    readerLink.className = 'gve-bar-btn reader-link';
    readerLink.textContent = '📖 Switch to Comics Now! Reader (Test Changes) →';
    readerLink.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let mode = 'manga-panel-zoom';
      try {
        mode = new URL(readerLink.href, window.location.href).searchParams.get('mode') || mode;
      } catch (_e) {}
      writeEntryMarker('reader', mode, 'gve-bar', 'gve');
      setPendingDest('reader');
    });

    const buttons = {};
    presets.forEach((p, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gve-bar-btn' + (idx === 0 ? ' active' : '');
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        Object.values(buttons).forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        window.cnTrack?.('gve-preset', { preset: p.id });
        if (p.action === 'library') {
          const libBtn = document.getElementById('nav-library');
          if (libBtn) libBtn.click();
        } else {
          activeReaderMode = p.readerMode;
          readerLink.href = '../demo-reader/index.html?mode=' + encodeURIComponent(activeReaderMode);
          window.postMessage({ target: 'gve-now-demo', comicId: p.comicId, page: p.page }, '*');
        }
      });
      buttons[p.id] = btn;
      leftGroup.appendChild(btn);
    });

    rightGroup.appendChild(readerLink);
    bar.appendChild(leftGroup);
    bar.appendChild(rightGroup);
    document.body.prepend(bar);

    const syncDemoBarSpace = () => {
      document.documentElement.style.setProperty('--gve-demo-bar-height', bar.offsetHeight + 'px');
    };
    syncDemoBarSpace();
    if (window.ResizeObserver) new ResizeObserver(syncDemoBarSpace).observe(bar);
    window.addEventListener('resize', syncDemoBarSpace);
    window.addEventListener('orientationchange', syncDemoBarSpace);

    const params = new URLSearchParams(window.location.search);
    const comicParam = params.get('comic');
    const pageParam = params.get('page');
    if (comicParam) {
      setTimeout(() => {
        if (comicParam === 'f0d80d4e11db885d08f0572991e6f287185e4646' && buttons.western) {
          Object.values(buttons).forEach((b) => b.classList.remove('active'));
          buttons.western.classList.add('active');
          readerLink.href = '../demo-reader/index.html?mode=western-bubble-zoom';
        }
        window.postMessage(
          { target: 'gve-now-demo', comicId: comicParam, page: pageParam || 'page_002.jpg' },
          '*'
        );
      }, 350);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    injectStandaloneGveDemoBar();
  });
})();
