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
- **3-across grid** for All/Photos/Videos/Favourites, scrolling down as far
  as your library goes, **sorted newest first** (top-left) **to oldest last**
  (bottom), by each file's last-modified date. Folders inherit the same
  order, so a folder's fanned-out preview always shows its 5 newest items.
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
- **Favourites and folders persist for the browser tab's session** (via
  `sessionStorage`) — they survive a page reload in the same tab, but clear
  once the tab/browser session ends.
- **A folder only shows while its media is present.** Nothing about the
  library is written to disk, so when you close the app and come back, you
  re-add your photos/videos — only the folders that currently have media
  assigned to them show up. Re-add the exact same file later in the same
  session (same name/size/date) and it snaps straight back into whichever
  folder you'd put it in, since favourites and folder assignments are keyed
  off that.
- **Lightbox viewer**: tap any tile to open a fullscreen view.
  - **Pinch-to-zoom and pan on photos**, modeled on Apple Photos — zoom is
    anchored exactly between your fingers, tracks 1:1 with the gesture, the
    header/footer/nav chrome fades out while zoomed, panning is bounds-
    checked with a rubber-band give at the edges, and pinching past the
    zoom limit stretches past it then springs back to the max on release.
    Double-tap zooms in/out too.
  - Swipe left/right (or arrow keys) to move between photos/videos — only
    active at 1x zoom, so it never fights with panning a zoomed photo.
  - Favourite toggle and native video playback.
- **Swipe between tabs** on the main grid (left/right), in addition to the
  tab bar.
- **Per-item menu** (••• button) for Add/Remove Favourite, Move to Folder,
  Info (type, folder, size, date), and Remove from the library. A heart
  button on every tile is a one-tap favourite shortcut.
- **Select mode** for mass-organizing: tap the select-circle button in the
  topbar (on any media grid — All/Photos/Videos/Favourites, or inside a
  folder) to switch into multi-select. Tap tiles to select them, use
  **Select All** in the topbar to grab everything currently in view, then
  use the bottom action bar to **Favourite/Unfavourite**, **Move** the whole
  selection into a folder (or a brand new one) in one shot, or **Remove**
  them all — each action exits select mode when it's done. **Cancel** backs
  out without doing anything.
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
  into view (via `IntersectionObserver`), a few at a time (a small
  concurrency-limited queue) — and **prioritized**: photos load before
  videos, and within each, top-to-bottom in the order they appear on screen,
  so what you'd expect to see fill in first does.
- **Video tiles never contain a live `<video>` element.** A single still
  frame is captured once — retried at a few different timestamps so a real
  frame is captured essentially every time, not just when the first blind
  seek happens to land on one — into the same small cached thumbnail image
  used for photos. Real video decoding only happens when you open a video in
  the lightbox. On the rare total failure (corrupt/unsupported file) a
  generic icon is shown instead of a permanently blank tile.
- **Grids render in chunks** across idle frames rather than blocking the
  main thread building thousands of DOM nodes in one pass, so even a huge
  import doesn't freeze the UI while the grid fills in.

## Notes & limitations

- This is a *viewer*, not a media library manager — it doesn't move, copy,
  or write files anywhere on your device. It only reads what you pick.
- Because nothing is persisted to disk, a full page reload clears your
  library (by design — see "A folder only shows while its media is present"
  above) except favourites and folder definitions/assignments, which live in
  `sessionStorage` for that tab's session and re-attach automatically once
  you re-add the same files.
