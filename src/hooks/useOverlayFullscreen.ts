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
