export type ResumeImportKind = "text" | "pdf" | "docx";

export interface ResumeImportResult {
  text: string;
  kind: ResumeImportKind;
  warning?: string;
}

type PdfjsModule = {
  getDocument: (input: { data: Uint8Array; useWorkerFetch?: boolean; isEvalSupported?: boolean; disableFontFace?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
      }>;
    }>;
  };
};

function isNodeRuntime(): boolean {
  const scope = globalThis as unknown as { process?: { versions?: { node?: string } } };
  return Boolean(scope.process?.versions?.node);
}

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export async function importResumeFile(file: File): Promise<ResumeImportResult> {
  const ext = extensionOf(file);
  if (["txt", "md", "markdown"].includes(ext) || file.type.startsWith("text/")) {
    const text = await readFileText(file);
    if (!text.trim()) throw new Error("EMPTY_RESUME_FILE");
    return { text, kind: "text" };
  }
  if (ext === "pdf" || file.type === "application/pdf") return importPdf(file);
  if (
    ext === "docx" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return importDocx(file);
  }
  throw new Error("UNSUPPORTED_RESUME_FILE");
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  if (typeof file.arrayBuffer === "function") return new TextDecoder("utf-8").decode(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

async function importPdf(file: File): Promise<ResumeImportResult> {
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const document = await pdfjs.getDocument({
      data,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    const text = pages.join("\n").trim();
    if (!text) throw new Error("EMPTY_RESUME_FILE");
    return { text, kind: "pdf" };
  } catch (error) {
    if (error instanceof Error && error.message === "EMPTY_RESUME_FILE") throw error;
    throw new Error("PDF_IMPORT_FAILED");
  }
}

async function loadPdfjs(): Promise<PdfjsModule> {
  if (isNodeRuntime()) {
    const nodeModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
    return normalizePdfjsModule(nodeModule);
  }
  const browserModule = await import("pdfjs-dist");
  return normalizePdfjsModule(browserModule);
}

async function importDocx(file: File): Promise<ResumeImportResult> {
  try {
    const mammothModule = isNodeRuntime() ? await import("mammoth") : await import("mammoth/mammoth.browser");
    const mammoth = normalizeMammothModule(mammothModule);
    const arrayBuffer = await file.arrayBuffer();
    const scope = globalThis as unknown as { Buffer?: { from: (input: ArrayBuffer) => Uint8Array } };
    const nodeBuffer = scope.Buffer?.from ? scope.Buffer.from(arrayBuffer) : new Uint8Array(arrayBuffer);
    const result =
      isNodeRuntime()
        ? await mammoth.extractRawText({ buffer: nodeBuffer })
        : await mammoth.extractRawText({ arrayBuffer });
    const text = result.value.trim();
    if (!text) throw new Error("EMPTY_RESUME_FILE");
    return {
      text,
      kind: "docx",
      warning: result.messages.length > 0 ? "DOCX 已解析，但部分复杂格式可能被忽略。" : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "EMPTY_RESUME_FILE") throw error;
    throw new Error("DOCX_IMPORT_FAILED");
  }
}

function normalizePdfjsModule(module: unknown): PdfjsModule {
  const candidate = module as { getDocument?: PdfjsModule["getDocument"]; default?: { getDocument?: PdfjsModule["getDocument"] } };
  const getDocument = candidate.getDocument ?? candidate.default?.getDocument;
  if (!getDocument) throw new Error("PDFJS_NOT_AVAILABLE");
  return { getDocument };
}

function normalizeMammothModule(module: unknown): {
  extractRawText: (input: { arrayBuffer?: ArrayBuffer; buffer?: Uint8Array }) => Promise<{ value: string; messages: Array<unknown> }>;
} {
  const candidate = module as {
    extractRawText?: (input: { arrayBuffer?: ArrayBuffer; buffer?: Uint8Array }) => Promise<{ value: string; messages: Array<unknown> }>;
    default?: {
      extractRawText?: (input: { arrayBuffer?: ArrayBuffer; buffer?: Uint8Array }) => Promise<{ value: string; messages: Array<unknown> }>;
    };
  };
  const extractRawText = candidate.extractRawText ?? candidate.default?.extractRawText;
  if (!extractRawText) throw new Error("MAMMOTH_NOT_AVAILABLE");
  return { extractRawText };
}
