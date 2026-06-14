# Overlay Chat Fullscreen Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fullscreen view mode to the overlay AI Response panel, toggled by an icon on the always-visible overlay bar and a global hotkey (`Ctrl/Cmd+Shift+F`), that expands the overlay window to fill the monitor's work area (taskbar stays visible) until explicitly toggled off.

**Architecture:** A new Rust command (`set_overlay_fullscreen`) resizes/repositions the `main` window to the current monitor's `work_area()`, saving the prior position/size to managed state and restoring it on exit. A new frontend hook (`useOverlayFullscreen`) owns the `isFullscreen` flag, invokes the command, and registers the `toggle_fullscreen` custom global-shortcut callback. A module-level guard short-circuits the existing `resizeWindow` so the auto height/width logic never clobbers fullscreen. A toggle icon on the overlay bar drives the same hook.

**Tech Stack:** Tauri 2.8 (Rust), React + TypeScript, lucide-react icons, Tailwind.

> **Testing note:** This project has **no automated test harness** (no vitest/jest; `npm run build` = `tsc && vite build`). The work is native window + UI behavior. Verification gates per task are therefore: TypeScript type-check (`npx tsc --noEmit`), Rust compile (`cargo build` in `src-tauri`), and a final manual run (`npm run tauri dev`). Do not fabricate unit tests — follow the verification steps as written.

---

## File Structure

- `src-tauri/src/window.rs` — add `OverlayFullscreenState` struct + `set_overlay_fullscreen` command.
- `src-tauri/src/lib.rs` — `.manage()` the new state; register the command in `invoke_handler`.
- `src/hooks/useOverlayFullscreen.ts` — **new**: fullscreen state/hook + module-level `isOverlayFullscreen()` guard accessor + shortcut callback registration.
- `src/hooks/index.ts` — export the new hook.
- `src/hooks/useWindow.ts` — guard `resizeWindow` against running while fullscreen.
- `src/config/shortcuts.ts` — add the `toggle_fullscreen` default action.
- `src/pages/app/index.tsx` — mount the hook and add the toggle icon to the overlay bar.

---

## Task 1: Rust command — `set_overlay_fullscreen` + state

**Files:**
- Modify: `src-tauri/src/window.rs`
- Modify: `src-tauri/src/lib.rs:44-51` (`.manage` block) and `src-tauri/src/lib.rs:76-93` (`invoke_handler`)

- [ ] **Step 1: Add the state struct and command to `window.rs`**

Append to the end of `src-tauri/src/window.rs`:

```rust
/// Saved overlay window geometry so fullscreen can be restored to the exact
/// pre-fullscreen position and size.
#[derive(Default)]
pub struct OverlayFullscreenState {
    pub saved: std::sync::Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
}

/// Expand the main overlay window to the current monitor's work area
/// (taskbar/menubar stay visible), or restore it to the saved geometry.
#[tauri::command]
pub fn set_overlay_fullscreen(
    window: tauri::WebviewWindow,
    state: tauri::State<OverlayFullscreenState>,
    enabled: bool,
) -> Result<(), String> {
    use tauri::{Position, Size};

    if enabled {
        let pos = window
            .outer_position()
            .map_err(|e| format!("Failed to read window position: {}", e))?;
        let size = window
            .outer_size()
            .map_err(|e| format!("Failed to read window size: {}", e))?;
        {
            let mut saved = state
                .saved
                .lock()
                .map_err(|e| format!("Fullscreen state lock poisoned: {}", e))?;
            *saved = Some((pos, size));
        }

        let monitor = window
            .current_monitor()
            .map_err(|e| format!("Failed to get current monitor: {}", e))?
            .ok_or_else(|| "No current monitor available".to_string())?;
        let area = monitor.work_area();

        window
            .set_position(Position::Physical(area.position))
            .map_err(|e| format!("Failed to position fullscreen window: {}", e))?;
        window
            .set_size(Size::Physical(area.size))
            .map_err(|e| format!("Failed to resize fullscreen window: {}", e))?;
    } else {
        let saved = {
            let mut guard = state
                .saved
                .lock()
                .map_err(|e| format!("Fullscreen state lock poisoned: {}", e))?;
            guard.take()
        };
        if let Some((pos, size)) = saved {
            window
                .set_size(Size::Physical(size))
                .map_err(|e| format!("Failed to restore window size: {}", e))?;
            window
                .set_position(Position::Physical(pos))
                .map_err(|e| format!("Failed to restore window position: {}", e))?;
        }
    }

    Ok(())
}
```

Notes:
- `monitor.work_area()` returns `&PhysicalRect<i32, u32>` with public `position: PhysicalPosition<i32>` and `size: PhysicalSize<u32>` (both `Copy`); `area.position` / `area.size` copy out cleanly. Verified against `tauri` 2.8.2.
- `window: tauri::WebviewWindow` and `state: tauri::State<..>` are auto-injected by Tauri; the JS side does not pass them.
- `set_size`/`set_position` work even though the window is `resizable: false` (programmatic sizing is always allowed).

- [ ] **Step 2: Register the managed state in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `.manage(...)` chain (currently ending at line 51 with `.manage(shortcuts::MoveWindowState::default())`) and add one line after it:

```rust
        .manage(shortcuts::MoveWindowState::default())
        .manage(window::OverlayFullscreenState::default())
```

- [ ] **Step 3: Register the command in `invoke_handler`**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![...]` list, add `window::set_overlay_fullscreen,` next to the other `window::` commands (after `window::move_window,` at line 81):

```rust
            window::move_window,
            window::set_overlay_fullscreen,
```

- [ ] **Step 4: Compile the Rust backend**

Run: `cd src-tauri && cargo build`
Expected: builds successfully (no errors). Warnings unrelated to this change are acceptable.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/window.rs src-tauri/src/lib.rs
git commit -m "feat: add set_overlay_fullscreen Tauri command"
```

---

## Task 2: Frontend hook `useOverlayFullscreen` + `resizeWindow` guard

**Files:**
- Create: `src/hooks/useOverlayFullscreen.ts`
- Modify: `src/hooks/index.ts`
- Modify: `src/hooks/useWindow.ts:13-31`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useOverlayFullscreen.ts` with exactly:

```ts
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

// Module-level mirror of the fullscreen flag. `useWindowResize` reads this to
// avoid clobbering the fullscreen window size with its 600px-width auto-resize.
let fullscreenActive = false;

/** Whether the overlay is currently in fullscreen mode. */
export const isOverlayFullscreen = (): boolean => fullscreenActive;

/**
 * Owns the overlay fullscreen view mode: toggles the main window between its
 * compact size and the current monitor's work area, and wires the
 * `toggle_fullscreen` global shortcut to the same toggle.
 */
export const useOverlayFullscreen = () => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { registerCustomShortcutCallback, unregisterCustomShortcutCallback } =
    useGlobalShortcuts();

  const setFullscreen = useCallback(async (enabled: boolean) => {
    setIsFullscreen(enabled);
    try {
      if (enabled) {
        // Guard ON before resizing so concurrent resizeWindow calls no-op.
        fullscreenActive = true;
        await invoke("set_overlay_fullscreen", { enabled: true });
      } else {
        // Restore while the guard is still ON, then release it.
        await invoke("set_overlay_fullscreen", { enabled: false });
        fullscreenActive = false;
      }
    } catch (error) {
      console.error("Failed to set overlay fullscreen:", error);
      // Keep the module flag consistent with the attempted state.
      fullscreenActive = enabled;
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen(!fullscreenActive);
  }, [setFullscreen]);

  // Register the global-shortcut callback (Ctrl/Cmd+Shift+F).
  useEffect(() => {
    registerCustomShortcutCallback("toggle_fullscreen", toggleFullscreen);
    return () => unregisterCustomShortcutCallback("toggle_fullscreen");
  }, [
    registerCustomShortcutCallback,
    unregisterCustomShortcutCallback,
    toggleFullscreen,
  ]);

  return { isFullscreen, toggleFullscreen };
};
```

- [ ] **Step 2: Export the hook from the barrel**

In `src/hooks/index.ts`, add after the existing `export * from "./useWindow";` line:

```ts
export * from "./useOverlayFullscreen";
```

- [ ] **Step 3: Guard `resizeWindow`**

In `src/hooks/useWindow.ts`, add the import at the top (after the existing imports):

```ts
import { isOverlayFullscreen } from "./useOverlayFullscreen";
```

Then change the start of `resizeWindow` (currently lines 14-31) so it bails out entirely while fullscreen is active. Replace:

```ts
  const resizeWindow = useCallback(async (expanded: boolean) => {
    try {
      const window = getCurrentWebviewWindow();

      if (!expanded && isAnyPopoverOpen()) {
        return;
      }
```

with:

```ts
  const resizeWindow = useCallback(async (expanded: boolean) => {
    try {
      // Fullscreen owns the window geometry; never let auto-resize (which
      // hardcodes a 600px width via set_window_height) clobber it.
      if (isOverlayFullscreen()) {
        return;
      }

      const window = getCurrentWebviewWindow();

      if (!expanded && isAnyPopoverOpen()) {
        return;
      }
```

Leave the rest of `resizeWindow` and the file unchanged.

- [ ] **Step 4: Type-check the frontend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOverlayFullscreen.ts src/hooks/index.ts src/hooks/useWindow.ts
git commit -m "feat: add useOverlayFullscreen hook and resize guard"
```

---

## Task 3: Add the `toggle_fullscreen` default shortcut

**Files:**
- Modify: `src/config/shortcuts.ts:64-73` (insert a new entry into `DEFAULT_SHORTCUT_ACTIONS`)

- [ ] **Step 1: Add the action entry**

In `src/config/shortcuts.ts`, add a new object to the `DEFAULT_SHORTCUT_ACTIONS` array, immediately after the `screenshot` entry (which currently ends at line 73 with `},`) and before the closing `];`:

```ts
  {
    id: "toggle_fullscreen",
    name: "Toggle Fullscreen",
    description: "Expand/restore the AI response panel to fullscreen",
    defaultKey: {
      macos: "cmd+shift+f",
      windows: "ctrl+shift+f",
      linux: "ctrl+shift+f",
    },
  },
```

Notes:
- `shift+f` does not collide with existing defaults (`d`, `i`, `m`, `a`, `s`, `backslash`, `h`, bare `ctrl/cmd`).
- `getShortcutsConfig()` merges defaults over stored config (`{ ...defaults.bindings, ...parsed.bindings }`), so this binding is auto-registered on next startup, and `getAllShortcutActions()` makes it appear (and rebindable) in the Shortcuts settings UI with no further changes.
- Because `toggle_fullscreen` is not a built-in arm in `handle_shortcut_action` (Rust), pressing it falls through to the existing `custom-shortcut-triggered` event path, which the hook's callback handles.

- [ ] **Step 2: Type-check the frontend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/config/shortcuts.ts
git commit -m "feat: add toggle_fullscreen default shortcut"
```

---

## Task 4: Add the fullscreen toggle icon to the overlay bar

**Files:**
- Modify: `src/pages/app/index.tsx`

- [ ] **Step 1: Import the hook and icons**

In `src/pages/app/index.tsx`, update the lucide import (line 10) from:

```ts
import { SparklesIcon } from "lucide-react";
```

to:

```ts
import { SparklesIcon, Maximize2, Minimize2 } from "lucide-react";
```

Add the hook to the existing hooks import. The file currently imports `useApp` from `@/hooks` on line 8 (`import { useApp } from "@/hooks";`). Change it to:

```ts
import { useApp, useOverlayFullscreen } from "@/hooks";
```

- [ ] **Step 2: Call the hook in the component**

In `src/pages/app/index.tsx`, just after the existing `const { isHidden, systemAudio } = useApp();` line (line 17), add:

```ts
  const { isFullscreen, toggleFullscreen } = useOverlayFullscreen();
```

- [ ] **Step 3: Add the toggle button next to the Sparkles button**

In the same file, find the Sparkles `Button` block (lines 71-78) inside the `systemAudio?.capturing` cluster:

```tsx
            <Completion isHidden={isHidden} />
            <Button
              size={"icon"}
              className="cursor-pointer"
              title="Open Dev Space"
              onClick={openDashboard}
            >
              <SparklesIcon className="h-4 w-4" />
            </Button>
```

Replace it with (adds the fullscreen toggle before the Sparkles button):

```tsx
            <Completion isHidden={isHidden} />
            <Button
              size={"icon"}
              className="cursor-pointer"
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              size={"icon"}
              className="cursor-pointer"
              title="Open Dev Space"
              onClick={openDashboard}
            >
              <SparklesIcon className="h-4 w-4" />
            </Button>
```

The button lives inside the cluster that is hidden while `systemAudio?.capturing`, matching the Sparkles/Completion controls.

- [ ] **Step 4: Type-check the frontend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/app/index.tsx
git commit -m "feat: add fullscreen toggle icon to overlay bar"
```

---

## Task 5: Manual verification

**Files:** none (run the app).

- [ ] **Step 1: Build both layers once**

Run: `npx tsc --noEmit && cd src-tauri && cargo build && cd ..`
Expected: both succeed.

- [ ] **Step 2: Launch the app**

Run: `npm run tauri dev`
Expected: the overlay bar appears with a new Maximize icon between the input area and the Sparkles button.

- [ ] **Step 3: Verify enter via the bar icon**

Click the Maximize icon.
Expected: the overlay window expands to fill the monitor's **work area**; the OS taskbar/menubar remain visible; the icon switches to the Minimize glyph and its tooltip reads "Exit fullscreen".

- [ ] **Step 4: Verify chat fills the screen**

With fullscreen on, type a question and submit.
Expected: the AI Response popover fills the enlarged window (full width, near-full height).

- [ ] **Step 5: Verify it stays fullscreen across messages and panel close**

Send another message (stays fullscreen). Then close the response panel (X / clear).
Expected: the window **stays** at work-area size showing just the bar — it does NOT auto-shrink to the compact bar. The Minimize icon is still present.

- [ ] **Step 6: Verify exit restores geometry**

Click the Minimize icon (or press `Ctrl/Cmd+Shift+F`).
Expected: the window returns to its prior position and compact size; normal popover-driven resizing resumes (open a response → expands to 600px; close → shrinks to the bar).

- [ ] **Step 7: Verify the global hotkey**

With the panel closed and not fullscreen, press `Ctrl/Cmd+Shift+F`.
Expected: it toggles fullscreen on; press again to toggle off. (Confirm the binding also appears in Settings → Shortcuts as "Toggle Fullscreen" and is rebindable.)

- [ ] **Step 8 (multi-monitor, if available): Verify correct monitor**

Drag the bar to a secondary monitor, then enter fullscreen.
Expected: it fills that monitor's work area, not the primary monitor's.

---

## Self-Review Notes

- **Spec coverage:** work-area sizing (Task 1), `useOverlayFullscreen` + guard (Task 2), `toggle_fullscreen` shortcut (Task 3), always-visible bar icon + hotkey wiring (Tasks 3+4), stay-until-toggled lifecycle with no auto-exit (Task 2 guard + Task 5 step 5), not persisted (hook defaults `isFullscreen` to `false` each launch). All spec sections map to a task.
- **Type consistency:** `set_overlay_fullscreen({ enabled })` arg name matches the Rust `enabled: bool`; `isOverlayFullscreen()` exported from `useOverlayFullscreen.ts` and imported in `useWindow.ts`; `toggleFullscreen`/`isFullscreen` names consistent between hook return and `app/index.tsx` usage.
- **No placeholders:** every step shows the exact code/command.
