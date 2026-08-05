(() => {
  'use strict';

  /* ==========================================================================
     State
     - mediaItems lives only in memory for this tab's page-session — nothing is
       written to disk. Re-opening the app means re-adding your media, which is
       exactly why folders "disappear" until their media is added back.
     - favorites persist in sessionStorage (per browser-tab session only; wiped
       when the tab/browser session ends), keyed by a stable id derived from
       folder path + name + size + last-modified, so favourites naturally
       re-attach if you re-add the same files later in the same session.
     - mediaItems is kept sorted newest-first (by lastModified) at all times,
       so every derived view (All/Photos/Videos/Favourites/Folders) inherits
       that order for free.
     ========================================================================== */

  const mediaItems = [];
  const mediaMap = new Map();
  const favorites = new Set(loadFavorites());

  let currentTab = 'all';
  let currentFolder = null;

  let lightboxList = [];
  let lightboxIndex = 0;

  let contextMenuTargetId = null;

  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif)$/i;
  const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i;

  const TAB_TITLES = {
    all: 'All',
    photos: 'Photos',
    videos: 'Videos',
    favorites: 'Favourites',
    folders: 'Folders',
  };

  /* ------------------------------- DOM refs -------------------------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const topbarTitle = $('#topbarTitle');
  const fileInput = $('#fileInput');
  const folderInput = $('#folderInput');
  const addFilesBtn = $('#addFilesBtn');
  const addFolderBtn = $('#addFolderBtn');

  const tabBtns = $$('.tab-btn');
  const folderBackBtn = $('#folderBackBtn');
  const folderDetailTitle = $('#folderDetailTitle');

  const lightboxEl = $('#lightbox');
  const lightboxStage = $('#lightboxStage');
  const lightboxMedia = $('#lightboxMedia');
  const lightboxCounter = $('#lightboxCounter');
  const lightboxName = $('#lightboxName');
  const lightboxMeta = $('#lightboxMeta');
  const lightboxClose = $('#lightboxClose');
  const lightboxPrev = $('#lightboxPrev');
  const lightboxNext = $('#lightboxNext');
  const lightboxFav = $('#lightboxFav');

  const contextMenu = $('#contextMenu');
  const contextMenuBackdrop = $('#contextMenuBackdrop');

  const infoSheet = $('#infoSheet');
  const infoSheetBackdrop = $('#infoSheetBackdrop');
  const infoName = $('#infoName');
  const infoList = $('#infoList');
  const infoClose = $('#infoClose');

  /* ------------------------------- Utilities -------------------------------- */

  function loadFavorites() {
    try {
      return JSON.parse(sessionStorage.getItem('pv_favorites') || '[]');
    } catch {
      return [];
    }
  }

  function saveFavorites() {
    sessionStorage.setItem('pv_favorites', JSON.stringify(Array.from(favorites)));
  }

  function detectType(file) {
    if (file.type.startsWith('image/')) return 'photo';
    if (file.type.startsWith('video/')) return 'video';
    if (IMAGE_EXT.test(file.name)) return 'photo';
    if (VIDEO_EXT.test(file.name)) return 'video';
    return null;
  }

  function folderPathOf(file) {
    const rel = file.webkitRelativePath || '';
    if (!rel) return '';
    const parts = rel.split('/');
    parts.pop();   // filename
    parts.shift(); // the picked root folder itself isn't a meaningful sub-folder
    return parts.join('/');
  }

  function leafName(path) {
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let val = bytes;
    let i = -1;
    do { val /= 1024; i++; } while (val >= 1024 && i < units.length - 1);
    return `${val.toFixed(1)} ${units[i]}`;
  }

  function formatDate(ts) {
    if (!ts) return 'Unknown date';
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  function sortMediaItems() {
    // Newest first, top-left to bottom-right in the grid.
    mediaItems.sort((a, b) => b.lastModified - a.lastModified);
  }

  /* ==========================================================================
     Thumbnail pipeline — this is the whole ballgame for perf.

     Grid tiles and folder-fan cards NEVER touch the original full-resolution
     file. Instead every item gets a single small, square, pre-cropped JPEG
     thumbnail generated once (cached on the item, shared between every place
     it's shown) and only when it actually scrolls into view. The full-quality
     original (`item.url`) is reserved for the fullscreen lightbox only.

     - createImageBitmap with resize hints does a scaled decode where the
       browser supports it, instead of decoding a full multi-megapixel photo
       just to shrink it afterwards.
     - Video thumbnails are a single captured frame (a cheap <canvas> snapshot
       taken once), never a live <video> element sitting in a grid tile.
     - A small concurrency-limited queue + IntersectionObserver means
       importing hundreds/thousands of files is just an in-memory array push
       + sort — no decoding happens until something is actually scrolled into
       view, and only a few thumbnails are generated at once.
     ========================================================================== */

  const THUMB_SIZE = 360; // output px (square) — small enough to be cheap, sharp enough for a ~2x DPR tile
  const THUMB_QUALITY = 0.72;
  const MAX_CONCURRENT_THUMBS = 3;

  let activeThumbJobs = 0;
  const thumbQueue = [];

  function scheduleThumb(item, onReady) {
    if (item.thumbUrl) { onReady(item.thumbUrl); return; }
    if (item.thumbFailed) { onReady(null); return; }
    if (item.thumbWaiters) {
      item.thumbWaiters.push(onReady);
      return;
    }
    item.thumbWaiters = [onReady];
    thumbQueue.push(item);
    pumpThumbQueue();
  }

  function pumpThumbQueue() {
    while (activeThumbJobs < MAX_CONCURRENT_THUMBS && thumbQueue.length) {
      const item = thumbQueue.shift();
      activeThumbJobs++;
      generateThumb(item)
        .catch(() => null)
        .then((url) => {
          activeThumbJobs--;
          const waiters = item.thumbWaiters || [];
          item.thumbWaiters = null;
          if (!url) item.thumbFailed = true;
          waiters.forEach((fn) => fn(url));
          pumpThumbQueue();
        });
    }
  }

  async function generateThumb(item) {
    const canvas = item.type === 'photo'
      ? await photoToCanvas(item.file, THUMB_SIZE)
      : await videoToCanvas(item);
    if (!canvas) return null;
    const blob = await canvasToBlob(canvas, 'image/jpeg', THUMB_QUALITY);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    item.thumbUrl = url;
    return url;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob(resolve, type, quality);
      else resolve(null);
    });
  }

  // Center-crop-and-scale a source (bitmap/video/img) onto a `size x size` canvas.
  function cropToSquare(source, sw, sh, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const srcSize = Math.min(sw, sh);
    const sx = (sw - srcSize) / 2;
    const sy = (sh - srcSize) / 2;
    ctx.drawImage(source, sx, sy, srcSize, srcSize, 0, 0, size, size);
    return canvas;
  }

  async function photoToCanvas(file, size) {
    let bitmap = null;
    // Try a scaled decode first — far cheaper than decoding the full photo.
    if (window.createImageBitmap) {
      try {
        bitmap = await createImageBitmap(file, {
          resizeWidth: size * 2,
          resizeQuality: 'medium',
          imageOrientation: 'from-image',
        });
      } catch {
        try { bitmap = await createImageBitmap(file); } catch { bitmap = null; }
      }
    }
    if (bitmap) {
      const canvas = cropToSquare(bitmap, bitmap.width, bitmap.height, size);
      if (bitmap.close) bitmap.close();
      return canvas;
    }
    // Fallback for engines without createImageBitmap support.
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = cropToSquare(img, img.naturalWidth, img.naturalHeight, size);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function videoToCanvas(item) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      const url = URL.createObjectURL(item.file);
      let settled = false;

      const finish = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        video.load();
        resolve(val);
      };

      const capture = () => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) { finish(null); return; }
        if (isFinite(video.duration)) item.duration = video.duration;
        try {
          finish(cropToSquare(video, vw, vh, THUMB_SIZE));
        } catch {
          finish(null);
        }
      };

      video.addEventListener('loadeddata', () => {
        if (isFinite(video.duration)) item.duration = video.duration;
        try {
          video.currentTime = Math.min(0.5, (video.duration || 1) * 0.1);
        } catch {
          capture();
        }
      }, { once: true });
      video.addEventListener('seeked', capture, { once: true });
      video.addEventListener('error', () => finish(null));

      const safety = setTimeout(() => finish(null), 6000);
      video.src = url;
    });
  }

  // A single shared observer drives lazy thumbnail loading for every grid,
  // folder-fan, and folder-detail image on the page.
  const tileImgToItem = new WeakMap();
  const thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      thumbObserver.unobserve(img);
      const item = tileImgToItem.get(img);
      tileImgToItem.delete(img);
      if (!item) continue;
      scheduleThumb(item, (url) => applyThumbToImg(img, item, url));
    }
  }, { root: null, rootMargin: '600px 0px', threshold: 0.01 });

  function applyThumbToImg(img, item, url) {
    if (!img.isConnected) return;
    if (url) {
      img.src = url;
      requestAnimationFrame(() => img.classList.add('loaded'));
    }
    if (item.type === 'video' && item.duration != null) {
      const badge = img.parentElement && img.parentElement.querySelector('.dur');
      if (badge) badge.textContent = formatDuration(item.duration);
    }
  }

  // Attach a lazily-loaded thumbnail <img> to a tile-ish container.
  function makeThumbImg(item, alt) {
    const img = document.createElement('img');
    img.className = 'tile-thumb';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = alt || item.name;
    if (item.thumbUrl) {
      img.src = item.thumbUrl;
      img.classList.add('loaded');
    } else {
      tileImgToItem.set(img, item);
      thumbObserver.observe(img);
    }
    return img;
  }

  /* ------------------------------- Adding media ------------------------------- */

  addFilesBtn.addEventListener('click', () => fileInput.click());
  addFolderBtn.addEventListener('click', () => folderInput.click());

  fileInput.addEventListener('change', (e) => {
    processFiles(e.target.files, false);
    fileInput.value = '';
  });
  folderInput.addEventListener('change', (e) => {
    processFiles(e.target.files, true);
    folderInput.value = '';
  });

  function processFiles(fileList, fromFolder) {
    // Pure in-memory bookkeeping only — no decoding happens here, which is
    // why adding even a large batch of files stays fast. Thumbnails are
    // generated lazily, on demand, as tiles actually scroll into view.
    let added = 0;
    for (const file of Array.from(fileList)) {
      const type = detectType(file);
      if (!type) continue;
      const folderPath = fromFolder ? folderPathOf(file) : '';
      const id = `${folderPath}|${file.name}|${file.size}|${file.lastModified}`;
      if (mediaMap.has(id)) continue;
      const url = URL.createObjectURL(file);
      const item = {
        id, url, file, name: file.name, size: file.size, folderPath, type,
        lastModified: file.lastModified || Date.now(),
        duration: null,
        thumbUrl: null,
        thumbFailed: false,
        thumbWaiters: null,
      };
      mediaItems.push(item);
      mediaMap.set(id, item);
      added++;
    }
    if (added) {
      sortMediaItems();
      renderActive();
    }
  }

  function removeItem(id) {
    const idx = mediaItems.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const [item] = mediaItems.splice(idx, 1);
    mediaMap.delete(id);
    favorites.delete(id);
    saveFavorites();
    URL.revokeObjectURL(item.url);
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    renderActive();
  }

  /* --------------------------------- Tabs ----------------------------------- */

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  function setActiveTab(tab) {
    currentTab = tab;
    currentFolder = null;
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#view-${tab}`).classList.add('active');
    topbarTitle.textContent = TAB_TITLES[tab];
    renderActive();
  }

  folderBackBtn.addEventListener('click', () => setActiveTab('folders'));

  function openFolder(path) {
    currentFolder = path;
    $$('.view').forEach((v) => v.classList.remove('active'));
    $('#view-folder-detail').classList.add('active');
    folderDetailTitle.textContent = leafName(path);
    topbarTitle.textContent = leafName(path);
    renderFolderDetail();
  }

  function renderActive() {
    if (currentFolder !== null) {
      renderFolderDetail();
      return;
    }
    switch (currentTab) {
      case 'all':
        renderGrid('all', mediaItems);
        break;
      case 'photos':
        renderGrid('photos', mediaItems.filter((i) => i.type === 'photo'));
        break;
      case 'videos':
        renderGrid('videos', mediaItems.filter((i) => i.type === 'video'));
        break;
      case 'favorites':
        renderGrid('favorites', mediaItems.filter((i) => favorites.has(i.id)));
        break;
      case 'folders':
        renderFolders();
        break;
    }
  }

  /* --------------------------- Progressive rendering --------------------------- */

  // Rebuilding a grid of hundreds/thousands of tiles in one synchronous pass
  // is itself a source of jank, so we build it in small chunks across idle
  // frames instead of blocking the main thread. `renderGen` lets a stale,
  // still-running chunk loop bail out the moment a newer render supersedes it
  // (e.g. rapidly switching tabs).
  let renderGen = 0;
  const CHUNK_SIZE = 60;

  function fillGridProgressively(gridEl, items, buildFn) {
    gridEl.innerHTML = '';
    const gen = ++renderGen;
    let i = 0;
    const schedule = window.requestIdleCallback || ((fn) => requestAnimationFrame(fn));
    function step() {
      if (gen !== renderGen) return; // superseded by a newer render
      const frag = document.createDocumentFragment();
      const end = Math.min(i + CHUNK_SIZE, items.length);
      for (; i < end; i++) frag.appendChild(buildFn(items[i]));
      gridEl.appendChild(frag);
      if (i < items.length) schedule(step);
    }
    step();
  }

  /* ------------------------------- Grid render -------------------------------- */

  function renderGrid(viewKey, items) {
    const section = $(`#view-${viewKey}`);
    const gridEl = $('.tile-grid', section);
    const emptyEl = $('.empty-state', section);

    if (!items.length) {
      gridEl.innerHTML = '';
      gridEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = emptyStateHTML(viewKey);
      bindEmptyStateCTA(emptyEl);
      return;
    }

    gridEl.hidden = false;
    emptyEl.hidden = true;
    fillGridProgressively(gridEl, items, (item) => buildTile(item, items));
  }

  function renderFolderDetail() {
    const items = currentFolder === null ? [] : mediaItems.filter((i) => i.folderPath === currentFolder);
    const section = $('#view-folder-detail');
    const gridEl = $('.tile-grid', section);
    const emptyEl = $('.empty-state', section);

    if (!items.length) {
      gridEl.innerHTML = '';
      gridEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = `
        <svg class="icon"><use href="#icon-folders"/></svg>
        <h3>This folder is empty</h3>
        <p>Once media is added back to this folder it will show up here again.</p>`;
      return;
    }

    gridEl.hidden = false;
    emptyEl.hidden = true;
    fillGridProgressively(gridEl, items, (item) => buildTile(item, items));
  }

  function buildTile(item, contextList) {
    const tile = document.createElement('div');
    tile.className = 'tile' + (favorites.has(item.id) ? ' is-favorite' : '');
    tile.dataset.id = item.id;

    tile.appendChild(makeThumbImg(item));

    if (item.type === 'video') {
      const badge = document.createElement('div');
      badge.className = 'video-badge';
      badge.innerHTML = `<svg class="icon"><use href="#icon-play"/></svg><span class="dur">${item.duration != null ? formatDuration(item.duration) : '--:--'}</span>`;
      tile.appendChild(badge);
    }

    const favBtn = document.createElement('button');
    favBtn.className = 'fav-btn';
    favBtn.setAttribute('aria-label', 'Toggle favourite');
    favBtn.innerHTML = '<svg class="icon"><use href="#icon-favorites"/></svg>';
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(item.id);
    });
    tile.appendChild(favBtn);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-btn';
    menuBtn.setAttribute('aria-label', 'More options');
    menuBtn.innerHTML = '<svg class="icon"><use href="#icon-dots"/></svg>';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openContextMenu(item.id, menuBtn);
    });
    tile.appendChild(menuBtn);

    tile.addEventListener('click', () => openLightbox(contextList, contextList.indexOf(item)));

    return tile;
  }

  function toggleFavorite(id) {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    saveFavorites();
    renderActive();
    if (!lightboxEl.hidden) updateLightboxFavState();
  }

  /* -------------------------------- Empty states -------------------------------- */

  function emptyStateHTML(viewKey) {
    switch (viewKey) {
      case 'all':
        return `
          <svg class="icon"><use href="#icon-all"/></svg>
          <h3>No media yet</h3>
          <p>Add photos, videos, or a whole folder from this device to get started.</p>
          <button class="btn-primary empty-cta" data-action="add-folder">Add a Folder</button>`;
      case 'photos':
        return `
          <svg class="icon"><use href="#icon-photos"/></svg>
          <h3>No photos yet</h3>
          <p>Photos you add will show up here.</p>`;
      case 'videos':
        return `
          <svg class="icon"><use href="#icon-videos"/></svg>
          <h3>No videos yet</h3>
          <p>Videos you add will show up here.</p>`;
      case 'favorites':
        return `
          <svg class="icon"><use href="#icon-favorites"/></svg>
          <h3>No favourites yet</h3>
          <p>Tap the heart on any photo or video to add it here. Favourites last for this session only.</p>`;
      case 'folders':
        return `
          <svg class="icon"><use href="#icon-folders"/></svg>
          <h3>No folders yet</h3>
          <p>Add a folder from this device — folders only show up while their media is present.</p>
          <button class="btn-primary empty-cta" data-action="add-folder">Add a Folder</button>`;
      default:
        return '';
    }
  }

  function bindEmptyStateCTA(emptyEl) {
    const cta = $('.empty-cta', emptyEl);
    if (!cta) return;
    cta.addEventListener('click', () => {
      if (cta.dataset.action === 'add-folder') folderInput.click();
      else fileInput.click();
    });
  }

  /* --------------------------------- Folders ----------------------------------- */

  function getFolderMap() {
    // mediaItems is already newest-first, so every folder's item list — and
    // therefore its fan-out sample and its detail view — inherits that order.
    const map = new Map();
    for (const item of mediaItems) {
      if (!item.folderPath) continue;
      if (!map.has(item.folderPath)) map.set(item.folderPath, []);
      map.get(item.folderPath).push(item);
    }
    return map;
  }

  function renderFolders() {
    const section = $('#view-folders');
    const gridEl = $('.folder-grid', section);
    const emptyEl = $('.empty-state', section);
    const folderMap = getFolderMap();
    const folderPaths = Array.from(folderMap.keys()).sort((a, b) => a.localeCompare(b));

    if (!folderPaths.length) {
      gridEl.innerHTML = '';
      gridEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = emptyStateHTML('folders');
      bindEmptyStateCTA(emptyEl);
      return;
    }

    gridEl.hidden = false;
    emptyEl.hidden = true;
    fillGridProgressively(gridEl, folderPaths, (path) => buildFolderCard(path, folderMap.get(path)));
  }

  function buildFolderCard(path, items) {
    const card = document.createElement('div');
    card.className = 'folder-card';

    const fan = document.createElement('div');
    fan.className = 'folder-fan';
    const sample = items.slice(0, 5); // newest 5, since `items` is already newest-first
    const n = sample.length;
    sample.forEach((item, i) => {
      const offset = i - (n - 1) / 2;
      const c = document.createElement('div');
      c.className = 'fan-card';
      c.style.setProperty('--dx', `${offset * 26}px`);
      c.style.setProperty('--rot', `${offset * 12}deg`);
      c.style.zIndex = String(10 - Math.round(Math.abs(offset) * 2));
      c.appendChild(makeThumbImg(item));
      fan.appendChild(c);
    });
    card.appendChild(fan);

    const name = document.createElement('div');
    name.className = 'folder-name';
    name.textContent = leafName(path);
    card.appendChild(name);

    const count = document.createElement('div');
    count.className = 'folder-count';
    count.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    card.appendChild(count);

    card.addEventListener('click', () => openFolder(path));
    return card;
  }

  /* -------------------------------- Lightbox ------------------------------------ */
  // The lightbox always uses the full-quality original (item.url) — only the
  // small grid/folder previews are downscaled.

  function openLightbox(list, index) {
    lightboxList = list;
    lightboxIndex = index;
    lightboxEl.hidden = false;
    document.body.style.overflow = 'hidden';
    renderLightbox();
  }

  function closeLightbox() {
    lightboxEl.hidden = true;
    lightboxMedia.innerHTML = '';
    document.body.style.overflow = '';
  }

  function renderLightbox() {
    const item = lightboxList[lightboxIndex];
    if (!item) { closeLightbox(); return; }

    lightboxMedia.innerHTML = '';
    let el;
    if (item.type === 'photo') {
      el = document.createElement('img');
      el.src = item.url;
      el.alt = item.name;
    } else {
      el = document.createElement('video');
      el.src = item.url;
      el.controls = true;
      el.autoplay = true;
      el.playsInline = true;
    }
    lightboxMedia.appendChild(el);

    lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxList.length}`;
    lightboxName.textContent = item.name;
    lightboxMeta.textContent = [item.folderPath || null, formatBytes(item.size), formatDate(item.lastModified)]
      .filter(Boolean).join(' · ');

    lightboxPrev.disabled = lightboxIndex <= 0;
    lightboxNext.disabled = lightboxIndex >= lightboxList.length - 1;

    updateLightboxFavState();
  }

  function updateLightboxFavState() {
    const item = lightboxList[lightboxIndex];
    if (!item) return;
    lightboxFav.classList.toggle('is-favorite', favorites.has(item.id));
  }

  function lightboxStep(delta) {
    const next = lightboxIndex + delta;
    if (next < 0 || next >= lightboxList.length) return;
    lightboxIndex = next;
    renderLightbox();
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightboxPrev.addEventListener('click', () => lightboxStep(-1));
  lightboxNext.addEventListener('click', () => lightboxStep(1));
  lightboxFav.addEventListener('click', () => {
    const item = lightboxList[lightboxIndex];
    if (item) toggleFavorite(item.id);
  });

  document.addEventListener('keydown', (e) => {
    if (lightboxEl.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') lightboxStep(-1);
    else if (e.key === 'ArrowRight') lightboxStep(1);
  });

  // Swipe left/right through the lightbox
  (function enableLightboxSwipe() {
    let startX = 0, startY = 0, tracking = false, locked = null;
    lightboxStage.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      locked = null;
    }, { passive: true });

    lightboxStage.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (locked === null) locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }, { passive: true });

    lightboxStage.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      if (locked === 'x' && Math.abs(dx) > 50) {
        if (dx < 0) lightboxStep(1); else lightboxStep(-1);
      }
    });
  })();

  /* ------------------------------ Swipe between tabs -------------------------- */

  (function enableTabSwipe() {
    const order = ['all', 'photos', 'videos', 'favorites', 'folders'];
    const content = $('#content');
    let startX = 0, startY = 0, tracking = false, locked = null;

    content.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || currentFolder !== null) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      locked = null;
    }, { passive: true });

    content.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        locked = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
      }
    }, { passive: true });

    content.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      if (locked !== 'x') return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < 60) return;
      const idx = order.indexOf(currentTab);
      if (dx < 0 && idx < order.length - 1) setActiveTab(order[idx + 1]);
      else if (dx > 0 && idx > 0) setActiveTab(order[idx - 1]);
    });
  })();

  /* ------------------------------- Context menu -------------------------------- */

  function openContextMenu(id, anchorEl) {
    contextMenuTargetId = id;
    const isFav = favorites.has(id);
    const favBtn = $('[data-action="favorite"]', contextMenu);
    favBtn.classList.toggle('is-favorite', isFav);
    $('span', favBtn).textContent = isFav ? 'Remove from Favourites' : 'Add to Favourites';

    contextMenu.hidden = false;
    contextMenuBackdrop.hidden = false;

    const rect = anchorEl.getBoundingClientRect();
    const menuRect = contextMenu.getBoundingClientRect();
    let left = rect.right - menuRect.width;
    let top = rect.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
    if (top + menuRect.height > window.innerHeight - 8) top = rect.top - menuRect.height - 6;
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
  }

  function closeContextMenu() {
    contextMenu.hidden = true;
    contextMenuBackdrop.hidden = true;
    contextMenuTargetId = null;
  }

  contextMenuBackdrop.addEventListener('click', closeContextMenu);

  $$('#contextMenu button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = contextMenuTargetId;
      const action = btn.dataset.action;
      closeContextMenu();
      if (!id) return;
      if (action === 'favorite') toggleFavorite(id);
      else if (action === 'remove') removeItem(id);
      else if (action === 'info') openInfo(id);
    });
  });

  /* --------------------------------- Info sheet --------------------------------- */

  function openInfo(id) {
    const item = mediaMap.get(id);
    if (!item) return;
    infoName.textContent = item.name;
    infoList.innerHTML = '';
    const rows = [
      ['Type', item.type === 'photo' ? 'Photo' : 'Video'],
      ['Folder', item.folderPath || '—'],
      ['Size', formatBytes(item.size)],
      ['Modified', formatDate(item.lastModified)],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      infoList.appendChild(dt);
      infoList.appendChild(dd);
    }
    infoSheet.hidden = false;
    infoSheetBackdrop.hidden = false;
  }

  function closeInfo() {
    infoSheet.hidden = true;
    infoSheetBackdrop.hidden = true;
  }

  infoClose.addEventListener('click', closeInfo);
  infoSheetBackdrop.addEventListener('click', closeInfo);

  /* ---------------------------------- Init --------------------------------------- */

  setActiveTab('all');
})();
