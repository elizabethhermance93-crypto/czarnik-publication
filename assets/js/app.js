/**
 * Czarnik Publications Online Viewer
 * Vanilla JS single-page publication viewer.
 */
(function () {
  'use strict';

  const ZOOM_STEP = 10;
  const ZOOM_MIN = 25;
  const ZOOM_MAX = 400;
  const ZOOM_DEFAULT = 100;
  const MOBILE_BREAKPOINT = 768;

  const state = {
    currentPage: 1,
    pageCount: 1,
    zoomLevel: ZOOM_DEFAULT,
    fitMode: 'fitWidth',
    activeBookmarkId: null,
    activeParentId: null,
    expandedSections: new Set(),
    thumbnailsVisible: true,
    bookmarkPanelOpen: true,
    outline: [],
    outlineDoc: null,
    manifest: null,
    imageCache: new Map(),
    prefetchQueue: new Set(),
    isLoading: false,
    naturalWidth: 0,
    naturalHeight: 0,
    loadToken: 0,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function isMobile() {
    return window.innerWidth < MOBILE_BREAKPOINT;
  }

  function resolveAssetUrl(path) {
    if (!path) return path;
    if (/^(https?:|data:)/.test(path)) return path;
    if (path.startsWith('/')) {
      const base = window.location.pathname.replace(/\/[^/]*$/, '/');
      return base + path.slice(1);
    }
    return path;
  }

  function scheduleIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: 2000 });
    } else {
      setTimeout(fn, 100);
    }
  }

  function clampPage(page) {
    const n = parseInt(page, 10);
    if (Number.isNaN(n)) return state.currentPage;
    return Math.max(1, Math.min(state.pageCount, n));
  }

  function pageKey(page) {
    return String(page);
  }

  function getManifestEntry(page) {
    if (!state.manifest || !state.manifest.pages) return null;
    return state.manifest.pages[pageKey(page)] || null;
  }

  function derivePageCount() {
    const manifestCount = state.manifest?.document?.pageCount || 0;
    const outlineCount = state.outlineDoc?.document?.pageCount || 0;

    if (manifestCount > 0) return manifestCount;
    if (outlineCount > 0) return outlineCount;

    let maxPage = 1;
    for (const section of state.outline) {
      maxPage = Math.max(maxPage, section.page || 1);
      for (const child of section.children || []) {
        maxPage = Math.max(maxPage, child.page || 1);
      }
    }

    if (state.manifest?.pages) {
      for (const key of Object.keys(state.manifest.pages)) {
        maxPage = Math.max(maxPage, parseInt(key, 10));
      }
    }

    return maxPage;
  }

  function findBookmarkForPage(page) {
    let best = null;
    let bestPage = 0;

    for (const section of state.outline) {
      if (section.page <= page && section.page >= bestPage) {
        best = section;
        bestPage = section.page;
      }
      for (const child of section.children || []) {
        if (child.page <= page && child.page >= bestPage) {
          best = child;
          bestPage = child.page;
        }
      }
    }

    return best;
  }

  function findParentOfBookmark(bookmarkId) {
    for (const section of state.outline) {
      if (section.id === bookmarkId) return section;
      for (const child of section.children || []) {
        if (child.id === bookmarkId) return section;
      }
    }
    return null;
  }

  function findBookmarkById(id) {
    for (const section of state.outline) {
      if (section.id === id) return section;
      for (const child of section.children || []) {
        if (child.id === id) return child;
      }
    }
    return null;
  }

  function getSiblingPages(bookmarkId) {
    const parent = findParentOfBookmark(bookmarkId);
    if (!parent) return [];

    const siblings = [];
    if (parent.children && parent.children.length) {
      for (const child of parent.children) {
        siblings.push(child.page);
      }
    } else {
      siblings.push(parent.page);
    }

    const idx = siblings.findIndex((p) => {
      const bm = findBookmarkById(bookmarkId);
      return bm && bm.page === p;
    });

    if (idx === -1) return siblings.slice(0, 3);
    return siblings.slice(idx + 1, idx + 4);
  }

  function setActiveBookmark(bookmarkId) {
    state.activeBookmarkId = bookmarkId;
    const parent = findParentOfBookmark(bookmarkId);
    if (parent && parent.children && parent.children.length && parent.id !== bookmarkId) {
      state.expandedSections.add(parent.id);
      state.activeParentId = parent.id;
    } else {
      state.activeParentId = bookmarkId;
      state.expandedSections.add(bookmarkId);
    }
  }

  function updateUrlHash() {
    const hash = `#page=${state.currentPage}`;
    if (window.location.hash !== hash) {
      history.replaceState(null, '', hash);
    }
  }

  function parseUrlHash() {
    const match = window.location.hash.match(/page=(\d+)/);
    if (match) {
      return clampPage(match[1]);
    }
    return null;
  }

  function updatePageDisplays() {
    const totalText = `/ ${state.pageCount}`;
    els.pageInput.value = state.currentPage;
    els.pageInputMobile.value = state.currentPage;
    els.pageTotal.textContent = totalText;
    els.pageTotalMobile.textContent = totalText;
    els.pageInput.max = state.pageCount;
    els.pageInputMobile.max = state.pageCount;

    const atStart = state.currentPage <= 1;
    const atEnd = state.currentPage >= state.pageCount;

    [els.btnPrevPage, els.btnPrevPageMobile, els.btnFloatPrev].forEach((btn) => {
      if (btn) btn.disabled = atStart;
    });
    [els.btnNextPage, els.btnNextPageMobile, els.btnFloatNext].forEach((btn) => {
      if (btn) btn.disabled = atEnd;
    });
  }

  function updateZoomDisplays() {
    const fitLabels = {
      fitWidth: 'Fit Width',
      fitPage: 'Fit Page',
      actual: 'Actual Size',
      custom: `${state.zoomLevel}%`,
    };

    let zoomLabel;
    if (state.fitMode === 'custom') {
      zoomLabel = `${state.zoomLevel}%`;
    } else if (state.fitMode === 'actual') {
      zoomLabel = '1:1';
    } else if (state.fitMode === 'fitPage') {
      zoomLabel = 'Fit Page';
    } else {
      zoomLabel = 'Fit Width';
    }

    els.zoomDisplay.textContent = zoomLabel;
    els.zoomDisplayMobile.textContent = zoomLabel;
    els.fitModeLabel.textContent = fitLabels[state.fitMode] || 'Fit Width';
  }

  function updateViewportChrome() {
    const root = document.documentElement;
    if (isMobile()) {
      root.style.setProperty('--viewer-chrome-y', '140px');
    } else {
      root.style.setProperty('--viewer-chrome-y', '132px');
    }
  }

  function applyZoomToImage() {
    const img = els.pageImage;
    img.classList.remove('fit-width', 'fit-page', 'actual-size', 'custom-zoom');

    switch (state.fitMode) {
      case 'fitWidth':
        img.classList.add('fit-width');
        img.style.width = '';
        img.style.height = '';
        break;
      case 'fitPage':
        img.classList.add('fit-page');
        img.style.width = '';
        img.style.height = '';
        break;
      case 'actual':
        img.classList.add('actual-size');
        if (state.naturalWidth) {
          img.style.width = `${state.naturalWidth}px`;
          img.style.height = `${state.naturalHeight}px`;
        }
        break;
      case 'custom':
        img.classList.add('custom-zoom');
        if (state.naturalWidth) {
          const scale = state.zoomLevel / 100;
          img.style.width = `${Math.round(state.naturalWidth * scale)}px`;
          img.style.height = `${Math.round(state.naturalHeight * scale)}px`;
        }
        break;
      default:
        img.classList.add('fit-width');
    }
  }

  function showPageState(which) {
    els.pageLoading.classList.toggle('d-none', which !== 'loading');
    els.pageMissing.classList.toggle('d-none', which !== 'missing');
    els.pageImageWrap.classList.toggle('d-none', which !== 'image');
  }

  function showMissingPage() {
    const p = els.pageMissing.querySelector('p');
    if (p) {
      p.textContent =
        `Page ${state.currentPage} image not rendered yet. Render this page using the local render script.`;
    }
    showPageState('missing');
  }

  function prefetchImage(url) {
    const resolved = resolveAssetUrl(url);
    if (!resolved || state.imageCache.has(resolved) || state.prefetchQueue.has(resolved)) return;

    state.prefetchQueue.add(resolved);
    const img = new Image();
    img.onload = () => {
      state.imageCache.set(resolved, true);
      state.prefetchQueue.delete(resolved);
    };
    img.onerror = () => {
      state.prefetchQueue.delete(resolved);
    };
    img.src = resolved;
  }

  function prefetchPages(pages) {
    scheduleIdle(() => {
      for (const page of pages) {
        const entry = getManifestEntry(page);
        if (entry?.image) prefetchImage(entry.image);
        if (entry?.thumb) prefetchImage(entry.thumb);
      }
    });
  }

  function prefetchSectionStarts() {
    const pages = state.outline.map((s) => s.page).filter(Boolean);
    prefetchPages(pages);
  }

  function prefetchAdjacent() {
    prefetchPages([state.currentPage - 1, state.currentPage + 1]);
  }

  function renderCurrentPage() {
    const entry = getManifestEntry(state.currentPage);
    const img = els.pageImage;
    const token = ++state.loadToken;

    img.alt = `Page ${state.currentPage} of ${state.pageCount}`;
    state.isLoading = true;
    showPageState('loading');

    if (!entry || !entry.image) {
      state.isLoading = false;
      showMissingPage();
      updatePageDisplays();
      updateThumbnailHighlight();
      updateBookmarkHighlight();
      updateUrlHash();
      prefetchAdjacent();
      return;
    }

    const imageUrl = resolveAssetUrl(entry.image);
    const cached = state.imageCache.has(imageUrl);

    const onLoad = () => {
      if (token !== state.loadToken) return;
      state.naturalWidth = entry.width || img.naturalWidth;
      state.naturalHeight = entry.height || img.naturalHeight;
      state.isLoading = false;
      state.imageCache.set(imageUrl, true);
      showPageState('image');
      applyZoomToImage();
      updatePageDisplays();
      updateThumbnailHighlight();
      updateBookmarkHighlight();
      updateUrlHash();
      prefetchAdjacent();
    };

    const onError = () => {
      if (token !== state.loadToken) return;
      state.isLoading = false;
      showMissingPage();
      updatePageDisplays();
      updateThumbnailHighlight();
      updateBookmarkHighlight();
      updateUrlHash();
      prefetchAdjacent();
    };

    img.onload = onLoad;
    img.onerror = onError;
    img.src = imageUrl;

    if (cached && img.complete) {
      onLoad();
    }
  }

  function goToPage(page, bookmarkId) {
    const target = clampPage(page);
    state.currentPage = target;

    if (bookmarkId) {
      setActiveBookmark(bookmarkId);
      prefetchPages(getSiblingPages(bookmarkId));
    } else {
      const bm = findBookmarkForPage(target);
      if (bm) {
        setActiveBookmark(bm.id);
      }
    }

    updateExpandedSectionsUI();
    updateBookmarkHighlight();
    scrollActiveBookmarkIntoView();
    renderCurrentPage();
  }

  function buildBookmarkRow(item, isChild) {
    const isActive = state.activeBookmarkId === item.id;
    const isParentActive = state.activeParentId === item.id && !isChild;
    const classes = ['bookmark-row'];
    if (isChild) classes.push('bookmark-row-child');
    if (isActive) classes.push('active');
    if (isParentActive) classes.push('parent-active');

    return `
      <button type="button" class="${classes.join(' ')}"
        data-bookmark-id="${item.id}"
        data-page="${item.page}"
        role="treeitem"
        aria-selected="${isActive}">
        <span class="bookmark-title">${escapeHtml(item.title)}</span>
        <span class="bookmark-page">${item.page}</span>
      </button>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderBookmarkSection(section) {
    const hasChildren = section.children && section.children.length > 0;
    const isExpanded = state.expandedSections.has(section.id);
    const chevronIcon = isExpanded ? 'bi-chevron-down' : 'bi-chevron-right';

    let html = `<div class="bookmark-section" data-section-id="${section.id}">`;
    html += `<div class="bookmark-parent">`;
    html += `<button type="button" class="bookmark-chevron${hasChildren ? '' : ' leaf'}"
      data-section-id="${section.id}"
      aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(section.title)}"
      aria-expanded="${isExpanded}">
      <i class="bi ${chevronIcon}" aria-hidden="true"></i>
    </button>`;
    html += buildBookmarkRow(section, false);
    html += `</div>`;

    if (hasChildren) {
      html += `<div class="bookmark-children${isExpanded ? '' : ' collapsed'}" role="group">`;
      for (const child of section.children) {
        html += buildBookmarkRow(child, true);
      }
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderBookmarkTrees() {
    const html = state.outline.map(renderBookmarkSection).join('');
    els.bookmarkTreeDesktop.innerHTML = html;
    els.bookmarkTreeMobile.innerHTML = html;
    bindBookmarkEvents(els.bookmarkTreeDesktop);
    bindBookmarkEvents(els.bookmarkTreeMobile);
  }

  function updateExpandedSectionsUI() {
    [els.bookmarkTreeDesktop, els.bookmarkTreeMobile].forEach((tree) => {
      tree.querySelectorAll('.bookmark-section').forEach((sec) => {
        const sectionId = sec.dataset.sectionId;
        const isExpanded = state.expandedSections.has(sectionId);
        const children = sec.querySelector('.bookmark-children');
        const chevron = sec.querySelector('.bookmark-chevron:not(.leaf)');
        if (children) {
          children.classList.toggle('collapsed', !isExpanded);
        }
        if (chevron) {
          chevron.setAttribute('aria-expanded', String(isExpanded));
          const icon = chevron.querySelector('i');
          if (icon) {
            icon.classList.remove('bi-chevron-down', 'bi-chevron-right');
            icon.classList.add(isExpanded ? 'bi-chevron-down' : 'bi-chevron-right');
          }
        }
      });
    });
  }

  function scrollActiveBookmarkIntoView() {
    const tree = isMobile() ? els.bookmarkTreeMobile : els.bookmarkTreeDesktop;
    if (!tree) return;
    const active = tree.querySelector('.bookmark-row.active');
    if (active) {
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function bindBookmarkEvents(container) {
    container.querySelectorAll('.bookmark-row').forEach((row) => {
      row.addEventListener('click', () => {
        const page = parseInt(row.dataset.page, 10);
        const id = row.dataset.bookmarkId;
        goToPage(page, id);
        if (isMobile()) {
          const offcanvas = bootstrap.Offcanvas.getInstance(els.bookmarkOffcanvas);
          if (offcanvas) offcanvas.hide();
        }
      });

      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          row.click();
        }
      });
    });

    container.querySelectorAll('.bookmark-chevron:not(.leaf)').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.sectionId;
        if (state.expandedSections.has(id)) {
          state.expandedSections.delete(id);
        } else {
          state.expandedSections.add(id);
          const section = state.outline.find((s) => s.id === id);
          if (section?.children) {
            prefetchPages(section.children.map((c) => c.page));
          }
        }
        updateExpandedSectionsUI();
      });

      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    });
  }

  function updateBookmarkHighlight() {
    [els.bookmarkTreeDesktop, els.bookmarkTreeMobile].forEach((tree) => {
      tree.querySelectorAll('.bookmark-row').forEach((row) => {
        const isActive = row.dataset.bookmarkId === state.activeBookmarkId;
        row.classList.toggle('active', isActive);
        row.setAttribute('aria-selected', isActive);
      });
      tree.querySelectorAll('.bookmark-section').forEach((sec) => {
        const sectionId = sec.dataset.sectionId;
        const parentRow = sec.querySelector('.bookmark-parent .bookmark-row');
        if (parentRow) {
          parentRow.classList.toggle('parent-active', sectionId === state.activeParentId);
        }
      });
    });
  }

  function renderThumbnails() {
    const container = els.thumbnailContainer;
    container.innerHTML = '';

    if (!state.manifest?.pages || Object.keys(state.manifest.pages).length === 0) {
      const empty = document.createElement('p');
      empty.className = 'thumbnail-empty';
      empty.textContent = 'No thumbnails rendered yet';
      container.appendChild(empty);
      return;
    }

    const pages = Object.keys(state.manifest.pages)
      .map((k) => parseInt(k, 10))
      .sort((a, b) => a - b);

    for (const pageNum of pages) {
      const entry = state.manifest.pages[pageKey(pageNum)];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumbnail-item';
      btn.dataset.page = pageNum;
      btn.setAttribute('aria-label', `Go to page ${pageNum}`);

      if (entry.thumb) {
        const img = document.createElement('img');
        img.src = resolveAssetUrl(entry.thumb);
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => {
          img.replaceWith(createThumbPlaceholder(pageNum));
        };
        btn.appendChild(img);
      } else {
        btn.appendChild(createThumbPlaceholder(pageNum));
      }

      const label = document.createElement('span');
      label.className = 'thumbnail-label';
      label.textContent = pageNum;
      btn.appendChild(label);

      btn.addEventListener('click', () => goToPage(pageNum));
      container.appendChild(btn);
    }

    updateThumbnailHighlight();
  }

  function createThumbPlaceholder(pageNum) {
    const div = document.createElement('div');
    div.className = 'thumbnail-placeholder';
    div.textContent = pageNum;
    return div;
  }

  function updateThumbnailHighlight() {
    if (!els.thumbnailContainer) return;
    els.thumbnailContainer.querySelectorAll('.thumbnail-item').forEach((item) => {
      const isActive = parseInt(item.dataset.page, 10) === state.currentPage;
      item.classList.toggle('active', isActive);
      if (isActive) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  function setFitMode(mode) {
    state.fitMode = mode;
    if (mode === 'actual') {
      state.zoomLevel = 100;
    }
    updateZoomDisplays();
    if (!state.isLoading && !els.pageImageWrap.classList.contains('d-none')) {
      applyZoomToImage();
    }
  }

  function setZoom(level) {
    state.zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    state.fitMode = 'custom';
    updateZoomDisplays();
    if (!state.isLoading && !els.pageImageWrap.classList.contains('d-none')) {
      applyZoomToImage();
    }
  }

  function syncBookmarkToggleState(isOpen) {
    els.btnToggleBookmarks.classList.toggle('active', isOpen);
    els.btnToggleBookmarks.setAttribute('aria-pressed', String(isOpen));
  }

  function toggleThumbnails() {
    state.thumbnailsVisible = !state.thumbnailsVisible;
    els.thumbnailRail.classList.toggle('collapsed', !state.thumbnailsVisible);
  }

  function toggleBookmarkPanel() {
    if (isMobile()) {
      const offcanvas = bootstrap.Offcanvas.getOrCreateInstance(els.bookmarkOffcanvas);
      offcanvas.toggle();
      return;
    }

    state.bookmarkPanelOpen = !state.bookmarkPanelOpen;
    els.bookmarkPanel.classList.toggle('collapsed', !state.bookmarkPanelOpen);
    syncBookmarkToggleState(state.bookmarkPanelOpen);
  }

  function bindEvents() {
    els.btnPrevPage.addEventListener('click', () => goToPage(state.currentPage - 1));
    els.btnNextPage.addEventListener('click', () => goToPage(state.currentPage + 1));
    els.btnPrevPageMobile.addEventListener('click', () => goToPage(state.currentPage - 1));
    els.btnNextPageMobile.addEventListener('click', () => goToPage(state.currentPage + 1));
    els.btnFloatPrev.addEventListener('click', () => goToPage(state.currentPage - 1));
    els.btnFloatNext.addEventListener('click', () => goToPage(state.currentPage + 1));

    const handlePageInput = (input) => {
      const handler = () => {
        const val = clampPage(input.value);
        input.value = val;
        goToPage(val);
      };
      input.addEventListener('change', handler);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handler();
        }
      });
    };
    handlePageInput(els.pageInput);
    handlePageInput(els.pageInputMobile);

    els.btnZoomIn.addEventListener('click', () => setZoom(state.zoomLevel + ZOOM_STEP));
    els.btnZoomOut.addEventListener('click', () => setZoom(state.zoomLevel - ZOOM_STEP));
    els.btnZoomInMobile.addEventListener('click', () => setZoom(state.zoomLevel + ZOOM_STEP));
    els.btnZoomOutMobile.addEventListener('click', () => setZoom(state.zoomLevel - ZOOM_STEP));
    els.btnFitWidthMobile.addEventListener('click', () => setFitMode('fitWidth'));

    els.btnActualSize.addEventListener('click', () => setFitMode('actual'));

    document.querySelectorAll('[data-fit]').forEach((item) => {
      item.addEventListener('click', () => setFitMode(item.dataset.fit));
    });

    els.btnToggleThumbnails.addEventListener('click', toggleThumbnails);
    els.btnToggleBookmarks.addEventListener('click', toggleBookmarkPanel);
    els.btnCloseBookmarks.addEventListener('click', () => {
      state.bookmarkPanelOpen = false;
      els.bookmarkPanel.classList.add('collapsed');
      syncBookmarkToggleState(false);
    });

    els.bookmarkOffcanvas.addEventListener('shown.bs.offcanvas', () => {
      if (isMobile()) syncBookmarkToggleState(true);
    });
    els.bookmarkOffcanvas.addEventListener('hidden.bs.offcanvas', () => {
      if (isMobile()) syncBookmarkToggleState(false);
    });

    // Weak deterrent only — not real content protection.
    els.pageImage.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('hashchange', () => {
      const page = parseUrlHash();
      if (page && page !== state.currentPage) {
        goToPage(page);
      }
    });

    window.addEventListener('resize', () => {
      updateViewportChrome();
      if (!state.isLoading && !els.pageImageWrap.classList.contains('d-none')) {
        applyZoomToImage();
      }
    });
  }

  function cacheElements() {
    els.pageInput = $('pageInput');
    els.pageInputMobile = $('pageInputMobile');
    els.pageTotal = $('pageTotal');
    els.pageTotalMobile = $('pageTotalMobile');
    els.btnPrevPage = $('btnPrevPage');
    els.btnNextPage = $('btnNextPage');
    els.btnPrevPageMobile = $('btnPrevPageMobile');
    els.btnNextPageMobile = $('btnNextPageMobile');
    els.btnFloatPrev = $('btnFloatPrev');
    els.btnFloatNext = $('btnFloatNext');
    els.btnZoomIn = $('btnZoomIn');
    els.btnZoomOut = $('btnZoomOut');
    els.btnZoomInMobile = $('btnZoomInMobile');
    els.btnZoomOutMobile = $('btnZoomOutMobile');
    els.btnFitWidthMobile = $('btnFitWidthMobile');
    els.btnActualSize = $('btnActualSize');
    els.zoomDisplay = $('zoomDisplay');
    els.zoomDisplayMobile = $('zoomDisplayMobile');
    els.fitModeLabel = $('fitModeLabel');
    els.btnToggleThumbnails = $('btnToggleThumbnails');
    els.btnToggleBookmarks = $('btnToggleBookmarks');
    els.btnCloseBookmarks = $('btnCloseBookmarks');
    els.thumbnailRail = $('thumbnailRail');
    els.thumbnailContainer = $('thumbnailContainer');
    els.bookmarkPanel = $('bookmarkPanel');
    els.bookmarkTreeDesktop = $('bookmarkTreeDesktop');
    els.bookmarkTreeMobile = $('bookmarkTreeMobile');
    els.bookmarkOffcanvas = $('bookmarkOffcanvas');
    els.pageStage = $('pageStage');
    els.pageLoading = $('pageLoading');
    els.pageMissing = $('pageMissing');
    els.pageImageWrap = $('pageImageWrap');
    els.pageImage = $('pageImage');
  }

  async function loadData() {
    const [outlineRes, manifestRes] = await Promise.all([
      fetch('data/outline.json'),
      fetch('data/page-manifest.json'),
    ]);

    if (!outlineRes.ok) throw new Error('Failed to load outline.json');
    if (!manifestRes.ok) throw new Error('Failed to load page-manifest.json');

    const outlineData = await outlineRes.json();
    const manifestData = await manifestRes.json();

    state.outlineDoc = outlineData;
    state.outline = outlineData.outline || [];
    state.manifest = manifestData;
    state.pageCount = derivePageCount();
  }

  async function init() {
    cacheElements();
    bindEvents();
    updateViewportChrome();

    try {
      await loadData();
    } catch (err) {
      console.error(err);
      els.pageMissing.querySelector('p').textContent =
        'Failed to load document data. Check that data/outline.json and data/page-manifest.json exist.';
      showPageState('missing');
      return;
    }

    renderThumbnails();
    renderBookmarkTrees();
    updateZoomDisplays();

    const hashPage = parseUrlHash();
    const startPage = hashPage || 1;
    goToPage(startPage);

    prefetchSectionStarts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
