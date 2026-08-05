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
    let added = 0;
    for (const file of Array.from(fileList)) {
      const type = detectType(file);
      if (!type) continue;
      const folderPath = fromFolder ? folderPathOf(file) : '';
      const id = `${folderPath}|${file.name}|${file.size}|${file.lastModified}`;
      if (mediaMap.has(id)) continue;
      const url = URL.createObjectURL(file);
      const item = { id, url, name: file.name, size: file.size, folderPath, type, lastModified: file.lastModified };
      mediaItems.push(item);
      mediaMap.set(id, item);
      added++;
    }
    if (added) renderActive();
  }

  function removeItem(id) {
    const idx = mediaItems.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const [item] = mediaItems.splice(idx, 1);
    mediaMap.delete(id);
    favorites.delete(id);
    saveFavorites();
    URL.revokeObjectURL(item.url);
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

  /* ------------------------------- Grid render -------------------------------- */

  function renderGrid(viewKey, items) {
    const section = $(`#view-${viewKey}`);
    const gridEl = $('.tile-grid', section);
    const emptyEl = $('.empty-state', section);

    gridEl.innerHTML = '';

    if (!items.length) {
      gridEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = emptyStateHTML(viewKey);
      bindEmptyStateCTA(emptyEl);
      return;
    }

    gridEl.hidden = false;
    emptyEl.hidden = true;
    const frag = document.createDocumentFragment();
    items.forEach((item) => frag.appendChild(buildTile(item, items)));
    gridEl.appendChild(frag);
  }

  function renderFolderDetail() {
    const items = currentFolder === null ? [] : mediaItems.filter((i) => i.folderPath === currentFolder);
    const section = $('#view-folder-detail');
    const gridEl = $('.tile-grid', section);
    const emptyEl = $('.empty-state', section);
    gridEl.innerHTML = '';

    if (!items.length) {
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
    const frag = document.createDocumentFragment();
    items.forEach((item) => frag.appendChild(buildTile(item, items)));
    gridEl.appendChild(frag);
  }

  function buildTile(item, contextList) {
    const tile = document.createElement('div');
    tile.className = 'tile' + (favorites.has(item.id) ? ' is-favorite' : '');
    tile.dataset.id = item.id;

    let mediaEl;
    if (item.type === 'photo') {
      mediaEl = document.createElement('img');
      mediaEl.src = item.url;
      mediaEl.loading = 'lazy';
      mediaEl.alt = item.name;
    } else {
      mediaEl = document.createElement('video');
      mediaEl.src = item.url;
      mediaEl.muted = true;
      mediaEl.preload = 'metadata';
      mediaEl.playsInline = true;
    }
    tile.appendChild(mediaEl);

    if (item.type === 'video') {
      const badge = document.createElement('div');
      badge.className = 'video-badge';
      badge.innerHTML = '<svg class="icon"><use href="#icon-play"/></svg><span class="dur">--:--</span>';
      tile.appendChild(badge);
      mediaEl.addEventListener('loadedmetadata', () => {
        badge.querySelector('.dur').textContent = formatDuration(mediaEl.duration);
      }, { once: true });
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

    gridEl.innerHTML = '';

    if (!folderPaths.length) {
      gridEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = emptyStateHTML('folders');
      bindEmptyStateCTA(emptyEl);
      return;
    }

    gridEl.hidden = false;
    emptyEl.hidden = true;
    const frag = document.createDocumentFragment();
    folderPaths.forEach((path) => frag.appendChild(buildFolderCard(path, folderMap.get(path))));
    gridEl.appendChild(frag);
  }

  function buildFolderCard(path, items) {
    const card = document.createElement('div');
    card.className = 'folder-card';

    const fan = document.createElement('div');
    fan.className = 'folder-fan';
    const sample = items.slice(0, 5);
    const n = sample.length;
    sample.forEach((item, i) => {
      const offset = i - (n - 1) / 2;
      const c = document.createElement('div');
      c.className = 'fan-card';
      c.style.setProperty('--dx', `${offset * 26}px`);
      c.style.setProperty('--rot', `${offset * 12}deg`);
      c.style.zIndex = String(10 - Math.round(Math.abs(offset) * 2));
      const el = item.type === 'photo' ? document.createElement('img') : document.createElement('video');
      el.src = item.url;
      if (item.type === 'video') { el.muted = true; el.preload = 'metadata'; }
      c.appendChild(el);
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
