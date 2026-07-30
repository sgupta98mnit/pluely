import { getDatabase } from "./config";
import type { ContextDocument, ContextDocumentInput } from "@/types";

/**
 * Create a new context document (resume or additional document).
 * For type "resume", any existing resume row is replaced so there is only
 * ever one active resume at a time.
 */
export async function createContextDocument(
  input: ContextDocumentInput
): Promise<ContextDocument> {
  const db = await getDatabase();

  const name = input.name.trim();
  const content = input.content.trim();

  if (!name) {
    throw new Error("Document name cannot be empty");
  }

  if (!content) {
    throw new Error("Document content cannot be empty");
  }

  // A resume is a singleton: uploading a new one replaces the old one.
  if (input.type === "resume") {
    await db.execute("DELETE FROM context_documents WHERE type = 'resume'");
  }

  const result = await db.execute(
    "INSERT INTO context_documents (type, name, content, file_type, size) VALUES (?, ?, ?, ?, ?)",
    [input.type, name, content, input.file_type, input.size]
  );

  const inserted = await db.select<ContextDocument[]>(
    "SELECT * FROM context_documents WHERE id = ?",
    [result.lastInsertId]
  );

  if (!inserted[0]) {
    throw new Error("Failed to retrieve created document");
  }

  return inserted[0];
}

/**
 * Get all context documents (resume + additional documents)
 */
export async function getAllContextDocuments(): Promise<ContextDocument[]> {
  const db = await getDatabase();
  return await db.select<ContextDocument[]>(
    "SELECT * FROM context_documents ORDER BY created_at ASC"
  );
}

/**
 * Get the current resume, if any
 */
export async function getResumeDocument(): Promise<ContextDocument | null> {
  const db = await getDatabase();
  const result = await db.select<ContextDocument[]>(
    "SELECT * FROM context_documents WHERE type = 'resume' LIMIT 1"
  );
  return result[0] || null;
}

/**
 * Get all additional (non-resume) documents
 */
export async function getAdditionalDocuments(): Promise<ContextDocument[]> {
  const db = await getDatabase();
  return await db.select<ContextDocument[]>(
    "SELECT * FROM context_documents WHERE type = 'document' ORDER BY created_at ASC"
  );
}

/**
 * Delete a context document by id
 */
export async function deleteContextDocument(id: number): Promise<void> {
  const db = await getDatabase();
  const result = await db.execute(
    "DELETE FROM context_documents WHERE id = ?",
    [id]
  );

  if (result.rowsAffected === 0) {
    throw new Error("Document not found");
  }
}
