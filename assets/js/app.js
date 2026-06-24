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
  const SCROLL_SYNC_LOCK_MS = 600;
  const DEFAULT_PAGE_ASPECT = 1445 / 1870;

  const THEME_STORAGE_KEY = 'viewer-theme';

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
    bookmarkSearchQuery: '',
    theme: 'light',
    scrollSyncLocked: false,
    pageStreamBuilt: false,
  };

  let pageLoadObserver = null;
  let pageTrackObserver = null;
  let scrollRafId = 0;

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

  function validatePageInput(input) {
    const raw = String(input.value).trim();
    const n = parseInt(raw, 10);
    const invalid = raw === '' || Number.isNaN(n) || n < 1 || n > state.pageCount;
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    return !invalid;
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

  function getDefaultPageSize() {
    if (state.manifest?.pages) {
      for (const key of Object.keys(state.manifest.pages)) {
        const entry = state.manifest.pages[key];
        if (entry?.width && entry?.height) {
          return { width: entry.width, height: entry.height };
        }
      }
    }
    return { width: 1445, height: 1870 };
  }

  function zoomStreamClass() {
    switch (state.fitMode) {
      case 'fitPage':
        return 'zoom-fit-page';
      case 'actual':
        return 'zoom-actual';
      case 'custom':
        return 'zoom-custom';
      default:
        return 'zoom-fit-width';
    }
  }

  function applyZoomToStream() {
    if (!els.pageStream) return;

    els.pageStream.classList.remove('zoom-fit-width', 'zoom-fit-page', 'zoom-actual', 'zoom-custom');
    els.pageStream.classList.add(zoomStreamClass());

    if (state.fitMode === 'actual' || state.fitMode === 'custom') {
      const scale = state.fitMode === 'actual' ? 1 : state.zoomLevel / 100;
      els.pageStream.querySelectorAll('.page-slot .page-image').forEach((img) => {
        const slot = img.closest('.page-slot');
        const pageNum = parseInt(slot?.dataset.page || '0', 10);
        const entry = getManifestEntry(pageNum);
        const w = entry?.width || img.naturalWidth || getDefaultPageSize().width;
        const h = entry?.height || img.naturalHeight || getDefaultPageSize().height;
        img.style.width = `${Math.round(w * scale)}px`;
        img.style.height = `${Math.round(h * scale)}px`;
      });
    } else {
      els.pageStream.querySelectorAll('.page-slot .page-image').forEach((img) => {
        img.style.width = '';
        img.style.height = '';
      });
    }
  }

  function setStreamLoading(loading) {
    if (els.pageStreamLoading) {
      els.pageStreamLoading.classList.toggle('d-none', !loading);
    }
    if (els.pageStream) {
      els.pageStream.classList.toggle('d-none', loading);
    }
  }

  function createMissingSlotContent(pageNum) {
    const wrap = document.createElement('div');
    wrap.className = 'page-slot-missing';
    wrap.innerHTML = `
      <i class="bi bi-file-earmark-image" aria-hidden="true"></i>
      <p>Page image not rendered yet.</p>
      <span class="page-slot-label">Page ${pageNum}</span>
    `;
    return wrap;
  }

  function hydratePageSlot(slot) {
    if (!slot || slot.dataset.hydrated === 'true') return;

    const pageNum = parseInt(slot.dataset.page, 10);
    const entry = getManifestEntry(pageNum);
    const inner = slot.querySelector('.page-slot-inner');
    if (!inner) return;

    slot.dataset.hydrated = 'true';

    inner.style.aspectRatio = '';
    inner.style.minHeight = '';

    if (!entry?.image) {
      inner.appendChild(createMissingSlotContent(pageNum));
      return;
    }

    const img = document.createElement('img');
    img.className = 'page-image';
    img.alt = `Page ${pageNum} of ${state.pageCount}`;
    img.draggable = false;
    img.decoding = 'async';
    img.addEventListener('contextmenu', (e) => e.preventDefault());
    img.addEventListener('load', () => {
      applyZoomToStream();
    });
    img.addEventListener('error', () => {
      inner.innerHTML = '';
      inner.appendChild(createMissingSlotContent(pageNum));
    });

    const imageUrl = resolveAssetUrl(entry.image);
    img.src = imageUrl;
    if (state.imageCache.has(imageUrl)) {
      img.loading = 'eager';
    } else {
      img.loading = 'lazy';
    }
    inner.appendChild(img);
  }

  function buildPageStream() {
    if (!els.pageStream) return;

    setStreamLoading(true);
    els.pageStream.innerHTML = '';

    const defaultSize = getDefaultPageSize();
    const aspect = defaultSize.width / defaultSize.height;

    for (let pageNum = 1; pageNum <= state.pageCount; pageNum += 1) {
      const slot = document.createElement('section');
      slot.className = 'page-slot';
      slot.id = `page-slot-${pageNum}`;
      slot.dataset.page = String(pageNum);
      slot.setAttribute('aria-label', `Page ${pageNum}`);

      const inner = document.createElement('div');
      inner.className = 'page-slot-inner';
      inner.style.aspectRatio = String(aspect);
      inner.style.minHeight = '120px';

      slot.appendChild(inner);
      els.pageStream.appendChild(slot);
    }

    setupPageObservers();
    applyZoomToStream();
    state.pageStreamBuilt = true;
    setStreamLoading(false);
  }

  function setupPageObservers() {
    if (pageLoadObserver) pageLoadObserver.disconnect();
    if (pageTrackObserver) pageTrackObserver.disconnect();

    pageLoadObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            hydratePageSlot(entry.target);
          }
        }
      },
      {
        root: els.readingPane,
        rootMargin: '900px 0px',
        threshold: 0,
      }
    );

    pageTrackObserver = new IntersectionObserver(
      (entries) => {
        if (state.scrollSyncLocked) return;

        let bestPage = null;
        let bestRatio = 0;

        for (const entry of entries) {
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestPage = parseInt(entry.target.dataset.page, 10);
          }
        }

        if (bestPage && bestRatio > 0.15) {
          setCurrentPageFromScroll(bestPage);
        }
      },
      {
        root: els.readingPane,
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0, 0.15, 0.35, 0.55, 0.75, 1],
      }
    );

    els.pageStream.querySelectorAll('.page-slot').forEach((slot) => {
      pageLoadObserver.observe(slot);
      pageTrackObserver.observe(slot);
    });
  }

  function setCurrentPageFromScroll(page) {
    const target = clampPage(page);
    if (target === state.currentPage) return;

    state.currentPage = target;

    const bm = findBookmarkForPage(target);
    if (bm) {
      setActiveBookmark(bm.id);
      updateExpandedSectionsUI();
      updateBookmarkHighlight();
      scrollActiveBookmarkIntoView();
    }

    updatePageDisplays();
    updateThumbnailHighlight();
    updateUrlHash();
    prefetchAdjacent();
  }

  function scrollToPageSlot(page, smooth) {
    const slot = document.getElementById(`page-slot-${page}`);
    if (!slot || !els.readingPane) return;

    state.scrollSyncLocked = true;
    slot.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });

    window.setTimeout(() => {
      state.scrollSyncLocked = false;
    }, smooth ? SCROLL_SYNC_LOCK_MS : 80);
  }

  function handleReadingPaneScroll() {
    if (state.scrollSyncLocked || !els.readingPane) return;

    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0;
      const pane = els.readingPane;
      const centerY = pane.scrollTop + pane.clientHeight * 0.35;
      const slots = els.pageStream?.querySelectorAll('.page-slot');
      if (!slots?.length) return;

      let bestPage = state.currentPage;
      let bestDistance = Infinity;

      slots.forEach((slot) => {
        const top = slot.offsetTop;
        const height = slot.offsetHeight || 1;
        const mid = top + height / 2;
        const distance = Math.abs(mid - centerY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = parseInt(slot.dataset.page, 10);
        }
      });

      setCurrentPageFromScroll(bestPage);
    });
  }

  function syncPageView(options = {}) {
    const smooth = options.smooth !== false;
    scrollToPageSlot(state.currentPage, smooth);
    hydratePageSlot(document.getElementById(`page-slot-${state.currentPage}`));
    updatePageDisplays();
    updateThumbnailHighlight();
    updateBookmarkHighlight();
    updateUrlHash();
    prefetchAdjacent();
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

  function goToPage(page, bookmarkId, options = {}) {
    const target = clampPage(page);
    const distance = Math.abs(target - state.currentPage);
    const smooth =
      options.smooth !== false && !options.instant && distance > 0 && distance <= 3;

    if (bookmarkId) {
      setActiveBookmark(bookmarkId);
      prefetchPages(getSiblingPages(bookmarkId));
    } else if (target !== state.currentPage) {
      const bm = findBookmarkForPage(target);
      if (bm) {
        setActiveBookmark(bm.id);
      }
    }

    state.currentPage = target;

    updateExpandedSectionsUI();
    updateBookmarkHighlight();
    scrollActiveBookmarkIntoView();

    if (!state.pageStreamBuilt) return;

    syncPageView({ smooth });
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

  function filterBookmarkTrees(query) {
    const q = query.trim().toLowerCase();
    state.bookmarkSearchQuery = q;

    [els.bookmarkTreeDesktop, els.bookmarkTreeMobile].forEach((tree) => {
      if (!tree) return;

      tree.querySelectorAll('.bookmark-section').forEach((sec) => {
        const sectionId = sec.dataset.sectionId;
        const sectionTitle =
          sec.querySelector('.bookmark-parent .bookmark-title')?.textContent.toLowerCase() || '';
        const sectionMatches = !q || sectionTitle.includes(q);
        let childMatches = false;

        sec.querySelectorAll('.bookmark-children .bookmark-row').forEach((row) => {
          const childTitle = row.querySelector('.bookmark-title')?.textContent.toLowerCase() || '';
          const match = !q || sectionMatches || childTitle.includes(q);
          row.classList.toggle('bookmark-filter-hidden', !match);
          if (childTitle.includes(q)) childMatches = true;
        });

        const sectionVisible = !q || sectionMatches || childMatches;
        sec.classList.toggle('bookmark-filter-hidden', !sectionVisible);

        if (q && childMatches && !sectionMatches) {
          state.expandedSections.add(sectionId);
        }
      });
    });

    if (q) updateExpandedSectionsUI();
  }

  function focusBookmarkSearch() {
    if (isMobile()) {
      const offcanvas = bootstrap.Offcanvas.getOrCreateInstance(els.bookmarkOffcanvas);
      offcanvas.show();
      setTimeout(() => els.bookmarkSearchMobile?.focus(), 300);
    } else {
      if (!state.bookmarkPanelOpen) {
        state.bookmarkPanelOpen = true;
        els.bookmarkPanel.classList.remove('collapsed');
        syncBookmarkToggleState(true);
      }
      els.bookmarkSearch?.focus();
    }
  }

  function bindBookmarkSearch(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      filterBookmarkTrees(input.value);
      const other = input === els.bookmarkSearch ? els.bookmarkSearchMobile : els.bookmarkSearch;
      if (other && other.value !== input.value) other.value = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        filterBookmarkTrees('');
        input.blur();
      }
    });
  }

  function renderBookmarkTrees() {
    const html = state.outline.map(renderBookmarkSection).join('');
    els.bookmarkTreeDesktop.innerHTML = html;
    els.bookmarkTreeMobile.innerHTML = html;
    bindBookmarkEvents(els.bookmarkTreeDesktop);
    bindBookmarkEvents(els.bookmarkTreeMobile);
    if (state.bookmarkSearchQuery) {
      filterBookmarkTrees(state.bookmarkSearchQuery);
    }
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
    applyZoomToStream();
  }

  function setZoom(level) {
    state.zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    state.fitMode = 'custom';
    updateZoomDisplays();
    applyZoomToStream();
  }

  function syncBookmarkToggleState(isOpen) {
    els.btnToggleBookmarks.classList.toggle('active', isOpen);
    els.btnToggleBookmarks.setAttribute('aria-pressed', String(isOpen));
  }

  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    state.theme = next;
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (_) {
      /* ignore storage errors */
    }
    updateThemeUI();
  }

  function loadStoredTheme() {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch (_) {
      /* ignore */
    }
    return 'light';
  }

  function updateThemeUI() {
    const isDark = state.theme === 'dark';
    if (els.btnThemeToggle) {
      els.btnThemeToggle.querySelector('.theme-icon-light')?.classList.toggle('d-none', isDark);
      els.btnThemeToggle.querySelector('.theme-icon-dark')?.classList.toggle('d-none', !isDark);
      els.btnThemeToggle.setAttribute(
        'title',
        isDark ? 'Switch to light theme' : 'Switch to dark theme'
      );
    }
    document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      const active = btn.dataset.themeChoice === state.theme;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    });
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
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
      input.addEventListener('input', () => validatePageInput(input));
      input.addEventListener('blur', () => {
        if (!validatePageInput(input)) {
          input.value = state.currentPage;
          input.setAttribute('aria-invalid', 'false');
        }
      });
      const handler = () => {
        if (!validatePageInput(input)) {
          input.value = state.currentPage;
          input.setAttribute('aria-invalid', 'false');
          return;
        }
        const val = clampPage(input.value);
        input.value = val;
        input.setAttribute('aria-invalid', 'false');
        goToPage(val, null, { instant: true });
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
    if (els.btnSearch) {
      els.btnSearch.addEventListener('click', focusBookmarkSearch);
    }
    if (els.btnThemeToggle) {
      els.btnThemeToggle.addEventListener('click', toggleTheme);
    }
    document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice));
    });
    if (els.menuToggleThumbnails) {
      els.menuToggleThumbnails.addEventListener('click', toggleThumbnails);
    }
    bindBookmarkSearch(els.bookmarkSearch);
    bindBookmarkSearch(els.bookmarkSearchMobile);
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

    window.addEventListener('hashchange', () => {
      const page = parseUrlHash();
      if (page && page !== state.currentPage) {
        goToPage(page, null, { instant: true });
      }
    });

    window.addEventListener('resize', () => {
      updateViewportChrome();
      applyZoomToStream();
    });

    if (els.readingPane) {
      els.readingPane.addEventListener('scroll', handleReadingPaneScroll, { passive: true });
    }
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
    els.readingPane = $('readingPane');
    els.pageStream = $('pageStream');
    els.pageStreamLoading = $('pageStreamLoading');
    els.btnSearch = $('btnSearch');
    els.btnThemeToggle = $('btnThemeToggle');
    els.menuToggleThumbnails = $('menuToggleThumbnails');
    els.bookmarkSearch = $('bookmarkSearch');
    els.bookmarkSearchMobile = $('bookmarkSearchMobile');
  }

  async function loadData() {
    let outlineLoaded = false;

    try {
      const outlineRes = await fetch('data/outline.json');
      if (!outlineRes.ok) throw new Error('Failed to load outline.json');
      const outlineData = await outlineRes.json();
      state.outlineDoc = outlineData;
      state.outline = outlineData.outline || [];
      outlineLoaded = true;
    } catch (err) {
      console.error(err);
      throw err;
    }

    try {
      const manifestRes = await fetch('data/page-manifest.json');
      if (manifestRes.ok) {
        state.manifest = await manifestRes.json();
      } else {
        console.warn('page-manifest.json not found; viewer will show missing-page placeholders.');
        state.manifest = { document: { pageCount: state.outlineDoc?.document?.pageCount || 0 }, pages: {} };
      }
    } catch (err) {
      console.warn('Failed to load page-manifest.json', err);
      state.manifest = { document: { pageCount: state.outlineDoc?.document?.pageCount || 0 }, pages: {} };
    }

    state.pageCount = derivePageCount();
    return outlineLoaded;
  }

  async function init() {
    cacheElements();
    applyTheme(loadStoredTheme());
    bindEvents();
    updateViewportChrome();
    setStreamLoading(true);

    try {
      await loadData();
    } catch (err) {
      console.error(err);
      setStreamLoading(false);
      if (els.pageStream) {
        els.pageStream.innerHTML =
          '<p class="page-stream-error">Failed to load document data. Check that data/outline.json exists.</p>';
      }
      return;
    }

    renderThumbnails();
    renderBookmarkTrees();
    updateZoomDisplays();

    buildPageStream();

    const hashPage = parseUrlHash();
    const startPage = hashPage || 1;
    state.currentPage = startPage;

    const bm = findBookmarkForPage(startPage);
    if (bm) {
      setActiveBookmark(bm.id);
      updateExpandedSectionsUI();
      updateBookmarkHighlight();
    }

    updatePageDisplays();
    scrollToPageSlot(startPage, false);
    hydratePageSlot(document.getElementById(`page-slot-${startPage}`));
    updateThumbnailHighlight();
    updateUrlHash();
    prefetchSectionStarts();
    prefetchAdjacent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
