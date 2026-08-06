# Media Mover — wearing the Photos design language

This is the **Media Mover app's own code**, restyled to look like the
`photo-viewer/` app in this repo. The logic, features, and behaviour are
Media Mover's; only the appearance changed.

Open **`index.html`**, or serve the folder with any static file server.
`media-mover-standalone.html` is the same app merged into a single
self-contained file (no separate CSS/JS), for environments (like Koder)
that run one HTML file.

## What this is (and isn't)

- **The engine is untouched Media Mover.** Its folder vault, favourites
  keying, duplicate detection, EXIF sort, save-to-files, hold-to-select,
  zoom controller, and fullscreen/theater handling all work exactly as they
  did — this is a reskin, not a rewrite.
- **The look is the Photos app's**: SF Pro type, the light/dark adaptive
  palette (it was dark-only before), the 16px/10px radius scale, blurred
  translucent bars, and Apple-blue accents with the same red/pink/green
  semantic colours used for destructive/favourite/folder actions.
- **One icon set, from one sprite.** Every emoji glyph used as *app chrome*
  was replaced with the Photos app's SVG icon set, so every tab, button,
  badge, and menu row shares a single art style. Two icons were added to
  that set for settings rows Media Mover has and Photos doesn't
  (`icon-clock`, `icon-calendar`, `icon-swipe`, plus import/export/save).
- **Folder icons stay emoji on purpose.** The per-folder emoji picker is
  content *you* choose, not app chrome, so it's left exactly as it was.

## How the reskin was done

The CSS was rewritten from scratch against Media Mover's *original class
and custom-property names*, because its JS reaches into styling in a few
places and would break if those names moved:

- `gallery.style.gridTemplateColumns` is written directly (the Small/Medium/
  Large control), so the grid rule is only a default.
- `viewer.style.animation = 'fIn …'` / `'fOut …'` names keyframes by string,
  so `@keyframes fIn` / `fOut` must keep those names.
- A folder-picker heading is injected with an inline `color: var(--mut)`,
  so `--mut` still has to exist — it just resolves to the Photos secondary
  text colour now.

Only five JS edits were needed, all of them icon plumbing:

1. A `svgIcon(id)` helper, used by the three badges built at runtime (the
   tile's favourite heart and folder marker).
2. `refreshFavBtn()` no longer overwrites its buttons' contents — the
   filled/unfilled state rides on the existing `.favOn` / `.ctxFavOn`
   classes instead, so the SVG survives.
3. The three fullscreen toggles swap sprite icons rather than assigning a
   glyph to `textContent` (which would have wiped the `<svg>`).
4. The two baked-in placeholder images (video/broken-image) lost their
   hardcoded `#1a1a1e` background so the tile's own surface shows through —
   that's what lets them read correctly in light *and* dark mode, since a
   `data:` URI can't respond to the theme.
5. Emoji prefixes were stripped from toast messages, matching the Photos
   app's plain-text toasts.

## Notes

- Popovers, menus, and toasts use a more opaque surface than the top/tab
  bars do. `backdrop-filter` isn't reliably supported in embedded WebViews,
  and without it a 72%-alpha panel is unreadable over a photo grid; this
  stays legible on its own and still frosts where the platform supports it.
- The "Folder Vault" export remains Media Mover's own format. Note that its
  encryption uses a key hardcoded in the page's JavaScript, so it obscures
  the file but is not meaningfully secret — treat it as a backup format,
  not a security boundary.
