import fs from "fs";
import path from "path";
import * as pdfjsLib from "pdfjs-dist";

export type IndexedChunk = {
  id: string;
  docPath: string;
  docName: string;
  page: number;
  text: string;
};

type IndexState = {
  chunks: IndexedChunk[];
  df: Map<string, number>; // document frequency per term across chunks
  totalChunks: number;
};

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

async function extractPdfChunks(absPath: string): Promise<IndexedChunk[]> {
  const chunks: IndexedChunk[] = [];
  const docName = path.basename(absPath);
  const targetChunkChars = 900;

  try {
    // Read the PDF file
    const dataBuffer = fs.readFileSync(absPath);
    
    // Configure pdfjs for serverless environment
    pdfjsLib.GlobalWorkerOptions.workerSrc = undefined;
    
    // Parse the entire PDF
    const pdf = await pdfjsLib.getDocument({
      data: dataBuffer,
      useWorker: false,
      disableWorker: true
    }).promise;
    
    const numPages = pdf.numPages;
    let fullText = "";
    
    // Extract text from all pages
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += pageText + " ";
    }
    
    const normalizedText = normalizeWhitespace(fullText);
    
    if (!normalizedText) {
      return chunks;
    }

    // Split into chunks
    for (let i = 0; i < normalizedText.length; i += targetChunkChars) {
      const slice = normalizedText.slice(i, Math.min(i + targetChunkChars, normalizedText.length));
      const id = `${docName}-p1-${i}`;
      chunks.push({ id, docPath: absPath, docName, page: 1, text: slice });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to parse PDF", absPath, err);
  }

  return chunks;
}

async function buildIndex(): Promise<IndexState> {
  const envPaths = process.env.DOC_PATHS?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  // Fallback to the documents directory in public folder
  const fallback = path.resolve(process.cwd(), "public/documents/2024_National_Custodial_Specification_October_2024-1.pdf");
  const filePaths = envPaths.length > 0 ? envPaths : [fallback];

  const allChunks: IndexedChunk[] = [];
  for (const p of filePaths) {
    try {
      const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
      if (fs.existsSync(abs)) {
        const chunks = await extractPdfChunks(abs);
        allChunks.push(...chunks);
      }
    } catch (err) {
      // Skip problematic files
      // eslint-disable-next-line no-console
      console.warn("Failed to index", p, err);
    }
  }

  // Build DF map
  const df = new Map<string, number>();
  for (const chunk of allChunks) {
    const uniqueTerms = new Set(tokenize(chunk.text));
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  return { chunks: allChunks, df, totalChunks: allChunks.length };
}

// Simple global cache to persist between requests in dev
const g = globalThis as unknown as { __DOC_INDEX?: Promise<IndexState> };

export async function ensureIndex(): Promise<IndexState> {
  if (!g.__DOC_INDEX) {
    g.__DOC_INDEX = buildIndex();
  }
  return g.__DOC_INDEX;
}

export function resetIndex(): void {
  delete (globalThis as any).__DOC_INDEX;
}

export async function getIndexDiagnostics(): Promise<{
  totalChunks: number;
  files: { docName: string; pages: number }[];
  configuredPaths: { path: string; exists: boolean }[];
}> {
  const idx = await ensureIndex();

  const envPaths = process.env.DOC_PATHS?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const fallback = path.resolve(process.cwd(), "public/documents/2024_National_Custodial_Specification_October_2024-1.pdf");
  const filePaths = envPaths.length > 0 ? envPaths : [fallback];

  const configuredPaths = filePaths.map((p) => {
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    return { path: abs, exists: fs.existsSync(abs) };
  });

  const fileToPages = new Map<string, Set<number>>();
  for (const c of idx.chunks) {
    if (!fileToPages.has(c.docName)) fileToPages.set(c.docName, new Set());
    fileToPages.get(c.docName)!.add(c.page);
  }
  const files = Array.from(fileToPages.entries()).map(([docName, pages]) => ({ docName, pages: pages.size }));
  return { totalChunks: idx.totalChunks, files, configuredPaths };
}

function scoreChunk(queryTokens: string[], chunk: IndexedChunk, df: Map<string, number>, total: number): number {
  const textTokens = tokenize(chunk.text);
  const termCounts = new Map<string, number>();
  for (const t of textTokens) termCounts.set(t, (termCounts.get(t) || 0) + 1);
  let score = 0;
  for (const qt of queryTokens) {
    const tf = termCounts.get(qt) || 0;
    if (tf === 0) continue;
    const docFreq = df.get(qt) || 1;
    const idf = Math.log((total + 1) / (docFreq + 1));
    score += tf * idf;
  }
  return score;
}

export type RetrievedContext = {
  text: string;
  segments: { docName: string; page: number; charCount: number }[];
} | null;

export async function getRelevantContext(query: string, charBudget = 4000, topK = 8): Promise<RetrievedContext> {
  const index = await ensureIndex();
  if (index.totalChunks === 0) return null;
  const qTokens = tokenize(query);
  const scoredAll = index.chunks
    .map((c) => ({ c, s: scoreChunk(qTokens, c, index.df, index.totalChunks) }))
    .sort((a, b) => b.s - a.s);
  let picked = scoredAll.filter((x) => x.s > 0).slice(0, topK);
  // Fallback: if no positive scores, just take the first topK pages in order
  if (picked.length === 0) {
    picked = scoredAll.slice(0, topK);
  }

  const lines: string[] = [];
  const segments: { docName: string; page: number; charCount: number }[] = [];
  let used = 0;
  for (const { c } of picked) {
    const header = `[${c.docName} p.${c.page}]`;
    const block = `${header}\n${normalizeWhitespace(c.text)}`;
    if (used + block.length + 4 > charBudget) break;
    lines.push(block);
    segments.push({ docName: c.docName, page: c.page, charCount: block.length });
    used += block.length + 4;
  }
  if (lines.length === 0) return null;
  return {
    text: `Relevant document excerpts (use for reference; cite when useful):\n\n${lines.join("\n\n---\n\n")}`,
    segments,
  };
}

export async function scanConfiguredPdfs(maxPages: number = 10): Promise<{
  docs: {
    path: string;
    exists: boolean;
    pages?: { page: number; extractedChars: number; usedOcr: boolean; error?: string }[];
  }[];
}> {
  const envPaths = process.env.DOC_PATHS?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const fallback = path.resolve(process.cwd(), "public/documents/2024_National_Custodial_Specification_October_2024-1.pdf");
  const filePaths = envPaths.length > 0 ? envPaths : [fallback];

  const results: {
    path: string;
    exists: boolean;
    pages?: { page: number; extractedChars: number; usedOcr: boolean; error?: string }[];
  }[] = [];

  for (const p of filePaths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    const exists = fs.existsSync(abs);
    const docRes: any = { path: abs, exists };
    if (!exists) {
      results.push(docRes);
      continue;
    }
    try {
      // Use pdfjs-dist to extract text
      const dataBuffer = fs.readFileSync(abs);
      
      // Configure pdfjs for serverless environment
      pdfjsLib.GlobalWorkerOptions.workerSrc = undefined;
      
      const pdf = await pdfjsLib.getDocument({
        data: dataBuffer,
        useWorker: false,
        disableWorker: true
      }).promise;
      
      const numPages = pdf.numPages;
      let fullText = "";
      
      // Extract text from all pages
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(" ");
        fullText += pageText + " ";
      }
      
      const text = normalizeWhitespace(fullText);
      
      docRes.pages = [{ 
        page: 1, 
        extractedChars: text.length, 
        usedOcr: false 
      }];
    } catch (e) {
      docRes.pages = [{ 
        page: 0, 
        extractedChars: 0, 
        usedOcr: false, 
        error: (e as any)?.message || String(e) 
      }];
    }
    results.push(docRes);
  }
  return { docs: results };
}


