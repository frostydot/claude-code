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
  as your library goes.
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
