import { useEffect, useState } from "react";
import { useTitles, useSystemAudio } from "@/hooks";
import { listen } from "@tauri-apps/api/event";
import { safeLocalStorage, migrateLocalStorageToSQLite } from "@/lib";
import { getShortcutsConfig } from "@/lib/storage";
import { invoke } from "@tauri-apps/api/core";

export const useApp = () => {
  const systemAudio = useSystemAudio();
  const [isHidden, setIsHidden] = useState(false);
  // Initialize title management
  useTitles();

  // Initialize shortcuts from localStorage on app startup
  useEffect(() => {
    const initializeShortcuts = async () => {
      try {
        const config = getShortcutsConfig();
        await invoke("update_shortcuts", { config });
      } catch (error) {
        console.error("Failed to initialize shortcuts:", error);
      }
    };

    initializeShortcuts();
  }, []);

  // Migrate localStorage chat history to SQLite on app startup
  useEffect(() => {
    const runMigration = async () => {
      try {
        // Early exit: Check if migration already completed
        const migrationKey = "chat_history_migrated_to_sqlite";
        const alreadyMigrated =
          safeLocalStorage.getItem(migrationKey) === "true";

        if (alreadyMigrated) {
          return; // Migration already complete, skip
        }

        const result = await migrateLocalStorageToSQLite();

        if (result.success) {
          if (result.migratedCount > 0) {
            console.log(
              `Successfully migrated ${result.migratedCount} conversations to SQLite`
            );
          }
        } else if (result.error) {
          // Migration failed - log error
          console.error("Migration error:", result.error);
        }
      } catch (error) {
        // Critical error during migration
        console.error("Critical migration failure:", error);
      }
    };
    runMigration();
  }, []);

  const handleSelectConversation = (conversation: any) => {
    // useCompletion will fetch the full conversation from SQLite by id
    window.dispatchEvent(
      new CustomEvent("conversationSelected", {
        detail: { id: conversation.id },
      })
    );
  };

  const handleNewConversation = () => {
    // Trigger new conversation event
    window.dispatchEvent(new CustomEvent("newConversation"));
  };

  // WINDOWS HIDE/SHOW TOGGLE WINDOW WORKAROUND FOR SHORTCUTS
  //
  // On Windows the toggle_window shortcut doesn't actually hide the native
  // window in the Rust handler — it only flips a shared `is_hidden` flag and
  // emits `toggle-window-visibility`. To make the window *look* hidden, this
  // listener force-closes any open popover by writing inline styles directly
  // on the DOM (display:none !important, data-state=closed). Radix's own
  // controlled `open` prop isn't touched, so its React state stays "open".
  //
  // Critical: on the SHOW event we MUST undo those inline overrides,
  // otherwise the popover reopens with distorted layout — Radix's positioning
  // and animation state won't match the stale inline `display:none` /
  // `data-state=closed` still sitting on the element. That's what causes the
  // "formatting is fine on first open, distorted after Ctrl+Shift+I toggle"
  // regression.
  useEffect(() => {
    const unlistenPromise = listen<boolean>(
      "toggle-window-visibility",
      (event) => {
        const platform = navigator.platform.toLowerCase();
        if (typeof event.payload !== "boolean" || !platform.includes("win")) {
          return;
        }
        const isNowHidden = event.payload; // true = window just hidden
        setIsHidden(!isNowHidden);

        // Catch every popover (there are multiple in the tree — the response
        // panel and the nested chat history) — the old code only touched the
        // first #popover-content match, which is invalid HTML anyway.
        const popovers = document.querySelectorAll<HTMLElement>(
          '[data-slot="popover-content"], #popover-content'
        );
        const triggers = document.querySelectorAll<HTMLElement>(
          '[data-slot="popover-trigger"]'
        );

        if (isNowHidden) {
          popovers.forEach((el) => {
            el.style.setProperty("display", "none", "important");
            el.setAttribute("data-state", "closed");
          });
          triggers.forEach((el) => el.setAttribute("data-state", "closed"));
        } else {
          // Window is coming back — drop the forced-close overrides so
          // Radix's own render can drive display + data-state. React state
          // for the popovers is preserved (see useCompletion window-visibility
          // handler), so Radix will re-render with the correct data-state on
          // its next commit; removing the inline overrides here lets that
          // render actually reach the DOM.
          popovers.forEach((el) => {
            el.style.removeProperty("display");
            el.removeAttribute("data-state");
          });
          triggers.forEach((el) => el.removeAttribute("data-state"));
        }
      }
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const handleShortcutRegistrationError = (
      event: Event | CustomEvent<Array<[string, string, string]>>
    ) => {
      const detail =
        (event as CustomEvent<Array<[string, string, string]>>)?.detail ?? [];

      if (!detail.length) {
        return;
      }

      const formatted = detail
        .map(([action, key, error]) => ({ action, key, error }))
        .filter(({ action, key }) => action && key);

      if (!formatted.length) {
        return;
      }

      console.warn(
        "Some shortcuts could not be registered:",
        formatted.map(({ action, key, error }) => ({
          action,
          key,
          error,
        }))
      );
    };

    window.addEventListener(
      "shortcutRegistrationError",
      handleShortcutRegistrationError as EventListener
    );

    return () => {
      window.removeEventListener(
        "shortcutRegistrationError",
        handleShortcutRegistrationError as EventListener
      );
    };
  }, []);

  return {
    isHidden,
    setIsHidden,
    handleSelectConversation,
    handleNewConversation,
    systemAudio,
  };
};
