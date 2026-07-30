import { useCallback, useEffect, useState } from "react";
import {
  createSystemPrompt,
  getAllSystemPrompts,
  updateSystemPrompt,
  deleteSystemPrompt,
} from "@/lib/database";
import type {
  SystemPrompt,
  SystemPromptInput,
  UpdateSystemPromptInput,
} from "@/types";
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_PROMPT_NAME,
  STORAGE_KEYS,
} from "@/config";
import { safeLocalStorage } from "@/lib";
import { useApp } from "@/contexts";

export const useSystemPrompts = () => {
  const { setSystemPrompt } = useApp();
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(
    () => {
      const stored = safeLocalStorage.getItem(
        STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID
      );
      return stored ? Number(stored) : null;
    }
  );

  /**
   * Fetch all system prompts from database. Returns the fetched list so
   * callers that need the up-to-date data immediately (e.g. first-run
   * seeding) don't have to wait on the next render for state to settle.
   */
  const fetchPrompts = useCallback(async (): Promise<SystemPrompt[]> => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getAllSystemPrompts();
      setPrompts(result);
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch system prompts";
      setError(errorMessage);
      console.error("Error fetching system prompts:", err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create a new system prompt
   */
  const createPrompt = useCallback(
    async (input: SystemPromptInput): Promise<SystemPrompt> => {
      try {
        setError(null);
        const result = await createSystemPrompt(input);
        await fetchPrompts(); // Refresh list
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to create system prompt";
        setError(errorMessage);
        console.error("Error creating system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Update an existing system prompt
   */
  const updatePrompt = useCallback(
    async (
      id: number,
      input: UpdateSystemPromptInput
    ): Promise<SystemPrompt> => {
      try {
        setError(null);
        const result = await updateSystemPrompt(id, input);
        await fetchPrompts(); // Refresh list
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to update system prompt";
        setError(errorMessage);
        console.error("Error updating system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Delete a system prompt
   */
  const deletePrompt = useCallback(
    async (id: number): Promise<void> => {
      try {
        setError(null);
        await deleteSystemPrompt(id);
        await fetchPrompts(); // Refresh list
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to delete system prompt";
        setError(errorMessage);
        console.error("Error deleting system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Refresh prompts list
   */
  const refreshPrompts = useCallback(async () => {
    await fetchPrompts();
  }, [fetchPrompts]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * First-run seeding: create a normal, user-editable "Mock Interview Coach"
   * system prompt so the interview-coaching behavior lives in the same
   * editable library as anything else the user creates — not hardcoded. Only
   * seeds when the user genuinely has no prompts of their own yet, so it
   * never overwrites something they made, and only ever runs once (guarded
   * by a localStorage flag).
   */
  const seedDefaultPromptIfNeeded = useCallback(
    async (currentPrompts: SystemPrompt[]) => {
      const alreadySeeded = safeLocalStorage.getItem(
        STORAGE_KEYS.DEFAULT_PROMPT_SEEDED
      );
      if (alreadySeeded || currentPrompts.length > 0) {
        // Either already seeded, or the user already has prompts of their
        // own (e.g. upgraded from an older version) — nothing to seed.
        safeLocalStorage.setItem(STORAGE_KEYS.DEFAULT_PROMPT_SEEDED, "true");
        return;
      }

      try {
        const created = await createSystemPrompt({
          name: DEFAULT_PROMPT_NAME,
          prompt: DEFAULT_SYSTEM_PROMPT,
        });
        await fetchPrompts();
        safeLocalStorage.setItem(STORAGE_KEYS.DEFAULT_PROMPT_SEEDED, "true");

        // Don't steal selection away from an already-active Pluely cloud
        // prompt — just leave the seeded prompt available, unselected.
        const hasPluelyPromptSelected = safeLocalStorage.getItem(
          "selected_pluely_prompt"
        );
        if (!hasPluelyPromptSelected) {
          setSystemPrompt(created.prompt);
          setSelectedPromptId(created.id);
          safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, created.prompt);
          safeLocalStorage.setItem(
            STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID,
            created.id.toString()
          );
        }
      } catch (err) {
        console.error("Failed to seed default system prompt:", err);
      }
    },
    [fetchPrompts, setSystemPrompt]
  );

  // Fetch prompts on mount, then seed the default prompt if this is a
  // genuinely fresh install. Sequenced explicitly (rather than as two
  // separate effects reacting to state) so seeding always sees the real,
  // just-fetched list instead of a stale pre-fetch render's closure.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await fetchPrompts();
      if (cancelled) return;
      await seedDefaultPromptIfNeeded(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchPrompts, seedDefaultPromptIfNeeded]);

  /**
   * Load selected prompt on mount and when prompts change
   */
  useEffect(() => {
    if (selectedPromptId && prompts.length > 0) {
      const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);
      if (selectedPrompt) {
        setSystemPrompt(selectedPrompt.prompt);
      } else {
        // Selected prompt was deleted, reset to default
        setSelectedPromptId(null);
        safeLocalStorage.removeItem(STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID);
        const currentPrompt = safeLocalStorage.getItem(
          STORAGE_KEYS.SYSTEM_PROMPT
        );
        if (!currentPrompt) {
          setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
          safeLocalStorage.setItem(
            STORAGE_KEYS.SYSTEM_PROMPT,
            DEFAULT_SYSTEM_PROMPT
          );
        }
      }
    }
  }, [prompts, selectedPromptId, setSystemPrompt]);

  /**
   * Handle selecting a prompt
   */
  const handleSelectPrompt = useCallback(
    (promptId: number) => {
      const selectedPrompt = prompts.find((p) => p.id === promptId);
      if (selectedPrompt) {
        setSystemPrompt(selectedPrompt.prompt);
        setSelectedPromptId(promptId);
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_PROMPT,
          selectedPrompt.prompt
        );
        safeLocalStorage.setItem(
          STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID,
          promptId.toString()
        );
        // Clear any selected Pluely prompt when user selects their own prompt
        safeLocalStorage.removeItem("selected_pluely_prompt");
      }
    },
    [prompts, setSystemPrompt]
  );

  return {
    prompts,
    isLoading,
    error,
    selectedPromptId,
    createPrompt,
    updatePrompt,
    deletePrompt,
    refreshPrompts,
    clearError,
    handleSelectPrompt,
  };
};
