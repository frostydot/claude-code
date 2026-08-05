// ============================================================================
// Wavecast — Audio Visualizer & Lyrics
// Vanilla JS, no build step. Web Audio API for analysis, Canvas 2D for
// rendering, optional OpenAI Whisper/Chat for real speech-to-text + summary.
// ============================================================================

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const state = {
    audioCtx: null,
    analyser: null,
    sourceNode: null,
    freqData: null,
    timeData: null,
    vizMode: "bars",
    lyrics: null,        // { lines: [{ time, endTime, text, words:[{time,endTime,text}] }] }
    activeLineIndex: -1,
    activeWordIndex: -1,
    searchMatches: [],   // [{lineIdx, wordIdx, time}]
    searchIndex: -1,
    isSeeking: false,
    particles: [],
    hue: 260,
  };

  const $ = (sel) => document.querySelector(sel);
  const audioEl = new Audio();
  audioEl.crossOrigin = "anonymous";
  audioEl.preload = "auto";

  // ---------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------
  const els = {
    dropzone: $("#dropzone"),
    stage: $("#stage"),
    transport: $("#transport"),
    audioFile: $("#audioFile"),
    lyricsFile: $("#lyricsFile"),
    canvas: $("#canvas"),
    trackTitle: $("#trackTitle"),
    trackSub: $("#trackSub"),
    playBtn: $("#playBtn"),
    playIcon: $("#playIcon"),
    pauseIcon: $("#pauseIcon"),
    curTime: $("#curTime"),
    durTime: $("#durTime"),
    seekTrack: $("#seekTrack"),
    seekFill: $("#seekFill"),
    seekHandle: $("#seekHandle"),
    seekMarkers: $("#seekMarkers"),
    volumeSlider: $("#volumeSlider"),
    lyricsScroll: $("#lyricsScroll"),
    lyricsLines: $("#lyricsLines"),
    lyricsEmpty: $("#lyricsEmpty"),
    wordSearch: $("#wordSearch"),
    searchPrev: $("#searchPrev"),
    searchNext: $("#searchNext"),
    searchCount: $("#searchCount"),
    transcribeBtn: $("#transcribeBtn"),
    summarizeBtn: $("#summarizeBtn"),
    summaryPanel: $("#summaryPanel"),
    summaryStats: $("#summaryStats"),
    summaryText: $("#summaryText"),
    closeSummary: $("#closeSummary"),
    pasteLyricsBtn: $("#pasteLyricsBtn"),
    pasteLyricsModal: $("#pasteLyricsModal"),
    lyricsTextarea: $("#lyricsTextarea"),
    cancelPasteLyrics: $("#cancelPasteLyrics"),
    applyPasteLyrics: $("#applyPasteLyrics"),
    apiKeyBtn: $("#apiKeyBtn"),
    apiKeyModal: $("#apiKeyModal"),
    apiKeyInput: $("#apiKeyInput"),
    saveApiKey: $("#saveApiKey"),
    clearApiKey: $("#clearApiKey"),
    toast: $("#toast"),
  };

  const ctx2d = els.canvas.getContext("2d");

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  let toastTimer = null;
  function toast(msg, ms = 3200) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), ms);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------------------------------------------------------------------
  // Audio engine
  // ---------------------------------------------------------------------
  function ensureAudioGraph() {
    if (state.audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AC();
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = 0.82;
    state.sourceNode = state.audioCtx.createMediaElementSource(audioEl);
    state.sourceNode.connect(state.analyser);
    state.analyser.connect(state.audioCtx.destination);
    state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
    state.timeData = new Uint8Array(state.analyser.frequencyBinCount);
  }

  function loadAudioFile(file) {
    const url = URL.createObjectURL(file);
    audioEl.src = url;
    els.trackTitle.textContent = file.name.replace(/\.[^.]+$/, "");
    els.trackSub.textContent = "Loading…";
    els.dropzone.hidden = true;
    els.stage.hidden = false;
    els.transport.hidden = false;
    ensureAudioGraph();
    audioEl.addEventListener(
      "loadedmetadata",
      () => {
        els.durTime.textContent = fmtTime(audioEl.duration);
        els.trackSub.textContent = fmtTime(audioEl.duration) + " · ready";
        renderSeekMarkers();
      },
      { once: true }
    );
    resizeCanvas();
    startRenderLoop();
  }

  function togglePlay() {
    if (!audioEl.src) return;
    if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume();
    }
    if (audioEl.paused) audioEl.play();
    else audioEl.pause();
  }

  audioEl.addEventListener("play", () => {
    els.playIcon.hidden = true;
    els.pauseIcon.hidden = false;
  });
  audioEl.addEventListener("pause", () => {
    els.playIcon.hidden = false;
    els.pauseIcon.hidden = true;
  });
  audioEl.addEventListener("ended", () => {
    els.playIcon.hidden = false;
    els.pauseIcon.hidden = true;
  });

  audioEl.addEventListener("timeupdate", () => {
    if (state.isSeeking) return;
    updateTransportUI();
    updateLyricsSync();
  });

  function updateTransportUI() {
    const dur = audioEl.duration || 0;
    const cur = audioEl.currentTime || 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    els.seekFill.style.width = pct + "%";
    els.seekHandle.style.left = pct + "%";
    els.curTime.textContent = fmtTime(cur);
  }

  function seekTo(sec) {
    if (!isFinite(audioEl.duration)) return;
    audioEl.currentTime = Math.max(0, Math.min(audioEl.duration, sec));
    updateTransportUI();
    updateLyricsSync();
  }

  els.playBtn.addEventListener("click", togglePlay);
  els.volumeSlider.addEventListener("input", (e) => {
    audioEl.volume = parseFloat(e.target.value);
  });

  function seekFromClientX(clientX) {
    const rect = els.seekTrack.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(pct * (audioEl.duration || 0));
  }
  els.seekTrack.addEventListener("mousedown", (e) => {
    state.isSeeking = true;
    seekFromClientX(e.clientX);
    const onMove = (ev) => seekFromClientX(ev.clientX);
    const onUp = () => {
      state.isSeeking = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.code === "ArrowRight") {
      seekTo(audioEl.currentTime + 5);
    } else if (e.code === "ArrowLeft") {
      seekTo(audioEl.currentTime - 5);
    } else if (e.key === "/") {
      e.preventDefault();
      els.wordSearch.focus();
    }
  });

  // ---------------------------------------------------------------------
  // File loading / drag & drop
  // ---------------------------------------------------------------------
  els.audioFile.addEventListener("change", (e) => {
    if (e.target.files[0]) loadAudioFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("drag-over");
    })
  );
  els.dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio")) loadAudioFile(file);
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    if (e.target === els.dropzone || els.dropzone.contains(e.target)) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio")) loadAudioFile(file);
  });

  els.lyricsFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    applyLyricsText(text);
  });

  // ---------------------------------------------------------------------
  // Lyrics parsing
  //   Supports: standard LRC [mm:ss.xx]text
  //             enhanced LRC [mm:ss.xx]<mm:ss.xx> word <mm:ss.xx> word...
  //             plain text (no timestamps -> synced to AI transcription or
  //             evenly distributed once duration is known)
  // ---------------------------------------------------------------------
  const LRC_LINE_RE = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/;
  const LRC_WORD_RE = /<(\d+):(\d+(?:\.\d+)?)>/g;

  function toSeconds(m, s) {
    return parseInt(m, 10) * 60 + parseFloat(s);
  }

  function parseLrc(text) {
    const rawLines = text.split(/\r?\n/);
    const lines = [];
    let sawTimestamp = false;

    for (const raw of rawLines) {
      const m = raw.match(LRC_LINE_RE);
      if (!m) {
        if (raw.trim()) lines.push({ time: null, text: raw.trim(), words: null });
        continue;
      }
      sawTimestamp = true;
      const time = toSeconds(m[1], m[2]);
      let content = m[3];

      // Enhanced word-level tags?
      if (LRC_WORD_RE.test(content)) {
        LRC_WORD_RE.lastIndex = 0;
        const words = [];
        let lastIdx = 0;
        let lastTime = time;
        let match;
        const tokens = [];
        while ((match = LRC_WORD_RE.exec(content))) {
          const before = content.slice(lastIdx, match.index);
          if (before.trim()) tokens.push({ text: before.trim(), time: lastTime });
          lastTime = toSeconds(match[1], match[2]);
          lastIdx = LRC_WORD_RE.lastIndex;
        }
        const tail = content.slice(lastIdx).trim();
        if (tail) tokens.push({ text: tail, time: lastTime });
        tokens.forEach((t, i) => {
          words.push({ time: t.time, endTime: null, text: t.text });
        });
        content = tokens.map((t) => t.text).join(" ");
        lines.push({ time, text: content.trim(), words });
      } else {
        lines.push({ time, text: content.trim(), words: null });
      }
    }

    if (!sawTimestamp) return null;
    lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    // fill endTime = next line's start
    for (let i = 0; i < lines.length; i++) {
      lines[i].endTime = i + 1 < lines.length ? lines[i + 1].time : (lines[i].time + 8);
      distributeWordTimesIfMissing(lines[i]);
    }
    return { lines: lines.filter((l) => l.text) };
  }

  function distributeWordTimesIfMissing(line) {
    const words = line.text.split(/\s+/).filter(Boolean);
    if (!words.length) { line.words = []; return; }
    if (line.words && line.words.length) {
      // fill endTime for each word from next word's start
      for (let i = 0; i < line.words.length; i++) {
        line.words[i].endTime =
          i + 1 < line.words.length ? line.words[i + 1].time : line.endTime;
      }
      return;
    }
    const span = Math.max(0.3, line.endTime - line.time);
    const step = span / words.length;
    line.words = words.map((w, i) => ({
      text: w,
      time: line.time + i * step,
      endTime: line.time + (i + 1) * step,
    }));
  }

  function parsePlainText(text, duration) {
    const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!rawLines.length) return null;
    const total = duration && isFinite(duration) ? duration : rawLines.length * 4;
    const span = total / rawLines.length;
    const lines = rawLines.map((t, i) => {
      const time = i * span;
      const endTime = (i + 1) * span;
      const line = { time, endTime, text: t, words: null };
      distributeWordTimesIfMissing(line);
      return line;
    });
    return { lines };
  }

  function applyLyricsText(text) {
    let parsed = parseLrc(text);
    if (!parsed) parsed = parsePlainText(text, audioEl.duration);
    if (!parsed || !parsed.lines.length) {
      toast("Couldn't find any lyrics in that text.");
      return;
    }
    state.lyrics = parsed;
    renderLyrics();
    renderSeekMarkers();
    toast(`Loaded ${parsed.lines.length} lyric lines.`);
  }

  // Whisper verbose_json (with word timestamps) -> lyrics model, grouped
  // into readable lines by punctuation / word-count.
  function lyricsFromWhisper(json) {
    const words = (json.words || []).map((w) => ({
      text: w.word.trim(),
      time: w.start,
      endTime: w.end,
    }));
    if (!words.length) {
      // fall back to segments (line-level only)
      const lines = (json.segments || []).map((s) => {
        const line = { time: s.start, endTime: s.end, text: s.text.trim(), words: null };
        distributeWordTimesIfMissing(line);
        return line;
      });
      return { lines };
    }
    const lines = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      lines.push({
        time: cur[0].time,
        endTime: cur[cur.length - 1].endTime,
        text: cur.map((w) => w.text).join(" "),
        words: cur,
      });
      cur = [];
    };
    words.forEach((w) => {
      cur.push(w);
      if (/[.!?]$/.test(w.text) || cur.length >= 12) flush();
    });
    flush();
    return { lines };
  }

  // ---------------------------------------------------------------------
  // Lyrics rendering + sync
  // ---------------------------------------------------------------------
  function renderLyrics() {
    els.lyricsEmpty.hidden = !!state.lyrics;
    els.lyricsLines.innerHTML = "";
    if (!state.lyrics) return;

    state.lyrics.lines.forEach((line, li) => {
      const div = document.createElement("div");
      div.className = "lyric-line";
      div.dataset.line = li;
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains("word")) return;
        seekTo(line.time);
      });

      const words = line.words && line.words.length
        ? line.words
        : line.text.split(/\s+/).map((t) => ({ text: t, time: line.time, endTime: line.endTime }));

      words.forEach((w, wi) => {
        const span = document.createElement("span");
        span.className = "word";
        span.textContent = w.text;
        span.dataset.line = li;
        span.dataset.word = wi;
        span.addEventListener("click", (e) => {
          e.stopPropagation();
          seekTo(w.time);
        });
        div.appendChild(span);
        div.appendChild(document.createTextNode(" "));
      });

      els.lyricsLines.appendChild(div);
    });
  }

  function updateLyricsSync() {
    if (!state.lyrics) return;
    const t = audioEl.currentTime;
    const lines = state.lyrics.lines;

    let lineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (t >= lines[i].time && t < lines[i].endTime) { lineIdx = i; break; }
      if (t >= lines[i].time) lineIdx = i; // past line, keep as fallback until next found
    }

    if (lineIdx !== state.activeLineIndex) {
      const prevEl = els.lyricsLines.children[state.activeLineIndex];
      if (prevEl) prevEl.classList.remove("current");
      const curEl = els.lyricsLines.children[lineIdx];
      if (curEl) {
        curEl.classList.add("current");
        curEl.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      state.activeLineIndex = lineIdx;
      state.activeWordIndex = -1;
    }

    // mark past lines
    Array.from(els.lyricsLines.children).forEach((el, i) => {
      el.classList.toggle("past", i < lineIdx);
    });

    if (lineIdx >= 0) {
      const line = lines[lineIdx];
      const words = line.words && line.words.length ? line.words : [];
      let wIdx = -1;
      for (let i = 0; i < words.length; i++) {
        if (t >= words[i].time) wIdx = i;
      }
      const lineEl = els.lyricsLines.children[lineIdx];
      if (lineEl) {
        Array.from(lineEl.querySelectorAll(".word")).forEach((wEl, i) => {
          wEl.classList.toggle("active", i === wIdx);
          wEl.classList.toggle("spoken", i < wIdx);
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Seek-bar chapter markers (one per lyric line)
  // ---------------------------------------------------------------------
  function renderSeekMarkers() {
    els.seekMarkers.innerHTML = "";
    if (!state.lyrics || !audioEl.duration) return;
    state.lyrics.lines.forEach((line) => {
      const m = document.createElement("div");
      m.className = "seek-marker";
      m.style.left = (line.time / audioEl.duration) * 100 + "%";
      els.seekMarkers.appendChild(m);
    });
  }

  // ---------------------------------------------------------------------
  // Word search / skip-to-word
  // ---------------------------------------------------------------------
  function runSearch(query) {
    document.querySelectorAll(".word.search-hit").forEach((el) => el.classList.remove("search-hit"));
    document.querySelectorAll(".lyric-line.search-match").forEach((el) => el.classList.remove("search-match"));
    state.searchMatches = [];
    state.searchIndex = -1;

    if (!query.trim() || !state.lyrics) {
      els.searchCount.textContent = "0/0";
      return;
    }
    const q = query.trim().toLowerCase();
    state.lyrics.lines.forEach((line, li) => {
      const words = line.words && line.words.length ? line.words : [];
      words.forEach((w, wi) => {
        if (w.text.toLowerCase().replace(/[^\w']/g, "").includes(q)) {
          state.searchMatches.push({ lineIdx: li, wordIdx: wi, time: w.time });
        }
      });
    });

    state.searchMatches.forEach((m) => {
      const wEl = document.querySelector(`.word[data-line="${m.lineIdx}"][data-word="${m.wordIdx}"]`);
      if (wEl) {
        wEl.classList.add("search-hit");
        wEl.closest(".lyric-line").classList.add("search-match");
      }
    });

    els.searchCount.textContent = `0/${state.searchMatches.length}`;
    if (state.searchMatches.length) {
      state.searchIndex = 0;
      focusSearchMatch();
    }
  }

  function focusSearchMatch() {
    if (!state.searchMatches.length) return;
    const m = state.searchMatches[state.searchIndex];
    els.searchCount.textContent = `${state.searchIndex + 1}/${state.searchMatches.length}`;
    const wEl = document.querySelector(`.word[data-line="${m.lineIdx}"][data-word="${m.wordIdx}"]`);
    if (wEl) wEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  let searchDebounce;
  els.wordSearch.addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runSearch(e.target.value), 150);
  });
  els.wordSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.searchMatches.length) {
        seekTo(state.searchMatches[state.searchIndex].time);
      }
    }
  });
  els.searchNext.addEventListener("click", () => {
    if (!state.searchMatches.length) return;
    state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;
    focusSearchMatch();
  });
  els.searchPrev.addEventListener("click", () => {
    if (!state.searchMatches.length) return;
    state.searchIndex = (state.searchIndex - 1 + state.searchMatches.length) % state.searchMatches.length;
    focusSearchMatch();
  });

  // ---------------------------------------------------------------------
  // Visualizer modes
  // ---------------------------------------------------------------------
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.vizMode = chip.dataset.mode;
    });
  });

  function resizeCanvas() {
    const rect = els.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    els.canvas.width = rect.width * dpr;
    els.canvas.height = rect.height * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  function drawBars(w, h, energy) {
    const bins = 96;
    const step = Math.floor(state.freqData.length / bins);
    const gap = 3;
    const barW = w / bins - gap;
    ctx2d.save();
    for (let i = 0; i < bins; i++) {
      const v = state.freqData[i * step] / 255;
      const barH = Math.max(2, v * h * 0.85);
      const x = i * (barW + gap);
      const hue = (state.hue + i * 2.2) % 360;
      const grad = ctx2d.createLinearGradient(0, h - barH, 0, h);
      grad.addColorStop(0, `hsla(${hue}, 90%, 68%, 0.95)`);
      grad.addColorStop(1, `hsla(${(hue + 40) % 360}, 90%, 55%, 0.35)`);
      ctx2d.fillStyle = grad;
      ctx2d.shadowColor = `hsla(${hue}, 90%, 60%, 0.5)`;
      ctx2d.shadowBlur = 8 + energy * 20;
      roundRect(ctx2d, x, h - barH, barW, barH, 3);
      ctx2d.fill();
      // mirrored faint reflection
      ctx2d.globalAlpha = 0.18;
      ctx2d.fillRect(x, h, barW, barH * 0.25);
      ctx2d.globalAlpha = 1;
    }
    ctx2d.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawRadial(w, h, energy) {
    const cx = w / 2, cy = h / 2;
    const baseR = Math.min(w, h) * 0.18;
    const bins = 128;
    const step = Math.floor(state.freqData.length / bins);

    ctx2d.save();
    // pulsing core
    const coreR = baseR * (0.7 + energy * 0.4);
    const coreGrad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    coreGrad.addColorStop(0, `hsla(${state.hue}, 95%, 70%, 0.9)`);
    coreGrad.addColorStop(1, `hsla(${state.hue}, 95%, 60%, 0)`);
    ctx2d.fillStyle = coreGrad;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx2d.fill();

    for (let i = 0; i < bins; i++) {
      const v = state.freqData[i * step] / 255;
      const angle = (i / bins) * Math.PI * 2;
      const len = baseR * 0.3 + v * Math.min(w, h) * 0.32;
      const x1 = cx + Math.cos(angle) * baseR;
      const y1 = cy + Math.sin(angle) * baseR;
      const x2 = cx + Math.cos(angle) * (baseR + len);
      const y2 = cy + Math.sin(angle) * (baseR + len);
      const hue = (state.hue + i * 1.5) % 360;
      ctx2d.strokeStyle = `hsla(${hue}, 90%, 65%, 0.85)`;
      ctx2d.lineWidth = 2.2;
      ctx2d.shadowColor = `hsla(${hue}, 90%, 60%, 0.5)`;
      ctx2d.shadowBlur = 6 + energy * 14;
      ctx2d.beginPath();
      ctx2d.moveTo(x1, y1);
      ctx2d.lineTo(x2, y2);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawWave(w, h, energy) {
    ctx2d.save();
    ctx2d.lineWidth = 2.5;
    const grad = ctx2d.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `hsl(${state.hue}, 90%, 65%)`);
    grad.addColorStop(0.5, `hsl(${(state.hue + 80) % 360}, 90%, 65%)`);
    grad.addColorStop(1, `hsl(${(state.hue + 160) % 360}, 90%, 65%)`);
    ctx2d.strokeStyle = grad;
    ctx2d.shadowColor = `hsla(${state.hue}, 90%, 60%, 0.6)`;
    ctx2d.shadowBlur = 10 + energy * 16;
    ctx2d.beginPath();
    const len = state.timeData.length;
    for (let i = 0; i < len; i++) {
      const v = (state.timeData[i] - 128) / 128;
      const x = (i / len) * w;
      const y = h / 2 + v * h * 0.38;
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
    ctx2d.restore();
  }

  function spawnParticles(energy) {
    if (energy < 0.55) return;
    const w = els.canvas.width / (window.devicePixelRatio || 1);
    const h = els.canvas.height / (window.devicePixelRatio || 1);
    for (let i = 0; i < Math.floor(energy * 3); i++) {
      state.particles.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.3,
        y: h / 2 + (Math.random() - 0.5) * h * 0.3,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4 - 1,
        life: 1,
        hue: (state.hue + Math.random() * 60) % 360,
        r: 1.5 + Math.random() * 2.5,
      });
    }
  }

  function drawParticles(w, h, energy) {
    drawRadial(w, h, energy * 0.6);
    spawnParticles(energy);
    ctx2d.save();
    state.particles.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.life -= 0.012;
      ctx2d.globalAlpha = Math.max(0, p.life);
      ctx2d.fillStyle = `hsl(${p.hue}, 90%, 68%)`;
      ctx2d.shadowColor = `hsl(${p.hue}, 90%, 60%)`;
      ctx2d.shadowBlur = 10;
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx2d.fill();
    });
    ctx2d.globalAlpha = 1;
    ctx2d.restore();
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  function startRenderLoop() {
    let running = true;
    function frame() {
      if (!running) return;
      requestAnimationFrame(frame);
      const w = els.canvas.width / (window.devicePixelRatio || 1);
      const h = els.canvas.height / (window.devicePixelRatio || 1);
      ctx2d.clearRect(0, 0, w, h);

      let energy = 0;
      if (state.analyser) {
        state.analyser.getByteFrequencyData(state.freqData);
        state.analyser.getByteTimeDomainData(state.timeData);
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += state.freqData[i];
        energy = sum / (32 * 255);
        state.hue = (state.hue + 0.15 + energy * 0.6) % 360;
      } else {
        state.freqData = state.freqData || new Uint8Array(1024);
        state.timeData = state.timeData || new Uint8Array(1024);
      }

      switch (state.vizMode) {
        case "bars": drawBars(w, h, energy); break;
        case "radial": drawRadial(w, h, energy); break;
        case "wave": drawWave(w, h, energy); break;
        case "particles": drawParticles(w, h, energy); break;
      }
    }
    frame();
  }

  // ---------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------
  els.pasteLyricsBtn.addEventListener("click", () => (els.pasteLyricsModal.hidden = false));
  els.cancelPasteLyrics.addEventListener("click", () => (els.pasteLyricsModal.hidden = true));
  els.applyPasteLyrics.addEventListener("click", () => {
    applyLyricsText(els.lyricsTextarea.value);
    els.pasteLyricsModal.hidden = true;
  });

  els.apiKeyBtn.addEventListener("click", () => {
    els.apiKeyInput.value = localStorage.getItem("wavecast_openai_key") || "";
    els.apiKeyModal.hidden = false;
  });
  els.saveApiKey.addEventListener("click", () => {
    const key = els.apiKeyInput.value.trim();
    if (key) {
      localStorage.setItem("wavecast_openai_key", key);
      toast("API key saved locally.");
    }
    els.apiKeyModal.hidden = true;
  });
  els.clearApiKey.addEventListener("click", () => {
    localStorage.removeItem("wavecast_openai_key");
    els.apiKeyInput.value = "";
    toast("API key cleared.");
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  });

  function getApiKey() {
    return localStorage.getItem("wavecast_openai_key") || "";
  }

  // ---------------------------------------------------------------------
  // AI transcription (OpenAI Whisper) — real "detect what the audio is
  // saying". Requires the user's own API key, called directly from the
  // browser. Nothing is sent anywhere else.
  // ---------------------------------------------------------------------
  let currentAudioFile = null;
  els.audioFile.addEventListener("change", (e) => {
    currentAudioFile = e.target.files[0] || currentAudioFile;
  });
  els.dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("audio")) currentAudioFile = f;
  });

  els.transcribeBtn.addEventListener("click", async () => {
    const key = getApiKey();
    if (!key) {
      toast("Add your OpenAI API key first (AI Settings).");
      els.apiKeyModal.hidden = false;
      return;
    }
    if (!currentAudioFile) {
      toast("Load an audio file first.");
      return;
    }
    els.transcribeBtn.disabled = true;
    els.transcribeBtn.textContent = "Transcribing…";
    try {
      const form = new FormData();
      form.append("file", currentAudioFile);
      form.append("model", "whisper-1");
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
      }
      const json = await res.json();
      state.lyrics = lyricsFromWhisper(json);
      state.transcriptRaw = json.text || state.lyrics.lines.map((l) => l.text).join(" ");
      renderLyrics();
      renderSeekMarkers();
      els.summarizeBtn.disabled = false;
      toast(`Transcribed ${state.lyrics.lines.length} lines — click any word to jump there.`);
    } catch (err) {
      console.error(err);
      toast("Transcription failed: " + err.message, 5000);
    } finally {
      els.transcribeBtn.disabled = false;
      els.transcribeBtn.textContent = "✨ Transcribe with AI";
    }
  });

  // ---------------------------------------------------------------------
  // Summary — "tell me everything about what I was saying"
  // Local stats always shown; if an API key is present, also asks a chat
  // model to summarize/describe the transcript content.
  // ---------------------------------------------------------------------
  function computeLocalStats(transcript) {
    const words = transcript.trim().split(/\s+/).filter(Boolean);
    const unique = new Set(words.map((w) => w.toLowerCase().replace(/[^\w']/g, "")));
    const duration = audioEl.duration || 0;
    const wpm = duration ? Math.round((words.length / duration) * 60) : 0;
    return {
      words: words.length,
      unique: unique.size,
      duration: fmtTime(duration),
      wpm,
      lines: state.lyrics ? state.lyrics.lines.length : 0,
    };
  }

  els.summarizeBtn.addEventListener("click", async () => {
    if (!state.lyrics) return;
    const transcript = state.transcriptRaw || state.lyrics.lines.map((l) => l.text).join(" ");
    const stats = computeLocalStats(transcript);

    els.summaryStats.innerHTML = [
      ["Duration", stats.duration],
      ["Words", stats.words],
      ["Unique words", stats.unique],
      ["Speaking rate", stats.wpm + " wpm"],
      ["Lines", stats.lines],
    ].map(([l, n]) => `<div class="stat-pill"><span class="n">${n}</span><span class="l">${l}</span></div>`).join("");

    els.summaryText.textContent = "Generating summary…";
    els.summaryPanel.hidden = false;

    const key = getApiKey();
    if (!key) {
      els.summaryText.textContent = transcript
        ? "Full transcript:\n\n" + transcript
        : "No transcript available yet. Add an OpenAI API key in AI Settings for a written summary, or load lyrics manually.";
      return;
    }

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You summarize spoken audio transcripts clearly and concisely for the person who spoke them. Cover: what was said overall, key points/topics, and tone. Be direct and thorough, plain prose, no headers needed.",
            },
            { role: "user", content: `Here is a transcript of audio I recorded. Tell me everything about what I was saying:\n\n${transcript}` },
          ],
          temperature: 0.4,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
      }
      const json = await res.json();
      els.summaryText.textContent = json.choices?.[0]?.message?.content?.trim() || "(no summary returned)";
    } catch (err) {
      console.error(err);
      els.summaryText.textContent = "Summary failed (" + err.message + "). Full transcript:\n\n" + transcript;
    }
  });

  els.closeSummary.addEventListener("click", () => (els.summaryPanel.hidden = true));

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  resizeCanvas();
})();
