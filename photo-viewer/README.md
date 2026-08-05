# Photos — a fully on-device HTML photo & video viewer

A single-page, no-build, no-backend photo/video viewer. Everything runs in
the browser — nothing is ever uploaded anywhere.

Open **`index.html`** directly, or serve the folder with any static file
server, and it just works.

## Features

- **Bottom tab bar** with five sections: **All**, **Photos**, **Videos**,
  **Favourites**, **Folders** — each with its own icon, drawn from one
  consistent icon set so every tab shares the same art style.
- **3-across grid** for All/Photos/Videos/Favourites, scrolling down as far
  as your library goes, **sorted newest first** (top-left) **to oldest last**
  (bottom), by each file's last-modified date. Folders inherit the same
  order, so a folder's fanned-out preview always shows its 5 newest items.
- **Folders** tab shows **2 across**: each folder is a card with up to five
  of its photos/videos fanned out like a spread deck of cards, the folder
  name, and an item count underneath. Tap a folder to browse it in the same
  3-across grid, with a back button to return.
- **Fully on-device**: use **＋** to add loose photos/videos, or the
  **folder+** button to add a whole folder (including subfolders) via your
  device's folder picker. Files are read straight from disk into the page
  (via `URL.createObjectURL`) — nothing leaves the browser, and nothing is
  written to disk anywhere else.
- **Favourites persist for the browser tab's session** (via
  `sessionStorage`) — they survive a page reload in the same tab, but clear
  once the tab/browser session ends.
- **Folders only show while their media is present.** Nothing about the
  library is written to disk, so if you close the app and come back, you
  add your folder back in and only the folders that actually contain media
  reappear — remove all of a folder's items and it disappears from the
  Folders tab immediately.
- **Lightbox viewer**: tap any tile to open a fullscreen view with swipe
  left/right (touch), arrow-key navigation, a favourite toggle, and video
  playback.
- **Swipe between tabs** on the main grid (left/right), in addition to the
  tab bar.
- **Per-item menu** (••• button) for Add/Remove Favourite, Info (name,
  folder, size, date), and Remove from the library. A heart button on every
  tile is a one-tap favourite shortcut.
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
  concurrency-limited queue), so scrolling through a huge library stays
  smooth instead of decoding everything up front.
- **Video tiles never contain a live `<video>` element.** A single frame is
  captured once into the same small cached thumbnail image used for photos —
  real video decoding only happens when you open a video in the lightbox.
- **Grids render in chunks** across idle frames rather than blocking the
  main thread building thousands of DOM nodes in one pass, so even a huge
  import doesn't freeze the UI while the grid fills in.

## Notes & limitations

- This is a *viewer*, not a media library manager — it doesn't move, copy,
  or write files anywhere on your device. It only reads what you pick.
- Folder selection (`webkitdirectory`) is supported in all Chromium- and
  WebKit-based browsers (Chrome, Edge, Safari) and Firefox 50+. If a
  browser doesn't support it, the "Add a Folder" button will simply behave
  like picking individual files.
- Because nothing is persisted to disk, a full page reload clears your
  library (by design — see "Folders only show while their media is
  present" above) except favourites, which live in `sessionStorage` for
  that tab's session and re-attach automatically if you re-add the same
  files.
