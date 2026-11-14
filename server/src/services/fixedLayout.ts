import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { File as ZipEntry } from 'unzipper';
import { bufferPart, streamPart, writeOfficeZip } from './officeZip';
import { applyLayoutRoles, defaultQuestionLayout, type LayoutItem, type LayoutRoles, type LayoutSource, missingPositionMessage, openLayoutSource, pageTextRows, type QuestionLayout, questionTextFrames } from './mineruLayout';
import { type ElementKind, type LayoutTemplate, originalTemplate, styleDefaults, styleFor, type TextStyle, usesBodyFontSize } from './layoutTemplate';
import { renderFormulaImage } from './formulaImage';
import { type AnswerRule, openSourcePdf, recoverSourceMarks } from './sourcePageMarks';
import {
  documentEnd, documentStart, editableFormula, flowAnswerRule, flowBodyText, flowParagraph, flowText, inferredTextSize, inlinePositionedFormula,
  officeRelationship, pageGeometry, pageParagraph, positionedFormula, positionedGap, positionedImage, positionedQuestion, positionedQuestionLine,
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

export async function exportFixedDocument(input: string, destination: string, options: {
  page?: number;
  template?: LayoutTemplate;
  corrections?: LayoutCorrections;
  roles?: LayoutRoles;
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
  const pageParagraphs = !flow && questionLayout === 'page-paragraphs';
  const adaptiveRows = !flow && questionLayout === 'adaptive-rows';
  const archive = await openLayoutSource({ ...options.pairedSource, archive: input }, { splitInlineProse: flow });
  const origin = [...archive.entries.values()].find(entry => entry.path.endsWith('_origin.pdf')) ?? options.sourcePdf;
  const formulaMode = template.formulaMode ?? 'editable';
  const media = new Map<string, Media>();
  const report: LayoutReport = { pages: 0, texts: 0, pictures: 0, formulas: 0, formulaImages: 0, tables: 0, warnings: [] };
  const unique = `${destination}.${randomUUID()}`;
  const temporaryXml = `${unique}.xml`;
  const temporaryDoc = `${unique}.part`;
  const handle = await open(temporaryXml, 'wx');
  const generatedFiles: string[] = [];
  let section: string | undefined;
  let id = 0;
  const sourcePdf = origin ? await openSourcePdf(origin).catch(() => undefined) : undefined;

  function picture(item: LayoutItem, box: LayoutItem['box'], elementId: number, inline = flow): string | undefined {
    const asset = item.asset;
    if (!asset) return;
    let image = media.get(asset);
    if (!image) {
      const entry = archive.entries.get(`images/${asset}`);
      const extension = extensionOf(asset);
      if (!entry || !extension) return;
      const index = media.size + 1;
      image = { entry, filename: `picture-${index}.${extension}`, relationship: `rIdImage${index}` };
      media.set(asset, image);
    }
    report.pictures++;
    return positionedImage(elementId, box, image.relationship, inline);
  }

  async function formulaImage(png: Buffer, box: LayoutItem['box'], elementId: number, inline = flow): Promise<string> {
    const filename = `${unique}.formula-${elementId}.png`;
    generatedFiles.push(filename);
    await writeFile(filename, png, { flag: 'wx' });
    const part = bufferPart('', png);
    const relationship = `rIdImage${media.size + 1}`;
    media.set(`formula:${elementId}`, { filename: `formula-${elementId}.png`, relationship, generated: { filename, size: part.size, crc: part.crc } });
    report.formulaImages++;
    return positionedImage(elementId, box, relationship, inline);
  }

  try {
    await handle.writeFile(documentStart);
    for await (const page of archive.pages()) {
      options.signal?.throwIfAborted();
  if (options.page !== undefined && page.number !== options.page) continue;
      if (options.roles) applyLayoutRoles(page, options.roles);
      if (page.approximateLines && !flow) throw new Error(missingPositionMessage);
      const geometry = pageGeometry(page.size, template);
      const explicitBreak = !flow && !pageParagraphs && section === geometry.section;
      if (section && !flow && !explicitBreak) await handle.writeFile(sectionBreak(section));
      if (!section || !flow) section = geometry.section;
      const warnings = new Set<string>();
      if (page.mixed?.unmatchedImages) warnings.add(`${page.mixed.unmatchedImages} 张图未能匹配 Pipeline，保留 VLM 裁片与比例，请对照原卷。`);
      const marks = sourcePdf ? await recoverSourceMarks(sourcePdf, page).catch(() => undefined) : undefined;
      const rulesByItem = new Map<string, AnswerRule[]>();
      for (const rule of marks?.rules ?? []) {
        const rules = rulesByItem.get(rule.after) ?? [];
        rules.push(rule);
        rulesByItem.set(rule.after, rules);
      }
      if (origin && !marks) warnings.add('无法读取原 PDF 的页面图形，可能漏掉 OCR 未识别的答题横线。');
      if (marks?.crops.size && !adaptiveRows && formulaMode === 'editable') warnings.add('个别公式识别不完整，已保留原卷局部图像。');
      const content: string[] = [];
      const boxes = page.items.map(item => geometry.box(item.box));
      const pageBox = geometry.box([0, 0, ...page.size]);
      const questionBlocks = pageParagraphs || adaptiveRows ? [pageTextRows({ ...page, items: page.items.map(item =>
        item.kind === 'table' && item.asset && !archive.entries.has(`images/${item.asset}`) ? { ...item, asset: undefined } : item,
      ) })] : !flow && (questionLayout === 'merged-options' || questionLayout === 'separate-options')
        ? questionTextFrames(page, questionLayout) : [];
      const groupedItems = new Set(questionBlocks.flatMap(block => block.lines.flat()));
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
      let paragraph: { item: LayoutItem; text: string; style: TextStyle; level?: number; runs: string[] } | undefined;
      const flush = () => {
        if (paragraph) content.push(flowParagraph(paragraph.runs.join(''), paragraph.style, paragraph.level));
        paragraph = undefined;
      };
      const writeInline = (item: LayoutItem, text: string, xml: string, role: ElementKind, style: TextStyle) => {
        if (!flow) return void content.push(xml);
        const startsQuestion = item.kind === 'text' && /^\d{1,3}[.．、]\s*[\p{Script=Han}（(]/u.test(text);
        const startsOption = item.kind === 'text' && item.role === 'option'
          && (paragraph?.item.role !== 'option' || /^[A-GＡ-Ｇ]\s*[.．、)）]/.test(text));
        if (!paragraph || (paragraph.item.group !== item.group && item.kind !== 'formula') || startsOption
          || (paragraph.item.line !== item.line && startsQuestion)) {
          flush();
          paragraph = { item, text: '', style: role === 'formula' ? bodyStyle : style, level: item.level, runs: [] };
        }
        if (item.kind === 'text' && paragraph.item.kind === 'text' && /[A-Za-z0-9]$/.test(paragraph.text)
          && /^[A-Za-z0-9]/.test(text) && (paragraph.item.line !== item.line || item.box[0] > paragraph.item.box[2] + 2)) {
          paragraph.runs.push(flowText(' ', style));
        }
        paragraph.item = item;
        paragraph.text = text;
        paragraph.runs.push(xml);
        for (const rule of rulesByItem.get(item.id) ?? []) {
          paragraph.runs.push(flowAnswerRule(geometry.box(rule.box)[2], paragraph.style));
          paragraph.text = '';
        }
      };
      for (const [index, item] of page.items.entries()) {
        if (!template.showPageMarks && ['header', 'footer', 'page_number'].includes(item.role)) continue;
        if (template.footer && ['footer', 'page_number'].includes(item.role)) continue;
        const text = options.corrections?.[item.id] ?? item.text ?? '';
        const box = boxes[index];
        const space = flow ? undefined : availableSpace(index, boxes, pageBox);
        const elementId = ++id;
        const role = elementStyle(item);
        const typography = styleFor(template, role);
        const grouped = groupedItems.has(item.id);
        const write = (value: string, xml: string) => {
          if (grouped) questionRuns.set(item.id, { id: item.id, xml, box, typography, level: item.level, formula: item.kind === 'formula' });
          else writeInline(item, value, xml, role, typography);
        };
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
            const { png, box: fitted } = renderFormulaImage(text, box, typography);
            write(text, await formulaImage(png, fitted, elementId, flow || grouped));
            continue;
          } catch {
            warnings.add('有公式图片无法生成，已尝试使用原图或可编辑公式。');
          }
        }
        if (item.kind === 'formula' && formulaMode === 'image' && item.asset) {
          const graphic = picture(item, box, elementId, flow || grouped);
          if (graphic) { write(text, graphic); continue; }
        }
        if (item.kind === 'formula' && text && formulaMode !== 'latex') {
          try {
            write(text, adaptiveRows ? editableFormula(text, { ...typography, fontSizePt: typography.fontSizePt ?? styleDefaults.fixedBodyFontSizePt })
              : grouped ? inlinePositionedFormula(box, text, typography)
              : flow ? editableFormula(text, typography) : positionedFormula(elementId, box, text, typography, space));
            report.formulas++;
            continue;
          } catch {
            warnings.add('有公式无法转换为 Word 公式，已使用原图或可编辑的 LaTeX 文本保留。');
            const crop = marks?.crops.get(item.id);
            if (crop && options.corrections?.[item.id] === undefined) {
              write(text, await formulaImage(crop, box, elementId, flow || grouped));
              continue;
            }
          }
        }
        if (item.kind === 'table' && text) {
          if (pageParagraphs || adaptiveRows) {
            const graphic = picture(item, box, elementId);
            if (graphic) { content.push(graphic); continue; }
            const plain = tablePlainText(text);
            if (plain && grouped) write(plain, flowText(plain, { ...typography, fontSizePt: typography.fontSizePt ?? inferredTextSize(box, plain) / 2 }));
            warnings.add('没有裁片的表格已按单元格顺序保留文字。');
            continue;
          }
          try {
            flush();
            content.push(positionedTable(elementId, box, text, typography, flow));
            report.tables++;
            continue;
          } catch {
            warnings.add('有表格结构无法转换，已尝试保留原图。');
          }
        }
        const graphic = item.kind === 'formula' && formulaMode === 'latex' && text ? undefined : picture(item, box, elementId, flow || grouped);
        if (graphic) {
          if (flow && item.kind !== 'formula') {
            flush();
            content.push(flowParagraph(graphic, typography));
          } else write(text, graphic);
        } else if (text && item.kind !== 'table') {
          const contentText = item.kind === 'formula' && formulaMode === 'latex' ? `$${text}$` : text;
          const blank = item.kind === 'text' && /^[_＿]+$/.test(contentText);
          const localSize = lineSizes.get(item.line) ?? bodySize;
          const cap = item.level ? undefined : /^\p{Script=Han}{1,2}$/u.test(contentText) && localSize
            ? Math.ceil(localSize * 1.12) : inferredCap;
          const sized = !flow && item.kind === 'text' && usesBodyFontSize(role)
            ? { ...typography, fontSizePt: typography.fontSizePt ?? styleDefaults.fixedBodyFontSizePt }
            : grouped ? { ...typography, fontSizePt: typography.fontSizePt ?? inferredTextSize(box, contentText, cap) / 2 } : typography;
          write(contentText, flow || grouped ? (blank ? flowAnswerRule(box[2], sized)
            : item.kind === 'text' ? flowBodyText(contentText, sized, item.level, !flow && !adaptiveRows && usesBodyFontSize(role) ? box[2] : undefined) : flowText(contentText, sized))
            : positionedText(elementId, box, contentText, sized, item.level, cap, space, item.kind === 'text' && usesBodyFontSize(role)));
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
            if (adaptiveRows) for (const rule of rulesByItem.get(run.id) ?? []) {
              const [ruleX, , ruleWidth] = geometry.box(rule.box);
              xml += positionedGap(ruleX - right) + flowAnswerRule(ruleWidth,
                { ...run.typography, fontSizePt: run.typography.fontSizePt ?? styleDefaults.fixedBodyFontSizePt });
              right = Math.max(right, ruleX + ruleWidth);
            }
          }
          if (adaptiveRows) {
            const row = runs.find(run => !run.formula) ?? runs[0];
            const style = { ...row.typography, fontSizePt: row.typography.fontSizePt ?? styleDefaults.fixedBodyFontSizePt };
            const linePt = style.lineSpacingPt ?? style.fontSizePt * (style.lineSpacing ?? 1.2);
            const minimum = Math.ceil((linePt * (runs.some(run => run.formula) ? 2.6 : 1.45)
              + (style.spaceBeforePt ?? 0) + (style.spaceAfterPt ?? 0)) * 12_700);
            const leftEdge = runs[0].box[0];
            const rightEdge = Math.max(right, leftEdge + 1);
            // Reserve room for Word's natural formula line box without moving the next row or any image.
            const rowBox: LayoutItem['box'] = [leftEdge, top,
              Math.min(pageBox[0] + pageBox[2] - leftEdge, Math.max(rightEdge - leftEdge + 127_000, (rightEdge - leftEdge) * 1.22)),
              Math.max(bottom - top, minimum)];
            content.push(positionedQuestion(++id, rowBox, flowParagraph(xml, style, row.level)));
            continue;
          }
          lines.push(positionedQuestionLine(xml, left, top * verticalScale - previousBottom, rowHeight * verticalScale));
          previousBottom = (top + rowHeight) * verticalScale;
        }
        if (pageParagraphs) pageRows = lines.join('');
        else if (lines.length) content.push(positionedQuestion(++id, [x, y,
          Math.min(pageBox[0] + pageBox[2] - x, width + 50_800), height + 381_000], lines.join('')));
      }
      if (!flow && marks) {
        for (const rule of marks.rules) {
          if (!adaptiveRows || !questionRuns.has(rule.after)) content.push(positionedRule(++id, geometry.box(rule.box)));
        }
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
    options.signal?.throwIfAborted();
    await packageDocument(temporaryDoc, temporaryXml, media, template, options.sourceName ?? path.parse(input).name);
    options.signal?.throwIfAborted();
    await rename(temporaryDoc, destination);
    return report;
  } finally {
    await sourcePdf?.destroy().catch(() => undefined);
    await handle.close();
    await Promise.all([rm(temporaryXml, { force: true }), rm(temporaryDoc, { force: true }), ...generatedFiles.map(filename => rm(filename, { force: true }))]);
  }
}
