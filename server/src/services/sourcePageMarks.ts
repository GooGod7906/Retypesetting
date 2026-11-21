import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { PDFDocumentProxy, RenderParameters } from 'pdfjs-dist/types/src/display/api';
import type { File as ZipEntry } from 'unzipper';
import type { Box, LayoutItem, LayoutPage } from './mineruLayout';

type Canvas = RenderParameters['canvasContext']['canvas'];
type CanvasFactory = {
  create(width: number, height: number): { canvas: Canvas; context: RenderParameters['canvasContext'] };
  destroy(target: { canvas: Canvas }): void;
};
const loadPdf = new Function('return import("pdfjs-dist/legacy/build/pdf.mjs")') as () => Promise<typeof import('pdfjs-dist')>;

export async function openSourcePdf(entry: ZipEntry | string): Promise<PDFDocumentProxy> {
  const size = typeof entry === 'string' ? (await stat(entry)).size : entry.uncompressedSize;
  if (size > 64 * 1024 * 1024) throw new Error('原始 PDF 超出图形恢复的内存限制。');
  const { getDocument } = await loadPdf();
  const fonts = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
  const data = typeof entry === 'string' ? await readFile(entry) : await entry.buffer();
  const task = getDocument({ data: Uint8Array.from(data), isEvalSupported: false, disableFontFace: true, standardFontDataUrl: fonts });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

export async function renderOriginalPage(pdf: PDFDocumentProxy, number: number) {
  const source = await pdf.getPage(number);
  const initial = source.getViewport({ scale: 1 });
  const viewport = source.getViewport({ scale: 2200 / Math.max(initial.width, initial.height) });
  const factory = pdf.canvasFactory as CanvasFactory;
  const raster = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  try {
    await source.render({ canvasContext: raster.context, viewport }).promise;
    const canvas = raster.canvas as unknown as { toBuffer(type: 'image/jpeg', quality: number): Buffer };
    return { image: canvas.toBuffer('image/jpeg', 88), size: [initial.width, initial.height] as [number, number] };
  } finally {
    factory.destroy(raster);
    source.cleanup();
  }
}

export interface AnswerRule { box: Box; after: string }

export function answerRules(page: LayoutPage, pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): AnswerRule[] {
  const sx = width / page.size[0];
  const sy = height / page.size[1];
  const lines = new Map<number, LayoutItem[]>();
  const exclusions: Box[] = [];
  for (const item of page.items) {
    if (item.kind === 'image' || item.kind === 'table') { exclusions.push(item.box); continue; }
    if (['header', 'footer', 'page_number'].includes(item.role) || item.role.includes('caption')) continue;
    const line = lines.get(item.line) ?? [];
    line.push(item);
    lines.set(item.line, line);
  }
  const results: AnswerRule[] = [];
  const dark = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    return pixels[index] + pixels[index + 1] + pixels[index + 2] < 615;
  };
  for (const line of lines.values()) {
    line.sort((a, b) => a.box[0] - b.box[0]);
    const text = line.filter(item => item.kind === 'text' && !/^[_＿]+$/.test(item.text ?? ''));
    const reference = text.length ? text : line;
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const textHeight = median(reference.map(({ box }) => box[3] - box[1]));
    const baseline = median(reference.map(({ box }) => box[3]));
    const firstRow = Math.max(1, Math.floor((baseline - textHeight * 0.4) * sy));
    const lastRow = Math.min(height - 2, Math.ceil((baseline + textHeight * 0.65) * sy));
    let previous = line[0];
    for (let index = 1; index <= line.length; index++) {
      const next = line[index];
      const after = previous;
      const nextLeft = next?.box[0] ?? Math.min(page.size[0], after.box[2] + textHeight * 15);
      const xStart = Math.max(0, Math.ceil((after.box[2] + textHeight * 0.035) * sx));
      const xEnd = Math.min(width, Math.floor((nextLeft - textHeight * 0.06) * sx));
      if (next && next.box[2] >= after.box[2]) previous = next;
      if (/^[_＿]+$|[_＿]{2,}$/.test(after.text ?? '') || /^[_＿]+$|^[_＿]{2,}/.test(next?.text ?? '')) continue;
      // Require a longer stroke without a following span, where a neighboring line can enter the search region.
      const minimum = Math.max(8, Math.round(textHeight * sx * (next ? 0.72 : 1.45)));
      if (xEnd - xStart < minimum) continue;
      for (let y = firstRow; y <= lastRow; y++) {
        let start = xStart;
        let lastInk = xStart - 1;
        let ink = 0;
        for (let x = xStart; x <= xEnd; x++) {
          if (x < xEnd && dark(x, y)) {
            if (!ink) start = x;
            ink++;
            lastInk = x;
            continue;
          }
          if (x < xEnd && x - lastInk <= 2 && ink) continue;
          const length = lastInk - start + 1;
          if (length >= minimum && ink >= length * 0.94) {
            // A rule is thin. Reject text or another thick shape that also crosses the candidate row.
            const offset = Math.max(2, Math.round(textHeight * sy * 0.17));
            const above = y - offset;
            const below = y + offset;
            let thick = 0;
            for (let check = start; check <= lastInk; check++) {
              if ((above >= 0 && dark(check, above)) || (below < height && dark(check, below))) thick++;
            }
            const box: Box = [start / sx, y / sy, (lastInk + 1) / sx, (y + 1) / sy];
            const overlaps = (other: Box, slack: number) => Math.min(other[2], box[2]) > Math.max(other[0], box[0])
              && box[1] >= other[1] - slack && box[1] <= other[3] + slack;
            if (thick < length * 0.28 && !exclusions.some(other => overlaps(other, 0))) {
              const existing = results.find(other => overlaps(other.box, textHeight * 0.28));
              if (!existing) results.push({ box, after: after.id });
              else if (box[2] - box[0] > existing.box[2] - existing.box[0]) Object.assign(existing, { box, after: after.id });
            }
          }
          ink = 0;
        }
      }
    }
  }
  return results.sort((a, b) => a.box[0] - b.box[0]);
}

export async function recoverSourceMarks(pdf: PDFDocumentProxy, page: LayoutPage, includeTables = false, equationCrops?: ReadonlySet<string>) {
  const source = await pdf.getPage(page.number);
  const initial = source.getViewport({ scale: 1 });
  const viewport = source.getViewport({ scale: 2200 / Math.max(initial.width, initial.height) });
  const factory = pdf.canvasFactory as CanvasFactory;
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const raster = factory.create(width, height);
  try {
    await source.render({ canvasContext: raster.context, viewport }).promise;
    const pixels = raster.context.getImageData(0, 0, width, height).data;
    const rules = page.approximateLines ? [] : answerRules(page, pixels, width, height);
    const crops = new Map<string, Buffer>();
    const tableCrops = new Map<string, { png: Buffer; box: Box }>();
    for (const item of page.items.filter(item => item.sourceCrop || equationCrops?.has(item.id) || (includeTables && item.kind === 'table'))) {
      const [x, y, right, bottom] = item.box;
      const pad = item.kind === 'table' ? 4 : 0;
      const sx = width / page.size[0];
      const sy = height / page.size[1];
      const x0 = Math.max(0, Math.floor(x * sx) - pad);
      const y0 = Math.max(0, Math.floor(y * sy) - pad);
      const w = Math.min(width, Math.ceil(right * sx) + pad) - x0;
      const h = Math.min(height, Math.ceil(bottom * sy) + pad) - y0;
      if (w <= 0 || h <= 0) continue;
      const crop = factory.create(w, h);
      try {
        crop.context.putImageData(raster.context.getImageData(x0, y0, w, h), 0, 0);
        const png = (crop.canvas as unknown as { toBuffer(type: 'image/png'): Buffer }).toBuffer('image/png');
        if (item.kind === 'table') tableCrops.set(item.id, { png, box: [x0 / sx, y0 / sy, (x0 + w) / sx, (y0 + h) / sy] });
        else crops.set(item.id, png);
      } finally {
        factory.destroy(crop);
      }
    }
    return { rules, crops, tableCrops };
  } finally {
    factory.destroy(raster);
    source.cleanup();
  }
}
