# Wavecast — Audio Visualizer & Lyrics

A single-page, no-build web app that visualizes any audio file in real time,
syncs word-by-word lyrics to playback, and can transcribe what's actually
being said using OpenAI's Whisper API — then let you click any word to jump
straight to that moment in the audio.

Two builds, same app:

- **`Wavecast.html`** — one self-contained file (HTML + CSS + JS inlined,
  zero dependencies). This is the one to use in **Koder** or any other
  mobile code-runner/WebView app: copy this single file onto your phone and
  open it, no server or other files needed. Touch-optimized (tap targets,
  touch-drag seek bar, bottom-sheet menu, safe-area insets for the notch/home
  indicator, no pinch-zoom or pull-to-refresh).
- **`index.html` + `style.css` + `app.js`** — the same app split into normal
  files, for running on desktop/web (e.g. via a local server). Functionally
  identical, just not bundled into one file.

## Running the mobile build in Koder

1. Copy `Wavecast.html` onto your device (AirDrop, iCloud Drive, email to
   yourself, etc.) or copy/paste its contents into a new file in Koder.
2. Open it and tap **Run/Preview**.
3. Tap **Choose Audio File** to load a track from your device.
4. Tap **☰** for the menu (open lyrics file, paste lyrics, AI settings).

Everything (visualizer, lyrics sync, tap-to-seek, word search) works fully
offline. AI transcription/summary need network access to `api.openai.com`
and your own API key (see below) — Koder's WebView allows outbound requests
like any other browser context.

## Features

- **Real-time visualizer** — 4 canvas modes (Bars, Radial, Wave, Particles),
  all reacting live to the audio's frequency/amplitude via the Web Audio API.
- **Word-level lyrics sync** — the current line and current word are
  highlighted live as the track plays, auto-scrolling to stay in view.
- **Click-to-seek** — click any lyric line or any single word to jump the
  audio to that exact timestamp. Chapter markers on the seek bar mark every
  line.
- **Word search ("skip to a word")** — type a word or phrase, it finds every
  occurrence in the lyrics and lets you jump between them with `↑`/`↓` or
  `Enter`.
- **AI transcription** — click **✨ Transcribe with AI** to have OpenAI's
  Whisper model listen to the loaded audio and generate the lyrics
  automatically, with real word-level timestamps, no manual `.lrc` file
  needed. This is what actually "detects what the audio is saying."
- **Summary ("tell me everything about what I was saying")** — computes local
  stats (duration, word count, unique words, speaking rate, line count) and,
  if you've added an API key, asks a chat model to summarize the transcript's
  content and tone.
- **Manual lyrics** — you can instead load a standard `.lrc` file, an
  *enhanced* LRC file with `<mm:ss.xx>` word tags, or paste plain text and it
  will evenly distribute timing across the track.

## Running it

No build step — just open `index.html` in a modern browser, or serve the
folder locally:

```bash
cd audio-visualizer-lyrics
python3 -m http.server 8080
# open http://localhost:8080
```

(Serving over `http://localhost` rather than `file://` avoids some browsers'
restrictions on `fetch`/CORS for the AI features.)

## AI transcription & summary setup

Both features call OpenAI's API **directly from your browser** using your own
key:

1. Click **AI Settings** in the top bar.
2. Paste an OpenAI API key (starts with `sk-...`). It's stored only in this
   browser's `localStorage` — never sent anywhere but `api.openai.com`.
3. Load an audio file, then click **✨ Transcribe with AI**.
4. Once a transcript exists, click **📝 Summarize**.

This uses the `whisper-1` model (`/v1/audio/transcriptions`, word-level
timestamps) and `gpt-4o-mini` (`/v1/chat/completions`) for the summary. Both
are billed to your own OpenAI account — check current pricing before
transcribing very long files.

If you don't want to use AI at all, everything else (visualizer, manual/LRC
lyrics, click-to-seek, word search) works fully offline with zero network
calls.

## Lyrics file format

Standard LRC (line-level sync):

```
[00:12.30]First line of the lyric
[00:15.80]Second line, right on cue
```

Enhanced LRC (word-level sync — lets you click individual words):

```
[00:12.30]<00:12.30>Hello <00:12.80>world <00:13.20>this <00:13.40>is <00:13.60>synced
```

Plain text (no timestamps) is also accepted — lines are spread evenly across
the track's duration as a rough approximation.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek -5s / +5s |
| `/` | Focus the word search box |
| `Enter` (in search) | Jump to the current match |

## Tech

Vanilla HTML/CSS/JS. No dependencies, no bundler. Uses:
- `Web Audio API` (`AnalyserNode`) for real-time frequency/waveform data
- `Canvas 2D` for all rendering
- `OpenAI Whisper` + `Chat Completions` APIs (optional, client-side calls)
