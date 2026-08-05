(() => {
  'use strict';

  /* ==========================================================================
     State
     - mediaItems (the actual photo/video File objects) lives only in memory —
       nothing is or can be written to disk for these. No web page, in any
       browser or embedded WebView, can silently re-read files off your
       device without you explicitly picking them again — that's a browser
       security boundary, not a limitation of this app. Re-opening the app
       always means re-adding your photos/videos via "Add Photos & Videos".
     - Favourites, folders (the ones YOU create), and which item is in which
       folder are small JSON metadata, and DO persist automatically across
       app restarts — no action needed from you — via a layered store (see
       "Persistence" below): IndexedDB first, falling back to localStorage,
       falling back to in-memory-only if neither is available in whatever
       WebView is hosting the page. A folder only ever appears in the
       Folders tab while at least one of its items is currently loaded —
       re-add the same file later and it snaps straight back into the
       folder you put it in, because the id is stable (name + size +
       last-modified), regardless of which storage tier actually held it.
     - mediaItems is kept sorted newest-first (by lastModified) at all times,
       so every derived view (All/Photos/Videos/Favourites/Folders) inherits
       that order for free.
     ========================================================================== */

  const mediaItems = [];
  const mediaMap = new Map();
  // Start empty and render immediately; hydrateFromStorage() (called at the
  // bottom of this file) fills these in asynchronously once the layered
  // store resolves. See "Persistence" below for why this has to be async,
  // and why nothing needs to wait on it.
  const favorites = new Set();
  let folders = [];          // [{ id, name }]
  let assignments = {};      // { itemId: folderId }

  let currentTab = 'all';
  let currentFolder = null; // folder id, while drilled into a folder's detail view

  let lightboxList = [];
  let lightboxIndex = 0;

  let contextMenuTargetId = null;
  let folderMenuTargetId = null;
  let moveSheetItemIds = [];
  let folderSheetMode = null;         // 'create' | 'rename'
  let folderSheetTargetFolderId = null;
  let folderSheetAssignItemIds = null;

  let selectMode = false;
  const selectedIds = new Set();

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
  const addFilesBtn = $('#addFilesBtn');
  const newFolderBtn = $('#newFolderBtn');
  const selectModeBtn = $('#selectModeBtn');
  const selectAllBtn = $('#selectAllBtn');
  const cancelSelectBtn = $('#cancelSelectBtn');

  const mainTabbar = $('#mainTabbar');
  const selectActionBar = $('#selectActionBar');
  const selectFavBtn = $('#selectFavBtn');
  const selectMoveBtn = $('#selectMoveBtn');
  const selectRemoveBtn = $('#selectRemoveBtn');

  const tabBtns = $$('.tab-btn', mainTabbar);
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
  const folderContextMenu = $('#folderContextMenu');
  const folderContextMenuBackdrop = $('#folderContextMenuBackdrop');

  const infoSheet = $('#infoSheet');
  const infoSheetBackdrop = $('#infoSheetBackdrop');
  const infoName = $('#infoName');
  const infoList = $('#infoList');
  const infoClose = $('#infoClose');

  const folderNameSheet = $('#folderNameSheet');
  const folderNameBackdrop = $('#folderNameBackdrop');
  const folderNameTitle = $('#folderNameTitle');
  const folderNameInput = $('#folderNameInput');
  const folderNameCreate = $('#folderNameCreate');
  const folderNameCancel = $('#folderNameCancel');

  const moveSheet = $('#moveSheet');
  const moveSheetBackdrop = $('#moveSheetBackdrop');
  const moveFolderList = $('#moveFolderList');

  /* ==========================================================================
     Persistence — IndexedDB, falling back to localStorage, falling back to
     in-memory-only. Every layer is wrapped so a failure anywhere in the
     chain degrades quietly instead of throwing.

     Why layered: some embedded WebViews (this shows up with file:// pages on
     iOS/Android in particular) throw a SecurityError on ANY Web Storage
     access — not a quota issue, an outright block — and IndexedDB is a
     separate API that isn't always blocked under the same restriction, so
     it's tried first. If a save call ever threw uncaught, every function
     that calls it — toggleFavorite, createFolder, assignToFolder, etc. —
     would abort right there, so the rest of that action (updating the UI,
     closing a sheet) would never run. That looks exactly like "favourites/
     folders don't save", except it's not a persistence problem, it's the
     action itself silently failing. So: nothing here is ever allowed to
     throw past this module, regardless of which tier is actually available.
     ========================================================================== */

  const IDB_NAME = 'pv-store';
  const IDB_VERSION = 1;
  const IDB_STORE = 'kv';

  let dbOpenPromise = null; // memoized — only ever attempt indexedDB.open() once

  function openIdb() {
    if (dbOpenPromise) return dbOpenPromise;
    dbOpenPromise = new Promise((resolve) => {
      if (!window.indexedDB) { resolve(null); return; }
      let req;
      try {
        req = indexedDB.open(IDB_NAME, IDB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(IDB_STORE)) {
            req.result.createObjectStore(IDB_STORE);
          }
        } catch {
          /* a genuinely fatal upgrade error still surfaces via onerror below */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null); // don't hang forever waiting on another tab
    });
    return dbOpenPromise;
  }

  // Resolves { ok:true, value } when IndexedDB was actually reachable
  // (value === undefined just means the key isn't set yet — a legitimately
  // empty store is not the same as a broken one, and must not fall through
  // to localStorage on every read), or { ok:false } when IndexedDB itself
  // couldn't be used at all.
  function idbGetKey(key) {
    return openIdb().then((db) => {
      if (!db) return { ok: false };
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = () => resolve({ ok: true, value: req.result });
          req.onerror = () => resolve({ ok: false });
          tx.onerror = () => resolve({ ok: false });
          tx.onabort = () => resolve({ ok: false });
        } catch {
          resolve({ ok: false });
        }
      });
    }).catch(() => ({ ok: false }));
  }

  function idbSetKey(key, value) {
    return openIdb().then((db) => {
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    }).catch(() => false);
  }

  // Tier 2 fallback. Deliberately localStorage, not sessionStorage — the
  // point of this whole layer is to survive an actual app restart (a fresh
  // WebView instance in Koder counts as a brand new "session" either way),
  // not just a same-tab reload, so the fallback needs the same
  // doesn't-expire-with-the-tab semantics IndexedDB has.
  function safeStorageGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — in-memory state (favorites/folders/assignments)
         still works for this page load, it just won't survive a restart */
    }
  }

  // Unified layered read/write. `saveKey` is fire-and-forget by design —
  // callers never await it, exactly like the plain-sessionStorage version
  // this replaced, since the in-memory state (which every renderer actually
  // reads from) is always updated by the caller before saveKey is invoked.
  async function loadKey(key, fallback) {
    const res = await idbGetKey(key);
    if (res.ok) return res.value !== undefined ? res.value : fallback;
    return safeStorageGet(key, fallback); // tier 2, itself falls through to `fallback` on failure (tier 3)
  }

  function saveKey(key, value) {
    idbSetKey(key, value)
      .then((ok) => { if (!ok) safeStorageSet(key, value); })
      .catch(() => safeStorageSet(key, value)); // absolute safety net
  }

  function loadFavorites() { return loadKey('pv_favorites', []); }
  function saveFavorites() { saveKey('pv_favorites', Array.from(favorites)); }
  function loadFolders() { return loadKey('pv_folders', []); }
  function saveFolders() { saveKey('pv_folders', folders); }
  function loadAssignments() { return loadKey('pv_assignments', {}); }
  function saveAssignments() { saveKey('pv_assignments', assignments); }

  // Runs once at startup (see the bottom of this file). mediaItems is always
  // empty at this point in practice — reaching it requires the native file
  // picker round trip, which takes far longer than this resolves in — but
  // the merges below are additive/guarded anyway so this is safe even if
  // that assumption is ever wrong.
  async function hydrateFromStorage() {
    const [favList, folderList, assignmentMap] = await Promise.all([
      loadFavorites(), loadFolders(), loadAssignments(),
    ]);

    favList.forEach((id) => favorites.add(id));

    // Only apply the loaded snapshot if nothing local has happened yet — the
    // only way folders/assignments could be non-empty already is the
    // Folders tab's own "New Folder" empty-state button, which needs no
    // media first, so it's the one path that can race hydration.
    if (folders.length === 0) folders = folderList;
    if (Object.keys(assignments).length === 0) assignments = assignmentMap;

    // favorites/folders are read live at render time; item.folderId is a
    // snapshot taken when the item was created, so it needs patching if any
    // items were added before hydration resolved.
    for (const item of mediaItems) {
      const assigned = assignments[item.id];
      if (assigned != null) item.folderId = assigned;
    }

    if (mediaItems.length) renderActive();
  }

  /* ------------------------------- Utilities -------------------------------- */

  function detectType(file) {
    if (file.type.startsWith('image/')) return 'photo';
    if (file.type.startsWith('video/')) return 'video';
    if (IMAGE_EXT.test(file.name)) return 'photo';
    if (VIDEO_EXT.test(file.name)) return 'video';
    return null;
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
    // Newest first, top-left to bottom-right in the grid. __pos is cached so
    // the thumbnail-loading priority queue can order cheaply (O(1) lookup)
    // instead of re-scanning the array on every comparison.
    mediaItems.sort((a, b) => b.lastModified - a.lastModified);
    reindexPositions();
  }

  function reindexPositions() {
    mediaItems.forEach((item, i) => { item.__pos = i; });
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
     - Video thumbnails are a single captured frame (a cheap <canvas>
       snapshot), never a live <video> element sitting in a grid tile. Capture
       is retried at a few different timestamps so essentially every playable
       video ends up with a real frame, not a blank tile.
     - A small priority queue (photos before videos, then top-to-bottom render
       order) plus IntersectionObserver means importing hundreds/thousands of
       files is just an in-memory array push + sort — no decoding happens
       until something is actually scrolled into view, only a few thumbnails
       generate at once, and what DOES load first matches what you'd expect
       to see appear first.
     ========================================================================== */

  const THUMB_SIZE = 360; // output px (square) — small enough to be cheap, sharp enough for a ~2x DPR tile
  const THUMB_QUALITY = 0.72;
  const MAX_CONCURRENT_THUMBS = 3;

  let activeThumbJobs = 0;
  const thumbQueue = [];

  function thumbPriority(item) {
    // Photos load before videos; within the same type, earlier in the
    // current sort order (i.e. higher up / earlier in the grid) goes first.
    const typeRank = item.type === 'photo' ? 0 : 1;
    return typeRank * 1e9 + (item.__pos ?? 0);
  }

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
      // Small queue (bounded by whatever's currently near-viewport) — cheap
      // to keep sorted by priority right before each pop.
      thumbQueue.sort((a, b) => thumbPriority(a) - thumbPriority(b));
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

  // Captures a real still frame for every playable video. Retries at a few
  // different timestamps (10%, ~50% capped, then the very first frame)
  // before giving up, since a single blind seek occasionally lands on a
  // black/undecoded frame right at 0.
  function videoToCanvas(item) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const url = URL.createObjectURL(item.file);
      let settled = false;
      let seekAttempts = 0;

      const finish = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        URL.revokeObjectURL(url);
        try { video.removeAttribute('src'); video.load(); } catch { /* noop */ }
        resolve(val);
      };

      const seekTimes = () => {
        const d = video.duration;
        if (!isFinite(d) || d <= 0) return [0];
        return [Math.min(0.5, d * 0.1), Math.min(1.5, d * 0.5), 0];
      };

      function tryCapture() {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return false;
        if (isFinite(video.duration)) item.duration = video.duration;
        try {
          finish(cropToSquare(video, vw, vh, THUMB_SIZE));
          return true;
        } catch {
          return false;
        }
      }

      function attemptNextSeek() {
        const times = seekTimes();
        if (seekAttempts >= times.length) { finish(null); return; }
        const t = times[seekAttempts++];
        try { video.currentTime = t; } catch { attemptNextSeek(); }
      }

      video.addEventListener('loadedmetadata', () => {
        if (isFinite(video.duration)) item.duration = video.duration;
        attemptNextSeek();
      }, { once: true });

      video.addEventListener('seeked', () => {
        if (!tryCapture()) attemptNextSeek();
      });

      video.addEventListener('error', () => finish(null));

      const safety = setTimeout(() => { if (!tryCapture()) finish(null); }, 7000);
      video.src = url;
      try { video.load(); } catch { /* noop */ }
    });
  }

  // A single shared observer drives lazy thumbnail loading for every grid,
  // folder-fan, and folder-detail image on the page.
  const tileImgToRecord = new WeakMap();
  const thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      thumbObserver.unobserve(img);
      const rec = tileImgToRecord.get(img);
      tileImgToRecord.delete(img);
      if (!rec) continue;
      scheduleThumb(rec.item, rec.handle);
    }
  }, { root: null, rootMargin: '600px 0px', threshold: 0.01 });

  function makeFallbackEl(item) {
    const div = document.createElement('div');
    div.className = 'thumb-fallback';
    const iconId = item.type === 'video' ? '#icon-videos' : '#icon-photos';
    div.innerHTML = `<svg class="icon"><use href="${iconId}"/></svg>`;
    return div;
  }

  // Attach a lazily-loaded thumbnail <img> to a tile-ish container.
  // `opts.onReady(url)` fires once the thumbnail resolves (url may be null
  // on the rare hard failure), letting the caller update anything else that
  // depends on it (e.g. a video duration badge) without fragile DOM lookups.
  function makeThumbImg(item, opts = {}) {
    const img = document.createElement('img');
    img.className = 'tile-thumb';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = opts.alt || item.name;

    const handle = (url) => {
      if (img.isConnected) {
        if (url) {
          img.src = url;
          requestAnimationFrame(() => img.classList.add('loaded'));
        } else {
          img.replaceWith(makeFallbackEl(item));
        }
      }
      if (opts.onReady) opts.onReady(url);
    };

    if (item.thumbUrl) {
      img.src = item.thumbUrl;
      img.classList.add('loaded');
    } else if (item.thumbFailed) {
      queueMicrotask(() => handle(null));
    } else {
      tileImgToRecord.set(img, { item, handle });
      thumbObserver.observe(img);
    }
    return img;
  }

  /* ------------------------------- Adding media ------------------------------- */

  addFilesBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    processFiles(e.target.files);
    fileInput.value = '';
  });

  function processFiles(fileList) {
    // Pure in-memory bookkeeping only — no decoding happens here, which is
    // why adding even a large batch of files stays fast. Thumbnails are
    // generated lazily, on demand, as tiles actually scroll into view.
    let added = 0;
    for (const file of Array.from(fileList)) {
      const type = detectType(file);
      if (!type) continue;
      const id = `${file.name}|${file.size}|${file.lastModified}`;
      if (mediaMap.has(id)) continue;
      const url = URL.createObjectURL(file);
      const item = {
        id, url, file, name: file.name, size: file.size, type,
        lastModified: file.lastModified || Date.now(),
        folderId: assignments[id] || null, // snap back into a remembered folder automatically
        duration: null,
        thumbUrl: null,
        thumbFailed: false,
        thumbWaiters: null,
        __pos: 0,
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

  // No render/save-triggering side effect beyond what's strictly needed to
  // drop the item — lets bulk removal do its own single reindex + render
  // instead of one per item.
  function removeItemCore(id) {
    const idx = mediaItems.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const [item] = mediaItems.splice(idx, 1);
    mediaMap.delete(id);
    favorites.delete(id);
    URL.revokeObjectURL(item.url);
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  }

  function removeItem(id) {
    removeItemCore(id);
    saveFavorites();
    reindexPositions();
    renderActive();
  }

  /* --------------------------------- Tabs ----------------------------------- */

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  function setActiveTab(tab) {
    exitSelectMode(true);
    currentTab = tab;
    currentFolder = null;
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#view-${tab}`).classList.add('active');
    syncTopbar();
    renderActive();
  }

  // Single source of truth for the topbar's title + which action buttons show,
  // across normal browsing, drilled-into-a-folder, and select mode.
  function syncTopbar() {
    const onFoldersOverview = currentTab === 'folders' && currentFolder === null;

    if (selectMode) {
      topbarTitle.textContent = selectedIds.size > 0 ? `${selectedIds.size} Selected` : 'Select Items';
      newFolderBtn.classList.add('hidden-btn');
      addFilesBtn.classList.add('hidden-btn');
      selectModeBtn.classList.add('hidden-btn');
      selectAllBtn.classList.remove('hidden-btn');
      cancelSelectBtn.classList.remove('hidden-btn');
      const list = getCurrentGridItems();
      selectAllBtn.textContent = list.length > 0 && list.every((it) => selectedIds.has(it.id)) ? 'Deselect All' : 'Select All';
      return;
    }

    if (currentFolder !== null) {
      const folder = folders.find((f) => f.id === currentFolder);
      topbarTitle.textContent = folder ? folder.name : 'Folder';
    } else {
      topbarTitle.textContent = TAB_TITLES[currentTab];
    }
    newFolderBtn.classList.toggle('hidden-btn', !onFoldersOverview);
    selectModeBtn.classList.toggle('hidden-btn', onFoldersOverview);
    addFilesBtn.classList.remove('hidden-btn');
    selectAllBtn.classList.add('hidden-btn');
    cancelSelectBtn.classList.add('hidden-btn');
  }

  folderBackBtn.addEventListener('click', () => setActiveTab('folders'));

  function openFolder(folderId) {
    exitSelectMode(true);
    currentFolder = folderId;
    $$('.view').forEach((v) => v.classList.remove('active'));
    $('#view-folder-detail').classList.add('active');
    const folder = folders.find((f) => f.id === folderId);
    folderDetailTitle.textContent = folder ? folder.name : 'Folder';
    syncTopbar();
    renderFolderDetail();
  }

  function getCurrentGridItems() {
    if (currentFolder !== null) return mediaItems.filter((i) => i.folderId === currentFolder);
    switch (currentTab) {
      case 'all': return mediaItems;
      case 'photos': return mediaItems.filter((i) => i.type === 'photo');
      case 'videos': return mediaItems.filter((i) => i.type === 'video');
      case 'favorites': return mediaItems.filter((i) => favorites.has(i.id));
      default: return [];
    }
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
    const items = currentFolder === null ? [] : mediaItems.filter((i) => i.folderId === currentFolder);
    const section = $('#view-folder-detail');
    const gridEl = $('.tile-grid', section);
    const emptyEl = $('.empty-state', section);

    if (!items.length) {
      gridEl.innerHTML = '';
      gridEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = emptyStateHTML('folder-empty');
      bindEmptyStateCTA(emptyEl);
      return;
    }

    gridEl.hidden = false;
    emptyEl.hidden = true;
    fillGridProgressively(gridEl, items, (item) => buildTile(item, items));
  }

  function buildTile(item, contextList) {
    const tile = document.createElement('div');
    tile.className = 'tile'
      + (favorites.has(item.id) ? ' is-favorite' : '')
      + (selectMode && selectedIds.has(item.id) ? ' selected' : '');
    tile.dataset.id = item.id;

    tile.appendChild(makeThumbImg(item, {
      onReady: () => {
        if (item.type === 'video' && item.duration != null) {
          const badge = tile.querySelector('.dur');
          if (badge) badge.textContent = formatDuration(item.duration);
        }
      },
    }));

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

    const selectIndicator = document.createElement('div');
    selectIndicator.className = 'select-indicator';
    selectIndicator.innerHTML = '<svg class="icon"><use href="#icon-check"/></svg>';
    tile.appendChild(selectIndicator);

    tile.addEventListener('click', () => {
      if (selectMode) toggleSelect(item.id, tile);
      else openLightbox(contextList, contextList.indexOf(item));
    });

    return tile;
  }

  function toggleFavorite(id) {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    saveFavorites();
    renderActive();
    if (!lightboxEl.hidden) updateLightboxFavState();
  }

  /* -------------------------------- Select mode -------------------------------- */
  // Multi-select for mass-favouriting, mass-moving into a folder, or mass-
  // removing. Entered via the topbar's select-circle button on any media
  // grid (not the Folders overview itself); the tab bar swaps out for a
  // 3-button action bar while it's active.

  function setSelectMode(on) {
    if (selectMode === on) return;
    selectMode = on;
    selectedIds.clear();
    document.body.classList.toggle('select-mode', on);
    mainTabbar.hidden = on;
    selectActionBar.hidden = !on;
    syncTopbar();
    updateSelectionBar();
    renderActive();
  }

  // Used by navigation (tab switch / folder open) to silently drop out of
  // select mode without forcing a redundant render — the caller re-renders
  // right after anyway.
  function exitSelectMode(quiet) {
    if (!selectMode) return;
    selectMode = false;
    selectedIds.clear();
    document.body.classList.remove('select-mode');
    mainTabbar.hidden = false;
    selectActionBar.hidden = true;
    if (!quiet) { syncTopbar(); updateSelectionBar(); renderActive(); }
  }

  function toggleSelect(id, tileEl) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    tileEl.classList.toggle('selected', selectedIds.has(id));
    syncTopbar();
    updateSelectionBar();
  }

  function updateSelectionBar() {
    const n = selectedIds.size;
    selectFavBtn.disabled = n === 0;
    selectMoveBtn.disabled = n === 0;
    selectRemoveBtn.disabled = n === 0;
    const allFav = n > 0 && Array.from(selectedIds).every((id) => favorites.has(id));
    selectFavBtn.classList.toggle('is-favorite', allFav);
    $('span', selectFavBtn).textContent = allFav ? 'Unfavourite' : 'Favourite';
  }

  selectModeBtn.addEventListener('click', () => setSelectMode(true));
  cancelSelectBtn.addEventListener('click', () => setSelectMode(false));

  selectAllBtn.addEventListener('click', () => {
    const list = getCurrentGridItems();
    const allSelected = list.length > 0 && list.every((it) => selectedIds.has(it.id));
    if (allSelected) selectedIds.clear();
    else list.forEach((it) => selectedIds.add(it.id));
    syncTopbar();
    updateSelectionBar();
    renderActive();
  });

  selectFavBtn.addEventListener('click', () => {
    if (!selectedIds.size) return;
    const allFav = Array.from(selectedIds).every((id) => favorites.has(id));
    selectedIds.forEach((id) => { if (allFav) favorites.delete(id); else favorites.add(id); });
    saveFavorites();
    setSelectMode(false);
  });

  selectMoveBtn.addEventListener('click', () => {
    if (!selectedIds.size) return;
    openMoveSheet(Array.from(selectedIds));
  });

  selectRemoveBtn.addEventListener('click', () => {
    if (!selectedIds.size) return;
    selectedIds.forEach((id) => removeItemCore(id));
    saveFavorites();
    reindexPositions();
    setSelectMode(false);
  });

  /* -------------------------------- Empty states -------------------------------- */

  function emptyStateHTML(viewKey) {
    switch (viewKey) {
      case 'all':
        return `
          <svg class="icon"><use href="#icon-all"/></svg>
          <h3>No media yet</h3>
          <p>Add photos and videos from this device to get started.</p>
          <button class="btn-primary empty-cta" data-action="add-media">Add Photos &amp; Videos</button>`;
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
          <p>Create a folder, then use a photo or video's ••• menu to move it in. Folders only show up while their media is present.</p>
          <button class="btn-primary empty-cta" data-action="new-folder">New Folder</button>`;
      case 'folder-empty':
        return `
          <svg class="icon"><use href="#icon-folders"/></svg>
          <h3>This folder is empty</h3>
          <p>Once you move something into this folder — or re-add media that was already in it — it'll show up here again.</p>`;
      default:
        return '';
    }
  }

  function bindEmptyStateCTA(emptyEl) {
    const cta = $('.empty-cta', emptyEl);
    if (!cta) return;
    cta.addEventListener('click', () => {
      if (cta.dataset.action === 'new-folder') openFolderNameSheet('create', null, null);
      else fileInput.click();
    });
  }

  /* --------------------------------- Folders ----------------------------------- */
  // Folders are entirely app-managed: you create them and move photos/videos
  // into them yourself (per-item ••• menu → "Move to Folder"). Nothing about
  // this is read from disk — a folder tile only ever renders while at least
  // one currently-loaded item is assigned to it.

  function getFolderMap() {
    // mediaItems is already newest-first, so every folder's item list — and
    // therefore its fan-out sample and its detail view — inherits that order.
    const map = new Map(); // folderId -> items[]
    for (const item of mediaItems) {
      if (!item.folderId) continue;
      if (!map.has(item.folderId)) map.set(item.folderId, []);
      map.get(item.folderId).push(item);
    }
    return map;
  }

  function createFolder(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const folder = { id: `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name: trimmed };
    folders.push(folder);
    saveFolders();
    return folder;
  }

  function renameFolder(id, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    folder.name = trimmed;
    saveFolders();
    if (currentFolder === id) { folderDetailTitle.textContent = trimmed; syncTopbar(); }
    renderActive();
  }

  function deleteFolder(id) {
    folders = folders.filter((f) => f.id !== id);
    saveFolders();
    let changed = false;
    for (const key of Object.keys(assignments)) {
      if (assignments[key] === id) { delete assignments[key]; changed = true; }
    }
    if (changed) saveAssignments();
    mediaItems.forEach((item) => { if (item.folderId === id) item.folderId = null; });
    if (currentFolder === id) setActiveTab('folders');
    else renderActive();
  }

  function assignToFolderSilent(itemId, folderId) {
    assignments[itemId] = folderId;
    const item = mediaMap.get(itemId);
    if (item) item.folderId = folderId;
  }

  function removeFromFolderSilent(itemId) {
    delete assignments[itemId];
    const item = mediaMap.get(itemId);
    if (item) item.folderId = null;
  }

  function assignToFolder(itemId, folderId) {
    assignToFolderSilent(itemId, folderId);
    saveAssignments();
    renderActive();
  }

  function removeFromFolder(itemId) {
    removeFromFolderSilent(itemId);
    saveAssignments();
    renderActive();
  }

  function renderFolders() {
    const section = $('#view-folders');
    const gridEl = $('.folder-grid', section);
    const emptyEl = $('.empty-state', section);
    const folderMap = getFolderMap();
    const visibleFolders = folders.filter((f) => folderMap.has(f.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!visibleFolders.length) {
      gridEl.innerHTML = '';
      gridEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = emptyStateHTML('folders');
      bindEmptyStateCTA(emptyEl);
      return;
    }

    gridEl.hidden = false;
    emptyEl.hidden = true;
    fillGridProgressively(gridEl, visibleFolders, (folder) => buildFolderCard(folder, folderMap.get(folder.id)));
  }

  function buildFolderCard(folder, items) {
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
    name.textContent = folder.name;
    card.appendChild(name);

    const count = document.createElement('div');
    count.className = 'folder-count';
    count.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    card.appendChild(count);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'folder-menu-btn';
    menuBtn.setAttribute('aria-label', 'Folder options');
    menuBtn.innerHTML = '<svg class="icon"><use href="#icon-dots"/></svg>';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderContextMenu(folder, menuBtn);
    });
    card.appendChild(menuBtn);

    card.addEventListener('click', () => openFolder(folder.id));
    return card;
  }

  /* ---------------------------- New Folder / Rename sheet ---------------------------- */

  function openFolderNameSheet(mode, folderId, assignItemIds) {
    folderSheetMode = mode;
    folderSheetTargetFolderId = folderId;
    folderSheetAssignItemIds = assignItemIds && assignItemIds.length ? assignItemIds : null;
    if (mode === 'rename') {
      const f = folders.find((x) => x.id === folderId);
      folderNameTitle.textContent = 'Rename Folder';
      folderNameInput.value = f ? f.name : '';
      folderNameCreate.textContent = 'Save';
    } else {
      folderNameTitle.textContent = 'New Folder';
      folderNameInput.value = '';
      folderNameCreate.textContent = 'Create';
    }
    folderNameSheet.hidden = false;
    folderNameBackdrop.hidden = false;
    requestAnimationFrame(() => folderNameInput.focus());
  }

  function closeFolderNameSheet() {
    folderNameSheet.hidden = true;
    folderNameBackdrop.hidden = true;
    folderSheetMode = null;
    folderSheetTargetFolderId = null;
    folderSheetAssignItemIds = null;
  }

  function submitFolderNameSheet() {
    const name = folderNameInput.value.trim();
    if (!name) { folderNameInput.focus(); return; }
    if (folderSheetMode === 'rename') {
      renameFolder(folderSheetTargetFolderId, name);
    } else {
      const folder = createFolder(name);
      if (folder && folderSheetAssignItemIds) {
        folderSheetAssignItemIds.forEach((id) => assignToFolderSilent(id, folder.id));
        saveAssignments();
        if (selectMode) setSelectMode(false); else renderActive();
      } else {
        renderActive();
      }
    }
    closeFolderNameSheet();
  }

  newFolderBtn.addEventListener('click', () => openFolderNameSheet('create', null, null));
  folderNameCreate.addEventListener('click', submitFolderNameSheet);
  folderNameCancel.addEventListener('click', closeFolderNameSheet);
  folderNameBackdrop.addEventListener('click', closeFolderNameSheet);
  folderNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitFolderNameSheet();
    else if (e.key === 'Escape') closeFolderNameSheet();
  });

  /* ------------------------------- Move to Folder sheet -------------------------------- */

  function buildMoveRow({ icon, label, danger, checked, onClick }) {
    const btn = document.createElement('button');
    btn.className = 'move-row' + (danger ? ' danger' : '');
    btn.innerHTML = `<svg class="icon"><use href="#${icon}"/></svg><span></span>` +
      (checked ? '<svg class="icon check"><use href="#icon-check"/></svg>' : '');
    btn.querySelector('span').textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // `ids` is always an array — a single-item ••• menu passes a 1-element
  // array, mass-select passes every currently-selected id. Assigning always
  // sets every given item to the chosen folder in one shot; the "checked"
  // mark on a folder row only lights up when the entire selection is
  // already, unambiguously, in that one folder.
  function openMoveSheet(ids) {
    moveSheetItemIds = ids;
    const items = ids.map((id) => mediaMap.get(id)).filter(Boolean);
    moveFolderList.innerHTML = '';

    if (items.some((it) => it.folderId)) {
      moveFolderList.appendChild(buildMoveRow({
        icon: 'icon-x', label: 'Remove from Folder', danger: true,
        onClick: () => {
          ids.forEach(removeFromFolderSilent);
          saveAssignments();
          closeMoveSheet();
          if (selectMode) setSelectMode(false); else renderActive();
        },
      }));
    }

    const newRow = buildMoveRow({
      icon: 'icon-folder-plus', label: 'New Folder…',
      onClick: () => { closeMoveSheet(); openFolderNameSheet('create', null, ids); },
    });
    newRow.classList.add('new-row');
    moveFolderList.appendChild(newRow);

    folders.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((folder) => {
      moveFolderList.appendChild(buildMoveRow({
        icon: 'icon-folders', label: folder.name,
        checked: items.length > 0 && items.every((it) => it.folderId === folder.id),
        onClick: () => {
          ids.forEach((id) => assignToFolderSilent(id, folder.id));
          saveAssignments();
          closeMoveSheet();
          if (selectMode) setSelectMode(false); else renderActive();
        },
      }));
    });

    moveSheet.hidden = false;
    moveSheetBackdrop.hidden = false;
  }

  function closeMoveSheet() {
    moveSheet.hidden = true;
    moveSheetBackdrop.hidden = true;
    moveSheetItemIds = [];
  }

  moveSheetBackdrop.addEventListener('click', closeMoveSheet);

  /* ------------------------------ Swipe between tabs -------------------------- */

  (function enableTabSwipe() {
    const order = ['all', 'photos', 'videos', 'favorites', 'folders'];
    const content = $('#content');
    let startX = 0, startY = 0, tracking = false, locked = null;

    content.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || currentFolder !== null || selectMode) return;
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

  /* -------------------------------- Lightbox ------------------------------------ */
  // The lightbox always uses the full-quality original (item.url) — only the
  // small grid/folder previews are downscaled. Photos support Apple-Photos-
  // style pinch-to-zoom/pan; see the zoom controller further down.

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
    zoomEl = null;
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
      el.className = 'zoomable';
      zoomEl = el;
    } else {
      el = document.createElement('video');
      el.src = item.url;
      el.controls = true;
      el.autoplay = true;
      el.playsInline = true;
      zoomEl = null;
    }
    lightboxMedia.appendChild(el);
    resetZoomState(false);

    lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxList.length}`;
    lightboxName.textContent = item.name;
    lightboxMeta.textContent = [formatBytes(item.size), formatDate(item.lastModified)].filter(Boolean).join(' · ');

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

  /* ------------------------- Pinch-zoom / pan (photos only) ------------------------- */
  // A unified pointer-event controller: single-finger drag at 1x navigates
  // between photos (existing swipe behaviour, and still applies to videos);
  // two fingers (or one finger once already zoomed in) pinch/pan the current
  // photo instead, anchored exactly between the fingers, with the chrome
  // fading out while zoomed and a spring-back if you pinch past the zoom
  // limit or pan past the image's edge.

  const MIN_SCALE = 1;
  const MAX_SCALE = 4;

  let zoomEl = null;
  let zoom = { scale: 1, x: 0, y: 0 };
  const activePointers = new Map(); // pointerId -> {x, y}
  let gesture = null; // null | 'swipe' | 'pan' | 'pinch'
  let swipeStart = { x: 0, y: 0 };
  let panStartPointer = { x: 0, y: 0 };
  let panStartOffset = { x: 0, y: 0 };
  let pinchStartDist = 1;
  let pinchStartScale = 1;
  let pinchStartMid = { x: 0, y: 0 };
  let pinchStartOffset = { x: 0, y: 0 };
  let lastTap = { time: 0, x: 0, y: 0 };

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function rubberBand(v, min, max, dampen) {
    if (v < min) return min - (min - v) * dampen;
    if (v > max) return max + (v - max) * dampen;
    return v;
  }

  function panBounds(scale) {
    const stageRect = lightboxStage.getBoundingClientRect();
    const w = zoomEl.offsetWidth * scale;
    const h = zoomEl.offsetHeight * scale;
    return {
      maxX: Math.max(0, (w - stageRect.width) / 2),
      maxY: Math.max(0, (h - stageRect.height) / 2),
    };
  }

  function clampPan(scale, x, y) {
    const { maxX, maxY } = panBounds(scale);
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  }

  function clampPanRubber(scale, x, y) {
    const { maxX, maxY } = panBounds(scale);
    return { x: rubberBand(x, -maxX, maxX, 0.45), y: rubberBand(y, -maxY, maxY, 0.45) };
  }

  function applyZoomTransform(animate) {
    if (!zoomEl) return;
    zoomEl.style.transition = animate ? 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    zoomEl.style.transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
    zoomEl.classList.toggle('is-zoomed', zoom.scale > 1.02);
  }

  function updateChromeForZoom() {
    lightboxEl.classList.toggle('zoomed', zoom.scale > 1.02);
  }

  function resetZoomState(animate) {
    zoom = { scale: 1, x: 0, y: 0 };
    gesture = null;
    activePointers.clear();
    applyZoomTransform(animate);
    updateChromeForZoom();
  }

  function settleZoom() {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom.scale));
    let { x, y } = clampPan(scale, zoom.x, zoom.y);
    if (scale <= MIN_SCALE + 0.001) { x = 0; y = 0; }
    zoom = { scale, x, y };
    applyZoomTransform(true);
    updateChromeForZoom();
  }

  function handleDoubleTap(clientX, clientY) {
    if (zoom.scale > 1.01) {
      zoom = { scale: 1, x: 0, y: 0 };
    } else {
      const target = 2.75;
      const stageRect = lightboxStage.getBoundingClientRect();
      const cx = clientX - (stageRect.left + stageRect.width / 2);
      const cy = clientY - (stageRect.top + stageRect.height / 2);
      const clamped = clampPan(target, -cx * (target - 1), -cy * (target - 1));
      zoom = { scale: target, x: clamped.x, y: clamped.y };
    }
    applyZoomTransform(true);
    updateChromeForZoom();
  }

  function onPointerDown(e) {
    if (e.target.closest('.lightbox-nav')) return;
    try { lightboxStage.setPointerCapture(e.pointerId); } catch { /* noop */ }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      const now = Date.now();
      const isDoubleTap = zoomEl && now - lastTap.time < 300 &&
        Math.abs(e.clientX - lastTap.x) < 30 && Math.abs(e.clientY - lastTap.y) < 30;
      if (isDoubleTap) {
        handleDoubleTap(e.clientX, e.clientY);
        lastTap = { time: 0, x: 0, y: 0 };
        activePointers.clear();
        gesture = null;
        return;
      }
      lastTap = { time: now, x: e.clientX, y: e.clientY };

      if (zoomEl && zoom.scale > 1.001) {
        gesture = 'pan';
        panStartPointer = { x: e.clientX, y: e.clientY };
        panStartOffset = { x: zoom.x, y: zoom.y };
      } else {
        gesture = 'swipe';
        swipeStart = { x: e.clientX, y: e.clientY };
      }
    } else if (activePointers.size === 2 && zoomEl) {
      const pts = Array.from(activePointers.values());
      gesture = 'pinch';
      pinchStartDist = Math.max(1, dist(pts[0], pts[1]));
      pinchStartScale = zoom.scale;
      pinchStartMid = mid(pts[0], pts[1]);
      pinchStartOffset = { x: zoom.x, y: zoom.y };
    }
  }

  function onPointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesture === 'pinch' && zoomEl && activePointers.size >= 2) {
      const pts = Array.from(activePointers.values()).slice(0, 2);
      const newDist = dist(pts[0], pts[1]);
      const newMid = mid(pts[0], pts[1]);
      const rawScale = pinchStartScale * (newDist / pinchStartDist);
      const scale = rubberBand(rawScale, MIN_SCALE, MAX_SCALE, 0.55);
      const stageRect = lightboxStage.getBoundingClientRect();
      const cx = pinchStartMid.x - (stageRect.left + stageRect.width / 2);
      const cy = pinchStartMid.y - (stageRect.top + stageRect.height / 2);
      const scaleRatio = scale / pinchStartScale;
      const dxMid = newMid.x - pinchStartMid.x;
      const dyMid = newMid.y - pinchStartMid.y;
      zoom = {
        scale,
        x: cx - (cx - pinchStartOffset.x) * scaleRatio + dxMid,
        y: cy - (cy - pinchStartOffset.y) * scaleRatio + dyMid,
      };
      applyZoomTransform(false);
      updateChromeForZoom();
    } else if (gesture === 'pan' && zoomEl) {
      const dx = e.clientX - panStartPointer.x;
      const dy = e.clientY - panStartPointer.y;
      const clamped = clampPanRubber(zoom.scale, panStartOffset.x + dx, panStartOffset.y + dy);
      zoom = { ...zoom, x: clamped.x, y: clamped.y };
      applyZoomTransform(false);
    }
    // 'swipe' gesture: no live feedback needed, decision happens on release.
  }

  function onPointerUp(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    try { lightboxStage.releasePointerCapture(e.pointerId); } catch { /* noop */ }

    if (gesture === 'pinch') {
      if (activePointers.size < 2) {
        settleZoom();
        if (activePointers.size === 1) {
          gesture = 'pan';
          const remaining = Array.from(activePointers.values())[0];
          panStartPointer = remaining;
          panStartOffset = { x: zoom.x, y: zoom.y };
        } else {
          gesture = null;
        }
      }
    } else if (gesture === 'pan') {
      if (activePointers.size === 0) { settleZoom(); gesture = null; }
    } else if (gesture === 'swipe') {
      if (activePointers.size === 0) {
        const dx = e.clientX - swipeStart.x;
        const dy = e.clientY - swipeStart.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) lightboxStep(1); else lightboxStep(-1);
        }
        gesture = null;
      }
    }
  }

  lightboxStage.addEventListener('pointerdown', onPointerDown);
  lightboxStage.addEventListener('pointermove', onPointerMove);
  lightboxStage.addEventListener('pointerup', onPointerUp);
  lightboxStage.addEventListener('pointercancel', onPointerUp);

  /* ------------------------------- Context menu -------------------------------- */

  function positionFloatingMenu(menuEl, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();
    let left = rect.right - menuRect.width;
    let top = rect.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
    if (top + menuRect.height > window.innerHeight - 8) top = rect.top - menuRect.height - 6;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  function openContextMenu(id, anchorEl) {
    contextMenuTargetId = id;
    const isFav = favorites.has(id);
    const favBtn = $('[data-action="favorite"]', contextMenu);
    favBtn.classList.toggle('is-favorite', isFav);
    $('span', favBtn).textContent = isFav ? 'Remove from Favourites' : 'Add to Favourites';

    contextMenu.hidden = false;
    contextMenuBackdrop.hidden = false;
    positionFloatingMenu(contextMenu, anchorEl);
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
      else if (action === 'move') openMoveSheet([id]);
      else if (action === 'remove') removeItem(id);
      else if (action === 'info') openInfo(id);
    });
  });

  function openFolderContextMenu(folder, anchorEl) {
    folderMenuTargetId = folder.id;
    folderContextMenu.hidden = false;
    folderContextMenuBackdrop.hidden = false;
    positionFloatingMenu(folderContextMenu, anchorEl);
  }

  function closeFolderContextMenu() {
    folderContextMenu.hidden = true;
    folderContextMenuBackdrop.hidden = true;
    folderMenuTargetId = null;
  }

  folderContextMenuBackdrop.addEventListener('click', closeFolderContextMenu);

  $$('#folderContextMenu button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = folderMenuTargetId;
      const action = btn.dataset.action;
      closeFolderContextMenu();
      if (!id) return;
      if (action === 'rename') openFolderNameSheet('rename', id, null);
      else if (action === 'delete') deleteFolder(id);
    });
  });

  /* --------------------------------- Info sheet --------------------------------- */

  function openInfo(id) {
    const item = mediaMap.get(id);
    if (!item) return;
    infoName.textContent = item.name;
    infoList.innerHTML = '';
    const folder = item.folderId ? folders.find((f) => f.id === item.folderId) : null;
    const rows = [
      ['Type', item.type === 'photo' ? 'Photo' : 'Video'],
      ['Folder', folder ? folder.name : '—'],
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

  setActiveTab('all');   // paints the (currently always-empty) UI immediately
  hydrateFromStorage();  // fire-and-forget async load of favourites/folders/assignments
})();
