
'use strict';

/* ── Constants ─────────────────────────────────────────── */
const LS_FAVS     = 'mediamover_favs';
const LS_VAULT    = 'mediamover_vault';
const LS_GRIDSIZE = 'mediamover_grid';
const VAULT_MAGIC = 'MMVAULT1:';
const VAULT_KEY   = 'MMVaultAES256GCMAppKey2024v1!!!!';
const HOLD_MS     = 440;
const HOLD_DRIFT  = 12;
const Z_MIN = 1, Z_MAX = 8;
const EXIF_CONCURRENCY = 8;   // cap parallel file-slice reads while sorting
const IMG_THUMB_CAP    = 6;   // image thumb decodes in flight at once
const VID_THUMB_CAP    = 2;   // video grabs in flight — iOS hard-limits live
                              // media decoders; 3+ caused runs of failures
const THUMB_MIN  = 96;        // device-px floor for generated thumbnails
const THUMB_MAX  = 512;       // device-px ceiling for generated thumbnails
const THUMB_TINY = 50000;     // files under ~50KB are decoded directly

const DEFAULT_FOLDER_EMOJI = '📁';
const FOLDER_EMOJIS = [
  '📁','📂','🗂️','📋','📌','📎','🗃️','🗄️',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍',
  '⭐','🌟','💫','✨','🔥','💎','🏆','🎯',
  '🎬','🎵','🎨','📸','🎮','🌍','🏠','🚀',
  '🌈','🌸','🍀','🦋','🐾','🔮','💡','🔑',
  '📚','📝','🗓️','📊','💼','🛠️','⚙️','🔒',
];

/* Both placeholders are drawn on a transparent background so the tile's own
   --surf3 shows through — that's what lets them read correctly in light and
   dark mode alike, since a baked-in data: URI can't respond to the theme. */
const VID_PH = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><circle cx='150' cy='150' r='52' fill='none' stroke='rgba(142,142,147,.45)' stroke-width='2'/><polygon points='140,122 194,150 140,178' fill='rgba(142,142,147,.55)'/></svg>"
);
const IMG_ERR = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect x='105' y='115' width='90' height='70' rx='8' fill='none' stroke='rgba(142,142,147,.5)' stroke-width='3'/><circle cx='128' cy='138' r='7' fill='rgba(142,142,147,.5)'/><path d='M113 178 L143 150 L160 165 L177 148 L192 178' fill='none' stroke='rgba(142,142,147,.5)' stroke-width='3' stroke-linejoin='round'/><line x1='98' y1='200' x2='202' y2='100' stroke='rgba(255,59,48,.55)' stroke-width='4' stroke-linecap='round'/></svg>"
);

/* ── DOM cache ─────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* Every icon in the app comes from the one sprite in index.html, so the
   handful of badges built at runtime pull from it too rather than hardcoding
   a glyph. Folder icons are the deliberate exception — those stay emoji,
   because they're content the user picked, not app chrome. */
const svgIcon = id => `<svg class="icon"><use href="#${id}"/></svg>`;
const pickBtn      = $('pickBtn'),     fileInput    = $('fileInput');
const gallery      = $('gallery'),     emptyEl      = $('emptyEl');
const emptyTit     = $('emptyTit'),    emptyHint    = $('emptyHint');
const viewer       = $('viewer'),      vCon         = $('vCon'),    vStage = $('vStage');
const statBar      = $('statBar'),     msg          = $('msg');
const closeBtn     = $('closeBtn'),    prevBtn      = $('prevBtn'), nextBtn = $('nextBtn'), moreBtn = $('moreBtn');
const vCtr         = $('vCtr'),        favBtn       = $('favBtn'),  vFsBtn  = $('vFsBtn'),  fsBtn   = $('fsBtn');
const settingsBtn  = $('settingsBtn'), sPanel       = $('sPanel');
const togSwipe     = $('togSwipe'),    togSort      = $('togSort'), togExif = $('togExif'), togDupes = $('togDupes');
const sExportVault = $('sExportVault'), sImportVault = $('sImportVault'), vaultImport = $('vaultImport');
const ctxBackdrop  = $('ctxBackdrop');
const ctx          = $('ctx'),         ctxSave      = $('ctxSave'), ctxFav = $('ctxFav'), ctxFL = $('ctxFL');
const ctxDel       = $('ctxDel'),      ctxX         = $('ctxX'),    ctxExportFavs = $('ctxExportFavs'), ctxFolder = $('ctxFolder');
const fldCtx       = $('fldCtx'),      fldCtxRename = $('fldCtxRename'), fldCtxDelete = $('fldCtxDelete'), fldCtxCancel = $('fldCtxCancel');
const emojiGrid    = $('emojiGrid');
const vName        = $('vName'),       vSz          = $('vSz'),    toast  = $('toast');
const zHUD         = $('zHUD'),        zLvl         = $('zLvl'),   zIn    = $('zIn'),   zOut  = $('zOut');
const zTab         = $('zTab'),        zTabBtn      = $('zTabBtn');
const cinemaExit   = $('cinemaExit');
const hNorm        = $('hNorm'),       hSel         = $('hSel'),   logoEl = $('logoEl'), hFTitle = $('hFTitle'), backBtn = $('backBtn');
const selCancelBtn = $('selCancelBtn'), selCountLbl = $('selCountLbl'), selAllBtn = $('selAllBtn');
const tabBar       = $('tabBar'),      actBar       = $('actBar');
const actFolder    = $('actFolder'),   actFav       = $('actFav'), actDel  = $('actDel');
const gWrap        = $('gWrap'),       folderView   = $('folderView');
const fvCards      = $('fvCards'),     fvEmpty      = $('fvEmpty');
const fvNewBtn     = $('fvNewBtn'),    fvExportBtn  = $('fvExportBtn'), fvImportBtn = $('fvImportBtn');
const fldPicker    = $('fldPicker'),   fpList       = $('fpList'), fpTit = $('fpTit'), fpNew = $('fpNew'), fpCancel = $('fpCancel');
const fldDot       = $('fldDot');

// Static NodeLists queried once instead of per call.
const tabEls   = document.querySelectorAll('.tab');
const sGBtnEls = document.querySelectorAll('.sGBtn');

let _stBadge = null;  // lazy-cached after first attach

/* ── Primary state ────────────────────────────────────── */
let list             = [];
let curFile          = null;
let activeTab        = 'all';
let activeFolderName = null;
let curURL           = null;
let thumbURLs        = [];
let folderThumbURLs  = [];
let fvThumbSeq       = 0;
let zS               = null;
let toastTimer       = null;
let hudTimer         = null;
let bSeq             = 0;
let cinemaMode       = false;
let favs             = new Set();
let folders          = new Map();   // name → { emoji, files: Set<favKey> }
let swipeOn          = true;
let newestF          = true;
let prefExif         = true;
let selectMode       = false;
let selected         = new Set();
let fldCtxTarget     = null;
let fpPickerTarget   = null;

const exifCache = new WeakMap();

/* ── Derived state — recomputed only on invalidation ──── */
let _filteredCache  = null;
let _filteredDirty  = true;
let _allFolderKeys  = null;       // Set of all favKeys present in any folder
let _dupeMap        = null;
let _dupeMapDirty   = true;
let _totalSize      = 0;

/* ── Invalidation ─────────────────────────────────────── */
function invList() {
  _filteredDirty = true;
  _dupeMapDirty  = true;
  let s = 0;
  for (let i = 0; i < list.length; i++) s += list[i].size || 0;
  _totalSize = s;
}
function invFolders() {
  _allFolderKeys = null;
  if (activeTab === 'folder') _filteredDirty = true;
}
function invFavs()    { if (activeTab === 'fav') _filteredDirty = true; }
function invFilter()  { _filteredDirty = true; }

/* ── Derived getters ──────────────────────────────────── */
function getFiltered() {
  if (!_filteredDirty) return _filteredCache;
  let r;
  switch (activeTab) {
    case 'photo': r = list.filter(isImg); break;
    case 'video': r = list.filter(isVid); break;
    case 'fav':   r = list.filter(f => favs.has(f)); break;
    case 'folder': {
      if (!activeFolderName) { r = []; break; }
      const entry = folders.get(activeFolderName);
      r = entry ? list.filter(f => entry.files.has(favKey(f))) : [];
      break;
    }
    default: r = list.slice();
  }
  _filteredCache = r;
  _filteredDirty = false;
  return r;
}
function getAllFolderKeys() {
  if (_allFolderKeys) return _allFolderKeys;
  const s = new Set();
  folders.forEach(({ files }) => files.forEach(k => s.add(k)));
  _allFolderKeys = s;
  return s;
}
function getDupeMap() {
  if (!_dupeMapDirty) return _dupeMap;
  const m = new Map();
  for (let i = 0; i < list.length; i++) {
    const k = dupeKey(list[i]);
    m.set(k, (m.get(k) || 0) + 1);
  }
  _dupeMap = m;
  _dupeMapDirty = false;
  return m;
}

/* ── Helpers ──────────────────────────────────────────── */
const isImg   = f => f.type.startsWith('image');
const isVid   = f => f.type.startsWith('video');
const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const buzz    = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const escH    = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// File keys are immutable per File object, so compute once and memoise.
// favKey/dupeKey are called in hot paths (filtering, folder lookups, dupe
// scan, badge updates) — caching turns repeated string builds into map hits.
const _favKeyCache  = new WeakMap();
const _dupeKeyCache = new WeakMap();
function favKey(f) {
  let k = _favKeyCache.get(f);
  if (k === undefined) {
    k = (f.name || '') + '|' + (f.size || 0) + '|' + (f.lastModified || 0);
    _favKeyCache.set(f, k);
  }
  return k;
}
function dupeKey(f) {
  let k = _dupeKeyCache.get(f);
  if (k === undefined) {
    k = (f.name || '') + '|' + (f.size || 0);
    _dupeKeyCache.set(f, k);
  }
  return k;
}

function revokeURL(u)     { if (u) try { URL.revokeObjectURL(u); } catch {} }
function clearThumbURLs() {
  for (let i = 0; i < thumbURLs.length; i++) revokeURL(thumbURLs[i]);
  thumbURLs.length = 0;
}
function clearFolderThumbURLs() {
  for (let i = 0; i < folderThumbURLs.length; i++) revokeURL(folderThumbURLs[i]);
  folderThumbURLs.length = 0;
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  const u = ['B','KB','MB','GB']; let i = 0, v = n;
  while (v >= 1024 && i < 3) { v /= 1024; i++; }
  return (i ? v.toFixed(1) : v) + ' ' + u[i];
}

function showToast(text, ms = 2400, action = null) {
  toast.textContent = '';
  toast.appendChild(document.createTextNode(text));
  if (action) {
    const b = document.createElement('button');
    b.className = 'toastAct';
    b.textContent = action.label;
    b.addEventListener('click', e => {
      e.stopPropagation();
      clearTimeout(toastTimer);
      toast.classList.remove('show');
      action.cb();
    });
    toast.appendChild(b);
    ms = Math.max(ms, 5000);   // give the action time to be tapped
  }
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

/* ── Folder data helpers ──────────────────────────────── */
function getFolderEmoji(name) { return folders.get(name)?.emoji || DEFAULT_FOLDER_EMOJI; }
function ensureFolder(name)   { if (!folders.has(name)) folders.set(name, { emoji: DEFAULT_FOLDER_EMOJI, files: new Set() }); }

/* ── Crypto — AES-256-GCM vault ───────────────────────── */
let _vaultKeyPromise = null;   // importKey once, reuse for every encrypt/decrypt
function getVaultKey() {
  if (!_vaultKeyPromise) {
    _vaultKeyPromise = crypto.subtle.importKey(
      'raw', new TextEncoder().encode(VAULT_KEY), 'AES-GCM', false, ['encrypt','decrypt']
    );
  }
  return _vaultKeyPromise;
}
function uint8ToB64(buf) {
  // Chunked to avoid call-stack limits on large vaults.
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  }
  return btoa(s);
}
async function encryptVault() {
  const key = await getVaultKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const obj = { v: 2, folders: {} };
  folders.forEach(({ emoji, files }, name) => {
    obj.folders[name] = { emoji: emoji || DEFAULT_FOLDER_EMOJI, files: [...files] };
  });
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  const buf = new Uint8Array(12 + ct.byteLength);
  buf.set(iv); buf.set(new Uint8Array(ct), 12);
  return VAULT_MAGIC + uint8ToB64(buf);
}
async function decryptVault(txt) {
  const t = txt.trim();
  if (!t.startsWith(VAULT_MAGIC)) throw new Error('Not a MediaMover vault file');
  const key = await getVaultKey();
  const raw = atob(t.slice(VAULT_MAGIC.length));
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
  const data  = JSON.parse(new TextDecoder().decode(plain));
  if (!data.folders) throw new Error('Invalid vault data');
  return data.folders;
}

/* ── Vault localStorage ───────────────────────────────── */
function saveVault() {
  try {
    const obj = {};
    folders.forEach(({ emoji, files }, n) => {
      obj[n] = { emoji: emoji || DEFAULT_FOLDER_EMOJI, files: [...files] };
    });
    localStorage.setItem(LS_VAULT, JSON.stringify(obj));
    invFolders();
  } catch {}
}
function loadVault() {
  try {
    const obj = JSON.parse(localStorage.getItem(LS_VAULT) || '{}');
    folders.clear();
    Object.entries(obj).forEach(([n, val]) => {
      if (Array.isArray(val)) {
        folders.set(n, { emoji: DEFAULT_FOLDER_EMOJI, files: new Set(val) });
      } else {
        folders.set(n, { emoji: val.emoji || DEFAULT_FOLDER_EMOJI, files: new Set(val.files || []) });
      }
    });
    invFolders();
  } catch {}
}
function mergeVaultData(data) {
  let added = 0;
  Object.entries(data).forEach(([name, val]) => {
    const incFiles = Array.isArray(val) ? val : (val.files || []);
    const incEmoji = Array.isArray(val) ? DEFAULT_FOLDER_EMOJI : (val.emoji || DEFAULT_FOLDER_EMOJI);
    if (!folders.has(name)) folders.set(name, { emoji: incEmoji, files: new Set() });
    const entry = folders.get(name);
    for (let i = 0; i < incFiles.length; i++) {
      if (!entry.files.has(incFiles[i])) { entry.files.add(incFiles[i]); added++; }
    }
  });
  invFolders();
  return added;
}

/* ── Vault export/import handlers ─────────────────────── */
function downloadBlob(blob, filename) {
  const u = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: u, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => revokeURL(u), 2000);
}
async function doExportVault() {
  toggleSP(false);
  if (!folders.size) { showToast('No folders to export yet'); return; }
  try {
    const enc = await encryptVault();
    downloadBlob(new Blob([enc], { type: 'text/plain' }),
      `mediamover-vault-${new Date().toISOString().slice(0, 10)}.txt`);
    showToast(`Exported ${folders.size} folder${folders.size !== 1 ? 's' : ''}`);
  } catch (e) { showToast('Export failed: ' + e.message); }
}
async function doImportVault(file) {
  if (!file) return;
  try {
    const data  = await decryptVault(await file.text());
    const added = mergeVaultData(data);
    saveVault(); renderFolderList(); updateFldDot();
    if (list.length) { buildGallery(getFiltered()); setStatus(); }
    const n = Object.keys(data).length;
    showToast(`Imported ${n} folder${n !== 1 ? 's' : ''} · ${added} new entries`);
  } catch (e) { showToast('Import failed: ' + (e.message || 'unreadable file')); }
}

sExportVault.onclick = doExportVault;
fvExportBtn.onclick  = doExportVault;
sImportVault.onclick = () => { toggleSP(false); vaultImport.click(); };
fvImportBtn.onclick  = () => vaultImport.click();
vaultImport.addEventListener('change', () => {
  const f = vaultImport.files[0];
  vaultImport.value = '';
  doImportVault(f);
});

/* ── Emoji picker ─────────────────────────────────────── */
// Buttons are inert; one delegated listener on the grid handles all 48
// (previously each rebuild attached 48 individual listeners).
function buildEmojiGrid(currentName) {
  emojiGrid.textContent = '';
  const current = getFolderEmoji(currentName);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < FOLDER_EMOJIS.length; i++) {
    const emoji = FOLDER_EMOJIS[i];
    const btn = document.createElement('button');
    btn.className = 'emojiBtn' + (emoji === current ? ' active' : '');
    btn.textContent = emoji;
    btn.title = emoji;
    frag.appendChild(btn);
  }
  emojiGrid.appendChild(frag);
}
emojiGrid.addEventListener('click', e => {
  const btn = e.target.closest('.emojiBtn');
  if (!btn || !fldCtxTarget) return;
  e.stopPropagation();
  const entry = folders.get(fldCtxTarget);
  if (!entry) return;
  const emoji = btn.textContent;
  entry.emoji = emoji;
  saveVault(); renderFolderList(); updateFldDot();
  const buttons = emojiGrid.children;
  for (let j = 0; j < buttons.length; j++) buttons[j].classList.toggle('active', buttons[j] === btn);
  if (activeFolderName === fldCtxTarget) updateHeader();
  showToast(`Icon updated to ${emoji}`);
});

/* ── Folder list view ─────────────────────────────────── */
// Folder cards render as a 2-column grid. Each card shows a small "arc" of
// up to 3 overlapping photo/video thumbnails (fanned out) with the folder
// name centered below. Thumbnails are generated at a small size and reuse
// the same cached-blob pipeline as the main gallery (see Thumbnails
// section) — full-resolution images are NEVER decoded just to show a tiny
// preview, and the cache is shared, so if the gallery already generated a
// thumb for a file, the folder view reuses it instantly.
function calcFolderThumbPx() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return clamp(Math.round(76 * dpr), THUMB_MIN, THUMB_MAX);
}
const FOLDER_THUMB_CAP = 4;   // concurrent thumb decodes while the folder list renders
function runFolderThumbQueue(jobs, seq) {
  if (!jobs.length) return;
  const px = calcFolderThumbPx();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      if (seq !== fvThumbSeq) return;   // a newer render superseded this one
      const { img, file } = job;
      let blob = null;
      try { blob = isVid(file) ? await vidThumb(file, px) : await makeImgThumb(file, px); }
      catch {}
      if (seq !== fvThumbSeq || !img.isConnected) continue;
      if (blob) {
        const u = URL.createObjectURL(blob);
        folderThumbURLs.push(u);
        img.src = u;
      } else {
        img.src = isVid(file) ? VID_PH : IMG_ERR;
      }
      img.classList.add('loaded');
    }
  };
  const pool = [];
  for (let w = 0; w < Math.min(FOLDER_THUMB_CAP, jobs.length); w++) pool.push(worker());
}

function renderFolderList() {
  fvCards.textContent = '';
  clearFolderThumbURLs();
  const seq = ++fvThumbSeq;
  let visibleCount = 0;

  const fileKeys = new Set();
  const keyToFile = new Map();
  for (let i = 0; i < list.length; i++) {
    const f = list[i], k = favKey(f);
    fileKeys.add(k);
    if (!keyToFile.has(k)) keyToFile.set(k, f);
  }

  const frag = document.createDocumentFragment();
  const thumbJobs = [];

  folders.forEach(({ emoji, files }, name) => {
    let matched = 0;
    const previewFiles = [];
    files.forEach(k => {
      if (!fileKeys.has(k)) return;
      matched++;
      if (previewFiles.length < 3) {
        const f = keyToFile.get(k);
        if (f) previewFiles.push(f);
      }
    });
    if (matched === 0) return;
    visibleCount++;

    const card = document.createElement('div');
    card.className = 'fCard';

    const arc = document.createElement('div');
    arc.className = 'fcArc n' + previewFiles.length;
    if (!previewFiles.length) {
      const ico = document.createElement('div');
      ico.className = 'fcArcIco';
      ico.textContent = emoji || DEFAULT_FOLDER_EMOJI;
      arc.appendChild(ico);
    } else {
      for (let i = 0; i < previewFiles.length; i++) {
        const img = document.createElement('img');
        img.className = 'fcArcImg';
        img.alt = '';
        arc.appendChild(img);
        thumbJobs.push({ img, file: previewFiles[i] });
      }
    }
    card.appendChild(arc);

    const nameEl = document.createElement('div');
    nameEl.className = 'fcName';
    nameEl.textContent = name;
    card.appendChild(nameEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'fcMeta';
    metaEl.textContent = `${matched} matched · ${files.size} saved`;
    card.appendChild(metaEl);

    const more = document.createElement('button');
    more.className = 'fcMoreBtn';
    more.title = 'Options';
    more.textContent = '⋯';
    card.appendChild(more);

    card.addEventListener('click', e => {
      if (e.target.closest('.fcMoreBtn')) {
        e.stopPropagation();
        const r = more.getBoundingClientRect();
        showFldCtxAt(name, r.left + r.width / 2, r.top);
        return;
      }
      drillIntoFolder(name);
    });
    attachHold(card, (x, y) => showFldCtxAt(name, x, y));
    frag.appendChild(card);
  });

  fvCards.appendChild(frag);
  runFolderThumbQueue(thumbJobs, seq);

  const fveTit  = fvEmpty.querySelector('.eTit');
  const fveHint = fvEmpty.querySelector('.eHint');
  if (visibleCount === 0) {
    fvEmpty.style.display = '';
    if (!folders.size) {
      fveTit.textContent  = 'No folders yet';
      fveHint.textContent = 'Create a folder, or import an encrypted vault file from another session.';
    } else if (!list.length) {
      fveTit.textContent  = 'No media loaded';
      fveHint.textContent = 'Load photos & videos above — folders that contain them will appear here.';
    } else {
      fveTit.textContent  = 'No matches';
      fveHint.textContent = 'None of your loaded files belong to any folder yet.';
    }
  } else {
    fvEmpty.style.display = 'none';
  }
}

function drillIntoFolder(name) {
  activeFolderName = name;
  invFilter();
  folderView.style.display = 'none';
  gWrap.style.display = '';
  buildGallery(getFiltered());
  updateHeader();
  setStatus();
}

function updateFldDot() {
  let has = false;
  if (list.length) {
    const keys = getAllFolderKeys();
    for (let i = 0; i < list.length; i++) {
      if (keys.has(favKey(list[i]))) { has = true; break; }
    }
  }
  fldDot.classList.toggle('on', has);
}

/* ── Folder ctx menu ──────────────────────────────────── */
function showFldCtxAt(name, x, y) {
  fldCtxTarget = name;
  hideCtx();
  ctxBackdrop.classList.add('show');
  buildEmojiGrid(name);
  fldCtx.style.display = 'block';
  fldCtx.style.transform = 'translate(-9999px,-9999px)';
  const w = fldCtx.offsetWidth, h = fldCtx.offsetHeight, pad = 10;
  fldCtx.style.transform = `translate(${clamp(x - w / 2, pad, innerWidth - w - pad)}px,${clamp(y - h - 8, pad, innerHeight - h - pad)}px)`;
  fldCtx.classList.add('sIn');
}
function hideFldCtx() {
  fldCtx.style.display = 'none';
  fldCtx.style.transform = 'translate(-9999px,-9999px)';
  fldCtxTarget = null;
  if (ctx.style.display !== 'block') ctxBackdrop.classList.remove('show');
}

fldCtxRename.onclick = () => {
  const name = fldCtxTarget; hideFldCtx();
  const newName = (prompt('Rename folder:', name) || '').trim();
  if (!newName || newName === name) return;
  if (newName.length > 60)        { showToast('Name too long'); return; }
  if (folders.has(newName))       { showToast('A folder with that name already exists'); return; }
  const entry = folders.get(name);
  folders.delete(name); folders.set(newName, entry);
  if (activeFolderName === name) { activeFolderName = newName; updateHeader(); }
  saveVault(); renderFolderList();
  showToast(`Renamed to "${newName}"`);
};
fldCtxDelete.onclick = () => {
  const name = fldCtxTarget; hideFldCtx();
  if (!confirm(`Delete folder "${name}"?\n\nFiles are not affected.`)) return;
  folders.delete(name);
  if (activeFolderName === name) { activeFolderName = null; showFolderList(); }
  saveVault(); renderFolderList(); updateFldDot();
  if (list.length) { buildGallery(getFiltered()); setStatus(); }
  showToast(`Folder "${name}" deleted`);
};
fldCtxCancel.onclick = hideFldCtx;
document.addEventListener('click', e => {
  if (fldCtx.style.display === 'block' && !fldCtx.contains(e.target)) hideFldCtx();
});

fvNewBtn.onclick = () => {
  const name = promptFolderName();
  if (!name) return;
  ensureFolder(name);
  saveVault(); renderFolderList(); updateFldDot();
  showToast(`Folder "${name}" created`);
};

function promptFolderName(def = '') {
  const n = (prompt('Folder name:', def) || '').trim();
  if (!n) return null;
  if (n.length > 60) { showToast('Name too long (max 60 chars)'); return null; }
  return n;
}

/* ── Folder picker sheet ──────────────────────────────── */
function openFolderPicker(targetFile) {
  fpPickerTarget = targetFile;
  fpTit.textContent = targetFile ? 'Add to Folder' : 'Add Selected to Folder';
  fpList.textContent = '';

  if (!folders.size) {
    const h = document.createElement('div');
    h.style.cssText = 'font-size:13px;color:var(--mut);padding:8px 10px 4px;';
    h.textContent = 'No folders yet — create one below.';
    fpList.appendChild(h);
  } else {
    const tFiles = targetFile ? [targetFile] : [...selected];
    const frag = document.createDocumentFragment();
    folders.forEach(({ emoji, files }, name) => {
      const allIn = tFiles.length && tFiles.every(f => files.has(favKey(f)));
      const row = document.createElement('div');
      row.className = 'fpItem';
      row.innerHTML =
        `<span>${emoji || DEFAULT_FOLDER_EMOJI} <span class="fpN">${escH(name)}</span></span>` +
        `<span class="fpC">${allIn ? '✓ added' : files.size + ' files'}</span>`;
      row.addEventListener('click', () => {
        const tf = targetFile ? [targetFile] : [...selected];
        if (allIn) tf.forEach(f => files.delete(favKey(f)));
        else       tf.forEach(f => files.add(favKey(f)));
        saveVault(); closeFolderPicker(); renderFolderList(); updateFldDot();
        if (activeTab === 'folder' && activeFolderName === name) {
          invFilter(); buildGallery(getFiltered()); setStatus();
        } else {
          updateTileFolderBadges(tf);
        }
        showToast(allIn ? `Removed from "${name}"` : `Added to "${name}"`);
      });
      frag.appendChild(row);
    });
    fpList.appendChild(frag);
  }
  fldPicker.classList.add('open');
}

function closeFolderPicker() {
  fldPicker.classList.remove('open');
  fpPickerTarget = null;
}

fpNew.addEventListener('click', () => {
  const name = promptFolderName();
  if (!name) return;
  ensureFolder(name);
  const tFiles = fpPickerTarget ? [fpPickerTarget] : [...selected];
  const entry = folders.get(name);
  tFiles.forEach(f => entry.files.add(favKey(f)));
  saveVault(); closeFolderPicker(); renderFolderList(); updateFldDot();
  updateTileFolderBadges(tFiles);
  showToast(`${tFiles.length > 0 ? 'Added to' : 'Created'} "${name}"`);
});
fpCancel.addEventListener('click', closeFolderPicker);
fldPicker.addEventListener('click', e => { if (e.target === fldPicker) closeFolderPicker(); });

// Batch badge refresh: one pass over the gallery DOM instead of an
// indexOf() scan per file (which was O(n·m) for multi-select adds).
function updateTileFolderBadges(filesArr) {
  if (!filesArr.length) return;
  const wanted = new Set(filesArr);
  const folderKeys = getAllFolderKeys();
  const kids = gallery.children;
  for (let i = 0; i < kids.length; i++) {
    const t = kids[i], f = t._file;
    if (!f || !wanted.has(f)) continue;
    const inAny = folderKeys.has(favKey(f));
    const existing = t.querySelector('.fldSt');
    if (inAny && !existing) {
      const b = document.createElement('div');
      b.className = 'fldSt'; b.innerHTML = svgIcon('icon-folders');
      t.appendChild(b);
    } else if (!inAny && existing) existing.remove();
  }
}

/* ── Tab switching ────────────────────────────────────── */
function switchTab(tab) {
  if (selectMode) exitSelectMode();
  activeTab = tab;
  invFilter();
  tabEls.forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  if (tab === 'folder' && activeFolderName === null) {
    showFolderList();
  } else {
    if (tab !== 'folder') activeFolderName = null;
    showGallery();
  }
  updateHeader();
  setStatus();
  hideCtx(); hideFldCtx();
  window.scrollTo(0, 0);   // each tab starts at the top — no leftover scroll
}

function showGallery() {
  gWrap.style.display = '';
  folderView.style.display = 'none';
  buildGallery(getFiltered());
}

function showFolderList() {
  activeFolderName = null;
  invFilter();
  gWrap.style.display = 'none';
  folderView.style.display = 'block';
  renderFolderList();
  updateHeader();
}

function updateHeader() {
  const drilled = activeTab === 'folder' && activeFolderName;
  backBtn.classList.toggle('on', !!drilled);
  logoEl.classList.toggle('off', !!drilled);
  hFTitle.classList.toggle('on',  !!drilled);
  hFTitle.textContent = drilled ? `${getFolderEmoji(activeFolderName)} ${activeFolderName}` : '';
}

backBtn.onclick = () => {
  if (selectMode) exitSelectMode();
  showFolderList();
};

tabEls.forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

/* ── Status bar ───────────────────────────────────────── */
function setStatus() {
  if (activeTab === 'folder' && activeFolderName === null) {
    statBar.classList.remove('has');
    msg.textContent = `${folders.size} folder${folders.size !== 1 ? 's' : ''} — tap to browse, hold for options.`;
    if (_stBadge) { _stBadge.remove(); _stBadge = null; }
    return;
  }
  const n = list.length;
  if (!n) {
    statBar.classList.remove('has');
    msg.textContent = 'No files selected — tap above to get started.';
    if (_stBadge) { _stBadge.remove(); _stBadge = null; }
    return;
  }
  statBar.classList.add('has');
  const fl = getFiltered();
  msg.textContent = selectMode
    ? `${selected.size} of ${fl.length} selected`
    : fl.length < n
      ? `${fl.length} of ${n} shown · Hold any tile for options`
      : `${n} item${n !== 1 ? 's' : ''} · Tap to view, hold for options`;
  if (!_stBadge) { _stBadge = document.createElement('span'); _stBadge.className = 'stBadge'; statBar.appendChild(_stBadge); }
  _stBadge.textContent = fmtBytes(_totalSize);
}

/* ── Multi-select ─────────────────────────────────────── */
function enterSelectMode(firstFile, firstTile) {
  selectMode = true;
  selected.clear();
  buzz(12);   // subtle haptic confirms the hold registered (Android)
  if (firstFile) {
    selected.add(firstFile);
    if (firstTile) firstTile.classList.add('selected');
  }
  gallery.classList.add('selMode');
  hNorm.classList.add('off'); hSel.classList.add('on');
  tabBar.classList.add('hidden'); actBar.classList.add('on');
  updateSelCount(); setStatus();
}

function exitSelectMode() {
  selectMode = false; selected.clear();
  gallery.classList.remove('selMode');
  const sel = gallery.querySelectorAll('.tile.selected');
  for (let i = 0; i < sel.length; i++) sel[i].classList.remove('selected');
  hNorm.classList.remove('off'); hSel.classList.remove('on');
  tabBar.classList.remove('hidden'); actBar.classList.remove('on');
  setStatus();
}

function toggleSelect(file, tile) {
  if (selected.has(file)) { selected.delete(file); tile.classList.remove('selected'); }
  else                    { selected.add(file);    tile.classList.add('selected');    }
  updateSelCount(); setStatus();
}

function updateSelCount() {
  const n = selected.size;
  selCountLbl.textContent = `${n} selected`;
  const fl = getFiltered();
  const allSel = n > 0 && fl.every(f => selected.has(f));
  selAllBtn.textContent = allSel ? 'Deselect All' : 'Select All';
  actFolder.disabled = n === 0;
  actFav.disabled    = n === 0;
  actDel.disabled    = n === 0;
}

selCancelBtn.onclick = exitSelectMode;

selAllBtn.onclick = () => {
  const fl = getFiltered();
  const allSel = fl.length > 0 && fl.every(f => selected.has(f));
  if (allSel) {
    fl.forEach(f => selected.delete(f));
    const sel = gallery.querySelectorAll('.tile.selected');
    for (let i = 0; i < sel.length; i++) sel[i].classList.remove('selected');
  } else {
    fl.forEach(f => selected.add(f));
    const kids = gallery.children;
    for (let i = 0; i < kids.length; i++) {
      const t = kids[i];
      if (t._file && selected.has(t._file)) t.classList.add('selected');
    }
  }
  updateSelCount(); setStatus();
};

actFolder.addEventListener('click', () => openFolderPicker(null));

actFav.addEventListener('click', () => {
  const files = [...selected];
  const allFav = files.every(f => favs.has(f));
  files.forEach(f => { allFav ? favs.delete(f) : favs.add(f); });
  saveFavs(); invFavs();
  const kids = gallery.children;
  for (let i = 0; i < kids.length; i++) {
    const t = kids[i];
    if (!t._file || !selected.has(t._file)) continue;
    let star = t.querySelector('.favSt');
    if (!allFav && !star) {
      star = document.createElement('div');
      star.className = 'favSt'; star.innerHTML = svgIcon('icon-favorites');
      t.appendChild(star);
    } else if (allFav && star) star.remove();
  }
  showToast(allFav ? `Removed ${files.length} from favourites` : `${files.length} added to favourites`);
  if (activeTab === 'fav') { buildGallery(getFiltered()); setStatus(); }
  exitSelectMode();
});

actDel.addEventListener('click', () => {
  const toRemove = [...selected];
  const snap = captureRemoval(toRemove);   // BEFORE mutation — indices valid
  // Single filter pass instead of repeated indexOf+splice (O(n) vs O(n·m)).
  const removeSet = new Set(toRemove);
  list = list.filter(f => !removeSet.has(f));
  for (let i = 0; i < toRemove.length; i++) {
    const f = toRemove[i];
    favs.delete(f);
    const k = favKey(f);
    folders.forEach(({ files }) => files.delete(k));
  }
  invList(); invFolders(); invFilter();
  saveFavs(); saveVault();
  exitSelectMode();
  const undo = { label: 'Undo', cb: () => restoreRemoval(snap) };
  if (!list.length) {
    gallery.textContent = ''; clearThumbURLs();
    emptyEl.style.display = '';
    renderFolderList(); updateFldDot(); setStatus();
    showToast(`Removed ${toRemove.length} item${toRemove.length !== 1 ? 's' : ''}`, 2400, undo);
    return;
  }
  buildGallery(getFiltered()); renderFolderList(); updateFldDot(); setStatus();
  showToast(`Removed ${toRemove.length} item${toRemove.length !== 1 ? 's' : ''}`, 2400, undo);
});

/* ── Undoable removal ─────────────────────────────────── */
// Snapshot everything a removal touches (list position, favourite state,
// folder memberships) BEFORE mutating, so a toast Undo can restore it all.
function captureRemoval(files) {
  return files.map(f => {
    const k = favKey(f);
    const inFolders = [];
    folders.forEach((entry, name) => { if (entry.files.has(k)) inFolders.push(name); });
    return { f, i: list.indexOf(f), fav: favs.has(f), inFolders };
  });
}
function restoreRemoval(snap) {
  snap.sort((a, b) => a.i - b.i);
  for (let j = 0; j < snap.length; j++) {
    const { f, i, fav, inFolders } = snap[j];
    list.splice(Math.min(Math.max(i, 0), list.length), 0, f);
    if (fav) favs.add(f);
    const k = favKey(f);
    for (let n = 0; n < inFolders.length; n++) folders.get(inFolders[n])?.files.add(k);
  }
  invList(); invFolders(); invFilter();
  saveFavs(); saveVault();
  if (activeTab === 'folder' && activeFolderName === null) renderFolderList();
  else buildGallery(getFiltered());
  renderFolderList(); updateFldDot(); setStatus();
  showToast('Restored');
}

/* ── Favourites ───────────────────────────────────────── */
function saveFavs() {
  try { localStorage.setItem(LS_FAVS, JSON.stringify([...favs].map(favKey))); } catch {}
}
function restoreFavs() {
  favs.clear();
  try {
    const saved = new Set(JSON.parse(localStorage.getItem(LS_FAVS) || '[]'));
    if (!saved.size) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (saved.has(favKey(list[i]))) { favs.add(list[i]); n++; }
    }
    return n;
  } catch { return 0; }
}
function toggleFav(file) {
  if (!file) return;
  const was = favs.has(file);
  was ? favs.delete(file) : favs.add(file);
  saveFavs(); invFavs(); refreshFavBtn(file);
  if (activeTab === 'fav') { buildGallery(getFiltered()); setStatus(); return; }
  const fl = getFiltered();
  const idx = fl.indexOf(file);
  const tile = idx >= 0 ? gallery.children[idx] : null;
  if (tile) {
    let star = tile.querySelector('.favSt');
    if (!was && !star) {
      star = document.createElement('div');
      star.className = 'favSt'; star.innerHTML = svgIcon('icon-favorites');
      tile.appendChild(star);
    } else if (was && star) star.remove();
  }
  showToast(was ? 'Removed from favourites' : 'Added to favourites');
}

function refreshFavBtn(file) {
  const on = !!(file && favs.has(file));
  // The icons themselves are the sprite <svg> already in the markup — the
  // filled/unfilled state is carried by the class, so nothing here replaces
  // the button's contents.
  favBtn.classList.toggle('favOn', on);
  ctxFL.textContent = on ? 'Unfavourite' : 'Favourite';
  ctxFav.classList.toggle('ctxFavOn', on);
}
favBtn.addEventListener('click', () => toggleFav(curFile));

/* ── File picking & sorting ───────────────────────────── */
pickBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (!files.length) return;

  clearThumbURLs();
  revokeURL(curURL); curURL = null;
  closeViewerImmediate();
  if (selectMode) exitSelectMode();

  list = files; curFile = null;
  invList(); invFolders(); invFilter();
  msg.textContent = 'Sorting…';

  await sortFiles();
  const restoredFavs = restoreFavs();
  loadVault(); renderFolderList(); updateFldDot();

  if (activeTab === 'folder' && activeFolderName === null) showFolderList();
  else showGallery();
  setStatus();
  if (restoredFavs) showToast(`${restoredFavs} favourite${restoredFavs !== 1 ? 's' : ''} restored`);
});

async function sortFiles() {
  const keys = new Map();
  if (prefExif) {
    // Bounded worker pool: previously Promise.all kicked off a file-slice
    // read for every image at once, which on a 1000-photo import meant
    // 1000 simultaneous 256KB reads. Eight at a time is just as fast and
    // far kinder to memory and the I/O scheduler.
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const f = list[i++];
        const dt = isImg(f) ? await getDateTaken(f) : null;
        keys.set(f, dt ? dt.getTime() : (f.lastModified || 0));
      }
    };
    const pool = [];
    for (let w = 0; w < Math.min(EXIF_CONCURRENCY, list.length); w++) pool.push(worker());
    await Promise.all(pool);
  } else {
    for (let i = 0; i < list.length; i++) keys.set(list[i], list[i].lastModified || 0);
  }
  list.sort((a, b) => {
    const d = (keys.get(b) ?? 0) - (keys.get(a) ?? 0);
    return newestF ? d : -d;
  });
  invFilter();
}

/* ── EXIF ─────────────────────────────────────────────── */
async function getDateTaken(file) {
  if (exifCache.has(file)) return exifCache.get(file);
  const isJPEG = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name || '');
  if (!isJPEG) { exifCache.set(file, null); return null; }
  try {
    const buf = await file.slice(0, 262144).arrayBuffer();
    const dv  = new DataView(buf);
    if (dv.getUint16(0, false) !== 0xFFD8) { exifCache.set(file, null); return null; }
    let off = 2;
    while (off + 4 < dv.byteLength) {
      if (dv.getUint8(off) !== 0xFF) break;
      const mk = dv.getUint8(off + 1), sz = dv.getUint16(off + 2, false);
      if (sz < 2) break;
      if (mk === 0xE1) {
        const st = off + 4;
        if (dv.getUint32(st, false) !== 0x45786966 || dv.getUint16(st + 4, false) !== 0) { off += 2 + sz; continue; }
        const tiff = st + 6, le = dv.getUint16(tiff, false) === 0x4949;
        const u16 = p => dv.getUint16(p, le), u32 = p => dv.getUint32(p, le);
        if (u16(tiff + 2) !== 0x002A) break;
        const ifd0 = tiff + u32(tiff + 4), iN = u16(ifd0);
        let dT = null, exifPtr = null;
        for (let i = 0; i < iN; i++) {
          const e = ifd0 + 2 + i * 12, tag = u16(e), cnt = u32(e + 4), vo = u32(e + 8);
          if (tag === 0x0132 && u16(e + 2) === 2 && cnt >= 10) dT = rdStr(dv, cnt <= 4 ? e + 8 : tiff + vo, cnt);
          if (tag === 0x8769) exifPtr = vo;
        }
        let dto = null;
        if (exifPtr) {
          const eI = tiff + exifPtr, eN = u16(eI);
          for (let i = 0; i < eN; i++) {
            const e = eI + 2 + i * 12, tag = u16(e), cnt = u32(e + 4), vo = u32(e + 8);
            if (tag === 0x9003 && u16(e + 2) === 2 && cnt >= 10) { dto = rdStr(dv, cnt <= 4 ? e + 8 : tiff + vo, cnt); break; }
          }
        }
        const parsed = parseExifDate(dto || dT);
        exifCache.set(file, parsed);
        return parsed;
      }
      if (mk === 0xDA || mk === 0xD9) break;
      off += 2 + sz;
    }
  } catch {}
  exifCache.set(file, null);
  return null;
}
function rdStr(dv, start, len) {
  let r = '';
  const end = Math.min(dv.byteLength, start + len);
  for (let i = start; i < end; i++) {
    const c = dv.getUint8(i);
    if (!c) break;
    r += String.fromCharCode(c);
  }
  return r.trim();
}
function parseExifDate(s) {
  if (!s) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d) ? null : d;
}

/* ── Thumbnails ───────────────────────────────────────── */
// Thumbs are generated at the size they're actually RENDERED, never at the
// source resolution. Previously image tiles got a raw object URL, so a 48MP
// photo was fully decoded into a ~100px tile and the browser kept the whole
// decoded bitmap alive per visible <img>. Now:
//   1. calcThumbPx() measures the real on-screen tile width × devicePixelRatio
//   2. createImageBitmap downscales DURING decode where supported, so the
//      full-resolution bitmap is never materialised at all
//   3. the result is re-encoded to a small webp/jpeg blob (a few KB)
//   4. blobs are cached per file, so tab switches / rebuilds cost nothing
// The fullscreen viewer still loads the original at full resolution.
const _thumbCache = new WeakMap();   // file → { px, blob }

function calcThumbPx() {
  // Real rendered tile width (tiles are square) × DPR, clamped to sane bounds.
  let cssW = gallery.firstElementChild?.clientWidth || 0;
  if (!cssW) {
    let gs = 104;
    try { gs = parseInt(localStorage.getItem(LS_GRIDSIZE), 10) || 104; } catch {}
    cssW = gs;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return clamp(Math.round(cssW * dpr), THUMB_MIN, THUMB_MAX);
}

// Tiles are square with object-fit:cover, so the SHORT side of the thumb is
// what must reach px. Width-based decode can't know the aspect in advance,
// so target ~1.34·px wide: portrait photos (width = short side) come out
// sharp, and typical landscape shots land at ≈px tall.
const thumbTargetW = px => Math.min(THUMB_MAX, Math.round(px * 1.34));

function canvasToBlob(c) {
  return new Promise(res => {
    c.toBlob(b => {
      if (b) { res(b); return; }
      c.toBlob(b2 => res(b2 || null), 'image/jpeg', .72);
    }, 'image/webp', .72);
  });
}

async function makeImgThumb(file, px) {
  const cached = _thumbCache.get(file);
  if (cached && cached.px >= px) return cached.blob;
  const tw = thumbTargetW(px);
  let bmp = null;
  try {
    try {
      // Downscale during decode — the full-res bitmap never exists.
      bmp = await createImageBitmap(file, {
        resizeWidth: tw, resizeQuality: 'medium', imageOrientation: 'from-image',
      });
    } catch {
      // Older Safari ignores/rejects resize options — decode, scale on canvas.
      bmp = await createImageBitmap(file);
    }
  } catch { return null; }   // unsupported format → caller falls back
  try {
    const sc = Math.min(1, tw / Math.max(bmp.width, 1));
    const w = Math.max(1, Math.round(bmp.width  * sc));
    const h = Math.max(1, Math.round(bmp.height * sc));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d', { alpha: false }).drawImage(bmp, 0, 0, w, h);
    const blob = await canvasToBlob(c);
    if (blob) _thumbCache.set(file, { px, blob });
    return blob;
  } catch { return null; }
  finally { if (bmp && bmp.close) bmp.close(); }
}

// Resolve once the video actually has a PAINTABLE frame at the new time.
// 'seeked' alone is unreliable — Safari in particular fires it before the
// frame is decodable, which is what produced black thumbnails. Where
// supported, requestVideoFrameCallback fires only when a real frame has
// been presented; elsewhere we pad 'seeked' with a short settle delay.
function awaitFrame(v) {
  return new Promise(res => {
    let done = false;
    const ok = () => { if (!done) { done = true; res(); } };
    const t = setTimeout(ok, 1500);            // hard cap — never hang the queue
    if (v.requestVideoFrameCallback) {
      v.requestVideoFrameCallback(() => { clearTimeout(t); ok(); });
    } else {
      v.addEventListener('seeked', () => {
        setTimeout(() => { clearTimeout(t); ok(); }, 60);
      }, { once: true });
    }
  });
}

// Seek, wait for a real frame, draw it, and report its average brightness
// (0–255). The 8×8 luminance probe costs microseconds; 0 means nothing
// usable was decoded at all, low values mean a dark-but-real frame.
async function grabFrame(v, time, c, ctx2, pctx) {
  const framed = awaitFrame(v);   // register BEFORE seeking
  try { v.currentTime = time; } catch {}
  await framed;
  ctx2.drawImage(v, 0, 0, c.width, c.height);
  pctx.drawImage(v, 0, 0, 8, 8);
  const d = pctx.getImageData(0, 0, 8, 8).data;
  let lum = 0;
  for (let i = 0; i < d.length; i += 4) lum += d[i] + d[i + 1] + d[i + 2];
  return lum / (64 * 3);
}

async function vidThumb(file, px) {
  const cached = _thumbCache.get(file);
  if (cached && cached.px >= px) return cached.blob;
  const u = URL.createObjectURL(file);
  const v = document.createElement('video');
  try {
    Object.assign(v, { preload: 'auto', muted: true, playsInline: true, src: u });
    await new Promise((res, rej) => {
      const t = setTimeout(rej, 4000);
      v.addEventListener('loadedmetadata', () => { clearTimeout(t); res(); }, { once: true });
      v.addEventListener('error', () => { clearTimeout(t); rej(); }, { once: true });
    });
    if (!v.videoWidth || !v.videoHeight) return null;
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 4;

    const sc = Math.min(1, px / Math.max(1, Math.min(v.videoWidth, v.videoHeight)));
    const c  = document.createElement('canvas');
    c.width  = Math.max(1, Math.round(v.videoWidth  * sc));
    c.height = Math.max(1, Math.round(v.videoHeight * sc));
    const ctx2 = c.getContext('2d', { alpha: false });
    const probe = document.createElement('canvas');
    probe.width = probe.height = 8;
    const pctx = probe.getContext('2d', { alpha: false, willReadFrequently: true });

    // Frame just past the start first (cheapest); step deeper if it's black.
    const tries = [Math.min(dur * .1, .8), Math.min(dur * .25, 3), Math.min(dur * .5, 8)];
    let best = 0;
    for (let i = 0; i < tries.length; i++) {
      const lum = await grabFrame(v, tries[i], c, ctx2, pctx);
      if (lum > best) best = lum;
      if (lum > 10) break;          // bright enough — done
    }
    // Nothing ever decoded (decoder pressure / broken file): report failure
    // so the caller can retry. Crucially, do NOT cache a blank black frame.
    if (best <= 0) return null;

    const blob = await canvasToBlob(c);
    if (blob) _thumbCache.set(file, { px, blob });
    return blob;
  } catch { return null; }
  finally {
    // Release the media decoder IMMEDIATELY. iOS only allows a handful of
    // live <video> elements; leaving them to the garbage collector is what
    // made runs of consecutive tiles fail to thumbnail.
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch {}
    revokeURL(u);
  }
}

/* ── Hold gesture (single-element) ────────────────────── */
function attachHold(el, cb) {
  let timer = null, sx = 0, sy = 0, fired = false;
  const start = (x, y) => {
    fired = false; sx = x; sy = y;
    timer = setTimeout(() => { timer = null; fired = true; cb(x, y); }, HOLD_MS);
  };
  const move = (x, y) => {
    if (timer && Math.hypot(x - sx, y - sy) > HOLD_DRIFT) { clearTimeout(timer); timer = null; }
  };
  const end = () => { clearTimeout(timer); timer = null; };

  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    start(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!timer || e.touches.length !== 1) { end(); return; }
    move(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  el.addEventListener('touchend',    end, { passive: true });
  el.addEventListener('touchcancel', end, { passive: true });
  el.addEventListener('contextmenu', e => { e.preventDefault(); cb(e.clientX, e.clientY); });
  el.addEventListener('click', e => {
    if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); }
  }, { capture: true });
}

/* ── Gallery: delegated hold + click ──────────────────── */
(function setupGalleryDelegation() {
  let timer = null, sx = 0, sy = 0, holdTile = null, fired = false;

  const begin = (tile, x, y) => {
    holdTile = tile; sx = x; sy = y; fired = false;
    timer = setTimeout(() => {
      timer = null; fired = true;
      handleHold(holdTile, sx, sy);
    }, HOLD_MS);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

  gallery.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const t = e.touches[0];
    begin(tile, t.clientX, t.clientY);
  }, { passive: true });

  gallery.addEventListener('touchmove', e => {
    if (!timer || e.touches.length !== 1) { cancel(); return; }
    const t = e.touches[0];
    if (Math.hypot(t.clientX - sx, t.clientY - sy) > HOLD_DRIFT) cancel();
  }, { passive: true });

  gallery.addEventListener('touchend',    cancel, { passive: true });
  gallery.addEventListener('touchcancel', cancel, { passive: true });

  gallery.addEventListener('contextmenu', e => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    handleHold(tile, e.clientX, e.clientY);
  });

  // Capture-phase click suppression after a hold fired
  gallery.addEventListener('click', e => {
    if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); }
  }, { capture: true });

  // Bubble-phase click handler — open viewer or toggle select
  gallery.addEventListener('click', e => {
    const tile = e.target.closest('.tile');
    if (!tile || !tile._file) return;
    const file = tile._file;
    if (selectMode) { toggleSelect(file, tile); return; }
    curFile = file;
    openViewer(getFiltered());
  });

  function handleHold(tile, x, y) {
    const file = tile._file;
    if (!file) return;
    if (!selectMode) {
      enterSelectMode(file, tile);
    } else {
      curFile = file; refreshFavBtn(file); showCtxAt(x, y);
    }
  }
})();

/* ── Context menu (file) ──────────────────────────────── */
function showCtxAt(x, y) {
  ctxBackdrop.classList.add('show');
  ctx.style.transform = 'translate(-9999px,-9999px)';
  ctx.style.display = 'block';
  const w = ctx.offsetWidth, h = ctx.offsetHeight, pad = 10;
  ctx.style.transform = `translate(${clamp(x - w / 2, pad, innerWidth - w - pad)}px,${clamp(y - h - 8, pad, innerHeight - h - pad)}px)`;
  ctx.classList.add('sIn');
}
function hideCtx() {
  ctx.style.display = 'none';
  ctx.style.transform = 'translate(-9999px,-9999px)';
  if (fldCtx.style.display !== 'block') ctxBackdrop.classList.remove('show');
}
document.addEventListener('click', e => {
  if (ctx.style.display === 'block' && !ctx.contains(e.target) && e.target !== moreBtn) hideCtx();
});

moreBtn.onclick = () => {
  refreshFavBtn(curFile);
  const r = moreBtn.getBoundingClientRect();
  showCtxAt(r.left + r.width / 2, r.top - 4);
};
ctxX.onclick = hideCtx;

ctxSave.onclick = () => {
  if (!curFile) return;
  downloadBlob(curFile, curFile.name || (isImg(curFile) ? 'image' : 'video'));
  hideCtx(); showToast('Saved to Files');
};
ctxFav.onclick    = () => { toggleFav(curFile); hideCtx(); };
ctxFolder.onclick = () => { hideCtx(); openFolderPicker(curFile); };

ctxDel.onclick = () => {
  if (!curFile) return;
  const file = curFile, wasOpen = viewer.classList.contains('open');
  const snap = captureRemoval([file]);   // BEFORE mutation
  const fl = getFiltered(), dIdx = fl.indexOf(file), lIdx = list.indexOf(file);
  if (lIdx >= 0) list.splice(lIdx, 1);
  favs.delete(file); saveFavs();
  const k = favKey(file);
  folders.forEach(({ files }) => files.delete(k));
  saveVault();
  invList(); invFolders(); invFilter();
  hideCtx();
  const undo = { label: 'Undo', cb: () => restoreRemoval(snap) };
  if (!list.length) {
    curFile = null; closeViewerImmediate();
    gallery.textContent = ''; clearThumbURLs();
    emptyEl.style.display = '';
    renderFolderList(); updateFldDot(); setStatus();
    showToast('Removed', 2400, undo);
    return;
  }
  const nextFL = getFiltered();
  buildGallery(nextFL); renderFolderList(); updateFldDot(); setStatus();
  if (wasOpen) {
    if (!nextFL.length) { closeViewer(); }
    else {
      curFile = nextFL[Math.min(Math.max(dIdx, 0), nextFL.length - 1)];
      renderViewer(nextFL);
    }
  }
  showToast('Removed', 2400, undo);
};

ctxExportFavs.onclick = () => {
  hideCtx();
  const favList = [...favs].map(f => f.name || '(unnamed)');
  if (!favList.length) { showToast('No favourites yet — tap the heart on any file'); return; }
  downloadBlob(new Blob([
    `Media Mover — Favourites (${favList.length})\n${new Date().toLocaleString()}\n\n` + favList.join('\n')
  ], { type: 'text/plain' }), 'favourites.txt');
  showToast(`Exported ${favList.length} favourite${favList.length !== 1 ? 's' : ''}`);
};

/* ── Gallery builder ──────────────────────────────────── */
function buildGallery(files) {
  const seq = ++bSeq;

  // Tear down previous observer + revoke previous thumbnail URLs.
  // This was the main memory leak: blob URLs from prior renders persisted
  // until file-picker reset, growing on every tab switch / filter change.
  if (buildGallery._obs) { buildGallery._obs.disconnect(); buildGallery._obs = null; }
  clearThumbURLs();
  gallery.textContent = '';

  if (!files.length) {
    emptyEl.style.display = '';
    if (activeTab === 'folder' && activeFolderName) {
      emptyTit.textContent  = 'No matches';
      emptyHint.textContent = 'None of your loaded files are in this folder yet. Add files using "Hold → Add to Folder".';
    } else if (activeTab === 'fav') {
      emptyTit.textContent  = 'No favourites yet';
      emptyHint.textContent = 'Tap the heart on any file, or hold a tile and choose Favourite.';
    } else {
      emptyTit.textContent  = 'Nothing here';
      emptyHint.textContent = 'Try selecting a different tab, or load more files.';
    }
    return;
  }
  emptyEl.style.display = 'none';
  if (selectMode) gallery.classList.add('selMode');

  const dm         = getDupeMap();
  const showDupes  = togDupes.checked;
  const folderKeys = getAllFolderKeys();
  const frag       = document.createDocumentFragment();

  for (let i = 0; i < files.length; i++) {
    const t = buildTile(files[i], dm, showDupes, folderKeys);
    t._idx = i;   // used to keep thumbnail loading in strict tile order
    frag.appendChild(t);
  }
  gallery.appendChild(frag);

  // Lazy thumbnail loading via a single IntersectionObserver. Jobs always
  // START in tile order (1, 2, 3…) but several run at once — strict
  // one-at-a-time was the bottleneck. The grid still fills top-to-bottom,
  // just a few tiles at a time, and cached thumbs resolve instantly.
  const thumbPx = calcThumbPx();   // measured AFTER tiles are in the DOM

  const setThumb = (img, blob) => {
    const u = URL.createObjectURL(blob);
    thumbURLs.push(u);     // revoked on next rebuild
    img.src = u;
  };

  // Live progress in the status bar so big imports don't feel frozen.
  let qTotal = 0, qDone = 0;
  const bumpProgress = () => {
    qDone++;
    if (seq !== bSeq || selectMode) return;
    if (qDone < qTotal) msg.textContent = `Generating thumbnails ${qDone}/${qTotal}…`;
    else setStatus();
  };

  // Ordered queue factory: binary-insert by tile index so loading order
  // matches the screen, with up to `limit` jobs in flight at once.
  const makeQueue = (worker, limit) => {
    const q = [];
    let active = 0;
    const drain = () => {
      while (active < limit && q.length) {
        const job = q.shift();
        if (job.s !== bSeq) continue;   // gallery rebuilt — skip stale job
        active++;
        worker(job).finally(() => { active--; drain(); });
      }
    };
    return job => {
      let lo = 0, hi = q.length;
      while (lo < hi) { const m = (lo + hi) >> 1; q[m].idx < job.idx ? lo = m + 1 : hi = m; }
      q.splice(lo, 0, job);
      drain();
    };
  };

  const pushImg = makeQueue(async job => {
    const { img, file, s } = job;
    const blob = await makeImgThumb(file, thumbPx);
    if (s === bSeq) {
      if (blob) setThumb(img, blob);
      else {
        // Format createImageBitmap can't read — direct decode fallback.
        // If even that fails, the img error handler shows the broken state.
        const u = URL.createObjectURL(file);
        thumbURLs.push(u);
        img.src = u;
      }
    }
    bumpProgress();
  }, IMG_THUMB_CAP);

  const pushVid = makeQueue(async job => {
    const { img, file, s } = job;
    const blob = await vidThumb(file, thumbPx);
    if (s !== bSeq) { bumpProgress(); return; }
    if (blob) { setThumb(img, blob); bumpProgress(); return; }
    if (!job.retried) {
      // Failures here are usually transient decoder pressure — one retry,
      // re-inserted in order, catches nearly all of them.
      job.retried = true;
      pushVid(job);
      return;   // not done yet — don't advance the progress counter
    }
    bumpProgress();   // gave up — placeholder stays, tile still opens fine
  }, VID_THUMB_CAP);

  const obs = new IntersectionObserver(entries => {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.isIntersecting) continue;
      obs.unobserve(entry.target);
      const tile = entry.target, file = tile._file;
      if (!file) continue;
      const img = tile.firstChild;
      if (!img || img.src) continue;
      const s = bSeq, idx = tile._idx || 0;
      if (isImg(file)) {
        if (file.size && file.size < THUMB_TINY) {
          // Already tiny — decoding directly beats re-encoding it.
          const u = URL.createObjectURL(file);
          thumbURLs.push(u);
          img.src = u;
        } else {
          qTotal++;
          pushImg({ img, file, s, idx });
        }
      } else {
        img.src = VID_PH;
        img.classList.add('loaded');
        qTotal++;
        pushVid({ img, file, s, idx });
      }
    }
  }, { rootMargin: '400px 0px', threshold: 0 });

  buildGallery._obs = obs;
  const kids = gallery.children;
  for (let i = 0; i < kids.length; i++) obs.observe(kids[i]);
}
buildGallery._obs = null;

function buildTile(file, dm, showDupes, folderKeys) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile._file = file;
  if (selectMode && selected.has(file)) tile.classList.add('selected');

  const img = document.createElement('img');
  img.className = 'tImg';
  img.alt = file.name || '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.addEventListener('load',  () => img.classList.add('loaded'), { once: true });
  img.addEventListener('error', () => {
    img.classList.add('loaded');
    // Show an explicit "can't preview" state rather than an empty tile.
    if (img.src && img.src !== IMG_ERR) img.src = IMG_ERR;
  });
  tile.appendChild(img);  // must be firstChild — observer relies on this

  const ovl = document.createElement('div');
  ovl.className = 'ovl';
  tile.appendChild(ovl);

  const badge = document.createElement('div');
  const vid = isVid(file);
  badge.className = 'badge ' + (vid ? 'bVid' : 'bImg');
  badge.textContent = vid ? 'VID' : 'IMG';
  tile.appendChild(badge);

  const chk = document.createElement('div');
  chk.className = 'tCheck';
  tile.appendChild(chk);

  if (vid) {
    const pl = document.createElement('div');
    pl.className = 'plIco';
    pl.innerHTML = '<svg viewBox="0 0 10 10"><polygon points="2,1 9,5 2,9"/></svg>';
    tile.appendChild(pl);
  }

  if (showDupes && (dm.get(dupeKey(file)) || 0) > 1) {
    const bd = document.createElement('div');
    bd.className = 'bDup'; bd.textContent = 'DUP';
    tile.appendChild(bd);
  }

  if (favs.has(file)) {
    const star = document.createElement('div');
    star.className = 'favSt'; star.innerHTML = svgIcon('icon-favorites');
    tile.appendChild(star);
  }

  if (folderKeys.has(favKey(file))) {
    const fb = document.createElement('div');
    fb.className = 'fldSt'; fb.innerHTML = svgIcon('icon-folders');
    tile.appendChild(fb);
  }

  return tile;
}

/* ── Viewer ───────────────────────────────────────────── */
function openViewer(fl) {
  renderViewer(fl || getFiltered());
  if (!viewer.classList.contains('open')) {
    viewer.classList.add('open');
    viewer.style.animation = 'fIn .18s ease-out both';
  }
  hideCtx();
}
function closeViewer() {
  if (!viewer.classList.contains('open')) return;
  if (zS?.rafId) { cancelAnimationFrame(zS.rafId); zS.rafId = null; }
  viewer.style.animation = 'fOut .15s ease-in both';
  viewer.addEventListener('animationend', () => {
    viewer.classList.remove('open');
    viewer.style.animation = '';
    _cleanupViewer();
  }, { once: true });
  hideCtx();
  if (cinemaMode) setCinema(false);
  if (document.fullscreenElement === viewer || document.webkitFullscreenElement === viewer) exitNativeFS();
}
function closeViewerImmediate() {
  viewer.classList.remove('open');
  viewer.style.animation = '';
  hideCtx();
  if (cinemaMode) setCinema(false);
  if (document.fullscreenElement === viewer || document.webkitFullscreenElement === viewer) exitNativeFS();
  _cleanupViewer();
}
function _cleanupViewer() {
  if (zS?.rafId) cancelAnimationFrame(zS.rafId);
  zS = null;
  revokeURL(curURL); curURL = null;
  vCon.textContent = '';
}

function renderViewer(fl) {
  const viewList = fl || getFiltered();
  if (!curFile && viewList.length) curFile = viewList[0];
  const idx = curFile ? viewList.indexOf(curFile) : -1;

  revokeURL(curURL); curURL = null;
  if (zS?.rafId) { cancelAnimationFrame(zS.rafId); zS.rafId = null; }
  zS = null;
  vCon.textContent = '';

  if (!curFile) { vName.textContent = '—'; vSz.textContent = '—'; return; }

  vName.textContent = curFile.name || 'Untitled';
  vSz.textContent   = fmtBytes(curFile.size);
  vCtr.textContent  = (idx >= 0 ? idx + 1 : '?') + ' / ' + viewList.length;
  prevBtn.disabled  = idx <= 0;
  nextBtn.disabled  = idx >= viewList.length - 1;
  refreshFavBtn(curFile);
  zIn.disabled = zOut.disabled = false;
  zTab.style.display = '';

  invStage();   // new media — stale stage/image measurements are invalid
  curURL = URL.createObjectURL(curFile);
  if (isImg(curFile)) {
    const img = document.createElement('img');
    img.id = 'zImg'; img.draggable = false; img.decoding = 'async';
    // Progressive open: the cached grid thumb appears INSTANTLY while the
    // full-resolution original decodes in the background, then swaps in.
    // Decoding a 48MP photo can take hundreds of ms — previously that was
    // a blank stage; now the viewer never shows empty.
    const cached = _thumbCache.get(curFile);
    if (cached) {
      const tu = URL.createObjectURL(cached.blob);
      img.src = tu;
      const full = new Image();
      full.decoding = 'async';
      full.src = curURL;
      const ready = full.decode
        ? full.decode()
        : new Promise(r => { full.onload = r; full.onerror = r; });
      ready.catch(() => {}).then(() => {
        // Only swap if the user hasn't navigated away in the meantime.
        if (img.isConnected && img.src === tu) img.src = curURL;
        revokeURL(tu);
      });
    } else {
      img.src = curURL;
    }
    vCon.appendChild(img);
    setupZoom(img);
  } else {
    const v = document.createElement('video');
    v.id = 'vVid'; v.src = curURL; v.controls = true;
    v.playsInline = true; v.preload = 'metadata';
    vCon.appendChild(v);
    // No zoom for videos — hide the tab entirely so it's out of the way.
    zTab.style.display = 'none';
    zTab.classList.remove('open');
  }
}

function nextItem() {
  const fl = getFiltered(), i = curFile ? fl.indexOf(curFile) : -1;
  if (i < fl.length - 1) { curFile = fl[i + 1]; renderViewer(fl); }
}
function prevItem() {
  const fl = getFiltered(), i = curFile ? fl.indexOf(curFile) : -1;
  if (i > 0) { curFile = fl[i - 1]; renderViewer(fl); }
}
closeBtn.onclick = closeViewer;
prevBtn.onclick  = prevItem;
nextBtn.onclick  = nextItem;

/* ── Swipe ────────────────────────────────────────────── */
// Two ways to trigger navigation: a deliberate drag past SWIPE_DIST_MIN,
// or a fast flick — anything crossing SWIPE_FLICK_MIN within SWIPE_FLICK_MS
// counts even if the finger barely moved. That second path is what makes
// small, quick swipes register without needing a long drag across the
// screen. The vertical-cancel margin is also tighter (was 10px) since the
// stage never scrolls vertically, so there's nothing to protect against.
const SWIPE_DIST_MIN  = 30;
const SWIPE_FLICK_MIN = 14;
const SWIPE_FLICK_MS  = 260;
let swX = 0, swY = 0, swT = 0, swActive = false, swHoriz = false;
vStage.addEventListener('touchstart', e => {
  swActive = false; swHoriz = false;
  if (!swipeOn || e.touches.length !== 1 || (zS && zS.scale > 1.02)) return;
  swX = e.touches[0].clientX; swY = e.touches[0].clientY;
  swT = Date.now();
  swActive = true;
}, { passive: true });
vStage.addEventListener('touchmove', e => {
  if (!swActive || e.touches.length !== 1) { swActive = false; return; }
  const dx = Math.abs(e.touches[0].clientX - swX), dy = Math.abs(e.touches[0].clientY - swY);
  if (!swHoriz) {
    if (dy > dx + 6) { swActive = false; return; }
    if (dx > 6) swHoriz = true;
  }
}, { passive: true });
vStage.addEventListener('touchend', e => {
  if (!swActive || !swHoriz) { swActive = false; return; }
  swActive = false; swHoriz = false;
  if (zS && zS.scale > 1.02) return;
  const dx = e.changedTouches[0].clientX - swX;
  const fast = (Date.now() - swT) < SWIPE_FLICK_MS && Math.abs(dx) > SWIPE_FLICK_MIN;
  if (dx < 0 && (dx <= -SWIPE_DIST_MIN || fast)) nextItem();
  else if (dx > 0 && (dx >= SWIPE_DIST_MIN || fast)) prevItem();
}, { passive: true });

/* ── Zoom ────────────────────────────────────────────────
 * Coordinate model:
 *   transform-origin: center center
 *   Image is flex-centered in vStage, so its natural-center sits at the stage center.
 *   With transform = translate(tx,ty) scale(s), an image-space offset (dx,dy) from the
 *   image's natural center renders in the viewport at:
 *       (stage_cx + tx + dx*s, stage_cy + ty + dy*s)
 *
 * Zoom-around-viewport-point (vx,vy) — keep that point stable while scale s -> s':
 *   let px = vx - stage_cx, py = vy - stage_cy
 *   tx' = px - (px - tx) * (s'/s)        (image-size-independent)
 *
 * Pan clamp:
 *   When imgW*s > stageW: |tx| <= (imgW*s - stageW)/2
 *   Else:                  tx is forced to 0 (image fits, keep centered)
 * ──────────────────────────────────────────────────────── */

// Stage-rect / image-dimension cache. clampT and the pinch handler run on
// EVERY pointermove, and each getBoundingClientRect / offsetWidth call
// forces a synchronous layout read — the main source of gesture jank on
// large images. Measure once, invalidate only when layout actually changes.
let _stRect = null, _imgW = 0, _imgH = 0;
function stageRect() { return _stRect || (_stRect = vStage.getBoundingClientRect()); }
function invStage()  { _stRect = null; _imgW = _imgH = 0; }
window.addEventListener('resize', invStage);

function showHUD(pct) {
  const s = Math.round(pct) + '%';
  zHUD.textContent = s; zLvl.textContent = s;
  zHUD.classList.add('vis');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => zHUD.classList.remove('vis'), 1400);
  if (zS) {
    zIn.disabled  = zS.scale >= Z_MAX - .01;
    zOut.disabled = zS.scale <= Z_MIN + .01;
  }
}
function applyT(img) {
  if (!zS) return;
  img.style.transform = `translate3d(${zS.x}px,${zS.y}px,0) scale(${zS.scale})`;
}
function clampT(img) {
  const st = stageRect();
  if (!_imgW) {
    _imgW = img.offsetWidth  || st.width;
    _imgH = img.offsetHeight || st.height;
  }
  const sw = _imgW * zS.scale, sh = _imgH * zS.scale;
  const mx = sw > st.width  ? (sw - st.width)  / 2 : 0;
  const my = sh > st.height ? (sh - st.height) / 2 : 0;
  zS.x = clamp(zS.x, -mx, mx);
  zS.y = clamp(zS.y, -my, my);
}
function zoomToPoint(img, ns, vx, vy) {
  if (!zS) return;
  ns = clamp(ns, Z_MIN, Z_MAX);
  const st = stageRect();
  const cx = st.left + st.width / 2, cy = st.top + st.height / 2;
  const px = vx - cx, py = vy - cy;
  const r = ns / zS.scale;
  zS.x = px - (px - zS.x) * r;
  zS.y = py - (py - zS.y) * r;
  zS.scale = ns;
  clampT(img); applyT(img);
  showHUD(ns * 100);
}

// Animation only fires on explicit triggers: buttons, double-tap, fit.
// During active pinch/pan, transforms are applied directly (no spring).
function animateZoom(img, targetScale, vx, vy) {
  if (!zS) return;
  if (zS.rafId) { cancelAnimationFrame(zS.rafId); zS.rafId = null; }
  const st = stageRect();
  const cx = st.left + st.width / 2, cy = st.top + st.height / 2;
  const px = (vx == null ? cx : vx) - cx;
  const py = (vy == null ? cy : vy) - cy;
  const ns = clamp(targetScale, Z_MIN, Z_MAX);
  const sScale = zS.scale, sX = zS.x, sY = zS.y;
  const r = ns / sScale;
  let eX = px - (px - sX) * r;
  let eY = py - (py - sY) * r;
  // At scale 1 the image is centered (no overflow possible), so snap to 0.
  if (ns <= 1.001) { eX = 0; eY = 0; }
  const me = zS;
  const t0 = performance.now(), dur = 220;
  const step = now => {
    if (zS !== me) return;          // viewer swapped image mid-animation
    const u = Math.min(1, (now - t0) / dur);
    const e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    zS.scale = sScale + (ns - sScale) * e;
    zS.x = sX + (eX - sX) * e;
    zS.y = sY + (eY - sY) * e;
    clampT(img); applyT(img);
    showHUD(zS.scale * 100);
    if (u < 1) zS.rafId = requestAnimationFrame(step);
    else zS.rafId = null;
  };
  zS.rafId = requestAnimationFrame(step);
}

function zStep(d) {
  if (!zS) return;
  const img = vCon.querySelector('#zImg'); if (!img) return;
  animateZoom(img, zS.scale + d);
}
function doFit() {
  if (!zS) return;
  const img = vCon.querySelector('#zImg'); if (!img) return;
  animateZoom(img, 1);
}
// Zoom tab: collapsed magnifier by default; expands to − % +, auto-collapses
// after 4s of no interaction. Tapping the percentage resets to fit.
let zTabTimer = null;
function pokeZTab() {
  clearTimeout(zTabTimer);
  zTabTimer = setTimeout(() => zTab.classList.remove('open'), 4000);
}
zTabBtn.addEventListener('click', () => {
  if (zTab.classList.toggle('open')) pokeZTab();
  else clearTimeout(zTabTimer);
});
zLvl.onclick = () => { doFit();      pokeZTab(); };
zIn.onclick  = () => { zStep(.6);    pokeZTab(); };
zOut.onclick = () => { zStep(-.6);   pokeZTab(); };

// Wheel: ctrl/meta or trackpad pinch (ctrlKey) zooms toward cursor.
// Plain wheel at fit also zooms. Plain wheel when zoomed pans.
vStage.addEventListener('wheel', e => {
  if (!zS) return;
  const img = vCon.querySelector('#zImg'); if (!img) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey || zS.scale <= 1.01) {
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? .07 : .0028));
    zoomToPoint(img, zS.scale * factor, e.clientX, e.clientY);
  } else {
    const mul = e.deltaMode === 1 ? 20 : 1;
    zS.x -= e.deltaX * mul;
    zS.y -= e.deltaY * mul;
    clampT(img); applyT(img);
  }
}, { passive: false });

function setupZoom(img) {
  zS = {
    scale: 1, x: 0, y: 0,
    p1: null, p2: null,
    sDist: 1, sScale: 1, sMx: 0, sMy: 0, sTx: 0, sTy: 0,
    pLX: 0, pLY: 0,
    downX: 0, downY: 0,
    didPan: false, didPinch: false,
    lastTap: 0, lastTapX: 0, lastTapY: 0,
    rafId: null,
  };
  applyT(img);
  if (img.complete && img.naturalWidth) showHUD(100);
  else img.addEventListener('load', () => showHUD(100), { once: true });
  // Re-measure whenever a new bitmap lands (incl. the full-res progressive
  // swap) — displayed size can settle differently after decode.
  img.addEventListener('load', () => { _imgW = _imgH = 0; });

  img.addEventListener('pointerdown', e => {
    try { img.setPointerCapture(e.pointerId); } catch {}
    // Kill any in-flight animation so the user's gesture takes over instantly.
    if (zS.rafId) { cancelAnimationFrame(zS.rafId); zS.rafId = null; }

    const pt = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (!zS.p1) {
      zS.p1 = pt;
      zS.pLX = e.clientX; zS.pLY = e.clientY;
      zS.downX = e.clientX; zS.downY = e.clientY;
      zS.didPan = false;
    } else if (!zS.p2 && zS.p1.id !== e.pointerId) {
      zS.p2 = pt;
      zS.sDist  = Math.hypot(zS.p1.x - zS.p2.x, zS.p1.y - zS.p2.y) || 1;
      zS.sScale = zS.scale;
      zS.sMx    = (zS.p1.x + zS.p2.x) / 2;
      zS.sMy    = (zS.p1.y + zS.p2.y) / 2;
      zS.sTx    = zS.x; zS.sTy = zS.y;
      zS.didPinch = true;
    }
  });

  img.addEventListener('pointermove', e => {
    if (!zS.p1) return;
    if (zS.p1.id === e.pointerId)              { zS.p1.x = e.clientX; zS.p1.y = e.clientY; }
    if (zS.p2 && zS.p2.id === e.pointerId)     { zS.p2.x = e.clientX; zS.p2.y = e.clientY; }

    if (zS.p2) {
      // Pinch zoom — anchor on start-midpoint + drift midpoint for natural two-finger pan.
      const dist = Math.hypot(zS.p1.x - zS.p2.x, zS.p1.y - zS.p2.y);
      const mx = (zS.p1.x + zS.p2.x) / 2, my = (zS.p1.y + zS.p2.y) / 2;
      const ns = clamp(zS.sScale * (dist / zS.sDist), Z_MIN, Z_MAX);
      const st = stageRect();
      const cx = st.left + st.width / 2, cy = st.top + st.height / 2;
      const pxS = zS.sMx - cx, pyS = zS.sMy - cy;
      const r = ns / zS.sScale;
      zS.x = (mx - cx) - (pxS - zS.sTx) * r;
      zS.y = (my - cy) - (pyS - zS.sTy) * r;
      zS.scale = ns;
      clampT(img); applyT(img);
      showHUD(ns * 100);
    } else {
      // Single-finger pan — only when zoomed in.
      if (zS.scale <= 1.01) {
        zS.pLX = e.clientX; zS.pLY = e.clientY;
        return;
      }
      const dx = e.clientX - zS.pLX, dy = e.clientY - zS.pLY;
      zS.pLX = e.clientX; zS.pLY = e.clientY;
      if (!zS.didPan && Math.hypot(e.clientX - zS.downX, e.clientY - zS.downY) > 4) {
        zS.didPan = true;
        img.classList.add('pan');
      }
      zS.x += dx; zS.y += dy;
      clampT(img); applyT(img);
    }
  });

  const onUp = e => {
    const wasP1 = zS.p1 && zS.p1.id === e.pointerId;
    const wasP2 = zS.p2 && zS.p2.id === e.pointerId;

    if (wasP2) {
      // Second finger up — continue with the remaining one.
      // Keep didPinch true so a stray tap on lift doesn't double-tap.
      zS.p2 = null;
      if (zS.p1) { zS.pLX = zS.p1.x; zS.pLY = zS.p1.y; }
    } else if (wasP1) {
      // Tap / double-tap detection — only fires when this gesture was just a tap.
      const moved = Math.hypot(e.clientX - zS.downX, e.clientY - zS.downY) > 6;
      if (!zS.didPan && !zS.didPinch && !moved && !zS.p2) {
        const now = Date.now();
        const closeEnough = Math.hypot(e.clientX - zS.lastTapX, e.clientY - zS.lastTapY) < 32;
        if (now - zS.lastTap < 320 && closeEnough) {
          if (zS.scale < 1.5) animateZoom(img, 2.8, e.clientX, e.clientY);
          else                animateZoom(img, 1);
          zS.lastTap = 0;
        } else {
          zS.lastTap = now;
          zS.lastTapX = e.clientX;
          zS.lastTapY = e.clientY;
        }
      }
      // Promote p2 -> p1 if user lifted first finger while second is still down.
      zS.p1 = zS.p2 ? { id: zS.p2.id, x: zS.p2.x, y: zS.p2.y } : null;
      zS.p2 = null;
      if (zS.p1) { zS.pLX = zS.p1.x; zS.pLY = zS.p1.y; }
    }

    if (!zS.p1 && !zS.p2) {
      img.classList.remove('pan');
      zS.didPan = false;
      zS.didPinch = false;
    }
  };
  img.addEventListener('pointerup', onUp);
  img.addEventListener('pointercancel', e => {
    if (zS.p1 && zS.p1.id === e.pointerId) zS.p1 = null;
    if (zS.p2 && zS.p2.id === e.pointerId) zS.p2 = null;
    if (!zS.p1 && !zS.p2) {
      img.classList.remove('pan');
      zS.didPan = false;
      zS.didPinch = false;
    }
  });
}

/* ── Fullscreen & Cinema ──────────────────────────────── */
const isNativeFS   = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const exitNativeFS = () => { try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch {} };
function enterNativeFS(el, fallback) {
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) { fallback?.(); return; }
  try { const p = req.call(el); if (p?.catch) p.catch(() => fallback?.()); }
  catch { fallback?.(); }
}
function setCinema(on) {
  cinemaMode = on;
  invStage();   // top/bottom bars toggle — stage size changes
  viewer.classList.toggle('cinema', on);
  vFsBtn.innerHTML = svgIcon(on ? 'icon-collapse' : 'icon-expand');
  vFsBtn.classList.toggle('on', on);
}
fsBtn.addEventListener('click', () => {
  if (isNativeFS()) { exitNativeFS(); return; }
  enterNativeFS(document.documentElement, () => showToast('Fullscreen not available'));
});
vFsBtn.addEventListener('click', () => {
  if (isNativeFS()) { exitNativeFS(); return; }
  if (cinemaMode)   { setCinema(false); return; }
  enterNativeFS(viewer, () => setCinema(true));
});
cinemaExit.addEventListener('click', () => {
  if (isNativeFS()) exitNativeFS();
  else setCinema(false);
});
function onFSChange() {
  invStage();   // fullscreen transitions resize the stage
  const on  = isNativeFS();
  const vFS = on && (document.fullscreenElement === viewer || document.webkitFullscreenElement === viewer);
  fsBtn.innerHTML  = svgIcon((on && !vFS) ? 'icon-collapse' : 'icon-expand');
  fsBtn.classList.toggle('on', on && !vFS);
  vFsBtn.innerHTML = svgIcon((vFS || cinemaMode) ? 'icon-collapse' : 'icon-expand');
  vFsBtn.classList.toggle('on', vFS || cinemaMode);
  if (!on && cinemaMode) setCinema(false);
}
document.addEventListener('fullscreenchange',       onFSChange);
document.addEventListener('webkitfullscreenchange', onFSChange);

/* ── Settings panel ───────────────────────────────────── */
function toggleSP(on) {
  sPanel.style.display = on ? 'block' : 'none';
  if (on) sPanel.classList.add('sIn');
}
settingsBtn.addEventListener('click', e => { e.stopPropagation(); toggleSP(sPanel.style.display !== 'block'); });
settingsBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); settingsBtn.click(); } });
document.addEventListener('click', e => {
  if (!sPanel.contains(e.target) && e.target !== settingsBtn) toggleSP(false);
});
document.addEventListener('scroll', () => toggleSP(false), { passive: true });

togSwipe.addEventListener('change', () => { swipeOn = togSwipe.checked; });
togSort.addEventListener('change', async () => {
  newestF = togSort.checked;
  if (list.length) { await sortFiles(); buildGallery(getFiltered()); setStatus(); }
});
togExif.addEventListener('change', async () => {
  prefExif = togExif.checked;
  if (list.length) { msg.textContent = 'Reading EXIF dates…'; await sortFiles(); buildGallery(getFiltered()); setStatus(); }
});
togDupes.addEventListener('change', () => { if (list.length) buildGallery(getFiltered()); });

sGBtnEls.forEach(btn => {
  btn.addEventListener('click', () => {
    sGBtnEls.forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    const sz = btn.dataset.gs;
    gallery.style.gridTemplateColumns = `repeat(auto-fill,minmax(${sz}px,1fr))`;
    try { localStorage.setItem(LS_GRIDSIZE, sz); } catch {}
  });
});

/* ── Keyboard shortcuts ──────────────────────────────── */
document.addEventListener('keydown', e => {
  const inV = viewer.classList.contains('open');
  if (e.key === 'Escape') {
    if (sPanel.style.display === 'block')        { toggleSP(false); return; }
    if (fldPicker.classList.contains('open'))    { closeFolderPicker(); return; }
    if (ctx.style.display === 'block')           { hideCtx(); return; }
    if (fldCtx.style.display === 'block')        { hideFldCtx(); return; }
    if (selectMode)                              { exitSelectMode(); return; }
    if (cinemaMode)                              { setCinema(false); return; }
    if (inV)                                     { closeViewer(); return; }
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (inV) {
      if (isNativeFS())   exitNativeFS();
      else if (cinemaMode) setCinema(false);
      else                enterNativeFS(viewer, () => setCinema(true));
    } else {
      if (isNativeFS()) exitNativeFS();
      else              enterNativeFS(document.documentElement, () => {});
    }
    return;
  }
  if (!inV) return;
  const atFit = !zS || zS.scale <= 1.02;
  if (e.key === 'ArrowRight' && atFit) { e.preventDefault(); nextItem(); }
  if (e.key === 'ArrowLeft'  && atFit) { e.preventDefault(); prevItem(); }
  if (e.key === '+' || e.key === '=')  { e.preventDefault(); zStep(.6); }
  if (e.key === '-')                   { e.preventDefault(); zStep(-.6); }
  if (e.key === '0')                   { e.preventDefault(); doFit(); }
});

/* ── Init ────────────────────────────────────────────── */
(() => {
  loadVault();
  renderFolderList();
  updateFldDot();
  try {
    const sz = localStorage.getItem(LS_GRIDSIZE);
    if (sz) {
      gallery.style.gridTemplateColumns = `repeat(auto-fill,minmax(${sz}px,1fr))`;
      sGBtnEls.forEach(b => b.classList.toggle('on', b.dataset.gs === sz));
    }
  } catch {}
  invList();   // sets _totalSize = 0
  setStatus();
})();

/* ── Cleanup ─────────────────────────────────────────── */
window.addEventListener('pagehide',     () => { clearThumbURLs(); revokeURL(curURL); clearFolderThumbURLs(); });
window.addEventListener('beforeunload', () => { clearThumbURLs(); revokeURL(curURL); clearFolderThumbURLs(); });
