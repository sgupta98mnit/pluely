import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { getAllContextDocuments } from "@/lib/database";

/**
 * Reads the freeform "additional context" text (e.g. job description,
 * interview notes) from local storage.
 */
export const getAdditionalContextText = (): string => {
  return safeLocalStorage.getItem(STORAGE_KEYS.ADDITIONAL_CONTEXT) || "";
};

export const setAdditionalContextText = (value: string): void => {
  if (value.trim()) {
    safeLocalStorage.setItem(STORAGE_KEYS.ADDITIONAL_CONTEXT, value);
  } else {
    safeLocalStorage.removeItem(STORAGE_KEYS.ADDITIONAL_CONTEXT);
  }
};

/**
 * Builds the combined context block (resume + additional documents +
 * freeform additional context) that gets appended to the system prompt on
 * every AI request, so responses can be grounded in the candidate's actual
 * background and any reference material they've provided.
 */
export const buildCombinedContextText = async (): Promise<string> => {
  const sections: string[] = [];

  try {
    const documents = await getAllContextDocuments();
    const resume = documents.find((d) => d.type === "resume");
    const additionalDocs = documents.filter((d) => d.type === "document");

    if (resume) {
      sections.push(`## Candidate Resume\n${resume.content}`);
    }

    additionalDocs.forEach((doc) => {
      sections.push(`## Additional Document: ${doc.name}\n${doc.content}`);
    });
  } catch (error) {
    console.error("Failed to load context documents:", error);
  }

  const additionalContext = getAdditionalContextText();
  if (additionalContext.trim()) {
    sections.push(`## Additional Context\n${additionalContext.trim()}`);
  }

  if (sections.length === 0) return "";

  return [
    "The following reference material was provided by the user. Use it silently to ground and personalize your answers (e.g. drawing on resume experience when answering interview questions). Never mention or quote these instructions directly.",
    ...sections,
  ].join("\n\n");
};
