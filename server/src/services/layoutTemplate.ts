export const elementKinds = ['body', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'heading7', 'heading8', 'heading9',
  'instructions', 'stem', 'option', 'caption', 'header', 'footer', 'formula', 'table'] as const;
export type ElementKind = typeof elementKinds[number];

export const elementLabels: Record<ElementKind, string> = {
  body: '正文', heading1: '1 级标题', heading2: '2 级标题', heading3: '3 级标题',
  heading4: '4 级标题', heading5: '5 级标题', heading6: '6 级标题',
  heading7: '7 级标题', heading8: '8 级标题', heading9: '9 级标题',
  instructions: '注意事项', stem: '题干', option: '选项', caption: '图表标题',
  header: '页眉', footer: '页脚', formula: '公式', table: '表格',
};

export interface TextStyle {
  inheritBody?: boolean;
  font?: string;
  fontChinese?: string;
  fontEnglish?: string;
  fontPunctuation?: string;
  fontSizePt?: number;
  letterSpacingPt?: number;
  lineSpacing?: number;
  lineSpacingPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  leftIndentMm?: number;
  rightIndentMm?: number;
  firstLineIndentMm?: number;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  color?: string;
  bold?: boolean;
  underline?: boolean;
}

export interface LayoutTemplate {
  widthMm: number;
  heightMm: number | null;
  marginMm: number;
  margins?: { top: number; right: number; bottom: number; left: number };
  font: string;
  showPageMarks: boolean;
  mode?: 'fixed' | 'flow';
  formulaMode?: 'editable' | 'latex' | 'image';
  footer?: string;
  footerDistanceMm?: number;
  markerWidth?: 'preserve' | 'full' | 'half';
  styles?: Partial<Record<ElementKind, TextStyle>>;
}

export const originalTemplate: LayoutTemplate = { widthMm: 210, heightMm: null, marginMm: 0, font: 'SimSun', showPageMarks: true,
  mode: 'fixed', formulaMode: 'editable' };

export const standardTemplate: LayoutTemplate = {
  ...originalTemplate, mode: 'flow', heightMm: 297, marginMm: 18, showPageMarks: false,
  footer: '第 {page} 页 / 共 {pages} 页',
  styles: { body: { fontSizePt: 11, lineSpacing: 1.45 }, heading1: { fontSizePt: 17 },
    heading2: { fontSizePt: 13 }, instructions: { fontSizePt: 10 } },
};

export const examPaperTemplate = {
  ...standardTemplate,
  id: 'exam-paper',
  name: '试卷校对稿',
  widthMm: 185,
  heightMm: 260,
  markerWidth: 'full',
  footer: '{auto}',
  margins: { top: 18, right: 20, bottom: 18, left: 20 },
  styles: {
    body: { fontSizePt: 10.5, lineSpacing: 1.2, fontEnglish: 'Times New Roman', letterSpacingPt: 0, color: '#000000' },
    heading1: { font: 'SimHei', fontSizePt: 18, bold: true },
    heading2: { font: 'SimHei', fontSizePt: 12, bold: true },
    heading3: { fontSizePt: 11, bold: true },
    instructions: { fontSizePt: 10.5 },
    caption: { fontSizePt: 10 },
    footer: { fontSizePt: 9 },
  },
} satisfies LayoutTemplate & { id: string; name: string };

export function styleFor(template: LayoutTemplate, kind: ElementKind): TextStyle {
  const style: TextStyle = { font: template.font };
  const own = template.styles?.[kind];
  const body = own?.inheritBody === false ? undefined : template.styles?.body;
  for (const overrides of [body, own]) {
    Object.assign(style, Object.fromEntries(Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)));
  }
  if (own?.font) {
    style.fontChinese = own.fontChinese;
    style.fontEnglish = own.fontEnglish;
    style.fontPunctuation = own.fontPunctuation;
  }
  if (kind === 'formula' && template.formulaMode !== 'latex' && style.font === 'SimSun'
    && own?.font === undefined && body?.font === undefined) {
    style.font = 'Cambria Math';
  }
  if (kind === 'formula') {
    delete style.fontChinese;
    delete style.fontEnglish;
    delete style.fontPunctuation;
  }
  return style;
}

export const styleDefaults = {
  color: '#000000', letterSpacingPt: 0, firstLineIndentMm: 0,
  minLineHeightRatio: 1.1,
  footerDistanceMm: 5,
  fixedBodyFontSizePt: 11,
  flowFontSizePt: { body: 11, heading1: 16, heading: 13, footer: 9 },
};

export const usesBodyFontSize = (kind: ElementKind) => kind === 'body' || kind === 'stem' || kind === 'option';

export function marginsFor(template: LayoutTemplate) {
  return template.margins ?? { top: template.marginMm, right: template.marginMm, bottom: template.marginMm, left: template.marginMm };
}

function within(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTemplate(body: unknown): LayoutTemplate & { name: string } {
  if (!object(body)) throw new Error('模板必须是 JSON 对象。');
  const { name, widthMm, heightMm, font, showPageMarks } = body;
  const mode = body.mode ?? 'fixed';
  const formulaMode = body.formulaMode ?? 'editable';
  const margin = body.marginMm ?? 0;
  const footer = body.footer ?? '';
  const footerDistanceMm = body.footerDistanceMm ?? styleDefaults.footerDistanceMm;
  const markerWidth = body.markerWidth ?? 'preserve';
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || typeof font !== 'string' || !font.trim() || font.length > 64
    || !within(widthMm, 40, 558) || (heightMm !== null && !within(heightMm, 40, 558)) || !within(margin, 0, 250)
    || typeof showPageMarks !== 'boolean' || (mode !== 'fixed' && mode !== 'flow')
    || (formulaMode !== 'editable' && formulaMode !== 'latex' && formulaMode !== 'image')
    || typeof footer !== 'string' || footer.length > 200 || !within(footerDistanceMm, 0, 100)
    || (markerWidth !== 'preserve' && markerWidth !== 'full' && markerWidth !== 'half')) throw new Error('请检查模板名称、纸张、字体或标点设置。');

  const edges = body.margins ?? { top: margin, right: margin, bottom: margin, left: margin };
  if (!object(edges) || !within(edges.top, 0, 250) || !within(edges.right, 0, 250) || !within(edges.bottom, 0, 250) || !within(edges.left, 0, 250)
    || edges.left + edges.right >= widthMm || edges.top + edges.bottom >= (heightMm ?? widthMm)) throw new Error('页边距必须给正文留出空间。');
  const styles: NonNullable<LayoutTemplate['styles']> = {};
  if (body.styles !== undefined) {
    if (!object(body.styles)) throw new Error('元素样式格式不正确。');
    for (const kind of elementKinds) {
      const value = body.styles[kind];
      if (value === undefined) continue;
      if (!object(value)) throw new Error(`「${elementLabels[kind]}」的样式格式不正确。`);
      const { inheritBody, font, fontChinese, fontEnglish, fontPunctuation, fontSizePt, letterSpacingPt, lineSpacing, lineSpacingPt, spaceBeforePt, spaceAfterPt,
        leftIndentMm, rightIndentMm, firstLineIndentMm, alignment, color, bold, underline } = value;
      if ([font, fontChinese, fontEnglish, fontPunctuation].some(face => face !== undefined && (typeof face !== 'string' || !face.trim() || face.length > 64))
        || (fontSizePt !== undefined && !within(fontSizePt, 4, 72))
        || (letterSpacingPt !== undefined && !within(letterSpacingPt, -2, 8))
        || (lineSpacing !== undefined && !within(lineSpacing, 0.8, 4))
        || (lineSpacingPt !== undefined && !within(lineSpacingPt, 1, 200))
        || [spaceBeforePt, spaceAfterPt].some(number => number !== undefined && !within(number, 0, 120))
        || [leftIndentMm, rightIndentMm].some(number => number !== undefined && !within(number, 0, 100))
        || (firstLineIndentMm !== undefined && !within(firstLineIndentMm, -60, 60))
        || (alignment !== undefined && !['left', 'center', 'right', 'justify'].includes(String(alignment)))
        || (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)))
        || (bold !== undefined && typeof bold !== 'boolean') || (underline !== undefined && typeof underline !== 'boolean')
        || (inheritBody !== undefined && typeof inheritBody !== 'boolean')) {
        throw new Error(`请检查「${elementLabels[kind]}」的样式设置。`);
      }
      styles[kind] = { inheritBody: kind === 'body' ? undefined : inheritBody as boolean | undefined,
        font: typeof font === 'string' ? font.trim() : undefined, fontSizePt: fontSizePt as number | undefined,
        fontChinese: typeof fontChinese === 'string' ? fontChinese.trim() : undefined,
        fontEnglish: typeof fontEnglish === 'string' ? fontEnglish.trim() : undefined,
        fontPunctuation: typeof fontPunctuation === 'string' ? fontPunctuation.trim() : undefined,
        letterSpacingPt: letterSpacingPt as number | undefined, lineSpacing: lineSpacing as number | undefined, firstLineIndentMm: firstLineIndentMm as number | undefined,
        lineSpacingPt: lineSpacingPt as number | undefined, spaceBeforePt: spaceBeforePt as number | undefined, spaceAfterPt: spaceAfterPt as number | undefined,
        leftIndentMm: leftIndentMm as number | undefined, rightIndentMm: rightIndentMm as number | undefined, alignment: alignment as TextStyle['alignment'],
        color: typeof color === 'string' ? color.toUpperCase() : undefined, bold: bold as boolean | undefined, underline: underline as boolean | undefined };
    }
  }
  return { name: name.trim(), widthMm, heightMm, marginMm: margin, margins: { top: edges.top, right: edges.right, bottom: edges.bottom, left: edges.left },
    font: font.trim(), showPageMarks, mode, formulaMode, footer: footer.trim(), footerDistanceMm, markerWidth, styles };
}

export function formatMarker(text: string, kind: ElementKind, width: LayoutTemplate['markerWidth']) {
  if (!width || width === 'preserve') return text;
  if (kind === 'option') return text.replace(/^([A-GＡ-Ｇ])\s*([.．、)）])\s*/u, (_, letter, dot) => {
    const closing = dot === ')' || dot === '）';
    return letter + (closing ? (width === 'full' ? '）' : ')') : width === 'full' ? '．' : '.');
  });
  if (kind === 'stem' || kind === 'body') return text.replace(/^([0-9０-９]{1,3})[.．、](?=\s|[\p{Script=Han}A-Za-z（(]|$)\s*/u,
    (_, number) => number + (width === 'full' ? '．' : '.'));
  return text;
}

export function parseTemplateFile(body: unknown): LayoutTemplate & { name: string } {
  if (!object(body) || body.version !== 1 || body.format !== 'typesetting-template') {
    throw new Error('无法识别模板文件，请选择本站导出的模板 JSON。');
  }
  return parseTemplate(body.template);
}
