// GetComics Tracker - Full Authentic App Embed for ComicsNow

(function initTracker() {
  const getBaseUrl = () => {
    const b = (window.APP_CONFIG && window.APP_CONFIG.baseUrl) || '';
    return b.endsWith('/') ? b.slice(0, -1) : b;
  };

  function injectHeaderButton() {
    if (document.getElementById('tracker-button')) return;

    const settingsBtn = document.getElementById('settings-button');
    const headerGroup = settingsBtn ? settingsBtn.parentElement : null;
    if (!headerGroup) return;

    const btn = document.createElement('button');
    btn.id = 'tracker-button';
    btn.setAttribute('aria-label', 'GetComics Tracker');
    btn.setAttribute('title', 'GetComics Tracker (Full App)');
    btn.className = 'brutalist-btn w-10 h-10 transition-colors flex items-center justify-center';
    btn.style.cssText = 'background: transparent !important; color: #fdfbf7 !important; border: 2px solid rgba(255, 255, 255, 0.2) !important; box-shadow: none !important; border-radius: 0.5rem;';
    btn.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
      </svg>
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255, 255, 255, 0.1) !important';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent !important';
    });

    btn.addEventListener('click', () => {
      showTrackerView();
    });

    headerGroup.insertBefore(btn, settingsBtn);
  }

  function injectTrackerView() {
    if (document.getElementById('tracker-view')) return;

    const mainContainer = document.querySelector('main') || document.getElementById('content') || document.body;
    const baseHref = getBaseUrl() + '/';

    const view = document.createElement('div');
    view.id = 'tracker-view';
    view.className = 'hidden flex-1 flex flex-col w-full h-full p-1 sm:p-3';
    view.style.cssText = 'height: calc(100vh - 65px); min-height: 600px; display: none; flex-direction: column;';

    view.innerHTML = `
      <div class="w-full h-full flex-1 rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-[#13171f]">
        <iframe
          id="tracker-frame"
          src="${baseHref}tracker-app/"
          class="w-full h-full border-0"
          style="width: 100%; height: 100%; border: none;"
          title="GetComics Tracker"
        ></iframe>
      </div>
    `;

    mainContainer.appendChild(view);
  }

  function showTrackerView() {
    const trackerView = document.getElementById('tracker-view');
    if (!trackerView) return;

    const knownViewIds = [
      'root-folder-list',
      'folder-list-view',
      'publisher-list',
      'series-list',
      'comic-list',
      'comic-viewer',
      'search-results-view',
      'smart-list-view'
    ];

    knownViewIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    // Also hide top filter/search bars while in tracker
    const searchContainer = document.getElementById('search-container');
    const filtersContainer = document.getElementById('filters-container');
    const smartFilterHost = document.getElementById('smart-filter-host');
    if (searchContainer) searchContainer.classList.add('hidden');
    if (filtersContainer) filtersContainer.classList.add('hidden');
    if (smartFilterHost) smartFilterHost.classList.add('hidden');

    trackerView.style.display = 'flex';
    trackerView.classList.remove('hidden');
    window.location.hash = '#/tracker';
  }

  function hideTrackerView() {
    const trackerView = document.getElementById('tracker-view');
    if (trackerView) {
      trackerView.style.display = 'none';
      trackerView.classList.add('hidden');
    }
    const searchContainer = document.getElementById('search-container');
    const filtersContainer = document.getElementById('filters-container');
    if (searchContainer) searchContainer.classList.remove('hidden');
    if (filtersContainer) filtersContainer.classList.remove('hidden');
  }

  function setupNavigationHook() {
    ['reading-list-button', 'downloads-button', 'ct-button', 'settings-button', 'breadcrumb'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', hideTrackerView);
    });

    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#/tracker') {
        showTrackerView();
      } else {
        hideTrackerView();
      }
    });

    if (window.location.hash === '#/tracker') {
      showTrackerView();
    }
  }

  function init() {
    injectHeaderButton();
    injectTrackerView();
    setupNavigationHook();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
