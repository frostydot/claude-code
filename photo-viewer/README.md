# Photos — a fully on-device HTML photo & video viewer

A single-page, no-build, no-backend photo/video viewer. Everything runs in
the browser — nothing is ever uploaded anywhere.

Open **`index.html`** directly, or serve the folder with any static file
server, and it just works. `photo-viewer-standalone.html` is the same app
merged into a single self-contained file (no separate CSS/JS), for
environments (like Koder) that run one HTML file.

## Features

- **Bottom tab bar** with five sections: **All**, **Photos**, **Videos**,
  **Favourites**, **Folders** — each with its own icon, drawn from one
  consistent icon set so every tab shares the same art style.
- **Grid** for All/Photos/Videos/Favourites, scrolling down as far as your
  library goes, **sorted newest first** (top-left) **to oldest last**
  (bottom). Sort prefers a JPEG's real EXIF *date taken* when present (a
  Settings toggle), falling back to the file's last-modified date otherwise
  — Settings → Display also lets you switch the grid between 2/3/4 columns
  (defaults to 3). Folders inherit the active sort, so a folder's
  fanned-out preview always shows its 5 newest items.
- **Duplicate detection**: items sharing a name and size get a small **DUP**
  badge (toggle in Settings) — catches the same photo imported twice from
  different sources with different timestamps, which the id alone wouldn't.
- **A status bar** above the grid shows the current item count and total
  size (or the live selection count while in Select mode).
- **Folders are yours to organize.** Tap **＋** to add loose photos and
  videos — there's no disk-folder import. Instead, use a photo/video's •••
  menu → **Move to Folder** to file it into a folder you create right there
  (or make a new one on the spot). The **Folders** tab shows **2 across**:
  each folder is a card with up to five of its newest photos/videos fanned
  out like a spread deck of cards, the folder name, and an item count
  underneath. Tap a folder to browse it in the same 3-across grid, with a
  back button to return; each folder card's ••• menu lets you rename or
  delete it.
- **Fully on-device.** Files are read straight from disk into the page (via
  `URL.createObjectURL`) — nothing leaves the browser, and nothing is
  written to disk anywhere else.
- **Favourites and folders persist automatically across app restarts** —
  no action needed from you. This is metadata only (which ids are favourited,
  which folders exist, which id is in which folder), stored via a layered
  fallback: IndexedDB first, then `localStorage`, then in-memory-only if
  neither is available in whatever browser/WebView is hosting the page —
  see "Persistence" below.
- **A folder only shows while its media is present.** Only the small
  organizational metadata above is ever stored — the actual photo/video
  files themselves are never written anywhere, so when you open the app,
  you re-add your photos/videos and only the folders that currently have
  media assigned to them show up. Re-add the exact same file later (same
  name/size/date) and it snaps straight back into whichever folder you'd
  put it in, since favourites and folder assignments are keyed off that id.
- **Lightbox viewer**: tap any tile to open a fullscreen view. Opens
  progressively — the cached thumbnail shows instantly while the full-
  resolution original decodes in the background, then swaps in, so large
  photos never leave the stage blank while decoding.
  - **Pinch-to-zoom and pan on photos**, modeled on Apple Photos — zoom is
    anchored exactly between your fingers, tracks 1:1 with the gesture, the
    header/footer/nav chrome fades out while zoomed, panning is bounds-
    checked with a rubber-band give at the edges, and pinching past the
    zoom limit stretches past it then springs back to the max on release.
    Double-tap zooms in/out too; on desktop, mouse wheel (or ctrl/⌘+wheel)
    does the same, zooming toward the cursor. A small HUD shows the current
    zoom percentage while it's changing.
  - **Fullscreen**: a button in the lightbox header requests real
    fullscreen where the platform allows it, falling back to a CSS-only
    "cinema" mode (hides all chrome, shows an explicit exit pill) where it
    doesn't — notably iOS Safari, which won't fullscreen arbitrary elements.
  - Swipe left/right (or arrow keys) to move between photos/videos — only
    active at 1x zoom, so it never fights with panning a zoomed photo.
  - Favourite toggle and native video playback.
- **Swipe between tabs** on the main grid (left/right), in addition to the
  tab bar.
- **Per-item menu** (••• button, or hold/long-press any tile) for Add/Remove
  Favourite, Move to Folder, Info (type, folder, size, date), and Remove
  from the library. A heart button on every tile is a one-tap favourite
  shortcut. **Remove is undoable** — a toast with an Undo button appears for
  a few seconds after removing anything, single or bulk.
- **Select mode** for mass-organizing: tap the select-circle button in the
  topbar, or hold/long-press any tile (on any media grid — All/Photos/
  Videos/Favourites, or inside a folder) to switch into multi-select. Tap
  tiles to select them, use **Select All** in the topbar to grab everything
  currently in view, then use the bottom action bar to
  **Favourite/Unfavourite**, **Move** the whole selection into a folder (or
  a brand new one) in one shot, or **Remove** them all (also undoable) —
  each action exits select mode when it's done. **Cancel** backs out
  without doing anything.
- **Settings panel** (gear icon): grid density, EXIF-sort and duplicate-
  marking toggles, and a manual backup export/import (see "Persistence").
- Light/dark mode aware, responsive, touch-target sized for mobile.

## Performance

Importing media is pure bookkeeping — reading file metadata and sorting an
array — so adding hundreds or thousands of files is effectively instant, no
matter how large the originals are. Nothing about the originals is decoded
at import time.

- **Previews are never full-resolution.** Every grid tile, folder-fan card,
  and folder-detail tile shows a small (~360px), pre-cropped, JPEG-quality
  thumbnail — generated once per item, cached, and reused everywhere that
  item appears. The original full-quality file is only ever touched when you
  open something in the fullscreen lightbox.
- **Thumbnails are generated lazily**, only for tiles that actually scroll
  into view (via `IntersectionObserver`), a few at a time — separate
  concurrency caps for photos vs. videos, since decoding video is far more
  expensive and some platforms (iOS in particular) hard-limit how many
  video decoders can exist at once — and **prioritized**: photos load
  before videos, and within each, top-to-bottom in the order they appear on
  screen, so what you'd expect to see fill in first does.
- **Video tiles never contain a live `<video>` element.** A single still
  frame is captured once — retried at a few different timestamps, keeping
  the brightest one found (measured with a cheap luminance probe) rather
  than trusting the first "successful" seek, since a blind seek occasionally
  lands on a black/undecoded frame even when it reports success — into the
  same small cached thumbnail image used for photos. Real video decoding
  only happens when you open a video in the lightbox. On the rare total
  failure (corrupt/unsupported file) a generic icon is shown instead of a
  permanently blank tile.
- **Offscreen tiles skip layout and paint entirely** (`content-visibility:
  auto`), on top of the lazy-thumbnail and chunked-rendering strategies
  above, so even a very large library stays smooth to scroll.
- **Grids render in chunks** across idle frames rather than blocking the
  main thread building thousands of DOM nodes in one pass, so even a huge
  import doesn't freeze the UI while the grid fills in.

## Persistence

- **Photos and videos themselves can never be silently reloaded.** This is
  a universal browser/OS security boundary, not a limitation of this app:
  no web page, in any browser or embedded WebView, can read files off your
  device without you explicitly picking them, every time. Opening the app
  fresh always means tapping "Add Photos & Videos" once — there's no way
  around that for any client-side app.
- **Favourites, folders, and folder assignments are different** — they're
  small JSON metadata generated by the app itself, not files read off your
  device, so they *can* persist automatically with zero action from you.
  They're stored through a layered fallback, tried in order: **IndexedDB**
  (survives app/browser restarts), then **`localStorage`** (same durability,
  used only if IndexedDB itself is unavailable), then **in-memory only**
  (if neither storage API works in that environment — everything still
  works normally for as long as the app stays open, it just won't survive
  a restart). Some embedded WebViews restrict one or both storage APIs for
  `file://` pages specifically; the app can't know in advance which tier a
  given environment will actually support, so it always tries the most
  durable option first and degrades quietly rather than breaking.
- Because the id used to key favourites/folder-assignments is derived from
  `name|size|last-modified` (not a random id), re-adding the exact same
  file — in a later session, not just after a reload — snaps it straight
  back into whichever favourite/folder state it had, on whichever storage
  tier actually held that data.
- **Manual backup, as a belt-and-suspenders option**: Settings → Backup →
  **Export Backup** downloads a small, human-readable JSON file with your
  favourites/folders/assignments (never the photos/videos — a page can't
  bundle those up even if it wanted to). **Import Backup** reads one back
  in and *merges* it into whatever's already loaded — matching folders by
  name, adding anything new — it never deletes or overwrites what you
  already have. Useful if automatic storage turns out to be unavailable in
  a given environment, or to carry your organization to another device.

## Notes & limitations

- This is a *viewer*, not a media library manager — it doesn't move, copy,
  or write files anywhere on your device. It only reads what you pick.
