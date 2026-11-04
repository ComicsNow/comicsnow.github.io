// Aria2 Download Manager - Embed Plugin for ComicsNow

(function initAria() {
  const getBaseUrl = () => {
    const b = (window.APP_CONFIG && window.APP_CONFIG.baseUrl) || '';
    return b.endsWith('/') ? b.slice(0, -1) : b;
  };

  function injectHeaderButton() {
    if (document.getElementById('aria-button')) return;

    const settingsBtn = document.getElementById('settings-button');
    const headerGroup = settingsBtn ? settingsBtn.parentElement : null;
    if (!headerGroup) return;

    const btn = document.createElement('button');
    btn.id = 'aria-button';
    btn.setAttribute('aria-label', 'Aria2 Downloads');
    btn.setAttribute('title', 'Aria2 Download Manager');
    btn.className = 'brutalist-btn w-10 h-10 transition-colors flex items-center justify-center';
    btn.style.cssText = 'background: transparent !important; color: #fdfbf7 !important; border: 2px solid rgba(255, 255, 255, 0.2) !important; box-shadow: none !important; border-radius: 0.5rem;';
    btn.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
      </svg>
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255, 255, 255, 0.1) !important';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent !important';
    });

    btn.addEventListener('click', () => {
      showAriaView();
    });

    // Place before settings button
    headerGroup.insertBefore(btn, settingsBtn);
  }

  function getAriaIframeSrc() {
    const baseHref = getBaseUrl() + '/';
    const proto = window.location.protocol.replace(':', '');
    const host = window.location.hostname;
    const port = window.location.port || (proto === 'https' ? '443' : '80');
    const cleanBase = baseHref.replace(/^\/|\/$/g, '');
    const rpcInterface = (cleanBase ? cleanBase + '/' : '') + 'aria-rpc';
    
    // Command URL tells AriaNg directly where the RPC endpoint is located
    return `${baseHref}aria-app/#!/settings/rpc/set?protocol=${proto}&host=${host}&port=${port}&interface=${encodeURIComponent(rpcInterface)}`;
  }

  function injectAriaView() {
    if (document.getElementById('aria-view')) return;

    const mainContainer = document.querySelector('main') || document.getElementById('content') || document.body;
    const iframeSrc = getAriaIframeSrc();

    const view = document.createElement('div');
    view.id = 'aria-view';
    view.className = 'hidden flex-1 flex flex-col w-full h-full p-1 sm:p-3';
    view.style.cssText = 'height: calc(100vh - 65px); min-height: 600px; display: none; flex-direction: column;';

    view.innerHTML = `
      <div class="w-full h-full flex-1 rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-[#13171f]">
        <iframe
          id="aria-frame"
          src="${iframeSrc}"
          class="w-full h-full border-0"
          style="width: 100%; height: 100%; border: none;"
          title="Aria2 Download Manager"
        ></iframe>
      </div>
    `;

    mainContainer.appendChild(view);
  }

  function showAriaView() {
    const ariaView = document.getElementById('aria-view');
    if (!ariaView) return;

    // Refresh iframe src to ensure RPC setting is synchronized if host changed
    const iframe = document.getElementById('aria-frame');
    if (iframe && (!iframe.src || iframe.src.indexOf('aria-app') === -1)) {
      iframe.src = getAriaIframeSrc();
    }

    // Hide tracker view if open
    const trackerView = document.getElementById('tracker-view');
    if (trackerView) {
      trackerView.style.display = 'none';
      trackerView.classList.add('hidden');
    }

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

    const searchContainer = document.getElementById('search-container');
    const filtersContainer = document.getElementById('filters-container');
    const smartFilterHost = document.getElementById('smart-filter-host');
    if (searchContainer) searchContainer.classList.add('hidden');
    if (filtersContainer) filtersContainer.classList.add('hidden');
    if (smartFilterHost) smartFilterHost.classList.add('hidden');

    ariaView.style.display = 'flex';
    ariaView.classList.remove('hidden');
    window.location.hash = '#/aria';
  }

  function hideAriaView() {
    const ariaView = document.getElementById('aria-view');
    if (ariaView) {
      ariaView.style.display = 'none';
      ariaView.classList.add('hidden');
    }
    const searchContainer = document.getElementById('search-container');
    const filtersContainer = document.getElementById('filters-container');
    if (searchContainer) searchContainer.classList.remove('hidden');
    if (filtersContainer) filtersContainer.classList.remove('hidden');
  }

  function setupNavigationHook() {
    ['reading-list-button', 'downloads-button', 'ct-button', 'settings-button', 'tracker-button', 'breadcrumb'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', hideAriaView);
    });

    document.getElementById('tracker-button')?.addEventListener('click', hideAriaView);

    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#/aria') {
        showAriaView();
      } else {
        hideAriaView();
      }
    });

    if (window.location.hash === '#/aria') {
      showAriaView();
    }
  }

  function init() {
    injectHeaderButton();
    injectAriaView();
    setupNavigationHook();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
