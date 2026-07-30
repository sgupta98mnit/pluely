import { useCallback, useEffect, useState } from "react";
import {
  createContextDocument,
  deleteContextDocument,
  getAllContextDocuments,
} from "@/lib/database";
import {
  extractDocumentText,
  getDocumentFileType,
  getAdditionalContextText,
  setAdditionalContextText,
} from "@/lib/functions";
import { MAX_CONTEXT_DOCUMENTS, MAX_CONTEXT_DOCUMENT_SIZE } from "@/config";
import type { ContextDocument } from "@/types";
import { useApp } from "@/contexts";

export const useContextDocuments = () => {
  const { refreshContextText } = useApp();

  const [resume, setResume] = useState<ContextDocument | null>(null);
  const [documents, setDocuments] = useState<ContextDocument[]>([]);
  const [additionalContext, setAdditionalContextState] = useState<string>(
    () => getAdditionalContextText()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const all = await getAllContextDocuments();
      setResume(all.find((d) => d.type === "resume") || null);
      setDocuments(all.filter((d) => d.type === "document"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load documents"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_CONTEXT_DOCUMENT_SIZE) {
      return `"${file.name}" is too large. Max size is ${
        MAX_CONTEXT_DOCUMENT_SIZE / (1024 * 1024)
      }MB.`;
    }
    const fileType = getDocumentFileType(file);
    if (!["pdf", "docx", "txt", "md"].includes(fileType)) {
      return `Unsupported file type for "${file.name}". Please upload a PDF, DOCX, TXT, or MD file.`;
    }
    return null;
  };

  const uploadResume = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      try {
        setIsUploading(true);
        setError(null);
        const content = await extractDocumentText(file);
        await createContextDocument({
          type: "resume",
          name: file.name,
          content,
          file_type: getDocumentFileType(file),
          size: file.size,
        });
        await fetchAll();
        await refreshContextText();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to upload resume"
        );
      } finally {
        setIsUploading(false);
      }
    },
    [fetchAll, refreshContextText]
  );

  const uploadDocument = useCallback(
    async (file: File) => {
      if (documents.length >= MAX_CONTEXT_DOCUMENTS) {
        setError(
          `You can only add up to ${MAX_CONTEXT_DOCUMENTS} additional documents.`
        );
        return;
      }

      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      try {
        setIsUploading(true);
        setError(null);
        const content = await extractDocumentText(file);
        await createContextDocument({
          type: "document",
          name: file.name,
          content,
          file_type: getDocumentFileType(file),
          size: file.size,
        });
        await fetchAll();
        await refreshContextText();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to upload document"
        );
      } finally {
        setIsUploading(false);
      }
    },
    [documents.length, fetchAll, refreshContextText]
  );

  const removeResume = useCallback(async () => {
    if (!resume) return;
    try {
      setError(null);
      await deleteContextDocument(resume.id);
      await fetchAll();
      await refreshContextText();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove resume"
      );
    }
  }, [resume, fetchAll, refreshContextText]);

  const removeDocument = useCallback(
    async (id: number) => {
      try {
        setError(null);
        await deleteContextDocument(id);
        await fetchAll();
        await refreshContextText();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to remove document"
        );
      }
    },
    [fetchAll, refreshContextText]
  );

  const saveAdditionalContext = useCallback(
    async (value: string) => {
      setAdditionalContextState(value);
      setAdditionalContextText(value);
      await refreshContextText();
    },
    [refreshContextText]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    resume,
    documents,
    additionalContext,
    setAdditionalContext: saveAdditionalContext,
    isLoading,
    isUploading,
    error,
    clearError,
    uploadResume,
    uploadDocument,
    removeResume,
    removeDocument,
    refreshDocuments: fetchAll,
  };
};
