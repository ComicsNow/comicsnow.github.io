(function () {
  'use strict';

  var ZOOM_DEMOS = {
    panels: {
      width: 680,
      height: 1007,
      singular: 'panel',
      statusName: 'Panel',
      hint: 'Tap a panel',
      boxes: [
        [327, 2, 331, 474],
        [10, 0, 312, 288],
        [15, 300, 308, 176],
        [23, 488, 635, 519]
      ]
    },
    bubbles: {
      width: 780,
      height: 1105,
      singular: 'speech bubble',
      statusName: 'Speech bubble',
      hint: 'Tap a bubble',
      boxes: [
        [24, 225, 216, 62],
        [283, 224, 215, 61],
        [540, 182, 216, 143],
        [591, 330, 123, 72],
        [18, 511, 171, 45],
        [536, 562, 220, 43],
        [42, 794, 323, 34],
        [429, 720, 142, 78],
        [632, 859, 107, 71],
        [38, 1065, 272, 28],
        [361, 960, 155, 127]
      ]
    }
  };

  var INSTALL_SNIPPETS = {
    compose:
      'services:\n' +
      '  comics-now:\n' +
      '    image: ghcr.io/comicsnow/comics-now:latest\n' +
      '    container_name: comics-now\n' +
      '    ports:\n' +
      '      - "3000:3000"\n' +
      '    volumes:\n' +
      '      - ./data:/app/data\n' +
      '      - /path/to/your/comics:/comics:ro\n' +
      '    restart: unless-stopped',
    docker:
      'docker run -d \\\n' +
      '  --name comics-now \\\n' +
      '  -p 3000:3000 \\\n' +
      '  -v $(pwd)/data:/app/data \\\n' +
      '  -v /path/to/your/comics:/comics:ro \\\n' +
      '  --restart unless-stopped \\\n' +
      '  ghcr.io/comicsnow/comics-now:latest',
    npx:
      '# Launch instantly with zero setup\n' +
      'npx comics-now --comics /path/to/your/comics --port 3000\n' +
      '\n' +
      '# Or install globally via npm\n' +
      'npm install -g comics-now'
  };

  function track(name, data) {
    if (window.umami && typeof window.umami.track === 'function') {
      try {
        window.umami.track(name, data || {});
      } catch (_error) {
        // Analytics should never break the page.
      }
    }
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    var active = document.activeElement;
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (_error) {
      copied = false;
    }
    document.body.removeChild(area);
    if (active && typeof active.focus === 'function') {
      active.focus();
    }
    return copied;
  }

  function initZoomDemo(stage) {
    var kind = stage.getAttribute('data-zoom-kind');
    var config = ZOOM_DEMOS[kind];
    var image = stage.querySelector('.zoom-page');
    var hint = stage.querySelector('.zoom-hint');
    var status = stage.querySelector('.zoom-status');
    if (!config || !image || stage.querySelector('.zoom-targets')) return;

    // Mirrors the reader's manga-panel-zoom and western-speech-zoom modes:
    // the page stays put and a magnified card opens above it.
    var isPanelZoom = kind === 'panels';
    var layer = document.createElement('div');
    layer.className = 'zoom-targets';

    var buttons = config.boxes.map(function (box, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'zoom-target';
      button.style.left = (box[0] / config.width) * 100 + '%';
      button.style.top = (box[1] / config.height) * 100 + '%';
      button.style.width = (box[2] / config.width) * 100 + '%';
      button.style.height = (box[3] / config.height) * 100 + '%';
      button.setAttribute(
        'aria-label',
        'Zoom into ' + config.singular + ' ' + (index + 1) + ' of ' + config.boxes.length
      );
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleZoom(index, button);
      });
      layer.appendChild(button);
      return button;
    });

    var lens = document.createElement('button');
    lens.type = 'button';
    lens.className = 'zoom-lens';
    lens.setAttribute('aria-label', 'Return to the full page');
    var lensImage = document.createElement('img');
    lensImage.alt = '';
    lensImage.decoding = 'async';
    lens.appendChild(lensImage);
    lens.addEventListener('click', function (event) {
      event.stopPropagation();
      zoomOut();
    });

    stage.appendChild(layer);
    stage.appendChild(lens);

    var activeIndex = -1;
    var lastTarget = null;
    var lastLensPosition = '';
    var resizeFrame = 0;

    if (hint) hint.textContent = config.hint;

    function setStatus(text) {
      if (status) status.textContent = text;
    }

    function focusWithoutScroll(element) {
      window.requestAnimationFrame(function () {
        try {
          element.focus({ preventScroll: true });
        } catch (_error) {
          element.focus();
        }
      });
    }

    function sourceBox(index) {
      var box = config.boxes[index].slice();
      if (!isPanelZoom && box[2] > 0 && box[3] > 0) {
        var growX = box[2] * 0.04;
        var growY = box[3] * 0.03;
        box[0] = Math.max(0, box[0] - growX);
        box[1] = Math.max(0, box[1] - growY);
        box[2] += growX * 2;
        box[3] += growY * 2;
      }
      return box;
    }

    function layoutFor(index) {
      var stageW = stage.clientWidth;
      var stageH = stage.clientHeight;
      if (!stageW || !stageH) return null;

      var box = sourceBox(index);
      if (!box[2] || !box[3]) return null;

      var baseScale = Math.min(stageW / config.width, stageH / config.height);
      var imageTop = (stageH - config.height * baseScale) / 2;
      var centerX = box[0] + box[2] / 2;
      var centerY = box[1] + box[3] / 2;
      var innerScale;
      var overlayW;
      var overlayH;
      var x;
      var y;

      if (isPanelZoom) {
        var maxPanelW = Math.min(stageW - 12, 1200);
        var maxPanelH = Math.min(stageH * 0.88, 1400);
        var pad = 12;
        var fitScale = Math.min(
          (maxPanelW - pad * 2) / box[2],
          (maxPanelH - pad * 2) / box[3]
        );

        innerScale = Math.max(fitScale, baseScale * 1.35);
        innerScale = Math.min(innerScale, baseScale * 4);
        if (box[3] * innerScale > maxPanelH * 1.25) {
          innerScale = Math.max(baseScale, maxPanelH / box[3]);
        }

        overlayW = Math.min(maxPanelW, Math.round(box[2] * innerScale + pad * 2));
        overlayH = Math.min(maxPanelH, Math.round(box[3] * innerScale + pad * 2));
        overlayW = Math.max(overlayW, Math.min(280, maxPanelW));
        overlayH = Math.max(overlayH, 160);
        x = Math.max(6, Math.min(stageW - overlayW - 6, (stageW - overlayW) / 2));
        y = Math.max(50, Math.min(stageH - overlayH - 80, (stageH - overlayH) / 2));
      } else {
        var maxBubbleW = Math.min(stageW - 12, 700);
        var maxBubbleH = Math.min(stageH * 0.52, 420);
        var padX = 20;
        var padY = 16;
        var minBubbleW = Math.min(260, maxBubbleW);
        var desiredScale = baseScale * 3.2;
        var maxFit = Math.min(
          (maxBubbleW - padX * 2) / box[2],
          (maxBubbleH - padY * 2) / box[3]
        );

        innerScale = Math.min(desiredScale, maxFit);
        overlayW = Math.min(
          maxBubbleW,
          Math.max(minBubbleW, Math.round(box[2] * innerScale + padX * 2))
        );
        overlayH = Math.min(
          maxBubbleH,
          Math.max(140, Math.round(box[3] * innerScale + padY * 2))
        );
        x = Math.max(6, Math.min(stageW - overlayW - 6, (stageW - overlayW) / 2));

        var bubbleStageY = imageTop + centerY * baseScale;
        var mid = stageH / 2;
        var deadzone = stageH * 0.1;
        if (!lastLensPosition) {
          lastLensPosition = bubbleStageY < mid ? 'bottom' : 'top';
        } else if (lastLensPosition === 'bottom') {
          if (bubbleStageY > mid + deadzone) lastLensPosition = 'top';
        } else if (bubbleStageY < mid - deadzone) {
          lastLensPosition = 'bottom';
        }

        y = lastLensPosition === 'top' ? 60 : stageH - overlayH - 100;
        y = Math.max(10, Math.min(stageH - overlayH - 10, y));
      }

      return {
        width: overlayW,
        height: overlayH,
        x: x,
        y: y,
        innerScale: innerScale,
        innerX: overlayW / 2 - centerX * innerScale,
        innerY: overlayH / 2 - centerY * innerScale
      };
    }

    function applyLayout(index, animate) {
      var layout = layoutFor(index);
      if (!layout) return;

      if (!animate) {
        lens.style.transition = 'none';
        lensImage.style.transition = 'none';
      }

      lens.style.width = layout.width + 'px';
      lens.style.height = layout.height + 'px';
      lens.style.transform =
        'translate(' + Math.round(layout.x) + 'px, ' + Math.round(layout.y) + 'px)';
      lensImage.style.width = config.width + 'px';
      lensImage.style.height = config.height + 'px';
      lensImage.style.transform =
        'translate(' +
        Math.round(layout.innerX) +
        'px, ' +
        Math.round(layout.innerY) +
        'px) scale(' +
        layout.innerScale.toFixed(4) +
        ')';

      if (!animate) {
        void lens.offsetWidth;
        lens.style.transition = '';
        lensImage.style.transition = '';
      }
    }

    function findHit(nx, ny) {
      var bestExact = -1;
      var smallestExact = Infinity;
      var i;
      var box;

      for (i = 0; i < config.boxes.length; i++) {
        box = config.boxes[i];
        if (nx >= box[0] && nx <= box[0] + box[2] && ny >= box[1] && ny <= box[1] + box[3]) {
          var area = box[2] * box[3];
          if (area < smallestExact) {
            smallestExact = area;
            bestExact = i;
          }
        }
      }
      if (bestExact !== -1 || isPanelZoom) return bestExact;

      var rect = image.getBoundingClientRect();
      if (!rect.width || !rect.height) return -1;
      var scaleX = config.width / rect.width;
      var scaleY = config.height / rect.height;
      var hitPadX = Math.max(30, Math.round(32 * scaleX));
      var hitPadY = Math.max(30, Math.round(36 * scaleY));
      var bestPadded = -1;
      var shortestDistance = Infinity;

      for (i = 0; i < config.boxes.length; i++) {
        box = config.boxes[i];
        var dx = Math.max(0, box[0] - nx, nx - (box[0] + box[2]));
        var dy = Math.max(0, box[1] - ny, ny - (box[1] + box[3]));
        if (dx <= hitPadX && dy <= hitPadY) {
          var distance = Math.hypot(dx / hitPadX, dy / hitPadY);
          if (distance < shortestDistance) {
            shortestDistance = distance;
            bestPadded = i;
          }
        }
      }
      return bestPadded;
    }

    function zoomTo(index, button) {
      activeIndex = index;
      lastTarget = button || buttons[index];
      track(isPanelZoom ? 'demo-panel-zoom' : 'demo-bubble-zoom', {
        item: index + 1,
        total: config.boxes.length
      });
      if (lensImage.getAttribute('src') !== (image.currentSrc || image.src)) {
        lensImage.src = image.currentSrc || image.src;
      }
      applyLayout(index, true);
      stage.classList.add('is-zoomed');
      if (hint) hint.textContent = config.hint;
      setStatus(
        config.statusName +
          ' ' +
          (index + 1) +
          ' of ' +
          config.boxes.length +
          ', close-up open'
      );
      focusWithoutScroll(lens);
    }

    function zoomOut() {
      if (activeIndex === -1) return;

      var index = activeIndex;
      activeIndex = -1;
      stage.classList.remove('is-zoomed');
      if (hint) hint.textContent = config.hint;
      setStatus('Full page view');

      var returnTarget = lastTarget || buttons[index];
      focusWithoutScroll(returnTarget);
    }

    function toggleZoom(index, button) {
      if (activeIndex === index) {
        zoomOut();
      } else {
        zoomTo(index, button);
      }
    }

    // The real reader resolves taps against the page coordinates, with extra
    // room around small speech bubbles. The invisible buttons above handle
    // keyboard focus; physical clicks are resolved here.
    stage.addEventListener('click', function (event) {
      if (event.target.closest('.zoom-lens') || event.target.closest('.zoom-target')) return;

      var rect = image.getBoundingClientRect();
      var insideImage =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      var index = -1;

      if (insideImage && rect.width && rect.height) {
        var nx = ((event.clientX - rect.left) * config.width) / rect.width;
        var ny = ((event.clientY - rect.top) * config.height) / rect.height;
        index = findHit(nx, ny);
      }

      if (index === -1) {
        if (activeIndex !== -1) zoomOut();
        return;
      }
      toggleZoom(index, buttons[index]);
    });

    stage.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || activeIndex === -1) return;
      event.preventDefault();
      zoomOut();
    });

    if (window.ResizeObserver) {
      var observer = new ResizeObserver(function () {
        if (activeIndex === -1) return;
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(function () {
          applyLayout(activeIndex, false);
        });
      });
      observer.observe(stage);
    }
  }

  function initZoomDemos() {
    Array.prototype.slice
      .call(document.querySelectorAll('[data-zoom-kind]'))
      .forEach(function (stage) {
        initZoomDemo(stage);
      });
  }

  function initInstall() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-install-tab]'));
    var panel = document.getElementById('install-code');
    var code = document.getElementById('install-code-content');
    var copyBtn = document.getElementById('copy-install-btn');
    if (!tabs.length || !panel || !code) return;

    function activate(tab, moveFocus) {
      if (!tab || !INSTALL_SNIPPETS[tab.getAttribute('data-install-tab')]) return;

      tabs.forEach(function (other) {
        var selected = other === tab;
        other.classList.toggle('is-active', selected);
        other.setAttribute('aria-selected', selected ? 'true' : 'false');
        other.tabIndex = selected ? 0 : -1;
      });

      code.textContent = INSTALL_SNIPPETS[tab.getAttribute('data-install-tab')];
      panel.setAttribute('aria-labelledby', tab.id);
      if (moveFocus) tab.focus();
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        activate(tab, false);
      });

      tab.addEventListener('keydown', function (event) {
        var next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          next = tabs[(index + 1) % tabs.length];
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          next = tabs[(index - 1 + tabs.length) % tabs.length];
        } else if (event.key === 'Home') {
          next = tabs[0];
        } else if (event.key === 'End') {
          next = tabs[tabs.length - 1];
        }

        if (!next) return;
        event.preventDefault();
        activate(next, true);
        track('install-tab-switch', { tab: next.getAttribute('data-install-tab') });
      });
    });

    activate(
      tabs.find(function (tab) {
        return tab.getAttribute('aria-selected') === 'true';
      }) || tabs[0],
      false
    );

    if (!copyBtn) return;

    var resetTimer = 0;
    function flashLabel(text) {
      window.clearTimeout(resetTimer);
      copyBtn.textContent = text;
      resetTimer = window.setTimeout(function () {
        copyBtn.textContent = 'Copy';
      }, 2000);
    }

    copyBtn.addEventListener('click', function () {
      var text = code.textContent || '';

      function copied() {
        flashLabel('Copied');
      }

      function selectIt() {
        var range = document.createRange();
        var selection = window.getSelection();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
        flashLabel('Press Ctrl+C');
      }

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(copied, function () {
          if (legacyCopy(text)) copied();
          else selectIt();
        });
      } else if (legacyCopy(text)) {
        copied();
      } else {
        selectIt();
      }
    });
  }

  function start() {
    initZoomDemos();
    initInstall();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
