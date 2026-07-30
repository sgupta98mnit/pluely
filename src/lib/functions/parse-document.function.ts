/**
 * Extracts plain text from uploaded resume / context documents (PDF, DOCX,
 * TXT, MD) entirely client-side so the content can be stored and combined
 * with the system prompt sent to the AI provider.
 */

const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
};

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
};

const extractPdfText = async (file: File): Promise<string> => {
  const [pdfjsLib, workerUrl] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((m) => m.default),
  ]);

  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await readFileAsArrayBuffer(file);
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ");
    pageTexts.push(pageText);
  }

  return pageTexts.join("\n\n").trim();
};

const extractDocxText = async (file: File): Promise<string> => {
  const mammoth = await import("mammoth");
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const result = await mammoth.extractRawText({ arrayBuffer });
  return (result.value || "").trim();
};

/**
 * Returns a short, normalized file-type label ("pdf" | "docx" | "txt" | "md")
 * used for both storage and dispatching to the correct parser.
 */
export const getDocumentFileType = (file: File): string => {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (["pdf", "docx", "txt", "md"].includes(ext)) return ext;
  if (file.type === "application/pdf") return "pdf";
  if (
    file.type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  return "txt";
};

/**
 * Extract plain text content from a supported resume/document file.
 * Throws if the file type isn't supported or extraction yields no text.
 */
export const extractDocumentText = async (file: File): Promise<string> => {
  const fileType = getDocumentFileType(file);

  let text = "";
  switch (fileType) {
    case "pdf":
      text = await extractPdfText(file);
      break;
    case "docx":
      text = await extractDocxText(file);
      break;
    case "txt":
    case "md":
      text = await readFileAsText(file);
      break;
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }

  if (!text || !text.trim()) {
    throw new Error(
      "Couldn't extract any text from this file. It may be empty, scanned/image-based, or corrupted."
    );
  }

  return text.trim();
};
