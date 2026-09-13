import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface PdfPageText { page: number; text: string; }
export interface PdfExtractionResult {
  pages: PdfPageText[];
  extractor: string;
  ocrUsed: boolean;
  warnings: string[];
  metadata?: Record<string, unknown>;
}

async function hasCommand(command: string): Promise<boolean> {
  const probes: Array<[string, string[]]> = [
    [command, ["-version"]],
    [command, ["--version"]],
    [process.platform === "win32" ? "where" : "which", [command]]
  ];
  for (const [cmd, args] of probes) {
    try {
      await execFileAsync(cmd, args, { timeout: 5000, maxBuffer: 1024 * 1024 });
      return true;
    } catch { /* try next probe */ }
  }
  return false;
}

function splitPages(text: string): PdfPageText[] {
  return String(text || "")
    .split("\f")
    .map((pageText, i) => ({ page: i + 1, text: pageText.replace(/\r/g, "") }))
    .filter((p, i, arr) => i < arr.length - 1 || p.text.trim());
}

function splitMarkedPages(text: string): PdfPageText[] {
  const normalized = String(text || "").replace(/\r/g, "");
  const marker = /(?:^|\n)\s*(?:={2,}|-{2,}|#{1,6})?\s*PAGE\s+(\d+)\s*(?:={2,}|-{2,}|:)?\s*(?=\n|$)/gim;
  const matches = [...normalized.matchAll(marker)];
  if (!matches.length) {
    const form = splitPages(normalized);
    return form.length ? form : [{ page: 1, text: normalized }];
  }
  const pages: PdfPageText[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = (matches[i].index || 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index || normalized.length) : normalized.length;
    pages.push({ page: Number(matches[i][1]), text: normalized.slice(start, end).trim() });
  }
  return pages.filter(p => p.text.trim());
}

function usefulChars(pages: PdfPageText[]) {
  return pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
}

function extractFileAnnotationText(payload: any): { text: string; hash?: string } {
  const annotations = [
    ...(payload?.choices?.[0]?.message?.annotations || []),
    ...(payload?.error?.metadata?.file_annotations || [])
  ];
  const seen = new Set<string>();
  const parts: string[] = [];
  let hash: string | undefined;
  for (const a of annotations) {
    if (a?.type !== "file" || !a?.file) continue;
    const h = String(a.file.hash || "");
    if (h && seen.has(h)) continue;
    if (h) seen.add(h), hash ||= h;
    for (const c of a.file.content || []) if (c?.type === "text" && c.text) parts.push(String(c.text));
  }
  return { text: parts.join("\n\n"), hash };
}

async function extractViaOpenRouter(buffer: Buffer, fileName: string): Promise<PdfExtractionResult | null> {
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) return null;
  const model = String(process.env.OPENROUTER_PDF_MODEL || "openrouter/auto").trim();
  const engine = String(process.env.OPENROUTER_PDF_ENGINE || "mistral-ocr").trim();
  const timeoutMs = Math.max(30_000, Number(process.env.OPENROUTER_PDF_TIMEOUT_MS || 180_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dataUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Motor Commission Grid Engine"
  };
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: Number(process.env.OPENROUTER_PDF_MAX_TOKENS || 30000),
        plugins: [{ id: "file-parser", pdf: { engine } }],
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Transcribe this insurance payout-grid PDF exactly, page by page. Do not calculate, infer or summarize. Preserve headings, percentages, state/RTO labels, table rows and GREEN/RED words. Prefix each page with a line exactly like === PAGE 1 ===, === PAGE 2 === and so on. If a value is unreadable, write [UNREADABLE] rather than guessing." },
            { type: "file", file: { filename: fileName, file_data: dataUrl } }
          ]
        }]
      })
    });
    const payload: any = await response.json().catch(() => ({}));
    const annotation = extractFileAnnotationText(payload);
    const completion = typeof payload?.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content : "";
    // Prefer the requested page-marked transcription. If the downstream model failed,
    // OpenRouter may still return parsed file annotations; use those as a deterministic fallback.
    const chosen = /PAGE\s+\d+/i.test(completion) ? completion : (annotation.text || completion);
    if (!response.ok && !chosen.trim()) {
      throw new Error(payload?.error?.message || `OpenRouter HTTP ${response.status}`);
    }
    const pages = splitMarkedPages(chosen);
    if (usefulChars(pages) < 50) throw new Error("OpenRouter returned insufficient PDF text.");
    return {
      pages,
      extractor: `OPENROUTER:${engine}`,
      ocrUsed: engine === "mistral-ocr",
      warnings: response.ok ? [] : [`OpenRouter inference returned HTTP ${response.status}, but parsed file annotations were recovered.`],
      metadata: { model, engine, fileHash: annotation.hash || null }
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function extractPdfText(buffer: Buffer, fileName = "grid.pdf"): Promise<PdfExtractionResult> {
  const warnings: string[] = [];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "motor-grid-pdf-"));
  const input = path.join(dir, path.basename(fileName).replace(/[^A-Za-z0-9_.-]/g, "_") || "grid.pdf");
  await fs.writeFile(input, buffer);
  try {
    let vectorPages: PdfPageText[] = [];
    if (await hasCommand("pdftotext")) {
      try {
        const out = await execFileAsync("pdftotext", ["-layout", input, "-"], { timeout: 120000, maxBuffer: 30 * 1024 * 1024 });
        vectorPages = splitPages(out.stdout || "");
      } catch (e) {
        warnings.push(`pdftotext failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (usefulChars(vectorPages) >= 100) return { pages: vectorPages, extractor: "PDFTOTEXT_LAYOUT", ocrUsed: false, warnings };
    } else {
      warnings.push("Local pdftotext is not installed; trying OCR/OpenRouter fallback.");
    }

    const ocrEnabled = String(process.env.ENABLE_PDF_OCR ?? "true").toLowerCase() !== "false";
    if (ocrEnabled && (await hasCommand("pdftoppm")) && (await hasCommand("tesseract"))) {
      try {
        const prefix = path.join(dir, "page");
        const dpi = String(process.env.PDF_OCR_DPI || "130");
        await execFileAsync("pdftoppm", ["-jpeg", "-r", dpi, input, prefix], { timeout: 240000, maxBuffer: 5 * 1024 * 1024 });
        const images = (await fs.readdir(dir)).filter(x => /^page-\d+\.(?:jpg|jpeg)$/i.test(x)).sort((a,b) => {
          const na = Number(a.match(/(\d+)/)?.[1] || 0); const nb = Number(b.match(/(\d+)/)?.[1] || 0); return na - nb;
        });
        const maxPages = Math.max(1, Number(process.env.PDF_OCR_MAX_PAGES || 50));
        const pages: PdfPageText[] = [];
        for (let i = 0; i < Math.min(images.length, maxPages); i++) {
          const image = path.join(dir, images[i]);
          try {
            const out = await execFileAsync("tesseract", [image, "stdout", "--psm", "6"], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
            pages.push({ page: i + 1, text: out.stdout || "" });
          } catch (e) {
            warnings.push(`OCR failed on page ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
            pages.push({ page: i + 1, text: "" });
          }
        }
        if (images.length > maxPages) warnings.push(`OCR limited to first ${maxPages} pages by PDF_OCR_MAX_PAGES.`);
        if (usefulChars(pages) >= 100) return { pages, extractor: "TESSERACT_OCR", ocrUsed: true, warnings };
        warnings.push("Local OCR returned insufficient text; trying OpenRouter fallback if configured.");
      } catch (e) {
        warnings.push(`Local OCR pipeline failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (ocrEnabled) {
      warnings.push("Local OCR tools are unavailable; trying OpenRouter fallback if configured.");
    }

    try {
      const remote = await extractViaOpenRouter(buffer, fileName);
      if (remote) return { ...remote, warnings: [...warnings, ...remote.warnings] };
    } catch (e) {
      warnings.push(`OpenRouter PDF extraction failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (usefulChars(vectorPages) > 0) {
      warnings.push("PDF extraction is incomplete. Install Poppler/Tesseract or configure OPENROUTER_API_KEY before activating this package.");
      return { pages: vectorPages, extractor: "PDFTOTEXT_PARTIAL", ocrUsed: false, warnings };
    }
    throw new Error("PDF_EXTRACTION_UNAVAILABLE: install Poppler/Tesseract or configure OPENROUTER_API_KEY. The grid was not guessed or activated.");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
