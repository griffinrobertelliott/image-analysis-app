import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getRelevantContext, getIndexDiagnostics, resetIndex, scanConfiguredPdfs } from "@/server/docIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnalyzeRequest = {
  imageBase64: string;
  prompt: string;
};

function extractTextFromMessageContent(message: any): string {
  try {
    const parts = Array.isArray(message?.content) ? message.content : [];
    const texts = parts
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text);
    return texts.join("\n\n");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    const { imageBase64, prompt } = (await req.json()) as AnalyzeRequest;
    if (!imageBase64 || !prompt || typeof imageBase64 !== "string" || typeof prompt !== "string") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
    }

    const anthropic = new Anthropic({ apiKey });

    // Retrieve relevant context from indexed PDFs, within budget
    // Force reindex if explicitly requested
    if (url.searchParams.get("reindex") === "1") resetIndex();
    const retrieved = await getRelevantContext(prompt, 6000, 8);
    const systemPrefix = retrieved?.text
      ? `${retrieved.text}\n\nWhen answering, base your judgment on the provided excerpts where relevant. If the excerpts are irrelevant, state your reasoning without them.`
      : undefined;

    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
    
    // Enhanced prompt to request bounding box coordinates
    const enhancedPrompt = `${prompt}

IMPORTANT: If you identify specific areas in the image that match or violate the criteria, please provide bounding box coordinates in this exact format:
BOUNDING_BOX: [x1, y1, x2, y2] - description

Where:
- x1, y1 = top-left corner (0-100% of image width/height)
- x2, y2 = bottom-right corner (0-100% of image width/height)
- description = brief explanation of what this area shows

Example: BOUNDING_BOX: [10, 20, 30, 40] - dirty floor area

Provide your analysis first, then list any relevant bounding boxes. If no specific areas need highlighting, don't include any BOUNDING_BOX lines.`;

    const message = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            ...(systemPrefix ? [{ type: "text", text: systemPrefix }] : []),
            { type: "text", text: enhancedPrompt },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ],
    } as any);

    const resultText = extractTextFromMessageContent(message) || "(No textual output)";
    
    // Extract bounding boxes from the response
    const boundingBoxes: Array<{x1: number, y1: number, x2: number, y2: number, description: string}> = [];
    const boxRegex = /BOUNDING_BOX:\s*\[([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\]\s*-\s*(.+)/gi;
    let match;
    
    while ((match = boxRegex.exec(resultText)) !== null) {
      const [, x1, y1, x2, y2, description] = match;
      boundingBoxes.push({
        x1: parseFloat(x1),
        y1: parseFloat(y1),
        x2: parseFloat(x2),
        y2: parseFloat(y2),
        description: description.trim()
      });
    }
    const diag = await getIndexDiagnostics();
    const scan = debug ? await scanConfiguredPdfs(5) : undefined;
    return NextResponse.json({
      result: resultText,
      boundingBoxes,
      contextMeta: retrieved?.segments ?? [],
      contextText: debug ? (retrieved?.text ?? null) : undefined,
      indexDiagnostics: debug ? diag : undefined,
      pageScan: scan,
    });
  } catch (err: any) {
    const msg = err?.message ?? "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


