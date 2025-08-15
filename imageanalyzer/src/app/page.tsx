"use client";

import { useCallback, useMemo, useRef, useState } from "react";

type AnalyzeResponse = {
  result: string;
  boundingBoxes?: Array<{x1: number, y1: number, x2: number, y2: number, description: string}>;
  contextMeta?: { docName: string; page: number; charCount: number }[];
  contextText?: string | null;
  indexDiagnostics?: { totalChunks: number; files: { docName: string; pages: number }[]; configuredPaths: { path: string; exists: boolean }[] };
  pageScan?: { docs: { path: string; exists: boolean; pages?: { page: number; extractedChars: number; usedOcr: boolean; error?: string }[] }[] };
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>("");
  const [showPrompt, setShowPrompt] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [passed, setPassed] = useState<boolean | null>(null);
  const [contextMeta, setContextMeta] = useState<AnalyzeResponse["contextMeta"]>([]);
  const [contextText, setContextText] = useState<string | null | undefined>(undefined);
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const [showExpanded, setShowExpanded] = useState<boolean>(false);
  const [indexDiag, setIndexDiag] = useState<AnalyzeResponse["indexDiagnostics"]>();
  const [pageScan, setPageScan] = useState<AnalyzeResponse["pageScan"]>();
  const [boundingBoxes, setBoundingBoxes] = useState<AnalyzeResponse["boundingBoxes"]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const extractRecommendation = useCallback((text: string): string => {
    // Look for "Recommendation:" or similar patterns
    const recommendationPatterns = [
      /recommendation:?\s*(.*)/i,
      /recommend:?\s*(.*)/i,
      /suggestion:?\s*(.*)/i,
      /action:?\s*(.*)/i,
      /next steps:?\s*(.*)/i,
      /conclusion:?\s*(.*)/i
    ];
    
    for (const pattern of recommendationPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    // If no explicit recommendation section, try to extract the last paragraph
    const paragraphs = text.split('\n\n').filter(p => p.trim());
    if (paragraphs.length > 0) {
      const lastParagraph = paragraphs[paragraphs.length - 1].trim();
      // If the last paragraph seems like a conclusion/recommendation
      if (lastParagraph.toLowerCase().includes('no') ||
          lastParagraph.toLowerCase().includes('recommend') ||
          lastParagraph.toLowerCase().includes('action') ||
          lastParagraph.toLowerCase().includes('attention') ||
          lastParagraph.toLowerCase().includes('required') ||
          lastParagraph.toLowerCase().includes('needed') ||
          lastParagraph.toLowerCase().includes('standards') ||
          lastParagraph.toLowerCase().includes('cleaning') ||
          lastParagraph.toLowerCase().includes('maintenance')) {
        return lastParagraph;
      }
    }
    
    // If still no clear recommendation, try to find sentences that contain key recommendation words
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    const recommendationSentences = sentences.filter(sentence => {
      const lower = sentence.toLowerCase();
      return lower.includes('no') ||
             lower.includes('recommend') ||
             lower.includes('action') ||
             lower.includes('attention') ||
             lower.includes('required') ||
             lower.includes('needed') ||
             lower.includes('standards') ||
             lower.includes('cleaning') ||
             lower.includes('maintenance') ||
             lower.includes('should') ||
             lower.includes('must');
    });
    
    if (recommendationSentences.length > 0) {
      return recommendationSentences.join('. ').trim() + '.';
    }
    
    // Fallback: return the full text if it's short, otherwise the first 300 characters
    return text.length > 300 ? text.substring(0, 300) + '...' : text;
  }, []);

  const classifyResult = useCallback((raw: string): boolean | null => {
    const text = (raw || "").toLowerCase();
    
    // 1) Explicit boolean-like mentions take precedence
    const has = (word: string) => new RegExp(`(^|\\b)${word}(\\b|[^a-z])`, "i").test(text);
    const positiveTokens = ["yes", "pass", "passed", "true"];
    const negativeTokens = ["fail", "failed", "false"];
    const anyPositive = positiveTokens.some(has);
    const anyNegative = negativeTokens.some(has);
    if (anyPositive && !anyNegative) return true;
    if (anyNegative && !anyPositive) return false;

    // 2) Heuristic cleanliness classifier with improved negation handling
    const normalized = text.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ");

    // Check for explicit negations first (e.g., "not clean", "is not clean", "not sanitary")
    const explicitNegations = [
      /not\s+clean/i,
      /is\s+not\s+clean/i,
      /not\s+maintained/i,
      /not\s+tidy/i,
      /not\s+neat/i,
      /not\s+organized/i,
      /not\s+sanitary/i,
      /not\s+hygienic/i,
      /not\s+spotless/i
    ];
    
    if (explicitNegations.some(pattern => pattern.test(text))) {
      return false;
    }

    const positivePhrases = [
      "clean", "well maintained", "tidy", "neat", "spotless", "organized", "sanitary", "hygienic",
      "vacuum tracks", "fresh vacuum", "recently cleaned", "orderly", "no clutter", "no debris",
      "no stains", "no dirt", "no dust", "free of dirt", "free of clutter", "generally clean",
      "acceptable cleanliness", "cleanliness standards", "no visible stains", "no visible marks",
      "no visible debris", "properly positioned", "good condition", "well-maintained"
    ];
    const negativePhrases = [
      "dirty", "messy", "clutter", "debris", "stain", "stains", "unclean", "soiled",
      "filthy", "untidy", "dusty", "mold", "spill", "trash", "greasy", "smudge", "smudges"
    ];

    // Patterns that imply positive via negation of negative (e.g., "no visible clutter")
    const negatedNegative = /(no|without|free of)\s+(visible\s+)?(clutter|debris|stains?|dirt|dust|mess|trash|mold)/;
    if (negatedNegative.test(normalized)) return true;

    // Check for positive phrases that indicate cleanliness standards are met
    const cleanlinessStandards = /(meets|meeting|acceptable|standards|requirements|satisfactory)/i;
    if (cleanlinessStandards.test(text) && !explicitNegations.some(pattern => pattern.test(text))) {
      return true;
    }

    // Count positive and negative phrases, but exclude negated negative phrases
    const posHits = positivePhrases.filter(p => normalized.includes(p)).length;
    
    // For negative phrases, only count them if they're NOT negated
    const negHits = negativePhrases.filter(p => {
      if (!normalized.includes(p)) return false;
      // Check if this negative phrase is negated (e.g., "no debris", "no stains")
      const negationPattern = new RegExp(`(no|without|free of)\\s+(visible\\s+)?${p}`, "i");
      return !negationPattern.test(text);
    }).length;

    if (posHits > 0 && negHits === 0) return true;
    if (negHits > 0 && posHits === 0) return false;
    if (posHits > negHits) return true;
    if (negHits > posHits) return false;
    return null;
  }, []);

  const onSelectFile = useCallback((f: File | null) => {
    setError(null);
    setResult("");
    setBoundingBoxes([]);
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (f.type !== "image/jpeg") {
      setError("Only JPG images are supported.");
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    onSelectFile(f ?? null);
  }, [onSelectFile]);

  const dragEvents = useMemo(() => ({
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => e.preventDefault(),
    onDrop,
  }), [onDrop]);

  const pickFile = useCallback(() => inputRef.current?.click(), []);

  const readAsBase64 = useCallback(async (blob: Blob) => {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

  const analyze = useCallback(async () => {
    if (!file) {
      setError("Please add a JPG image first.");
      return;
    }
    if (!prompt.trim()) {
      setError("Please enter a prompt.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult("");
    try {
      const base64 = await readAsBase64(file);
      const res = await fetch(`/api/analyze${showDebug ? "?debug=1&reindex=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, prompt }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Request failed (${res.status})`);
      }
      const data: AnalyzeResponse = await res.json();
      setResult(data.result);
      setBoundingBoxes(data.boundingBoxes || []);
      setContextMeta(data.contextMeta || []);
      setContextText(data.contextText);
      setIndexDiag(data.indexDiagnostics);
      setPageScan(data.pageScan);
      setPassed(classifyResult(data.result));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [file, prompt, readAsBase64, classifyResult]);

  return (
    <div className="font-sans min-h-screen p-8 sm:p-12">
      <main className="max-w-4xl mx-auto w-full flex flex-col gap-6">

        <div
          className="rounded-lg p-4 flex flex-col gap-3 items-center justify-center text-center"
          style={{ background: "var(--panel)", border: "1px solid var(--color-border)" }}
          {...dragEvents}
        >
          <div className="w-full flex flex-col items-center gap-3">
            <div className="text-sm">Drag and drop a JPG here, or</div>
            <button
              className="rounded-md px-3 py-1.5 text-sm"
              style={{ border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-primary)" }}
              onClick={pickFile}
              type="button"
            >
              Choose file
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg"
              className="hidden"
              onChange={(e) => onSelectFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {previewUrl && (
            <div className="mt-2 relative inline-block">
              <img
                src={previewUrl}
                alt="Preview"
                className="max-h-72 rounded-md"
                style={{ border: "1px solid var(--color-border)" }}
              />
              {boundingBoxes && boundingBoxes.length > 0 && (
                <div className="absolute inset-0 pointer-events-none">
                  {boundingBoxes.map((box, index) => (
                    <div
                      key={index}
                      className="absolute border-2 border-red-500"
                      style={{
                        left: `${box.x1}%`,
                        top: `${box.y1}%`,
                        width: `${box.x2 - box.x1}%`,
                        height: `${box.y2 - box.y1}%`,
                      }}
                      title={box.description}
                    >
                      <div className="absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 py-0.5 rounded whitespace-nowrap">
                        {box.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>Prompt</span>
          <button
            type="button"
            className="text-xs underline"
            style={{ color: "var(--color-accent)" }}
            onClick={() => setShowPrompt((v) => !v)}
          >
            {showPrompt ? "Hide" : "Show"}
          </button>
        </div>
        {showPrompt && (
          <label className="flex flex-col gap-2">
            <textarea
              className="w-full rounded-lg p-3 min-h-24 bg-transparent"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              placeholder="Describe what you want the model to analyze..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
        )}

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={analyze}
              disabled={loading}
              className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              style={{ background: "var(--accent)", color: "#0b1220" }}
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
              )}
              {loading ? "Analyzing..." : "Analyze"}
            </button>
            {loading && (
              <div className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Processing image and context...
              </div>
            )}
          </div>
          {error && <span className="text-red-500 text-sm">{error}</span>}
          <label className="ml-auto flex items-center gap-2 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
            Show context
          </label>
        </div>

        {result && (
          <div className="rounded-lg" style={{ border: "1px solid var(--color-border)", background: "var(--panel)" }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
              {passed === true && (
                <span role="img" aria-label="pass" className="inline-flex items-center justify-center w-5 h-5 rounded-full" style={{ background: "#16a34a" }}>✓</span>
              )}
              {passed === false && (
                <span role="img" aria-label="fail" className="inline-flex items-center justify-center w-5 h-5 rounded-full" style={{ background: "#dc2626" }}>✕</span>
              )}
              {passed === null && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full" style={{ background: "#64748b" }}>•</span>
              )}
              <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                {passed === true ? "Pass" : passed === false ? "Fail" : "Result"}
              </span>
              {contextMeta && contextMeta.length > 0 && (
                <span className="ml-auto text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  Context from {Array.from(new Set(contextMeta.map(m => `${m.docName} p.${m.page}`))).slice(0,3).join(", ")}
                </span>
              )}
            </div>
            
            {/* Recommendation Section (Always Visible) */}
            <div className="p-4">
              <div className="mb-3">
                <h4 className="text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>Recommendation</h4>
                <div
                  role="textbox"
                  aria-readonly="true"
                  className="w-full rounded-md p-3 bg-transparent whitespace-pre-wrap break-words min-h-20"
                  style={{ 
                    border: "1px solid var(--color-border)", 
                    color: "var(--color-text-primary)",
                    overflow: "visible",
                    wordWrap: "break-word"
                  }}
                >
                  {extractRecommendation(result)}
                </div>
              </div>
              
              {/* Expand/Collapse Button */}
              <button
                type="button"
                onClick={() => setShowExpanded(!showExpanded)}
                className="text-xs underline flex items-center gap-1"
                style={{ color: "var(--color-accent)" }}
              >
                {showExpanded ? "Hide" : "Show"} full analysis
                <span className="text-xs">
                  {showExpanded ? "▼" : "▶"}
                </span>
              </button>
            </div>
            
            {/* Expanded Analysis Section */}
            {showExpanded && (
              <div className="px-4 pb-4 space-y-4" style={{ borderTop: "1px solid var(--color-border)" }}>
                {/* Full Analysis */}
                <div>
                  <h4 className="text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>Full Analysis</h4>
                  <div
                    role="textbox"
                    aria-readonly="true"
                    className="w-full rounded-md p-3 bg-transparent whitespace-pre-wrap break-words"
                    style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  >
                    {result}
                  </div>
                </div>
                
                {/* Bounding Boxes Info */}
                {boundingBoxes && boundingBoxes.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>Identified Areas</h4>
                    <div className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                      {boundingBoxes.length} area{boundingBoxes.length !== 1 ? 's' : ''} identified and highlighted on the image above.
                    </div>
                  </div>
                )}
                
                {/* Debug Information */}
                {showDebug && (
                  <div className="space-y-3">
                    {indexDiag && (
                      <div>
                        <h4 className="text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>Document Index</h4>
                        <div className="rounded-md p-3 text-xs" style={{ border: "1px dashed var(--color-border)", color: "var(--color-text-secondary)", background: "var(--panel-elevated)" }}>
                          <div>Indexed chunks: {indexDiag.totalChunks}</div>
                          <div>Files: {indexDiag.files.map(f => `${f.docName} (${f.pages}p)`).join(", ") || "-"}</div>
                          {indexDiag.configuredPaths && (
                            <div className="mt-1">Configured paths: {indexDiag.configuredPaths.map(p => `${p.exists ? "✓" : "✕"} ${p.path}`).join("; ")}</div>
                          )}
                        </div>
                      </div>
                    )}
                    {contextText && (
                      <div>
                        <h4 className="text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>Relevant Context</h4>
                        <div className="rounded-md p-3 text-xs whitespace-pre-wrap break-words" style={{ border: "1px dashed var(--color-border)", color: "var(--color-text-secondary)", background: "var(--panel-elevated)" }}>
                          {contextText}
                        </div>
                      </div>
                    )}
                    {pageScan && (
                      <div>
                        <h4 className="text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>Document Scan</h4>
                        <div className="rounded-md p-3 text-xs whitespace-pre-wrap break-words" style={{ border: "1px dashed var(--color-border)", color: "var(--color-text-secondary)", background: "var(--panel-elevated)" }}>
                          {pageScan.docs.map(d => (
                            <div key={d.path} className="mb-2">
                              <div>{d.exists ? "✓" : "✕"} {d.path}</div>
                              {d.pages && d.pages.length > 0 && (
                                <div>
                                  {d.pages.map(p => `p.${p.page}: ${p.extractedChars} chars${p.usedOcr ? " (ocr)" : ""}${p.error ? ` error=${p.error}` : ""}`).join("; ")}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
