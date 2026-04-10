---
name: emilkowalski
description: Build polished React UI components using Vaul (drawer), Sonner (toasts), and Motion animations. Use this skill when the user asks to add a drawer, toast notification, dialog, or smooth animation to a React app; when they mention Vaul, Sonner, or want Emil Kowalski-style UI; or when they want to build accessible, beautifully animated components that feel native and delightful.
version: 1.0.0
author: emilkowalski
---

Build polished, accessible React UI components in the style of Emil Kowalski — minimal API surface, physics-based animations, and seamless feel. Focus on Vaul (drawers), Sonner (toasts), and Motion animations.

## Core Libraries

### Vaul — Drawer Component

Vaul is an unstyled drawer component for React built on top of Radix Dialog. Ideal for mobile-first bottom sheets and side panels.

```bash
npm install vaul
```

**Basic drawer:**
```tsx
import { Drawer } from 'vaul';

export function MyDrawer() {
  return (
    <Drawer.Root>
      <Drawer.Trigger>Open</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content className="bg-white flex flex-col rounded-t-[10px] h-full mt-24 max-h-[96%] fixed bottom-0 left-0 right-0">
          <div className="p-4 bg-white rounded-t-[10px] flex-1">
            <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-zinc-300 mb-8" />
            <div className="max-w-md mx-auto">
              <Drawer.Title className="font-medium mb-4 text-zinc-900">
                Drawer title
              </Drawer.Title>
              <p className="text-zinc-600 mb-2">Content goes here.</p>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

**Key Vaul patterns:**
- `shouldScaleBackground` — scale the page background as the drawer opens (set `data-vaul-drawer-wrapper` on the root element)
- `snapPoints` — define multiple snap positions (e.g. `[0.5, 1]` for 50% and full height)
- `dismissible={false}` — prevent closing on outside click
- `direction="right"` — side drawer variant
- Always add the drag handle (`w-12 h-1.5 rounded-full bg-zinc-300`) for mobile UX

**Scale background setup:**
```tsx
// Root layout
<div vaul-drawer-wrapper="">
  {children}
</div>

// Drawer
<Drawer.Root shouldScaleBackground>
```

### Sonner — Toast Notifications

Sonner is an opinionated, beautiful toast component.

```bash
npm install sonner
```

**Setup (add once to root layout):**
```tsx
import { Toaster } from 'sonner';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

**Triggering toasts:**
```tsx
import { toast } from 'sonner';

// Basic
toast('Event has been created');

// With description
toast('Event created', {
  description: 'Monday, January 3rd at 6:00pm',
});

// Types
toast.success('Successfully saved!');
toast.error('Something went wrong');
toast.warning('This action cannot be undone');
toast.info('New version available');
toast.loading('Saving...');

// Promise toast
toast.promise(saveData(), {
  loading: 'Saving...',
  success: 'Saved!',
  error: 'Failed to save',
});

// With action
toast('File deleted', {
  action: {
    label: 'Undo',
    onClick: () => undoDelete(),
  },
});
```

**Toaster customization:**
```tsx
<Toaster
  position="bottom-right"  // top-left, top-center, top-right, bottom-left, bottom-center, bottom-right
  richColors              // enables colored success/error/warning/info
  expand                  // expands toasts on hover
  closeButton            // shows close button
  theme="dark"           // or "light", "system"
  duration={4000}        // ms before auto-dismiss
/>
```

### Motion — Animations

Use the `motion` library (formerly Framer Motion) for physics-based, declarative animations.

```bash
npm install motion
```

**Micro-interactions:**
```tsx
import { motion } from 'motion/react';

// Fade + slide in
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: 8 }}
  transition={{ duration: 0.2, ease: [0.25, 0.4, 0.25, 1] }}
>
  Content
</motion.div>

// Button press
<motion.button
  whileTap={{ scale: 0.97 }}
  whileHover={{ scale: 1.02 }}
  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
>
  Click me
</motion.button>

// List stagger
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};
const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

<motion.ul variants={container} initial="hidden" animate="show">
  {items.map((i) => (
    <motion.li key={i.id} variants={item}>{i.name}</motion.li>
  ))}
</motion.ul>
```

**Layout animations (auto-animate reordering/resizing):**
```tsx
<motion.div layout>
  {/* Content that resizes — motion handles the transition */}
</motion.div>
```

**AnimatePresence for exit animations:**
```tsx
import { AnimatePresence, motion } from 'motion/react';

<AnimatePresence>
  {isVisible && (
    <motion.div
      key="modal"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    />
  )}
</AnimatePresence>
```

## Design Principles

Follow these principles when building components:

1. **Native feel** — Components should feel like platform primitives. Drawers should drag with finger velocity, toasts should stack naturally. Never fight the platform.

2. **Minimal API** — Expose the least surface area needed. Consumers shouldn't need to manage state for basic usage.

3. **Accessible by default** — Use Radix primitives where available. Include `aria-*` attributes, keyboard navigation, and focus trapping for modals/drawers.

4. **Unstyled core, styled examples** — Provide unstyled components with Tailwind CSS examples. Never bake in opinionated colors at the library level.

5. **Smooth, not flashy** — Prefer short durations (150–300ms), ease curves `[0.25, 0.4, 0.25, 1]`, and spring physics over linear animations. Animations should feel responsive, not decorative.

6. **Composable** — Build with compound component patterns (Root, Trigger, Content) following Radix conventions so consumers have full control.

## Common Patterns

### Dialog (use Radix directly)
```tsx
import * as Dialog from '@radix-ui/react-dialog';

<Dialog.Root>
  <Dialog.Trigger asChild>
    <button>Open dialog</button>
  </Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
    <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl p-6 shadow-xl w-full max-w-md">
      <Dialog.Title>Title</Dialog.Title>
      <Dialog.Description>Description</Dialog.Description>
      <Dialog.Close>Close</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

### Animated presence toggle
```tsx
function Toggle({ children, visible }: { children: React.ReactNode; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, filter: 'blur(4px)', scale: 0.98 }}
          animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
          exit={{ opacity: 0, filter: 'blur(4px)', scale: 0.98 }}
          transition={{ duration: 0.2 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

### Number counter animation
```tsx
import { useSpring, animated } from '@react-spring/web';
// or with motion:
import { useMotionValue, useSpring, motion } from 'motion/react';

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 100, damping: 30 });
  return <motion.span>{spring}</motion.span>;
}
```

## Accessibility Checklist

When building interactive components, verify:
- [ ] Keyboard navigation works (Tab, Enter, Space, Escape)
- [ ] Focus is trapped inside modals/drawers when open
- [ ] Focus returns to trigger on close
- [ ] Screen reader announces open/close state
- [ ] Touch targets are at least 44×44px on mobile
- [ ] Motion respects `prefers-reduced-motion`:

```tsx
import { useReducedMotion } from 'motion/react';

function MyComponent() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1, y: shouldReduceMotion ? 0 : -8 }}
    />
  );
}
```
