# emilkowalski

Build polished React UI components using [Vaul](https://github.com/emilkowalski/vaul) (drawer), [Sonner](https://github.com/emilkowalski/sonner) (toasts), and [Motion](https://motion.dev) animations.

## Overview

This plugin brings Emil Kowalski's UI component expertise to Claude Code. It provides a skill that guides building native-feeling, accessible, beautifully animated React components.

## Skill

### emilkowalski

Auto-triggered when you ask to:
- Add a **drawer** or bottom sheet (Vaul)
- Add **toast notifications** (Sonner)
- Add **smooth animations** with Motion
- Build accessible, polished React UI components

**Covers:**
- Vaul drawer setup, snap points, scale-background effect, side drawers
- Sonner toast types, promise toasts, action buttons, Toaster configuration
- Motion micro-interactions, layout animations, AnimatePresence exit animations, stagger patterns
- Design principles: native feel, minimal API, accessibility, `prefers-reduced-motion`

## Installation

```bash
npx skills add emilkowalski/skill
```

Or manually copy this plugin into your project's plugins directory and reference it in your `.claude/settings.json`.

## Libraries

| Library | Description | Install |
|---------|-------------|---------|
| [vaul](https://github.com/emilkowalski/vaul) | Unstyled drawer component for React | `npm install vaul` |
| [sonner](https://github.com/emilkowalski/sonner) | Opinionated toast component | `npm install sonner` |
| [motion](https://motion.dev) | Physics-based animation library | `npm install motion` |
