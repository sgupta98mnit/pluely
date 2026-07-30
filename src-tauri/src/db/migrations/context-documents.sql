-- Create context_documents table
-- Stores the user's resume and any additional reference documents whose
-- extracted text is combined with the system prompt on every AI request.
CREATE TABLE IF NOT EXISTS context_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('resume', 'document')),
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    file_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for faster lookups by type (resume vs. additional documents)
CREATE INDEX IF NOT EXISTS idx_context_documents_type ON context_documents(type);

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_context_documents_timestamp
AFTER UPDATE ON context_documents
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE context_documents
    SET updated_at = datetime('now')
    WHERE id = NEW.id;
END;
