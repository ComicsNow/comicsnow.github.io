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

  function currentPageNum() {
    const idx = window.currentPageIndex;
    return idx != null && Number.isFinite(Number(idx)) ? Math.max(1, Number(idx) + 1) : 1;
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

  function classifyContextMenuAction(text) {
    const t = String(text || '').toLowerCase();
    if (t.includes('bulk mark')) return 'bulk-mark-read';
    if (t.includes('unread')) return 'mark-unread';
    if (t.includes('read')) return 'mark-read';
    if (t.includes('download')) return 'download';
    if (t.includes('manga mode')) return 'manga-toggle';
    if (t.includes('continuous mode')) return 'continuous-toggle';
    if (t.includes('force re-run guided') || t.includes('re-run guided')) return 'guided-rerun';
    if (t.includes('guided detection')) return 'guided-run';
    if (t.includes('reading list')) return 'add-to-reading-list';
    if (t.includes('remove') || t.includes('delete')) return 'delete';
    return 'other';
  }

  function resolveCardScope(el) {
    if (!el || !el.closest) return 'comic';
    if (el.closest('#root-folder-list-container')) return 'library';
    if (el.closest('#folder-list-container')) return 'folder';
    if (el.closest('#publisher-list-container')) return 'publisher';
    if (el.closest('#series-list-container')) return 'series';
    if (el.closest('#smart-list-container')) return 'smart';
    if (el.closest('#search-results-container')) return 'search';
    return 'comic';
  }

  const INLINE_TOGGLES = {
    'fit-height-btn': {
      control: 'inline-fit-height',
      state: (btn) => (btn.classList.contains('active') || btn.getAttribute('aria-pressed') === 'true' ? 'on' : 'off')
    },
    'orientation-toggle-btn': {
      control: 'inline-orientation',
      state: (btn) =>
        btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('landscape')
          ? 'landscape'
          : 'portrait'
    },
    'manga-mode-btn': {
      control: 'inline-manga-mode',
      state: (btn) => (btn.classList.contains('active') ? 'on' : 'off')
    }
  };

  const PAGE_CONTROL_IDS = new Set([
    'prev-page-btn',
    'next-page-btn',
    'prev-page-btn-bottom',
    'next-page-btn-bottom',
    'fullscreen-prev-page-btn',
    'fullscreen-next-page-btn'
  ]);

  const PAGE_JUMP_IDS = new Set([
    'page-counter',
    'page-counter-bottom',
    'fullscreen-page-counter'
  ]);

  const GRID_OPEN_IDS = new Set([
    'page-grid-btn',
    'page-grid-btn-bottom',
    'fullscreen-page-grid-btn',
    'reader-filmstrip-grid-btn'
  ]);

  const SMART_SCOPE_BTNS = {
    'latest-added-btn': 'latest',
    'downloaded-btn': 'downloaded',
    'guided-smart-list-btn': 'guided',
    'dynamic-manga-filter-btn': 'manga',
    'dynamic-reading-list-filter-btn': 'reading-list'
  };

  const METADATA_ACTION_IDS = {
    'clear-staged-sources-btn': 'clear-staged',
    'synthesize-staged-sources-btn': 'synthesize-staged',
    'cv-prev': 'cv-prev',
    'cv-next': 'cv-next'
  };

  const SETTINGS_ACTION_IDS = {
    'directory-modal-close': 'directory-close',
    'directory-cancel-btn': 'directory-cancel',
    'directory-confirm-btn': 'directory-confirm',
    'add-library-btn': 'add-library',
    'scan-button': 'scan-library',
    'full-scan-button': 'full-scan-library',
    'clear-downloads-btn': 'clear-downloads',
    'comics-defaults-save-btn': 'save-comics-defaults',
    'refresh-devices-btn': 'refresh-devices',
    'refresh-users-btn': 'refresh-users',
    'guided-run-btn': 'guided-run',
    'guided-cancel-current-btn': 'guided-cancel-current',
    'guided-cancel-btn': 'guided-cancel-all',
    'guided-modal-refresh-btn': 'guided-modal-refresh',
    'guided-modal-banner-setup-btn': 'guided-modal-banner-setup',
    'guided-modal-test-btn': 'guided-modal-test',
    'guided-modal-setup-btn': 'guided-modal-setup',
    'guided-log-clear': 'guided-log-clear'
  };

  const TAGGER_ACTION_IDS = {
    'ct-close-btn': 'close',
    'ct-rescan-unmatched-btn': 'rescan-unmatched',
    'ct-rescan-xml-btn': 'rescan-xml',
    'ct-run-btn': 'run',
    'ct-cancel-btn': 'cancel',
    'ct-clear-output': 'clear-output',
    'ct-grab-btn': 'grab',
    'ct-apply-btn': 'apply',
    'ct-skip-btn': 'skip',
    'ct-confirm-yes': 'confirm-yes',
    'ct-confirm-no': 'confirm-no',
    'ct-migrate-btn': 'migrate',
    'ct-save-btn': 'save-settings',
    'ct-clear-history-btn': 'clear-history',
    'ct-gemini-key-toggle': 'gemini-key-toggle',
    'ct-gemini-save-btn': 'gemini-save',
    'ct-refresh-logs-btn': 'refresh-logs',
    'rename-cbz-btn': 'rename-cbz',
    'rename-clear-output': 'rename-clear-output',
    'move-comics-btn': 'move-comics',
    'move-clear-output': 'move-clear-output',
    'errors-refresh-btn': 'errors-refresh',
    'save-naming-rules-btn': 'save-naming-rules',
    'rename-library-btn': 'rename-library',
    'add-folder-level-btn': 'add-folder-level',
    'save-folder-rules-btn': 'save-folder-rules',
    'move-library-btn': 'move-library',
    'mgmt-confirm-cancel-btn': 'mgmt-confirm-cancel',
    'mgmt-confirm-proceed-btn': 'mgmt-confirm-proceed',
    'gemini-modal-disagree-btn': 'gemini-modal-disagree',
    'gemini-modal-save-btn': 'gemini-modal-save'
  };

  const RL_ACTION_IDS = {
    'reading-list-close-btn': 'close',
    'create-reading-list-btn': 'create-open',
    'export-all-lists-btn': 'export-all',
    'import-lists-btn': 'import-open',
    'edit-reading-lists-btn': 'edit-lists-toggle',
    'save-reading-lists-order-btn': 'save-lists-order',
    'cancel-reading-lists-edit-btn': 'cancel-lists-edit',
    'back-to-lists-btn': 'back-to-lists',
    'download-all-list-btn': 'download-all',
    'export-list-btn': 'export-list',
    'edit-list-btn': 'edit-list-toggle',
    'save-order-btn': 'save-list-order',
    'cancel-edit-btn': 'cancel-list-edit',
    'add-to-list-close-btn': 'add-modal-close',
    'add-to-list-cancel-btn': 'add-modal-cancel',
    'add-to-list-create-new-btn': 'add-modal-create-open'
  };

  const SYNC_ACTION_IDS = new Set([
    'sync-keep-current',
    'sync-accept',
    'sync-ignore',
    'sync-cancel',
    'sync-notification-close',
    'sync-notification-accept',
    'sync-notification-dismiss'
  ]);

  function previewCardPage(card) {
    if (!card) return 0;
    const numEl = card.querySelector('.comic-page-preview-number, .comic-filmstrip-number');
    const parsed = numEl ? parseInt(numEl.textContent, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    if (card.parentElement && card.parentElement.children) {
      const idx = Array.prototype.indexOf.call(card.parentElement.children, card);
      if (idx >= 0) return idx + 1;
    }
    return 0;
  }

  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted) return;
      const rawTarget = event.target;
      if (!rawTarget || !rawTarget.closest) return;
      if (rawTarget.closest('#cn-standalone-demo-bar')) return;

      const link = rawTarget.closest('a[href]');
      if (link && link.id === 'kofi-settings-link') {
        cnTrack('outbound-click', { host: 'ko-fi.com', path: '/comicsnow', source: 'reader-settings' });
        return;
      }

      const menuItem = rawTarget.closest('.comic-context-menu-item');
      if (menuItem && !menuItem.classList.contains('disabled')) {
        cnTrack('reader-context-menu-action', { action: classifyContextMenuAction(menuItem.textContent) });
        return;
      }

      const target = rawTarget.closest('button, [role="tab"]');
      if (target && !target.disabled) {
        const id = target.id || '';

        if (FULLSCREEN_CONTROLS[id] || INLINE_TOGGLES[id]) {
          const entry = FULLSCREEN_CONTROLS[id] || INLINE_TOGGLES[id];
          const comicId = currentComicId();
          window.setTimeout(() => {
            const btn = document.getElementById(id);
            if (!btn) return;
            cnTrack('reader-toggle', {
              control: entry.control,
              state: entry.state(btn),
              comic_id: comicId
            });
          }, 80);
          return;
        }

        if (target.classList.contains('download-btn')) {
          cnTrack('reader-download-click', {
            scope: resolveCardScope(target),
            comic_id: target.dataset.comicId || ''
          });
          return;
        }

        if (target.classList.contains('status-toggle-btn')) {
          cnTrack('reader-status-toggle', {
            scope: resolveCardScope(target),
            comic_id: target.dataset.comicId || ''
          });
          return;
        }

        if (target.classList.contains('alpha-filter-btn')) {
          const host = target.closest('#publisher-alpha-filter, #series-alpha-filter, #comic-alpha-filter, #folder-alpha-filter');
          const view = host && host.id ? host.id.replace('-alpha-filter', '') : viewSource();
          cnTrack('reader-alpha-filter', {
            view: view,
            char: safeToken(target.dataset.letter || target.textContent, 'all')
          });
          return;
        }

        if (target.closest('#breadcrumb')) {
          const btns = Array.from(document.querySelectorAll('#breadcrumb button'));
          cnTrack('reader-breadcrumb-click', {
            depth: Math.max(0, btns.indexOf(target)),
            total: btns.length,
            source: viewSource()
          });
          return;
        }

        if (SMART_SCOPE_BTNS[id]) {
          const baseScope = SMART_SCOPE_BTNS[id];
          window.setTimeout(() => {
            const active = window.activeSmartFilter;
            cnTrack('reader-smart-filter', {
              scope: safeToken(active || baseScope, baseScope),
              action: active ? 'on' : 'off'
            });
          }, 0);
          return;
        }

        if (id === 'clear-search-btn') {
          cnTrack('reader-search-clear', { source: viewSource() });
          return;
        }

        if (id === 'logout-button') {
          cnTrack('reader-logout-click', { source: viewSource() });
          return;
        }

        if (id === 'viewer-tab' || id === 'metadata-tab') {
          cnTrack('reader-tab-switch', {
            tab: id === 'metadata-tab' ? 'metadata' : 'viewer',
            comic_id: currentComicId()
          });
          return;
        }

        if (id === 'fullscreen-btn') {
          cnTrack('reader-fullscreen-open', { comic_id: currentComicId() });
          return;
        }

        if (id === 'fullscreen-close-btn' || id === 'fullscreen-close-btn-bottom') {
          cnTrack('reader-fullscreen-close', {
            control: id === 'fullscreen-close-btn-bottom' ? 'bottom-close' : 'top-close',
            comic_id: currentComicId(),
            page: currentPageNum()
          });
          return;
        }

        if (id === 'comic-summary-toggle') {
          const comicId = currentComicId();
          window.setTimeout(() => {
            const summary = document.getElementById('comic-summary');
            cnTrack('reader-summary-toggle', {
              open: summary ? !summary.classList.contains('hidden') : false,
              comic_id: comicId
            });
          }, 0);
          return;
        }

        if (id === 'fullscreen-spread-badge') {
          cnTrack('reader-cinema-pan', { comic_id: currentComicId(), page: currentPageNum() });
          return;
        }

        if (PAGE_CONTROL_IDS.has(id)) {
          cnTrack('reader-page-control', {
            control: id,
            comic_id: currentComicId(),
            page: currentPageNum()
          });
          return;
        }

        if (PAGE_JUMP_IDS.has(id)) {
          cnTrack('reader-page-jump', {
            control: id,
            comic_id: currentComicId(),
            page: currentPageNum()
          });
          return;
        }

        if (
          id === 'next-in-series-btn' ||
          id === 'fullscreen-next-in-series-btn' ||
          id === 'next-in-reading-list-btn' ||
          id === 'fullscreen-next-in-reading-list-btn'
        ) {
          cnTrack('reader-next-comic-click', {
            kind: id.includes('reading-list') ? 'reading-list' : 'series',
            surface: id.startsWith('fullscreen-') ? 'fullscreen' : 'inline',
            comic_id: currentComicId()
          });
          return;
        }

        if (GRID_OPEN_IDS.has(id)) {
          cnTrack('reader-grid-open', { source: id, comic_id: currentComicId() });
          return;
        }

        if (id === 'comic-page-grid-close') {
          cnTrack('reader-grid-close', { method: 'button', comic_id: currentComicId() });
          return;
        }

        if (id === 'fullscreen-filmstrip-btn' || id === 'reader-filmstrip-close-btn') {
          const comicId = currentComicId();
          window.setTimeout(() => {
            const strip = document.getElementById('reader-thumbnail-filmstrip');
            cnTrack('reader-filmstrip-toggle', {
              source: id === 'reader-filmstrip-close-btn' ? 'close-btn' : 'toolbar',
              open: strip ? !strip.classList.contains('hidden') : id !== 'reader-filmstrip-close-btn',
              comic_id: comicId
            });
          }, 0);
          return;
        }

        if (id === 'view-mode-grid-btn' || id === 'view-mode-compact-btn' || id === 'view-mode-dag-btn') {
          cnTrack('reader-reading-list-view', {
            mode: id === 'view-mode-dag-btn' ? 'dag' : id === 'view-mode-compact-btn' ? 'compact' : 'grid'
          });
          return;
        }

        if (target.classList.contains('rl-dag-quick-read-btn')) {
          cnTrack('reader-dag-read', { source: 'quick-read', comic_id: target.dataset.comicId || '' });
          return;
        }
        if (id === 'rl-inspector-read-btn') {
          cnTrack('reader-dag-read', { source: 'inspector', comic_id: target.dataset.comicId || '' });
          return;
        }
        if (id === 'rl-inspector-close-btn') {
          cnTrack('reader-dag-inspector-close', {});
          return;
        }
        if (target.classList.contains('rl-dag-filter-btn')) {
          cnTrack('reader-dag-filter', { filter: safeToken(target.dataset.filter, 'all') });
          return;
        }
        if (id === 'rl-dag-focus-unread-btn' || id === 'rl-dag-reset-btn') {
          cnTrack('reader-dag-action', {
            action: id === 'rl-dag-focus-unread-btn' ? 'focus-unread' : 'reset'
          });
          return;
        }
        if (target.classList.contains('rl-series-legend-chip')) {
          window.setTimeout(() => {
            cnTrack('reader-dag-series-filter', { active: target.style.opacity !== '0.4' });
          }, 0);
          return;
        }

        if (RL_ACTION_IDS[id]) {
          cnTrack('reader-reading-list-action', { action: RL_ACTION_IDS[id] });
          return;
        }

        if (target.closest('#reading-list-modal, #add-to-list-modal')) {
          if (target.classList.contains('play-list-btn')) {
            cnTrack('reader-reading-list-action', { action: 'play-list' });
            return;
          }
          if (target.classList.contains('dag-list-btn')) {
            cnTrack('reader-reading-list-action', { action: 'dag-list' });
            return;
          }
          if (target.classList.contains('download-list-btn')) {
            cnTrack('reader-reading-list-action', { action: 'download-list' });
            return;
          }
          if (target.classList.contains('read-toggle-btn')) {
            cnTrack('reader-reading-list-action', { action: 'read-toggle-list' });
            return;
          }
          if (target.classList.contains('delete-list-btn')) {
            cnTrack('reader-reading-list-action', { action: 'delete-list' });
            return;
          }
          if (target.classList.contains('reorder-up-btn') || target.classList.contains('reorder-down-btn')) {
            cnTrack('reader-reading-list-action', {
              action: target.classList.contains('reorder-up-btn') ? 'reorder-up' : 'reorder-down'
            });
            return;
          }
          if (target.classList.contains('resume-comic-btn')) {
            cnTrack('reader-reading-list-action', { action: 'resume-item' });
            return;
          }
          if (target.classList.contains('read-comic-btn')) {
            cnTrack('reader-reading-list-action', { action: 'read-item' });
            return;
          }
          if (target.classList.contains('mark-read-btn')) {
            cnTrack('reader-reading-list-action', { action: 'mark-item-read' });
            return;
          }
          if (target.classList.contains('download-comic-btn')) {
            cnTrack('reader-reading-list-action', { action: 'download-item' });
            return;
          }
          if (target.classList.contains('delete-comic-btn')) {
            cnTrack('reader-reading-list-action', { action: 'remove-item' });
            return;
          }
        }

        if (id === 'metadata-subtab-cv' || id === 'metadata-subtab-form') {
          cnTrack('reader-metadata-subtab', {
            tab: id === 'metadata-subtab-cv' ? 'cv' : 'form',
            comic_id: currentComicId()
          });
          return;
        }
        if (METADATA_ACTION_IDS[id]) {
          cnTrack('reader-metadata-action', {
            action: METADATA_ACTION_IDS[id],
            comic_id: currentComicId()
          });
          return;
        }
        if (target.classList.contains('stage-source-btn')) {
          cnTrack('reader-metadata-action', {
            action: 'stage-toggle',
            comic_id: currentComicId()
          });
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
        if (id.indexOf('mgmt-tab-') === 0) {
          cnTrack('reader-tagger-subtab', { tab: safeToken(id.slice('mgmt-tab-'.length), 'unknown') });
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
          return;
        }
        if (SETTINGS_ACTION_IDS[id]) {
          cnTrack('reader-settings-action', { action: SETTINGS_ACTION_IDS[id] });
          return;
        }
        if (String(target.getAttribute('onclick') || '').includes('closeSettingsModal')) {
          cnTrack('reader-settings-action', { action: 'close' });
          return;
        }
        if (TAGGER_ACTION_IDS[id]) {
          cnTrack('reader-tagger-action', { action: TAGGER_ACTION_IDS[id] });
          return;
        }
        if (SYNC_ACTION_IDS.has(id)) {
          cnTrack('reader-sync-action', { action: id });
          return;
        }

        const dlContainer = target.closest('.dl-queue-container');
        if (dlContainer) {
          let action = 'other';
          if (target.classList.contains('dl-tab')) {
            action = 'tab-' + safeToken(target.dataset.tab || target.textContent, 'all');
          } else if (target.classList.contains('dl-batch-btn')) {
            action = safeToken(target.dataset.action || target.textContent, 'batch');
          } else if (target.classList.contains('dl-retry-all-btn')) {
            action = 'retry-all';
          } else if (target.classList.contains('delete-download-btn')) {
            action = 'delete-item';
          } else if (target.classList.contains('ha')) {
            const label = String(target.title || target.getAttribute('aria-label') || '').toLowerCase();
            action = label.includes('close') ? 'close' : label.includes('collapse') || label.includes('expand') ? 'collapse' : 'header-action';
          }
          cnTrack('reader-downloads-action', { action: action });
          return;
        }

        if (target.closest('#comic-list, #series-list, #publisher-list') && /back to/i.test(target.textContent || '')) {
          cnTrack('reader-library-back', { source: viewSource() });
          return;
        }
      }

      if (rawTarget.closest('#comic-page-grid-backdrop')) {
        cnTrack('reader-grid-close', { method: 'backdrop', comic_id: currentComicId() });
        return;
      }

      const previewCard = rawTarget.closest('.comic-page-preview-card');
      if (previewCard) {
        cnTrack('reader-grid-select', { page: previewCardPage(previewCard), comic_id: currentComicId() });
        return;
      }

      const filmstripCard = rawTarget.closest('.comic-filmstrip-card');
      if (filmstripCard) {
        cnTrack('reader-filmstrip-select', { page: previewCardPage(filmstripCard), comic_id: currentComicId() });
        return;
      }

      const dagNode = rawTarget.closest('.rl-dag-node');
      if (dagNode) {
        const comicId = dagNode.dataset.nodeId || '';
        window.setTimeout(() => {
          const insp = document.getElementById('rl-dag-inspector');
          cnTrack('reader-dag-node-select', {
            comic_id: comicId,
            inspector: insp && !insp.classList.contains('hidden') ? 'open' : 'closed'
          });
        }, 0);
        return;
      }

      const rlCard = rawTarget.closest('#reading-lists-container > div');
      if (rlCard && rlCard.querySelector('.play-list-btn, .dag-list-btn')) {
        cnTrack('reader-reading-list-action', { action: 'open-list' });
        return;
      }

      if (rawTarget.closest('.logo-container')) {
        cnTrack('reader-home-click', { source: viewSource() });
        return;
      }

      if (rawTarget.closest('.add-device-library-card')) {
        cnTrack('reader-device-library-add', {});
        return;
      }

      const folderCard = rawTarget.closest('.folder-card');
      if (folderCard) {
        cnTrack('reader-library-drill', {
          level: folderCard.closest('#root-folder-list-container') ? 'root-folder' : 'folder'
        });
        return;
      }

      if (rawTarget.closest('.publisher-card')) {
        cnTrack('reader-library-drill', { level: 'publisher' });
        return;
      }

      if (rawTarget.closest('.series-card')) {
        cnTrack('reader-library-drill', { level: 'series' });
        return;
      }

      if (rawTarget.closest('.reading-list-card')) {
        cnTrack('reader-library-drill', { level: 'reading-list' });
        return;
      }

      const candidateLi = rawTarget.closest('#cv-results li, #search-results li');
      if (candidateLi && !rawTarget.closest('button, a, input, select')) {
        cnTrack('reader-metadata-action', {
          action: 'pick-candidate',
          comic_id: currentComicId()
        });
        return;
      }

      if (
        rawTarget.closest('#fullscreen-viewer') &&
        !rawTarget.closest('#fullscreen-nav-left, #fullscreen-nav-right, #fullscreen-controls, #fullscreen-info-bar, #fullscreen-scrubber-container, #reader-thumbnail-filmstrip, #comic-page-grid-overlay, #bubble-magnifier-overlay, #fullscreen-end-of-comic-navigation')
      ) {
        const controls = document.getElementById('fullscreen-controls');
        if (controls) {
          const wasOpen = !controls.classList.contains('hidden');
          const comicId = currentComicId();
          const checkControlsToggle = () => {
            const isOpen = !controls.classList.contains('hidden');
            if (isOpen !== wasOpen) {
              cnTrack('reader-controls-toggle', { visible: isOpen, comic_id: comicId });
              return true;
            }
            return false;
          };
          window.setTimeout(() => {
            if (!checkControlsToggle()) {
              window.setTimeout(checkControlsToggle, 450);
            }
          }, 0);
        }
      }
    },
    true
  );

  document.addEventListener(
    'dblclick',
    (event) => {
      if (!event.isTrusted) return;
      const dagNode = event.target && event.target.closest ? event.target.closest('.rl-dag-node') : null;
      if (dagNode && !event.target.closest('button')) {
        cnTrack('reader-dag-read', { source: 'dblclick', comic_id: dagNode.dataset.nodeId || '' });
      }
    },
    true
  );

  document.addEventListener(
    'contextmenu',
    (event) => {
      if (!event.isTrusted) return;
      const card = event.target && event.target.closest
        ? event.target.closest('.comic-card, .series-card, .publisher-card, .folder-card')
        : null;
      if (!card) return;
      const kind = card.classList.contains('comic-card')
        ? 'comic'
        : card.classList.contains('series-card')
          ? 'series'
          : card.classList.contains('publisher-card')
            ? 'publisher'
            : card.closest('#root-folder-list-container')
              ? 'root-folder'
              : 'folder';
      cnTrack('reader-context-menu-open', { target: kind });
    },
    true
  );

  document.addEventListener(
    'change',
    (event) => {
      if (!event.isTrusted) return;
      const el = event.target;
      if (!el || !el.id) return;
      const id = el.id;

      if (id === 'library-search-field') {
        cnTrack('reader-search-field', { field: safeToken(el.value, 'all') });
        return;
      }
      if (id === 'series-sort-select') {
        cnTrack('reader-series-sort', { order: safeToken(el.value, 'default') });
        return;
      }
      if (id === 'fullscreen-scrubber-slider') {
        cnTrack('reader-scrubber-seek', {
          comic_id: currentComicId(),
          page: Math.max(1, Number(el.value || 1))
        });
        return;
      }
      if (id === 'reading-list-publisher-filter') {
        cnTrack('reader-reading-list-action', {
          action: el.value && el.value !== 'all' ? 'publisher-filter-on' : 'publisher-filter-all'
        });
        return;
      }
      if (
        id === 'master-manga-toggle' ||
        id === 'master-continuous-toggle' ||
        id === 'allowed-formats-select' ||
        id === 'cbr-conversion-originals-select' ||
        id === 'pdf-conversion-originals-select' ||
        id === 'log-level-filter' ||
        id === 'log-category-filter' ||
        id === 'guided-log-level-filter' ||
        id === 'devices-user-select'
      ) {
        cnTrack('reader-settings-action', { action: id });
        return;
      }
      if (
        id.indexOf('src-cb-') === 0 ||
        id === 'ct-gemini-enabled-toggle' ||
        id === 'ct-gemini-model-select' ||
        id === 'ct-storage-input' ||
        id === 'ct-force-setting-cb'
      ) {
        cnTrack('reader-tagger-action', { action: id });
      }
    },
    true
  );

  document.addEventListener(
    'submit',
    (event) => {
      if (!event.isTrusted) return;
      const form = event.target;
      if (!form || !form.id) return;
      if (form.id === 'search-form') {
        const srcEl = document.getElementById('search-source');
        const queryEl = document.getElementById('search-query');
        cnTrack('reader-metadata-search', {
          source: safeToken(srcEl ? srcEl.value : 'comicvine', 'comicvine'),
          query_length: queryEl && queryEl.value ? queryEl.value.trim().length : 0
        });
        return;
      }
      if (form.id === 'metadata-form') {
        cnTrack('reader-metadata-save', { comic_id: currentComicId() });
        return;
      }
      if (form.id === 'settings-form' || form.id === 'guided-settings-form') {
        cnTrack('reader-settings-save', {
          section: form.id === 'guided-settings-form' ? 'guided-reader' : 'general'
        });
      }
    },
    true
  );

  let rlSearchTimer = null;
  let dagSearchTimer = null;
  document.addEventListener(
    'input',
    (event) => {
      if (!event.isTrusted) return;
      const el = event.target;
      if (!el || !el.id) return;
      if (el.id === 'reading-list-search') {
        window.clearTimeout(rlSearchTimer);
        rlSearchTimer = window.setTimeout(() => {
          cnTrack('reader-reading-list-search', {
            query_length: el.value ? el.value.trim().length : 0
          });
        }, 400);
        return;
      }
      if (el.id === 'rl-dag-search') {
        window.clearTimeout(dagSearchTimer);
        dagSearchTimer = window.setTimeout(() => {
          cnTrack('reader-dag-search', {
            query_length: el.value ? el.value.trim().length : 0
          });
        }, 400);
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted || event.key !== 'Enter') return;
      const el = event.target;
      if (!el || !el.id) return;
      if (
        el.id === 'page-jump-input' ||
        el.id === 'page-jump-input-bottom' ||
        el.id === 'fullscreen-page-jump-input'
      ) {
        cnTrack('reader-page-jump', {
          control: el.id + '-submit',
          comic_id: currentComicId(),
          page: Math.max(1, Number(el.value || currentPageNum()))
        });
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
      'position:fixed;top:0;left:0;right:0;z-index:1200;background:#15120e;border-bottom:2px solid #fb4d3d;padding:calc(6px + env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) 6px max(14px, env(safe-area-inset-left));display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.6);';

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
        #reading-list-modal,
        #settings-modal,
        #ct-modal,
        #mgmt-confirm-modal,
        #fullscreen-viewer {
          top: var(--cn-demo-bar-height, 0px) !important;
        }
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
      document.documentElement.style.setProperty('--cn-demo-bar-height', height + 'px');
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
  setTimeout(() => clearInterval(bootPoll), 30000);

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.target !== 'comics-now-demo') return;
    await runDemoAction(data.action, 'postmessage');
  });
})();
