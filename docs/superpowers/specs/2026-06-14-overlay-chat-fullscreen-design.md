# Overlay Chat Fullscreen Mode — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

Add a fullscreen view mode to the **overlay AI Response panel** (the floating
bar's chat popover). Today the response renders in a Radix popover under a thin
600px-wide bar. Fullscreen expands the overlay window to fill the monitor's
**work area** (taskbar/menubar stay visible) so the chat uses the whole screen.
It is toggled by a header button and a global hotkey, stays on across new
messages until explicitly toggled off, and restores the compact bar when the
response panel closes.

## Goals

- A fullscreen toggle for the overlay response panel only (not the dashboard
  `/chats` view).
- Expand to the current monitor's **work area** (do not cover the taskbar/menubar).
- Toggle via a header button **and** a global hotkey (`Ctrl/Cmd+Shift+F`).
- Once enabled, stay fullscreen across subsequent messages/responses until the
  user toggles it off or the panel fully closes.
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
- On `enterFullscreen`, the response popover must remain open. Since the popover
  is controlled by `isPopoverOpen` in `useCompletion`, toggling fullscreen does
  not itself open/close it; we only resize the window. (Fullscreen is only
  reachable from the header button while the panel is open, or from the hotkey —
  see §4 for the hotkey-while-closed case.)

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
- Hotkey-while-panel-closed: the hotkey only acts when the response panel is
  open. If pressed with no panel open, it is a no-op (entering fullscreen on an
  empty bar has no payoff). The callback reads the current panel-open state and
  returns early when closed.

### 5. Header toggle button (`Input.tsx`)

- Add a `Maximize2` / `Minimize2` (lucide) icon button in the response panel
  header, next to the Copy button.
- `onClick` → `toggleFullscreen()`. Icon reflects `isFullscreen`.
- `title` reflects state ("Enter fullscreen" / "Exit fullscreen").
- The button must not close the popover (it only resizes the window).

### 6. Lifecycle

- Fullscreen **stays on across new messages/responses** while the panel is open.
- When the response panel closes/resets (the existing `reset()` path or the
  Close button), **exit fullscreen and restore** the compact window. Wire
  `exitFullscreen()` into the panel-close flow so the window never gets stranded
  at full size with no panel.
- Not persisted to storage; defaults to off on each app launch.

## Data Flow

```
[Header button click]  ─┐
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

- **Manual (primary)**: enter via button and via hotkey; confirm window fills the
  work area and the taskbar/menubar remain visible; send another message and
  confirm it stays fullscreen; toggle off and confirm restore to prior
  position/size; close the panel while fullscreen and confirm the bar restores.
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
- `src/pages/app/components/completion/Input.tsx` — header toggle button.
- Wiring point (e.g. `src/pages/app/index.tsx` or the completion hook) — mount
  `useOverlayFullscreen`, register the custom-shortcut callback, and connect
  `exitFullscreen` to the panel-close flow.

## Open Implementation Checks

1. Confirm `tauri::Monitor::work_area()` is available on the resolved Tauri 2.x
   version; if not, bump or fall back.
2. Confirm the Radix popover stays open and repositions cleanly when the window
   resizes underneath it (it is anchored to the input, which stays at top).
