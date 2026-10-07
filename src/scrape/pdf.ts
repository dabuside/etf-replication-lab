import { writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fetchBinary } from '../http.ts';

const require = createRequire(import.meta.url);

type PdfDoc = { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str: string; transform: number[] }> }> }> };

let pdfjs: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
async function getPdfjs() {
  // Resolved lazily so tests that never touch PDFs don't pay the load cost.
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/** Eastmoney mirrors fund filings at a predictable URL keyed on the announcement ID. */
export function reportPdfUrl(announcementId: string): string {
  return `https://pdf.dfcfw.com/pdf/H2_${announcementId}_1.pdf`;
}

export async function downloadReportPdf(announcementId: string): Promise<Uint8Array> {
  return fetchBinary(reportPdfUrl(announcementId));
}

/**
 * Extract text from a fund filing PDF, reconstructing lines from glyph
 * baselines. Report tables are the whole point here, so we keep the vertical
 * grouping rather than emitting a flat character stream.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const lib = await getPdfjs();
  const standardFontDataUrl =
    new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href;

  const doc: PdfDoc = await lib.getDocument({
    data: bytes,
    useSystemFonts: true,
    standardFontDataUrl,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const lines: string[] = [];
    let current = '';
    let lastY: number | null = null;
    for (const item of content.items) {
      const y = item.transform[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (current.trim()) lines.push(current.trim());
        current = '';
      }
      current += item.str;
      lastY = y;
    }
    if (current.trim()) lines.push(current.trim());
    pages.push(`===== PAGE ${p} =====\n${lines.join('\n')}`);
  }
  return pages.join('\n');
}

/** Cached wrapper keyed on announcement ID, so re-runs don't refetch the PDF. */
export async function reportText(announcementId: string): Promise<string> {
  const path = new URL(`../../data/raw/report-${announcementId}.txt`, import.meta.url).pathname;
  try {
    return await readFile(path, 'utf8');
  } catch {
    const text = await extractPdfText(await downloadReportPdf(announcementId));
    await writeFile(path, text, 'utf8');
    return text;
  }
}

export { require };
