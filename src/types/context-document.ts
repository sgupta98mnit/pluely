export type ContextDocumentType = "resume" | "document";

export interface ContextDocument {
  id: number;
  type: ContextDocumentType;
  name: string;
  content: string;
  file_type: string;
  size: number;
  created_at: string;
  updated_at: string;
}

export interface ContextDocumentInput {
  type: ContextDocumentType;
  name: string;
  content: string;
  file_type: string;
  size: number;
}
