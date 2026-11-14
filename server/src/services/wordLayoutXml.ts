import katex from 'katex';
import { mml2omml } from 'mathml2omml';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { Box } from './mineruLayout';
import { type LayoutTemplate, marginsFor, styleDefaults, type TextStyle } from './layoutTemplate';
import { formulaGeometry } from './formulaImage';

export const emuPerMm = 36_000;
const emuPerPoint = 12_700;
const emuPerTwip = 635;
export const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const relationshipsNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const officeRelationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const artNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const pictureNs = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const shapeNs = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

export const documentStart = `${xmlHeader}<w:document xmlns:w="${wordNs}" xmlns:wp="${drawingNs}" xmlns:a="${artNs}" xmlns:pic="${pictureNs}" xmlns:wps="${shapeNs}" xmlns:r="${officeRelationship.slice(0, -1)}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>`;
export const documentEnd = '</w:body></w:document>';

export function escapeXml(value: string): string {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]!);
}

export function pageGeometry(size: [number, number], template: LayoutTemplate) {
  const [sourceWidth, sourceHeight] = size;
  const width = template.widthMm * emuPerMm;
  const margin = marginsFor(template);
  const horizontal = (margin.left + margin.right) * emuPerMm;
  const vertical = (margin.top + margin.bottom) * emuPerMm;
  const height = template.heightMm === null
    ? Math.min(558 * emuPerMm, (width - horizontal) * sourceHeight / sourceWidth + vertical)
    : template.heightMm * emuPerMm;
  const scale = Math.min((width - horizontal) / sourceWidth, (height - vertical) / sourceHeight);
  if (scale <= 0) throw new Error('模板留白超过了纸张尺寸。');
  const offsetX = margin.left * emuPerMm + (width - horizontal - sourceWidth * scale) / 2;
  const offsetY = margin.top * emuPerMm + (height - vertical - sourceHeight * scale) / 2;
  const box = ([x0, y0, x1, y1]: Box): Box => [
    Math.round(offsetX + x0 * scale), Math.round(offsetY + y0 * scale),
    Math.max(1, Math.round((x1 - x0) * scale)), Math.max(1, Math.round((y1 - y0) * scale)),
  ];
  const pageMargin = (edge: keyof typeof margin) => template.mode === 'flow' ? Math.round(margin[edge] * emuPerMm / emuPerTwip) : 0;
  const footerRef = template.footer ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : '';
  return { box, section: `<w:sectPr>${footerRef}<w:type w:val="nextPage"/><w:pgSz w:w="${Math.round(width / emuPerTwip)}" w:h="${Math.round(height / emuPerTwip)}"${width > height ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${pageMargin('top')}" w:right="${pageMargin('right')}" w:bottom="${pageMargin('bottom')}" w:left="${pageMargin('left')}" w:header="0" w:footer="283" w:gutter="0"/></w:sectPr>` };
}

const gridOff = '<w:adjustRightInd w:val="0"/><w:snapToGrid w:val="0"/>';
const carrierPr = gridOff + '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>';
export const pageParagraph = (content: string, pageBreakBefore = false) => `<w:p><w:pPr>${pageBreakBefore ? '<w:pageBreakBefore/>' : ''}${carrierPr}</w:pPr>${content}</w:p>`;
export const sectionBreak = (section: string) => `<w:p><w:pPr>${carrierPr}${section}</w:pPr></w:p>`;

function anchor(id: number, [x, y, width, height]: Box, graphic: string): string {
  return `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV><wp:extent cx="${width}" cy="${height}"/><wp:wrapNone/><wp:docPr id="${id}" name="Element ${id}"/><wp:cNvGraphicFramePr/>${graphic}</wp:anchor></w:drawing>`;
}

function drawingBox([x, y, width, height]: Box): Box {
  return [Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
}

export function positionedRule(id: number, box: Box): string {
  const bounds = drawingBox(box);
  const [x, y, width, height] = bounds;
  const graphic = `<a:graphic><a:graphicData uri="${shapeNs}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>`;
  const fallback = `<w:pict><v:rect id="AnswerRule${id}" stroked="f" fillcolor="#000000" style="position:absolute;margin-left:${x / emuPerPoint}pt;margin-top:${y / emuPerPoint}pt;width:${width / emuPerPoint}pt;height:${height / emuPerPoint}pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page"/></w:pict>`;
  return `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${anchor(id, bounds, graphic)}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></w:r>`;
}

export function positionedImage(id: number, box: Box, relationshipId: string, inline = false): string {
  const bounds = drawingBox(box);
  const [, , width, height] = bounds;
  const graphic = `<a:graphic><a:graphicData uri="${pictureNs}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  const drawing = inline ? `<w:drawing><wp:inline><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Image ${id}"/><wp:cNvGraphicFramePr/>${graphic}</wp:inline></w:drawing>` : anchor(id, bounds, graphic);
  return `<w:r>${drawing}</w:r>`;
}

function textBox(id: number, box: Box, content: string, verticalAnchor: 't' | 'ctr' = 't'): string {
  const bounds = drawingBox(box);
  const [x, y, width, height] = bounds;
  const graphic = `<a:graphic><a:graphicData uri="${shapeNs}"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx><wps:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${verticalAnchor}"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>`;
  const vmlAnchor = verticalAnchor === 'ctr' ? ';v-text-anchor:middle' : '';
  const fallback = `<w:pict><v:rect id="LayoutBox${id}" filled="f" stroked="f" style="position:absolute;margin-left:${x / emuPerPoint}pt;margin-top:${y / emuPerPoint}pt;width:${width / emuPerPoint}pt;height:${height / emuPerPoint}pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page${vmlAnchor}"><v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:f;mso-wrap-style:none"><w:txbxContent>${content}</w:txbxContent></v:textbox></v:rect></w:pict>`;
  return `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${anchor(id, bounds, graphic)}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></w:r>`;
}

export const positionedQuestion = (id: number, box: Box, content: string) => textBox(id, box, content);

export function tablePlainText(html: string) {
  const document = parseDocument(html);
  return DomUtils.findAll(element => element.name === 'tr', document.children)
    .map(row => DomUtils.findAll(element => element.name === 'th' || element.name === 'td', row.children)
      .map(cell => DomUtils.textContent(cell).trim()).filter(Boolean).join('　'))
    .filter(Boolean).join('　／　') || DomUtils.textContent(document).trim();
}

export function positionedQuestionLine(content: string, left: number, before: number, height: number) {
  const twips = (emu: number) => Math.max(0, Math.round(emu / emuPerTwip));
  return `<w:p><w:pPr><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>${gridOff}<w:spacing w:before="${twips(before)}" w:after="0" w:line="${Math.max(1, twips(height))}" w:lineRule="atLeast"/><w:ind w:left="${twips(left)}"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>${content}</w:p>`;
}

export function positionedGap(width: number) {
  const twips = Math.round(width / emuPerTwip);
  if (twips < 8) return '';
  // A 1 pt nonbreaking space is roughly 5 twips wide. Set the rest as run spacing
  // so preceding glyph widths cannot make Word jump to the next tab stop.
  return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:spacing w:val="${twips - 5}"/><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:t xml:space="preserve">\u00a0</w:t></w:r>`;
}
function paragraph(content: string, size: number, level?: number, typography: TextStyle = {}): string {
  const style = level ? `<w:pStyle w:val="Heading${Math.min(9, level)}"/>` : '';
  const minimum = typography.lineSpacingPt;
  const multiple = minimum === undefined && typography.lineSpacing;
  const line = Math.round(multiple ? multiple * 240 : minimum !== undefined ? minimum * 20 : size * 10 * styleDefaults.minLineHeightRatio);
  const mm = (value: number) => Math.round(value * emuPerMm / emuPerTwip);
  const first = typography.firstLineIndentMm ?? 0;
  const indent = `<w:ind w:left="${mm(typography.leftIndentMm ?? 0)}" w:right="${mm(typography.rightIndentMm ?? 0)}" w:${first < 0 ? 'hanging' : 'firstLine'}="${mm(Math.abs(first))}"/>`;
  const alignment = typography.alignment ? `<w:jc w:val="${typography.alignment === 'justify' ? 'both' : typography.alignment}"/>` : '';
  return `<w:p><w:pPr>${style}<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>${gridOff}<w:spacing w:before="${Math.round((typography.spaceBeforePt ?? 0) * 20)}" w:after="${Math.round((typography.spaceAfterPt ?? 0) * 20)}" w:line="${line}" w:lineRule="${multiple ? 'auto' : 'atLeast'}"/>${indent}${alignment}<w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>${content}</w:p>`;
}

function runProperties(typography: TextStyle, size?: number, defaultBold = false, italic = ''): string {
  const face = typography.font ? escapeXml(typography.font) : undefined;
  const font = face ? `<w:rFonts w:ascii="${face}" w:hAnsi="${face}" w:eastAsia="${face}" w:cs="${face}"/>` : '';
  const bold = typography.bold === undefined ? (defaultBold ? '<w:b/>' : '') : `<w:b w:val="${Number(typography.bold)}"/>`;
  const color = typography.color ? `<w:color w:val="${typography.color.slice(1)}"/>` : '';
  const tracking = typography.letterSpacingPt === undefined ? '' : `<w:spacing w:val="${Math.round(typography.letterSpacingPt * 20)}"/>`;
  const sizing = size === undefined ? '' : `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
  const underline = typography.underline === undefined ? '' : `<w:u w:val="${typography.underline ? 'single' : 'none'}"/>`;
  return font + bold + italic + color + tracking + sizing + underline;
}

function textRun(text: string, size: number, typography: TextStyle, defaultBold = false, widthPercent = 100): string {
  const scale = widthPercent === 100 ? '' : `<w:w w:val="${widthPercent}"/>`;
  const properties = runProperties(typography, size, defaultBold).replace('<w:sz', `${scale}<w:sz`);
  return `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

const textAdvance = (text: string) => Math.max(1, [...text].reduce((sum, char) => sum + (/^[\u0020-\u007E]$/.test(char) ? 0.54 : 1), 0));

function widthScale(width: number | undefined, text: string, size: number, typography: TextStyle) {
  if (width === undefined) return 100;
  const estimate = textAdvance(text) * size * emuPerPoint / 2
    + Math.max(0, (typography.letterSpacingPt ?? 0) * (text.length - 1) * emuPerPoint);
  return Math.max(1, Math.min(100, Math.floor(width * 100 / estimate)));
}

export function inferredTextSize([, , width, height]: Box, text: string, cap = 144): number {
  const advance = textAdvance(text);
  return Math.max(2, Math.min(cap, Math.round(2 * Math.min(height * 1.13, width * 0.97 / advance) / emuPerPoint)));
}

export function positionedText(id: number, box: Box, text: string, typography: TextStyle, level?: number, inferredCap?: number, space?: Box, fitWidth = false): string {
  const [x, y, width, height] = box;
  const size = typography.fontSizePt === undefined ? inferredTextSize(box, text, inferredCap) : Math.round(typography.fontSizePt * 2);
  return textBox(id, space ?? [x, y, Math.round(width * 1.04), Math.round(height * 1.62)],
    paragraph(textRun(text, size, typography, Boolean(level), widthScale(fitWidth ? width : undefined, text, size, typography)), size, level, typography));
}

export function editableFormula(latex: string, typography: TextStyle = {}, fitSize?: number): string {
  const rendered = katex.renderToString(latex, { output: 'mathml', trust: false, throwOnError: true, strict: 'ignore', maxExpand: 250, maxSize: 20 });
  const mathml = rendered.match(/<math\b[\s\S]*?<\/math>/)?.[0].replace(/<annotation(?:\s[^>]*)?>[\s\S]*?<\/annotation>/g, '');
  if (!mathml) throw new Error('公式缺少 MathML。');
  let omml = mml2omml(mathml)
    .replace(/(<m:t(?:\s[^>]*)?>)([\s\S]*?)(<\/m:t>)/g, (_match, start, text, end) => (
      start + text.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + end
    ))
    .replace(/<m:argPr\b[^>]*>[\s\S]*?<\/m:argPr>/g, '')
    .replace(/<m:sty\s+m:val="undefined"\s*\/>/g, '')
    .replace(/<m:rPr>([\s\S]*?)<\/m:rPr>/g, (match, properties: string) => properties.includes('<m:nor')
      ? `<m:rPr>${properties.replace(/<m:sty\b[^>]*\/>/g, '')}</m:rPr>` : match)
    .replace(/(<m:r>)(<w:rPr(?:\s[^>]*)?\s*\/>|<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>)(<m:rPr>[\s\S]*?<\/m:rPr>)/g, '$1$3$2');
  if (!omml.includes('<m:oMath') || !omml.includes('<m:t')) throw new Error('公式内容无法转换。');
  const size = fitSize ?? (typography.fontSizePt === undefined ? undefined : Math.round(typography.fontSizePt * 2));
  if (size !== undefined || typography.font || typography.color || typography.bold !== undefined || typography.underline !== undefined || typography.letterSpacingPt !== undefined) {
    omml = omml.replace(/<m:r>(<m:rPr>[\s\S]*?<\/m:rPr>)?(?:<w:rPr\s*\/>|<w:rPr>([\s\S]*?)<\/w:rPr>)?(?=<m:t\b)/g,
      (_match, mathProperties = '', wordProperties = '') => {
        if (typography.bold !== undefined && !mathProperties.includes('<m:nor')) {
          const variant = mathProperties.match(/<m:sty m:val="([^"]+)"\s*\/>/)?.[1] ?? 'i';
          const italic = variant === 'i' || variant === 'bi';
          const style = `<m:sty m:val="${typography.bold ? (italic ? 'bi' : 'b') : (italic ? 'i' : 'p')}"/>`;
          mathProperties = mathProperties
            ? mathProperties.replace(/<m:sty\b[^>]*\/>/, '').replace('</m:rPr>', `${style}</m:rPr>`)
            : `<m:rPr>${style}</m:rPr>`;
        }
        const italic = wordProperties.match(/<w:i(?:\s[^>]*)?\s*\/>/)?.[0] ?? '';
        const properties = runProperties(typography, size, /<w:b(?:\s|\/)/.test(wordProperties), italic);
        return `<m:r>${mathProperties}<w:rPr>${properties}</w:rPr>`;
      });
  }
  return omml;
}

function fittedFormula(box: Box, latex: string, typography: TextStyle) {
  const [, , width, height] = box;
  let fit = height / emuPerPoint;
  try {
    const geometry = formulaGeometry(latex);
    fit = Math.min(width * 1000 / geometry.width, height * 1000 / geometry.height) / emuPerPoint * 0.83;
  } catch { /* KaTeX may support an expression MathJax cannot measure. */ }
  const size = Math.max(4, Math.min(56, Math.floor(2 * Math.min(fit, typography.fontSizePt ?? fit))));
  const formula = editableFormula(latex, typography, size)
    .replace(/^(<m:oMath\b[^>]*>)([\s\S]*)(<\/m:oMath>)$/, '$1<m:box><m:boxPr><m:noBreak/></m:boxPr><m:e>$2</m:e></m:box>$3');
  return { formula, size };
}

export const inlinePositionedFormula = (box: Box, latex: string, typography: TextStyle) => fittedFormula(box, latex, typography).formula;

export function positionedFormula(id: number, box: Box, latex: string, typography: TextStyle, space: Box = box): string {
  const [x, y, , height] = box;
  const { formula, size } = fittedFormula(box, latex, typography);
  const padding = Math.min(y, Math.floor((space[3] - height) / 2));
  // Extra room for the Word line box must not move the OCR region's center.
  const boxHeight = height + 2 * padding;
  const content = paragraph(formula, size, undefined, { ...typography, lineSpacing: undefined });
  return textBox(id, [x, y - padding, space[2], boxHeight], content, 'ctr');
}

export function positionedTable(id: number, box: Box, html: string, typography: TextStyle, inline = false): string {
  const tree = parseDocument(html);
  const table = DomUtils.getElementsByTagName('table', tree.children, true, 1)[0];
  if (!table) throw new Error('缺少表格结构。');
  const rows = DomUtils.getElementsByTagName('tr', table.children, true, 500);
  if (!rows.length) throw new Error('表格为空。');
  const rowCount = rows.length;
  const cells = rows.map(() => new Map<number, { text: string; cols: number; merge?: 'restart' | 'continue'; bold?: boolean }>());
  let columnCount = 0;
  for (const [rowIndex, row] of rows.entries()) {
    let column = 0;
    for (const child of row.children) {
      if (!DomUtils.isTag(child) || (child.name !== 'td' && child.name !== 'th')) continue;
      while (cells[rowIndex].has(column)) column++;
      const cols = Math.max(1, Number.parseInt(child.attribs.colspan || '1', 10) || 1);
      const span = Math.min(rowCount - rowIndex, Math.max(1, Number.parseInt(child.attribs.rowspan || '1', 10) || 1));
      if (column + cols > 100) throw new Error('表格列数超出 Word 可排版范围。');
      const text = DomUtils.textContent(child).replace(/\s+/g, ' ').trim();
      for (let offset = 0; offset < span; offset++) {
        cells[rowIndex + offset].set(column, { text: offset ? '' : text, cols, bold: child.name === 'th',
          merge: span === 1 ? undefined : offset === 0 ? 'restart' : 'continue' });
        for (let covered = 1; covered < cols; covered++) cells[rowIndex + offset].set(column + covered, { text: '', cols: 0 });
      }
      column += cols;
      columnCount = Math.max(columnCount, column);
    }
  }
  if (!columnCount) throw new Error('表格为空。');
  const [, , width, height] = box;
  const cellWidth = Math.max(1, Math.floor(width / emuPerTwip / columnCount));
  const size = typography.fontSizePt === undefined ? Math.max(10, Math.min(22, Math.floor(height / rowCount / emuPerPoint * 1.25))) : Math.round(typography.fontSizePt * 2);
  const tableRows = cells.map(row => {
    const columns: string[] = [];
    for (let column = 0; column < columnCount; column++) {
      const cell = row.get(column) ?? { text: '', cols: 1 };
      if (!cell.cols) continue;
      const merge = cell.merge ? `<w:vMerge w:val="${cell.merge}"/>` : '';
      columns.push(`<w:tc><w:tcPr><w:tcW w:w="${cellWidth * cell.cols}" w:type="dxa"/>${cell.cols > 1 ? `<w:gridSpan w:val="${cell.cols}"/>` : ''}${merge}</w:tcPr>${paragraph(textRun(cell.text, size, typography, cell.bold), size, undefined, typography)}</w:tc>`);
    }
    return `<w:tr>${columns.join('')}</w:tr>`;
  }).join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="000000"/>`).join('');
  const grid = `<w:tblGrid>${`<w:gridCol w:w="${cellWidth}"/>`.repeat(columnCount)}</w:tblGrid>`;
  const content = `<w:tbl><w:tblPr><w:tblW w:w="${cellWidth * columnCount}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>${grid}${tableRows}</w:tbl><w:p/>`;
  return inline ? content : textBox(id, box, content);
}

const halfPoints = (typography: TextStyle, level?: number) => Math.round((typography.fontSizePt ?? styleDefaults.flowFontSizePt[level === 1 ? 'heading1' : level ? 'heading' : 'body']) * 2);
export function flowText(text: string, typography: TextStyle, level?: number, width?: number) {
  const size = halfPoints(typography, level);
  return textRun(text, size, typography, Boolean(level), widthScale(width, text, size, typography));
}
export const flowParagraph = (content: string, typography: TextStyle, level?: number) => paragraph(content, halfPoints(typography, level), level, typography);

export function flowAnswerRule(width: number, typography: TextStyle): string {
  const size = halfPoints(typography);
  // Figure spaces have the width of a digit and stay together when the paragraph wraps.
  const widthPt = width / emuPerPoint;
  const count = Math.min(80, Math.max(2, Math.round(widthPt / (size * 0.25))));
  return flowText('\u2007'.repeat(count), { ...typography, underline: true, letterSpacingPt: 0 });
}

export function flowBodyText(text: string, typography: TextStyle, level?: number, width?: number): string {
  if (width !== undefined && !/[_＿]{2,}/u.test(text)) return flowText(text, typography, level, width);
  return text.split(/([_＿]{2,})/u).filter(Boolean).map(part => /^[_＿]{2,}$/u.test(part)
    ? flowAnswerRule([...part].reduce((width, character) => width + (character === '＿' ? 1 : 0.5), 0)
      * halfPoints(typography, level) / 2 * emuPerPoint, typography)
    : flowText(part, typography, level)).join('');
}

export function wordFooter(template: string, filename: string, typography: TextStyle): string {
  const style = { fontSizePt: styleDefaults.flowFontSizePt.footer, alignment: 'center' as const, ...typography };
  const parts = template.split(/(\{(?:page|pages|file)\})/g).map(part => {
    if (part === '{page}' || part === '{pages}') return `<w:fldSimple w:instr=" ${part === '{page}' ? 'PAGE' : 'NUMPAGES'} ">${flowText('1', style)}</w:fldSimple>`;
    return flowText(part === '{file}' ? filename : part, style);
  });
  const centered = flowParagraph(parts.join(''), style);
  return `${xmlHeader}<w:ftr xmlns:w="${wordNs}">${centered}</w:ftr>`;
}

export function wordStyles(font: string): string {
  const face = escapeXml(font);
  const headingStyles = Array.from({ length: 9 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${index}"/></w:pPr></w:style>`).join('');
  return `${xmlHeader}<w:styles xmlns:w="${wordNs}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${face}" w:hAnsi="${face}" w:eastAsia="${face}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${gridOff}</w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${headingStyles}</w:styles>`;
}
