import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { File as ZipEntry } from 'unzipper';
import sharp from 'sharp';
import { DomUtils, parseDocument } from 'htmlparser2';
import { bufferPart, streamPart, writeOfficeZip } from './officeZip';
import { applyLayoutRoles, defaultQuestionLayout, detectFooter, detectFooterPattern, flowHeadingStyles, type LayoutAlignments, type LayoutItem, type LayoutRoles, type LayoutSource, missingPositionMessage, openLayoutSource, pageTextRows, type QuestionLayout, questionTextFrames } from './mineruLayout';
import { type ElementKind, type LayoutTemplate, formatMarker, originalTemplate, styleDefaults, styleFor, type TextStyle, usesBodyFontSize } from './layoutTemplate';
import { renderFormulaImage } from './formulaImage';
import { type AnswerRule, openSourcePdf, recoverSourceMarks, renderOriginalPage } from './sourcePageMarks';
import {
  documentEnd, documentStart, editableFormula, emuPerMm, fitAdaptiveFormula, fitPositionedTextStyle, flowAnswerRule, flowBodyText, flowColumns, flowParagraph, flowText, inferredTextSize, inlinePageImage, inlinePositionedFormula,
  officeRelationship, pageGeometry, pageParagraph, positionedAdaptiveRow, positionedFormula, positionedGap, positionedImage, positionedQuestion, positionedQuestionLine,
  positionedRule, positionedTable, positionedText, relationshipsNs, sectionBreak, tablePlainText, wordFooter, wordStyles, xmlHeader,
} from './wordLayoutXml';

export type LayoutCorrections = Record<string, string>;

export interface LayoutReport {
  pages: number;
  texts: number;
  pictures: number;
  formulas: number;
  formulaImages: number;
  tables: number;
  warnings: { page: number; message: string }[];
}

interface Media {
  entry?: ZipEntry;
  generated?: { filename: string; size: number; crc: number };
  filename: string;
  relationship: string;
}

const mime = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff' } as const;
type Extension = keyof typeof mime;

function extensionOf(asset: string): Extension | undefined {
  const suffix = path.extname(asset).toLowerCase().slice(1);
  const normalized = suffix === 'jpeg' ? 'jpg' : suffix === 'tiff' ? 'tif' : suffix;
  return Object.prototype.hasOwnProperty.call(mime, normalized) ? normalized as Extension : undefined;
}

async function packageDocument(output: string, mainXml: string, media: Map<string, Media>, template: LayoutTemplate, sourceName: string) {
  const buffer = (xml: string, name: string) => bufferPart(name, Buffer.from(xml, 'utf8'));
  const relationship = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${officeRelationship}${type}" Target="${target}"/>`;
  const rels = (body: string) => `${xmlHeader}<Relationships xmlns="${relationshipsNs}">${body}</Relationships>`;
  const types = Object.entries(mime).map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join('');
  const imageRelationships = [...media.values()].map(image => relationship(image.relationship, 'image', `media/${image.filename}`)).join('');
  const footerType = template.footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '';
  const footerRelationship = template.footer ? relationship('rIdFooter', 'footer', 'footer1.xml') : '';
  await writeOfficeZip(output, [
    buffer(`${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${footerType}</Types>`, '[Content_Types].xml'),
    buffer(rels(relationship('rId1', 'officeDocument', 'word/document.xml')), '_rels/.rels'),
    buffer(wordStyles(template.font), 'word/styles.xml'),
    buffer(rels(relationship('rIdStyles', 'styles', 'styles.xml') + footerRelationship + imageRelationships), 'word/_rels/document.xml.rels'),
    ...(template.footer ? [buffer(wordFooter(template.footer, sourceName, styleFor(template, 'footer')), 'word/footer1.xml')] : []),
    await streamPart('word/document.xml', () => createReadStream(mainXml)),
    ...[...media.values()].map(image => {
      const entry = image.entry;
      const generated = image.generated;
      return { name: `word/media/${image.filename}`, size: entry?.uncompressedSize ?? generated!.size,
        crc: entry?.crc32 ?? generated!.crc, stream: () => entry ? entry.stream() : createReadStream(generated!.filename) };
    }),
  ]);
}

function elementStyle(item: LayoutItem): ElementKind {
  if (item.kind === 'formula' || item.kind === 'table') return item.kind;
  if (item.roleOverride) return item.roleOverride;
  if (item.role === 'instructions' || item.role === 'option' || item.role === 'stem' || item.role === 'header') return item.role;
  if (item.role === 'footer' || item.role === 'page_number') return 'footer';
  if (item.role.includes('caption')) return 'caption';
  if (item.level) return `heading${Math.max(1, Math.min(9, item.level))}` as ElementKind;
  return 'body';
}

function availableSpace(index: number, boxes: LayoutItem['box'][], page: LayoutItem['box']): LayoutItem['box'] {
  const [x, y, width, height] = boxes[index];
  let right = Math.max(x + width, Math.min(page[0] + page[2], x + width + height * 0.55));
  let bottom = Math.max(y + height, Math.min(page[1] + page[3], y + height * 1.55));
  for (const [left, top, otherWidth, otherHeight] of boxes) {
    const sameLine = top < y + height && top + otherHeight > y;
    if (sameLine && left >= x + width) right = Math.min(right, left);
    if (top >= y + height && left < right && left + otherWidth > x) bottom = Math.min(bottom, top);
  }
  return [x, y, Math.floor(right - x), Math.floor(bottom - y)];
}

const optionStart = /^[A-GＡ-Ｇ]\s*[.．、)）]/u;
const boxedDiagram = /(?:\\boxed\b.*?){2}/s;
const tabRun = '<w:r><w:tab/></w:r>';
const sameVisualRow = (a: LayoutItem['box'], b: LayoutItem['box']) =>
  Math.min(a[3], b[3]) - Math.max(a[1], b[1]) >= Math.min(a[3] - a[1], b[3] - b[1]) * 0.6;

function sourceContent(items: LayoutItem[], pageWidth: number) {
  const body = items.filter(item => item.kind === 'text' && !item.level && ['body', 'text', 'stem', 'option', 'list'].includes(item.role));
  const sample = body.length ? body : items.filter(item => !['header', 'footer', 'page_number'].includes(item.role));
  if (!sample.length) return { left: 0, width: pageWidth };
  const left = Math.max(0, Math.min(...sample.map(item => item.box[0])));
  const right = Math.min(pageWidth, Math.max(...sample.map(item => item.box[2])));
  return right - left >= pageWidth * 0.4 ? { left, width: right - left } : { left: 0, width: pageWidth };
}

export async function exportFixedDocument(input: string, destination: string, options: {
  page?: number;
  template?: LayoutTemplate;
  corrections?: LayoutCorrections;
  roles?: LayoutRoles;
  alignments?: LayoutAlignments;
  sourceName?: string;
  sourcePdf?: string;
  pairedSource?: Pick<LayoutSource, 'pairedArchive' | 'mixedMode'>;
  questionLayout?: QuestionLayout;
  signal?: AbortSignal;
} = {}): Promise<LayoutReport> {
  options.signal?.throwIfAborted();
  if (options.page !== undefined && (!Number.isInteger(options.page) || options.page < 1)) throw new Error('请选择有效的原页码。');
  const template = options.template ?? originalTemplate;
  const flow = template.mode === 'flow';
  const questionLayout = options.questionLayout ?? (options.pairedSource?.mixedMode === 'fixed' ? defaultQuestionLayout : undefined);
  const portable = !flow && questionLayout === 'page-images';
  const pageParagraphs = !flow && questionLayout === 'page-paragraphs';
  const adaptiveRows = !flow && questionLayout === 'adaptive-rows';
  const archive = portable && options.sourcePdf ? undefined : await openLayoutSource({ ...options.pairedSource, archive: input }, { splitInlineProse: flow });
  const origin = options.sourcePdf ?? (archive && [...archive.entries.values()].find(entry => entry.path.endsWith('_origin.pdf')));
  const formulaMode = template.formulaMode ?? 'editable';
  const media = new Map<string, Media>();
  const report: LayoutReport = { pages: 0, texts: 0, pictures: 0, formulas: 0, formulaImages: 0, tables: 0, warnings: [] };
  const unique = `${destination}.${randomUUID()}`;
  const temporaryXml = `${unique}.xml`;
  const temporaryDoc = `${unique}.part`;
  const handle = await open(temporaryXml, 'wx');
  const generatedFiles: string[] = [];
  let section: string | undefined;
  let detectedFooter: string | undefined;
  let id = 0;
  const sourcePdf = origin ? await openSourcePdf(origin).catch(() => undefined) : undefined;

  function picture(item: LayoutItem, box: LayoutItem['box'], elementId: number, inline = flow): string | undefined {
    const asset = item.asset;
    if (!asset) return;
    let image = media.get(asset);
    if (!image) {
      const entry = archive?.entries.get(`images/${asset}`);
      const extension = extensionOf(asset);
      if (!entry || !extension) return;
      const index = media.size + 1;
      image = { entry, filename: `picture-${index}.${extension}`, relationship: `rIdImage${index}` };
      media.set(asset, image);
    }
    report.pictures++;
    return positionedImage(elementId, box, image.relationship, inline);
  }

  async function recoveredImage(bytes: Buffer, box: LayoutItem['box'], elementId: number, inline: boolean, formula = false, extension = 'png'): Promise<string> {
    const filename = `${unique}.crop-${elementId}.${extension}`;
    generatedFiles.push(filename);
    await writeFile(filename, bytes, { flag: 'wx' });
    const part = bufferPart('', bytes);
    const relationship = `rIdImage${media.size + 1}`;
    media.set(`crop:${elementId}`, { filename: `crop-${elementId}.${extension}`, relationship, generated: { filename, size: part.size, crc: part.crc } });
    if (formula) report.formulaImages++;
    else report.pictures++;
    return positionedImage(elementId, box, relationship, inline);
  }
  const formulaImage = (png: Buffer, box: LayoutItem['box'], elementId: number, inline: boolean) => recoveredImage(png, box, elementId, inline, true);
  const imageRatios = new Map<string, number>();
  async function measureImage(asset: string) {
    if (!imageRatios.has(asset)) {
      const entry = archive?.entries.get(`images/${asset}`);
      let ratio = 0;
      if (entry && entry.uncompressedSize <= 12 * 1024 ** 2) {
        try {
          const { width, height } = await sharp(await entry.buffer()).metadata();
          if (width && height) ratio = height / width;
        } catch { /* Use the source layout box when image metadata is unavailable. */ }
      }
      imageRatios.set(asset, ratio);
    }
    return imageRatios.get(asset)!;
  }

  try {
    await handle.writeFile(documentStart);
    if (portable) {
      if (!sourcePdf) throw new Error('无法读取原 PDF，不能生成兼容原位版。');
      for (let number = 1; number <= sourcePdf.numPages; number++) {
        options.signal?.throwIfAborted();
        if (options.page !== undefined && number !== options.page) continue;
        const { image, size } = await renderOriginalPage(sourcePdf, number);
        const pointsToMm = 25.4 / 72;
        const geometry = pageGeometry(size, { ...template, mode: 'flow', footer: undefined,
          widthMm: size[0] * pointsToMm, heightMm: size[1] * pointsToMm,
          margins: { top: 1, right: 1, bottom: 3, left: 1 } });
        const sameSize = section === geometry.section;
        if (section && !sameSize) await handle.writeFile(sectionBreak(section));
        section = geometry.section;
        const box = geometry.box([0, 0, ...size]);
        await handle.writeFile(inlinePageImage(await recoveredImage(image, box, ++id, true, false, 'jpg'), sameSize));
        report.pages++;
      }
    } else for await (const page of archive!.pages()) {
      options.signal?.throwIfAborted();
      const footer = template.footer === '{auto}' ? detectFooter(page) : undefined;
      detectedFooter ??= footer?.format;
      if (options.page !== undefined && page.number !== options.page) continue;
      if (options.roles) applyLayoutRoles(page, options.roles);
      if (page.approximateLines && !flow) throw new Error(missingPositionMessage);
      const geometry = pageGeometry(page.size, template);
      const explicitBreak = !flow && !pageParagraphs && section === geometry.section;
      if (section && !flow && !explicitBreak) await handle.writeFile(sectionBreak(section));
      if (!section || !flow) section = geometry.section;
      const warnings = new Set<string>();
      if (page.mixed?.unmatchedImages) warnings.add(`${page.mixed.unmatchedImages} 张图未能匹配 Pipeline，保留 VLM 裁片与比例，请对照原卷。`);
      const boxes = page.items.map(item => geometry.box(item.box));
      const pageBox = geometry.box([0, 0, ...page.size]);
      const questionBlocks = pageParagraphs || adaptiveRows ? [pageTextRows({ ...page, items: page.items.map(item =>
        item.kind === 'table' && item.asset && !archive!.entries.has(`images/${item.asset}`) ? { ...item, asset: undefined } : item,
      ) })] : !flow && (questionLayout === 'merged-options' || questionLayout === 'separate-options')
        ? questionTextFrames(page, questionLayout) : [];
      const adaptiveBounds = new Map<string, { height: number; standalone: boolean; textSizePt?: number }>();
      if (adaptiveRows) {
        const itemsById = new Map(page.items.map((item, index) => [item.id, { item, box: boxes[index] }]));
        const rows = questionBlocks[0].lines.map(ids => {
          const bounds = ids.map(id => itemsById.get(id)!.box);
          return { ids, top: Math.min(...bounds.map(box => box[1])),
            bottom: Math.max(...bounds.map(box => box[1] + box[3])) };
        });
        const nominalLine = (styleFor(template, 'body').fontSizePt ?? styleDefaults.fixedBodyFontSizePt) * 1.22 * 12_700;
        for (const [index, row] of rows.entries()) {
          const nextTop = rows[index + 1]?.top ?? pageBox[1] + pageBox[3];
          const height = Math.max(635, Math.min(Math.max((row.bottom - row.top) * 1.3, nominalLine), nextTop - row.top - 6350));
          const textSizes = row.ids.flatMap(key => {
            const { item, box } = itemsById.get(key)!;
            if (item.kind !== 'text') return [];
            const role = elementStyle(item);
            const text = formatMarker(options.corrections?.[key] ?? item.text ?? '', role, template.markerWidth);
            if ([...text].length < 4) return [];
            const style = styleFor(template, role);
            style.fontSizePt ??= styleDefaults.fixedBodyFontSizePt;
            return [fitPositionedTextStyle([box[0], box[1], box[2], height], text, style).fontSizePt!];
          }).sort((a, b) => a - b);
          const bounds = { height, standalone: row.ids.length === 1, textSizePt: textSizes[Math.floor(textSizes.length / 2)] };
          for (const key of row.ids) adaptiveBounds.set(key, bounds);
        }
      }
      const equationCrops = new Set<string>();
      if (sourcePdf && adaptiveRows && formulaMode === 'editable') {
        for (const item of page.items) if (item.kind === 'formula' && adaptiveBounds.has(item.id)
          && options.corrections?.[item.id] === undefined) equationCrops.add(item.id);
      }
      const marks = sourcePdf ? await recoverSourceMarks(sourcePdf, page, true, equationCrops).catch(() => undefined) : undefined;
      const rulesByItem = new Map<string, AnswerRule[]>();
      for (const rule of marks?.rules ?? []) {
        const rules = rulesByItem.get(rule.after) ?? [];
        rules.push(rule);
        rulesByItem.set(rule.after, rules);
      }
      if (origin && !marks) warnings.add('无法读取原 PDF 的页面图形，可能漏掉 OCR 未识别的答题横线。');
      if (marks?.crops.size && !adaptiveRows && formulaMode === 'editable') warnings.add('个别公式识别不完整，已保留原卷局部图像。');
      const content: string[] = [];
      const source = sourceContent(page.items, page.size[0]);
      const flowScale = geometry.contentWidth / source.width;
      const relativeX = (x: number) => Math.max(0, (x - source.left) * flowScale);
      const flowBox = ([left, top, right, bottom]: LayoutItem['box']): LayoutItem['box'] =>
        [0, 0, Math.min(geometry.contentWidth, (right - left) * flowScale), (bottom - top) * flowScale];
      const figureBox = (asset: string | undefined, bounds: LayoutItem['box'], maxWidth = bounds[2], maxHeight = bounds[3]): LayoutItem['box'] => {
        const ratio = (asset && imageRatios.get(asset)) || bounds[3] / bounds[2];
        const width = Math.min(maxWidth, maxHeight / ratio);
        return [bounds[0], bounds[1], width, width * ratio];
      };
      const flowHeadings = flow ? flowHeadingStyles(page, options.corrections) : undefined;
      const placedFigures = new Set<string>();
      const fixedRules: LayoutItem['box'][] = [];
      const sideFigure = new Map(page.items.flatMap((item, index) => {
        if (!flow || item.kind !== 'text' || item.level || !usesBodyFontSize(elementStyle(item)) || !item.text) return [];
        if (page.items.some(other => other !== item && other.group === item.group && (other.kind === 'text' || other.kind === 'formula'))) return [];
        const figure = page.items[index + 1];
        if (figure?.kind !== 'image' || !figure.asset || !sameVisualRow(item.box, figure.box)) return [];
        if (item.box[2] > figure.box[0] && figure.box[2] > item.box[0]) return [];
        if (page.items.some(other => other !== figure && other.kind === 'image' && sameVisualRow(other.box, figure.box))) return [];
        return [[item.id, figure] as const];
      }));
      const groupedItems = new Set(questionBlocks.flatMap(block => block.lines.flat()));
      const headingSizes = new Map<number, number>();
      if (!flow) for (const [index, item] of page.items.entries()) {
        const role = elementStyle(item);
        const value = options.corrections?.[item.id] ?? item.text;
        if (item.kind !== 'text' || !role.startsWith('heading') || !value) continue;
        const box = boxes[index];
        const height = adaptiveBounds.get(item.id)?.height ?? box[3] * 1.3;
        const fitted = fitPositionedTextStyle([box[0], box[1], box[2], height], value, styleFor(template, role));
        headingSizes.set(item.group, Math.min(headingSizes.get(item.group) ?? Infinity, fitted.fontSizePt!));
      }
      const questionRuns = new Map<string, { id: string; xml: string; box: LayoutItem['box']; typography: TextStyle; level?: number; formula: boolean }>();
      let pageRows = '';
      const bodyHeights = page.items.filter(item => item.kind === 'text' && !item.level && (item.text?.length ?? 0) >= 5)
        .map(item => geometry.box(item.box)[3]).sort((a, b) => a - b);
      const medianHeight = bodyHeights[Math.floor(bodyHeights.length / 2)];
      const inferredCap = medianHeight ? Math.max(8, Math.ceil(2 * medianHeight * 1.35 / 12700)) : undefined;
      const lineSizes = new Map<number, number>();
      const pageSizes: number[] = [];
      if (!flow) for (const [index, item] of page.items.entries()) {
        if (item.kind !== 'text' || item.level || !/\p{Script=Han}{5}/u.test(item.text ?? '')) continue;
        const size = inferredTextSize(boxes[index], item.text!, inferredCap);
        pageSizes.push(size);
        lineSizes.set(item.line, Math.max(lineSizes.get(item.line) ?? 0, size));
      }
      pageSizes.sort((a, b) => a - b);
      const bodySize = pageSizes[Math.floor(pageSizes.length / 2)];
      const bodyStyle = styleFor(template, 'body');
      let paragraph: { item: LayoutItem; text: string; style: TextStyle; level?: number; runs: string[]; tabs: number[] } | undefined;
      const flush = () => {
        if (paragraph) content.push(flowParagraph(paragraph.runs.join(''), paragraph.style, paragraph.level, paragraph.tabs));
        paragraph = undefined;
      };
      const writeInline = (item: LayoutItem, text: string, xml: string, role: ElementKind, style: TextStyle) => {
        if (!flow) return void content.push(xml);
        const startsQuestion = item.kind === 'text' && /^[0-9０-９]{1,3}[.．、]\s*[\p{Script=Han}A-Za-z（(]/u.test(text);
        const startsOption = item.kind === 'text' && role === 'option' && optionStart.test(text);
        const sameOptionRow = startsOption && paragraph && elementStyle(paragraph.item) === 'option' && sameVisualRow(paragraph.item.box, item.box)
          && item.box[0] >= paragraph.item.box[2] && relativeX(item.box[0]) < geometry.contentWidth;
        if (!paragraph || (!sameOptionRow && ((paragraph.item.group !== item.group && item.kind !== 'formula') || startsOption))
          || (paragraph.item.line !== item.line && startsQuestion)) {
          flush();
          const level = role.startsWith('heading') ? Number(role.slice(7)) : undefined;
          paragraph = { item, text: '', style: role === 'formula' ? bodyStyle : style, level, runs: [], tabs: [] };
        }
        if (sameOptionRow) {
          paragraph.tabs.push(relativeX(item.box[0]));
          paragraph.runs.push(tabRun);
        } else if (item.kind === 'text' && paragraph.item.kind === 'text' && /[A-Za-z0-9]$/.test(paragraph.text)
          && /^[A-Za-z0-9]/.test(text) && (paragraph.item.line !== item.line || item.box[0] > paragraph.item.box[2] + 2)) {
          paragraph.runs.push(flowText(' ', style));
        }
        paragraph.item = item;
        paragraph.text = text;
        paragraph.runs.push(xml);
        for (const rule of rulesByItem.get(item.id) ?? []) {
          paragraph.runs.push(flowAnswerRule(flowBox(rule.box)[2], paragraph.style));
          paragraph.text = '';
        }
      };
      for (const [index, item] of page.items.entries()) {
        if (placedFigures.has(item.id)) continue;
        if (footer?.ids.includes(item.id)) continue;
        if (!template.showPageMarks && ['header', 'footer', 'page_number'].includes(item.role)) continue;
        if (template.footer && ['footer', 'page_number'].includes(item.role)) continue;
        const originalText = options.corrections?.[item.id] ?? item.text ?? '';
        const box = boxes[index];
        const space = flow ? undefined : availableSpace(index, boxes, pageBox);
        const elementId = ++id;
        const heading = flowHeadings?.get(item.id);
        const role = heading?.role ?? elementStyle(item);
        const text = item.kind === 'text' ? formatMarker(originalText, role, template.markerWidth) : originalText;
        const typography = styleFor(template, role);
        if (!flow && item.kind === 'text' && role.startsWith('heading')) typography.fontSizePt = headingSizes.get(item.group) ?? typography.fontSizePt;
        if (heading?.mainTitle) typography.alignment ??= 'center';
        if (flow && options.alignments?.[item.id]) typography.alignment = options.alignments[item.id]!;
        if (flow && typography.alignment !== 'center' && (role === 'stem' || role === 'option' || role === 'body') && item.kind === 'text') {
          const indent = Math.min(geometry.contentWidth * 0.22, relativeX(item.box[0])) / emuPerMm;
          if (role === 'option' || role === 'stem') typography.leftIndentMm ??= indent;
          else if (!paragraph || paragraph.item.group !== item.group) typography.firstLineIndentMm ??= indent;
        }
        const alongside = sideFigure.get(item.id);
        if (alongside?.asset && !placedFigures.has(alongside.id)) {
          await measureImage(alongside.asset);
          const left = Math.min(item.box[0], alongside.box[0]);
          const span = Math.max(item.box[2], alongside.box[2]) - left;
          const localScale = Math.min(flowScale, geometry.contentWidth / span);
          const bounds = flowBox(alongside.box);
          const imageWidth = (alongside.box[2] - alongside.box[0]) * localScale;
          const graphic = picture(alongside, figureBox(alongside.asset, bounds, imageWidth, geometry.contentHeight), ++id);
          if (graphic) {
            flush();
            const textWidth = (item.box[2] - item.box[0]) * localScale;
            const gap = Math.max(0, span * localScale - imageWidth - textWidth);
            const style = { ...typography, leftIndentMm: 0, rightIndentMm: 0, firstLineIndentMm: 0 };
            const rules = (rulesByItem.get(item.id) ?? []).map(rule => flowAnswerRule(flowBox(rule.box)[2], style)).join('');
            const prose = { width: textWidth, content: flowParagraph(flowBodyText(text, style) + rules, style) };
            const image = { width: imageWidth, content: flowParagraph(graphic, style) };
            const columns = item.box[0] < alongside.box[0] ? [prose, image] : [image, prose];
            if (gap >= 635) columns.splice(1, 0, { width: gap, content: '' });
            const offset = Math.min(relativeX(left), Math.max(0, geometry.contentWidth - span * localScale));
            content.push(flowColumns(columns, offset));
            placedFigures.add(alongside.id);
            report.texts++;
            continue;
          }
        }
        const grouped = groupedItems.has(item.id);
        const write = (value: string, xml: string, runStyle = typography) => {
          if (grouped) questionRuns.set(item.id, { id: item.id, xml, box, typography: runStyle, level: item.level, formula: item.kind === 'formula' });
          else writeInline(item, value, xml, role, runStyle);
        };
        const rowBounds = adaptiveBounds.get(item.id);
        const equationBox: LayoutItem['box'] = rowBounds ? [box[0], box[1], box[2], Math.min(box[3], rowBounds.height)] : box;
        if (item.kind === 'image' && item.asset) {
          await measureImage(item.asset);
          if (flow) {
            const row = [item, ...page.items.slice(index + 1).filter(other => other.kind === 'image' && other.asset
              && !placedFigures.has(other.id) && sameVisualRow(item.box, other.box)
              && (other.box[0] >= item.box[2] || other.box[2] <= item.box[0]))].sort((a, b) => a.box[0] - b.box[0]);
            const left = row[0].box[0];
            const right = Math.max(...row.map(figure => figure.box[2]));
            const scale = Math.min(flowScale, geometry.contentWidth / (right - left));
            const originX = Math.min(relativeX(left), Math.max(0, geometry.contentWidth - (right - left) * scale));
            const runs: string[] = [];
            const tabs: number[] = [];
            for (const figure of row) {
              await measureImage(figure.asset!);
              const width = (figure.box[2] - figure.box[0]) * scale;
              const height = (figure.box[3] - figure.box[1]) * scale;
              const graphic = picture(figure, figureBox(figure.asset, [0, 0, width, height], width, geometry.contentHeight), figure === item ? elementId : ++id);
              if (!graphic) { warnings.add(`原包缺少可用资源，无法重建元素 ${figure.id}。`); continue; }
              if (runs.length) {
                tabs.push(originX + (figure.box[0] - left) * scale);
                runs.push(tabRun);
              }
              runs.push(graphic);
              placedFigures.add(figure.id);
            }
            if (runs.length) {
              flush();
              content.push(flowParagraph(runs.join(''), { ...typography, leftIndentMm: originX / emuPerMm, firstLineIndentMm: 0 }, undefined, tabs));
              const captions: { item: LayoutItem; x: number }[] = [];
              const rowBottom = Math.max(...row.map(figure => figure.box[3]));
              for (const figure of row) {
                if (!placedFigures.has(figure.id)) continue;
                const caption = page.items.slice(index + 1).find(part => part.kind === 'text' && part.role.includes('caption')
                  && !placedFigures.has(part.id) && part.box[1] >= rowBottom - 2
                  && part.box[1] - rowBottom < (part.box[3] - part.box[1]) * 2.5
                  && part.box[0] < figure.box[2] && part.box[2] > figure.box[0]);
                if (caption) {
                  const captionX = Math.max(figure.box[0], Math.min(caption.box[0], figure.box[2]));
                  captions.push({ item: caption, x: originX + (captionX - left) * scale });
                  placedFigures.add(caption.id);
                }
              }
              if (captions.length) {
                const style = styleFor(template, 'caption');
                content.push(flowParagraph(captions.map(({ item: caption }) => flowText(options.corrections?.[caption.id] ?? caption.text ?? '', style)).join(tabRun),
                  { ...style, alignment: 'left', leftIndentMm: captions[0].x / emuPerMm, firstLineIndentMm: 0 }, undefined, captions.slice(1).map(caption => caption.x)));
                report.texts += captions.length;
              }
              continue;
            }
          } else {
            const graphic = picture(item, figureBox(item.asset, box), elementId, false);
            if (graphic) { content.push(graphic); continue; }
          }
        }
        const tableCrop = item.kind === 'table' ? marks?.tableCrops.get(item.id) : undefined;
        if (!flow && tableCrop) {
          content.push(await recoveredImage(tableCrop.png, geometry.box(tableCrop.box), elementId, false));
          continue;
        }
        if (item.kind === 'formula' && item.sourceCrop && !adaptiveRows && formulaMode !== 'latex' && options.corrections?.[item.id] === undefined) {
          const crop = marks?.crops.get(item.id);
          if (crop) {
            write(text, await formulaImage(crop, box, elementId, flow || grouped));
          } else if (text) {
            const readable = text.replace(/^(?:\{\s*\}\s*)?[_^]\s*\{([^{}]*)\}/, '$1').replace(/\s+/g, '');
            write(readable, grouped ? flowText(readable, { ...typography, fontSizePt: typography.fontSizePt ?? inferredTextSize(box, readable, inferredCap) / 2 })
              : flow ? flowText(readable, bodyStyle) : positionedText(elementId, box, readable, typography, undefined, inferredCap, space));
            warnings.add('缺少底符的公式已保留为文本，请对照原卷。');
          }
          continue;
        }
        if (item.kind === 'formula' && formulaMode === 'image' && text) {
          try {
            const { png, box: fitted } = renderFormulaImage(text, equationBox, typography);
            write(text, await formulaImage(png, fitted, elementId, flow || grouped));
            continue;
          } catch {
            warnings.add('有公式图片无法生成，已尝试使用原图或可编辑公式。');
          }
        }
        if (item.kind === 'formula' && formulaMode === 'image' && item.asset) {
          const graphic = picture(item, equationBox, elementId, flow || grouped);
          if (graphic) { write(text, graphic); continue; }
        }
        if (item.kind === 'formula' && text && formulaMode !== 'latex') {
          try {
            if (rowBounds) {
              const requested = typography.fontSizePt ?? styleDefaults.fixedBodyFontSizePt;
              const lineSize = rowBounds.textSizePt ?? requested;
              const fitted = fitAdaptiveFormula(equationBox, text, { ...typography, fontSizePt: Math.min(requested, lineSize) });
              const crop = options.corrections?.[item.id] === undefined ? marks?.crops.get(item.id) : undefined;
              // Stacked OMML is rendered differently by Word-compatible viewers even at the same run size.
              const stacked = /<m:(?:f|eqArr|m)>/.test(fitted.formula);
              const cramped = !fitted.measured || fitted.size / 2 < requested * 0.8;
              // Some viewers render native math at their base font size despite the explicit OMML size.
              const viewerMayOversize = !rowBounds.standalone && fitted.size / 2 < styleDefaults.fixedBodyFontSizePt;
              if (crop && (item.sourceCrop || boxedDiagram.test(text) || (stacked && (rowBounds.standalone || cramped))
                || (rowBounds.standalone && cramped) || viewerMayOversize)) {
                const maxHeight = viewerMayOversize ? Math.min(equationBox[3], lineSize * 1.4 * 12_700) : equationBox[3];
                const bounds = figureBox(undefined, box, box[2], maxHeight);
                bounds[1] += Math.round((equationBox[3] - bounds[3]) / 2);
                content.push(await formulaImage(crop, bounds, elementId, false));
                if (!rowBounds.standalone) write(text, positionedGap(box[2]));
                warnings.add('个别公式在原位空间内难以清晰排版，已保留原卷局部图像。');
                continue;
              }
              write(text, fitted.formula, { ...typography, fontSizePt: fitted.size / 2 });
            } else {
              write(text, grouped ? inlinePositionedFormula(box, text, typography)
                : flow ? editableFormula(text, typography) : positionedFormula(elementId, box, text, typography, space));
            }
            report.formulas++;
            continue;
          } catch {
            warnings.add('有公式无法转换为 Word 公式，已使用原图或可编辑的 LaTeX 文本保留。');
            const crop = marks?.crops.get(item.id);
            if (crop && options.corrections?.[item.id] === undefined) {
              if (rowBounds?.standalone) {
                const bounds = figureBox(undefined, box, box[2], equationBox[3]);
                content.push(await formulaImage(crop, bounds, elementId, false));
              } else {
                write(text, await formulaImage(crop, equationBox, elementId, flow || grouped));
              }
              continue;
            }
          }
        }
        if (item.kind === 'table' && text) {
          if (pageParagraphs || adaptiveRows) {
            const graphic = picture(item, box, elementId);
            if (graphic) { content.push(graphic); continue; }
          }
          try {
            flush();
            const tableBox = flow ? flowBox(item.box) : box;
            const assetFor = (src: string) => src.replace(/^(?:\.\/)?images\//, '');
            const images = DomUtils.getElementsByTagName('img', parseDocument(text).children).map(node => assetFor(node.attribs.src ?? ''));
            for (const asset of images) await measureImage(asset);
            content.push(positionedTable(elementId, tableBox, text, typography, flow, (src, maxWidth) => {
              const asset = assetFor(src);
              const ratio = imageRatios.get(asset);
              if (!ratio) return '';
              const width = Math.min(maxWidth, geometry.contentHeight / ratio);
              return picture({ ...item, asset }, [0, 0, width, width * ratio], ++id, true) ?? '';
            }));
            report.tables++;
            continue;
          } catch {
            warnings.add('有表格结构无法转换，已尝试保留原图。');
            if (tableCrop) {
              const bounds = flowBox(tableCrop.box);
              const fitted = figureBox(undefined, bounds, bounds[2], geometry.contentHeight);
              content.push(flowParagraph(await recoveredImage(tableCrop.png, fitted, elementId, true), typography));
              continue;
            }
            if (!flow && grouped) {
              const plain = tablePlainText(text);
              if (plain) write(plain, flowText(plain, { ...typography, fontSizePt: typography.fontSizePt ?? inferredTextSize(box, plain) / 2 }));
              continue;
            }
          }
        }
        const graphicBox = flow && item.kind !== 'formula' ? flowBox(item.box) : box;
        if (item.kind === 'table' && item.asset) await measureImage(item.asset);
        const fittedGraphic = item.kind === 'table' ? figureBox(item.asset, graphicBox, graphicBox[2], flow ? geometry.contentHeight : graphicBox[3]) : graphicBox;
        const graphic = item.kind === 'formula' && formulaMode === 'latex' && text ? undefined : picture(item, fittedGraphic, elementId, flow || grouped);
        if (graphic) {
          if (flow && item.kind !== 'formula') {
            flush();
            content.push(flowParagraph(graphic, typography));
          } else write(text, graphic);
        } else if (flow && tableCrop) {
          flush();
          const bounds = flowBox(tableCrop.box);
          content.push(flowParagraph(await recoveredImage(tableCrop.png, figureBox(undefined, bounds, bounds[2], geometry.contentHeight), elementId, true), typography));
        } else if (text && item.kind !== 'table') {
          const contentText = item.kind === 'formula' && formulaMode === 'latex' ? `$${text}$` : text;
          const blank = item.kind === 'text' && /^[_＿]+$/.test(contentText);
          if (!flow && blank) {
            fixedRules.push([box[0], box[1] + box[3] * 0.82, box[2], Math.max(7000, box[3] * 0.06)]);
            continue;
          }
          const localSize = lineSizes.get(item.line) ?? bodySize;
          const cap = item.level ? undefined : /^\p{Script=Han}{1,2}$/u.test(contentText) && localSize
            ? Math.ceil(localSize * 1.12) : inferredCap;
          let sized = !flow && item.kind === 'text' && usesBodyFontSize(role)
            ? { ...typography, fontSizePt: typography.fontSizePt ?? styleDefaults.fixedBodyFontSizePt }
            : grouped ? { ...typography, fontSizePt: typography.fontSizePt ?? inferredTextSize(box, contentText, cap) / 2 } : typography;
          if (rowBounds) sized = fitPositionedTextStyle([box[0], box[1], box[2], rowBounds.height], contentText, sized);
          const level = flow ? (role.startsWith('heading') ? Number(role.slice(7)) : undefined) : item.level;
          write(contentText, flow || grouped ? (blank ? flowAnswerRule(flowBox(item.box)[2], sized)
            : item.kind === 'text' ? flowBodyText(contentText, sized, level, rowBounds ? box[2] : !flow && usesBodyFontSize(role) ? space?.[2] : undefined) : flowText(contentText, sized, level))
            : positionedText(elementId, box, contentText, sized, item.level, cap, space, item.kind === 'text' && usesBodyFontSize(role)), sized);
          report.texts++;
        } else if (item.asset || item.kind === 'table') {
          warnings.add(`原包缺少可用资源，无法重建元素 ${item.id}。`);
        }
      }
      for (const block of questionBlocks) {
        const [x, y, width, height] = pageParagraphs || adaptiveRows ? [0, 0, 0, 0] : geometry.box(block.box);
        let previousBottom = pageParagraphs ? 12_700 : y;
        const lines = [];
        const rows = block.lines.map(line => line.flatMap(key => questionRuns.get(key) ?? []))
          .filter(runs => runs.length)
          .map(runs => ({ runs, top: Math.min(...runs.map(run => run.box[1])), bottom: Math.max(...runs.map(run => run.box[1] + run.box[3])) }));
        // Reserve room for the page-ending paragraph and Word's rounding to twips.
        const pageBottom = pageBox[1] + pageBox[3];
        const last = rows[rows.length - 1];
        const lastBottom = last ? last.top + (last.bottom - last.top) * 1.3 : 0;
        const verticalScale = pageParagraphs ? Math.min(1, (pageBottom - 457_200) / Math.max(1, lastBottom)) : 1;
        for (const [index, { runs, top, bottom }] of rows.entries()) {
          const left = runs[0].box[0] - x;
          const rowHeight = Math.min(Math.round((bottom - top) * 1.3), (rows[index + 1]?.top ?? Infinity) - top);
          let right = runs[0].box[0];
          let xml = '';
          for (const run of runs) {
            const gap = run.box[0] - right;
            xml += positionedGap(gap);
            xml += run.xml;
            right = Math.max(right, run.box[0] + run.box[2]);
          }
          if (adaptiveRows) {
            const row = runs.find(run => !run.formula) ?? runs[0];
            const style = { ...row.typography, fontSizePt: row.typography.fontSizePt ?? styleDefaults.fixedBodyFontSizePt };
            const bounds = adaptiveBounds.get(row.id)!;
            const leftEdge = runs[0].box[0];
            const rightEdge = Math.max(right, leftEdge + 1);
            const rowBox: LayoutItem['box'] = [leftEdge, top,
              Math.min(pageBox[0] + pageBox[2] - leftEdge, Math.max(rightEdge - leftEdge + 127_000, (rightEdge - leftEdge) * 1.22)),
              bounds.height];
            content.push(positionedAdaptiveRow(++id, rowBox, xml, style, row.level));
            continue;
          }
          lines.push(positionedQuestionLine(xml, left, top * verticalScale - previousBottom, rowHeight * verticalScale));
          previousBottom = (top + rowHeight) * verticalScale;
        }
        if (pageParagraphs) pageRows = lines.join('');
        else if (lines.length) content.push(positionedQuestion(++id, [x, y,
          Math.min(pageBox[0] + pageBox[2] - x, width + 50_800), height + 381_000], lines.join('')));
      }
      if (!flow) for (const rule of [...(marks?.rules ?? []).map(rule => geometry.box(rule.box)), ...fixedRules]) {
        content.push(positionedRule(++id, rule));
      }
      flush();
      await handle.writeFile(flow ? content.join('') : pageParagraph(content.join(''), explicitBreak) + pageRows);
      report.pages++;
      for (const message of warnings) report.warnings.push({ page: page.number, message });
      if (options.page !== undefined) break;
    }
    if (!section) throw new Error(options.page ? `解析结果缺少第 ${options.page} 页。` : '解析结果不包含任何页面。');
    await handle.writeFile(section + documentEnd);
    await handle.close();
    if (!portable && template.footer === '{auto}' && !detectedFooter && options.pairedSource?.pairedArchive) {
      const paired = await openLayoutSource({ archive: options.pairedSource.pairedArchive });
      for await (const page of paired.pages()) {
        detectedFooter = detectFooterPattern(page);
        if (detectedFooter) break;
      }
    }
    const footer = portable ? undefined : template.footer === '{auto}' ? detectedFooter ?? '第 {page} 页 / 共 {pages} 页' : template.footer;
    options.signal?.throwIfAborted();
    await packageDocument(temporaryDoc, temporaryXml, media, { ...template, footer }, options.sourceName ?? path.parse(input).name);
    options.signal?.throwIfAborted();
    await rename(temporaryDoc, destination);
    return report;
  } finally {
    await sourcePdf?.destroy().catch(() => undefined);
    await handle.close();
    await Promise.all([rm(temporaryXml, { force: true }), rm(temporaryDoc, { force: true }), ...generatedFiles.map(filename => rm(filename, { force: true }))]);
  }
}
