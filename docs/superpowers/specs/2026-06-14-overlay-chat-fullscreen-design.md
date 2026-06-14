# Overlay Chat Fullscreen Mode — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

Add a fullscreen view mode to the **overlay AI Response panel** (the floating
bar's chat popover). Today the response renders in a Radix popover under a thin
600px-wide bar. Fullscreen expands the overlay window to fill the monitor's
**work area** (taskbar/menubar stay visible) so the chat uses the whole screen.
It is toggled by an icon on the always-visible overlay bar and a global hotkey,
and stays on across new messages (and across opening/closing the response panel)
until explicitly toggled off.

## Goals

- A fullscreen toggle for the overlay response panel only (not the dashboard
  `/chats` view).
- Expand to the current monitor's **work area** (do not cover the taskbar/menubar).
- Toggle via an icon on the always-visible overlay bar **and** a global hotkey
  (`Ctrl/Cmd+Shift+F`). Both work at any time, whether or not a response panel
  is open.
- Once enabled, stay fullscreen across subsequent messages/responses and across
  opening/closing the response panel, until the user explicitly toggles it off.
- Reuse the existing response popover rendering — no new dedicated layout.

## Non-Goals

- No fullscreen for the dashboard `/chats` conversation view.
- No edge-to-edge CSS polish (keep the current dropdown look, just larger).
- No persistence of fullscreen state across app restarts — it is a transient
  view mode.
- Not true OS fullscreen (no covering the taskbar; no `setFullscreen(true)`).

## Current Architecture (for context)

- **main window**: `600 × 54`, transparent, borderless, `resizable: false`
  (`src-tauri/tauri.conf.json`). Grows to `600 × 600` via the Rust
  `set_window_height` command (width hardcoded to 600) and shrinks back to 54
  via `useWindowResize` (`src/hooks/useWindow.ts`), which uses a
  `MutationObserver` to detect when no popover is open.
- **Response panel**: a Radix `Popover` in
  `src/pages/app/components/completion/Input.tsx`, sized `w-screen` ×
  `h-[calc(100vh-7rem)]`, anchored under the input. Its header holds the
  Conversation-mode switch (Ctrl+K), a Copy button, and a Close/clear button.
  Open/close is driven by `isPopoverOpen` from `useCompletion`; `onOpenChange`
  calls `reset()` when it closes (unless loading or `keepEngaged`).
- **Global shortcuts**: built-in action IDs are dispatched in Rust
  (`handle_shortcut_action`, `src-tauri/src/shortcuts.rs`). **Unknown action IDs
  fall through and emit a `custom-shortcut-triggered` event** carrying the
  action id. The frontend registers per-action callbacks via
  `useGlobalShortcuts` (`src/hooks/useGlobalShortcuts.ts`). Default bindings live
  in `src/config/shortcuts.ts` (`DEFAULT_SHORTCUT_ACTIONS`).

## Design

### 1. Rust command: `set_overlay_fullscreen`

New `#[tauri::command]` in `src-tauri/src/window.rs`, registered in
`invoke_handler` (`src-tauri/src/lib.rs`).

Signature (conceptual): `set_overlay_fullscreen(window, app, enabled: bool)`.

- **Enable**:
  1. Save the current `outer_position()` and `outer_size()` of the main window
     into a managed state struct (`OverlayFullscreenState`).
  2. Get the window's `current_monitor()` → `Monitor`, then `monitor.work_area()`
     (a `Rect` with `position` + `size`). `work_area()` is available in Tauri
     2.1+. **Verify this method exists on the resolved `tauri` 2.x version
     during implementation**; if unavailable, fall back to `monitor.size()` /
     `position()` (covers taskbar — acceptable degraded path) or bump the Tauri
     dependency.
  3. `set_position(work_area.position)` then `set_size(work_area.size)`.
- **Disable**:
  1. Read the saved position/size from state; if present, `set_size` then
     `set_position` to restore. If absent (e.g. never enabled), no-op.

Managed state: `OverlayFullscreenState { saved: Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>> }`,
added via `.manage(...)` in `lib.rs` alongside the existing state structs.

Notes:
- Programmatic `set_size`/`set_position` work even though the window is
  `resizable: false`; no need to toggle resizability.
- All sizing uses physical units from the monitor to stay correct under DPI
  scaling.

### 2. Frontend hook: `useOverlayFullscreen`

New hook in `src/hooks/` (exported from the hooks barrel).

State/behavior:
- `isFullscreen: boolean` (module-level singleton ref + React state, mirroring
  the existing `useWindowResize` global-listener pattern so the value is shared
  between the resize guard and the panel).
- `toggleFullscreen()` / `enterFullscreen()` / `exitFullscreen()` — set state and
  `invoke("set_overlay_fullscreen", { enabled })`.
- Toggling fullscreen only resizes the window; it never opens or closes the
  response popover (which stays controlled by `isPopoverOpen` in
  `useCompletion`). So fullscreen and panel-open are fully independent states.

### 3. `useWindowResize` guard

`useWindowResize` currently shrinks the window back to 54 whenever no popover is
open. Add a guard so it does **not** shrink while `isFullscreen` is true:

- Expose the fullscreen flag via the same module-level singleton the hook uses,
  and check it at the top of `resizeWindow(false)` and inside the
  `MutationObserver`/`mouseup` handlers. If fullscreen is active, skip the
  shrink entirely. Restoration of the compact size is owned exclusively by
  `exitFullscreen` (the Rust restore path).

### 4. Global hotkey wiring

- Add a `toggle_fullscreen` entry to `DEFAULT_SHORTCUT_ACTIONS`
  (`src/config/shortcuts.ts`):
  - `id: "toggle_fullscreen"`, name "Toggle Fullscreen",
    description "Expand/restore the AI response panel to fullscreen",
    default key `cmd+shift+f` (macOS) / `ctrl+shift+f` (windows/linux).
  - Chosen because `shift+f` does not collide with existing defaults
    (`d`, `i`, `m`, `a`, `s`, `backslash`, `h`, bare `ctrl/cmd`).
- **No Rust `handle_shortcut_action` change**: `toggle_fullscreen` is not a
  built-in arm, so it flows through the existing custom-shortcut path and emits
  `custom-shortcut-triggered`.
- Register the callback via `registerCustomShortcutCallback("toggle_fullscreen", toggleFullscreen)`
  (and unregister on cleanup) from wherever `useOverlayFullscreen` is mounted in
  the app overlay.
- The hotkey toggles fullscreen at any time, regardless of whether the response
  panel is open — matching the always-visible bar icon. With no response open,
  fullscreen simply enlarges the bar+canvas; a subsequent response fills it.

### 5. Toggle icon on the overlay bar (`app/index.tsx`)

- Add a `Maximize2` / `Minimize2` (lucide) icon `Button` to the always-visible
  main bar in `src/pages/app/index.tsx`, next to the existing Sparkles
  (dashboard) button.
- `onClick` → `toggleFullscreen()`. Icon reflects `isFullscreen`
  (`Minimize2` when fullscreen, `Maximize2` otherwise).
- `title` reflects state ("Enter fullscreen" / "Exit fullscreen").
- The button lives in the bar's right-hand control cluster; it is visible
  whether or not a response panel is open. It is hidden along with the rest of
  the controls when `systemAudio.capturing` (consistent with the existing
  Completion/Sparkles cluster).
- No changes needed in `Input.tsx`: resizing the window is independent of the
  Radix popover, which stays anchored to the input and re-flows automatically.

### 6. Lifecycle

- Fullscreen **stays on across new messages/responses and across opening or
  closing the response panel**. It is toggled off only by the user (bar icon or
  hotkey).
- Because the bar icon is always visible, there is no auto-exit on panel close:
  the window can sit at work-area size showing just the bar, and the user
  restores it from the same icon. The `useWindowResize` guard (§3) keeps the
  window from auto-shrinking to 54 while fullscreen is active.
- Not persisted to storage; defaults to off on each app launch.

## Data Flow

```
[Bar icon click]       ─┐
                        ├─► useOverlayFullscreen.toggleFullscreen()
[Ctrl/Cmd+Shift+F] ─────┘        │
   │ (Rust emits                 ▼
   │  custom-shortcut-     invoke("set_overlay_fullscreen", {enabled})
   │  triggered)                 │
   └─► registered callback        ▼
                          Rust: save/restore pos+size, resize to work_area
                                 │
                                 ▼
                   Window grows/shrinks; popover (w-screen/100vh) fills it
                   useWindowResize guard skips auto-shrink while fullscreen
```

## Error Handling

- Rust command returns `Result<(), String>`; the JS `invoke` is wrapped in
  try/catch and logs on failure (matching `useWindowResize`'s existing pattern).
  A failed resize leaves `isFullscreen` state and window out of sync only in the
  rare error case; on the next toggle the state corrects.
- If `work_area()` / `current_monitor()` returns `None` (e.g. headless), the
  command no-ops with an error string and the UI stays compact.

## Testing

- **Manual (primary)**: enter via the bar icon and via hotkey; confirm window
  fills the work area and the taskbar/menubar remain visible; send another
  message and confirm it stays fullscreen; close the response panel while
  fullscreen and confirm it **stays** at work-area size (does not auto-restore);
  toggle off via the bar icon and confirm restore to the prior position/size.
- **Multi-monitor**: trigger fullscreen with the bar on a secondary monitor;
  confirm it fills that monitor's work area, not the primary.
- **Rust**: the command is thin and platform-dependent; covered by manual
  verification. No unit test harness exists for the window module today.
- **Shortcut config**: confirm `toggle_fullscreen` appears in the Shortcuts
  settings UI and can be rebound (it reuses the existing generic shortcut list
  rendering).

## Files Touched

- `src-tauri/src/window.rs` — new `set_overlay_fullscreen` command + state save/restore.
- `src-tauri/src/lib.rs` — register command in `invoke_handler`; `.manage` new state.
- `src/hooks/useWindow.ts` — fullscreen guard in `useWindowResize`.
- `src/hooks/useOverlayFullscreen.ts` — new hook (+ barrel export in `src/hooks/index.ts`).
- `src/config/shortcuts.ts` — add `toggle_fullscreen` default action.
- `src/pages/app/index.tsx` — add the fullscreen toggle icon to the overlay bar,
  mount `useOverlayFullscreen`, and register/unregister the custom-shortcut
  callback.

## Open Implementation Checks

1. Confirm `tauri::Monitor::work_area()` is available on the resolved Tauri 2.x
   version; if not, bump or fall back.
2. Confirm the Radix popover stays open and repositions cleanly when the window
   resizes underneath it (it is anchored to the input, which stays at top).
