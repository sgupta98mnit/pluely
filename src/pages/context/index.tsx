import { useRef, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Textarea,
  Badge,
} from "@/components";
import { useContextDocuments } from "@/hooks";
import { PageLayout } from "@/layouts";
import { CONTEXT_DOCUMENT_ACCEPT, MAX_CONTEXT_DOCUMENTS } from "@/config";
import {
  FileTextIcon,
  UploadIcon,
  Trash2,
  Loader2,
  FileIcon,
} from "lucide-react";

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const Context = () => {
  const {
    resume,
    documents,
    additionalContext,
    setAdditionalContext,
    isLoading,
    isUploading,
    error,
    clearError,
    uploadResume,
    uploadDocument,
    removeResume,
    removeDocument,
  } = useContextDocuments();

  const resumeInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const [contextDraft, setContextDraft] = useState(additionalContext);
  const [isSavingContext, setIsSavingContext] = useState(false);

  const handleResumeSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await uploadResume(file);
  };

  const handleDocumentSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await uploadDocument(file);
  };

  const handleSaveContext = async () => {
    try {
      setIsSavingContext(true);
      await setAdditionalContext(contextDraft);
    } finally {
      setIsSavingContext(false);
    }
  };

  return (
    <PageLayout
      title="Resume & Context"
      description="Give the AI your resume, reference documents, and extra context so its answers are personalized to you"
    >
      {error && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Resume */}
      <Card className="shadow-none p-4">
        <CardHeader className="p-0">
          <CardTitle className="text-base">Resume</CardTitle>
          <CardDescription>
            Uploading a resume lets the AI reference your real experience
            when answering interview or conversation questions. PDF, DOCX,
            TXT, or MD.
          </CardDescription>
        </CardHeader>

        <div className="mt-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="size-4 animate-spin" /> Loading...
            </div>
          ) : resume ? (
            <div className="flex items-center justify-between rounded-lg border p-3 bg-black/5 dark:bg-white/5">
              <div className="flex items-center gap-3 min-w-0">
                <FileTextIcon className="size-5 flex-shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {resume.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(resume.size)} · uploaded {resume.created_at}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resumeInputRef.current?.click()}
                  disabled={isUploading}
                >
                  Replace
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={removeResume}
                  disabled={isUploading}
                  title="Remove resume"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => resumeInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <UploadIcon className="size-4 mr-2" />
              )}
              Upload Resume
            </Button>
          )}
        </div>

        <input
          ref={resumeInputRef}
          type="file"
          accept={CONTEXT_DOCUMENT_ACCEPT}
          onChange={handleResumeSelect}
          className="hidden"
        />
      </Card>

      {/* Additional Documents */}
      <Card className="shadow-none p-4">
        <CardHeader className="p-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                Additional Documents
              </CardTitle>
              <CardDescription>
                Job descriptions, project briefs, or any other reference
                material. Up to {MAX_CONTEXT_DOCUMENTS} files.
              </CardDescription>
            </div>
            <Badge variant="secondary">
              {documents.length}/{MAX_CONTEXT_DOCUMENTS}
            </Badge>
          </div>
        </CardHeader>

        <div className="mt-3 flex flex-col gap-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between rounded-lg border p-3 bg-black/5 dark:bg-white/5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileIcon className="size-5 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(doc.size)} · uploaded {doc.created_at}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeDocument(doc.id)}
                title="Remove document"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}

          <Button
            variant="outline"
            onClick={() => documentInputRef.current?.click()}
            disabled={isUploading || documents.length >= MAX_CONTEXT_DOCUMENTS}
            className="mt-1"
          >
            {isUploading ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <UploadIcon className="size-4 mr-2" />
            )}
            Add Document
          </Button>
        </div>

        <input
          ref={documentInputRef}
          type="file"
          accept={CONTEXT_DOCUMENT_ACCEPT}
          onChange={handleDocumentSelect}
          className="hidden"
        />
      </Card>

      {/* Additional Context */}
      <Card className="shadow-none p-4">
        <CardHeader className="p-0">
          <CardTitle className="text-base">Additional Context</CardTitle>
          <CardDescription>
            Freeform notes the AI should always keep in mind — role you're
            interviewing for, company info, tone preferences, etc.
          </CardDescription>
        </CardHeader>

        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            value={contextDraft}
            onChange={(e) => setContextDraft(e.target.value)}
            placeholder="e.g. I'm interviewing for a Senior Backend Engineer role at Acme Corp. Focus answers on distributed systems experience."
            className="min-h-32"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveContext}
              disabled={
                isSavingContext || contextDraft === additionalContext
              }
            >
              {isSavingContext ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Card>
    </PageLayout>
  );
};

export default Context;
