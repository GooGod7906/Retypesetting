import { pipeline } from 'node:stream';
import * as unzipper from 'unzipper';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';
import type { ElementKind } from './layoutTemplate';

export type Box = [number, number, number, number];

interface Span {
  type: string;
  bbox: Box;
  content?: string;
  html?: string;
  image_path?: string;
}

interface Block {
  type: string;
  bbox: Box;
  level?: number;
  lines?: { bbox: Box; spans: Span[] }[];
  blocks?: Block[];
}

interface SourcePage {
  page_idx: number;
  page_size: [number, number];
  para_blocks?: Block[];
  discarded_blocks?: Block[];
}

export interface LayoutItem {
  id: string;
  group: number;
  line: number;
  kind: 'text' | 'image' | 'formula' | 'table';
  role: string;
  box: Box;
  level?: number;
  text?: string;
  asset?: string;
  sourceCrop?: boolean;
  sharedPosition?: boolean;
  roleOverride?: ElementKind;
  alignmentOverride?: BlockAlignment;
}

export interface LayoutPage {
  number: number;
  size: [number, number];
  items: LayoutItem[];
  approximateLines: boolean;
  mixed?: { changedText: number; pipelineImages: number; unmatchedImages: number };
  questionBlocks?: QuestionBlock[];
}

export interface QuestionBlock {
  number?: string;
  box: Box;
  lines: string[][];
}

export const questionLayouts = ['adaptive-rows', 'page-paragraphs', 'merged-options', 'separate-options', 'page-images'] as const;
export type QuestionLayout = typeof questionLayouts[number];
export const defaultQuestionLayout: QuestionLayout = 'adaptive-rows';
const optionMarker = /^[A-GＡ-Ｇ]\s*[.．、)）]/;

export type LayoutRoles = Record<string, ElementKind | null>;
export type BlockAlignment = 'center' | 'left';
export type LayoutAlignments = Record<string, BlockAlignment | null>;

const examSection = /^(?:第[一二三四五六七八九十ⅠⅡIV\d]+(?:部分|卷)|[一二三四五六七八九十]+[、.．])/u;
const examSubsection = /^第[一二三四五六七八九十ⅠⅡIV\d]+节/u;
const instructionHeading = /^(?:(?:请)?听第.{1,8}段|(?:答题)?注意[：:]|请注意[：:])/u;

export function flowHeadingStyles(page: LayoutPage, corrections: Record<string, string> = {}) {
  const textOf = (item: LayoutItem) => corrections[item.id] ?? item.text ?? '';
  const headings = page.items.filter(item => item.kind === 'text' && item.level);
  const main = page.number === 1 ? headings.find(item => item.level === 1 && item.role !== 'instructions'
    && !examSection.test(textOf(item)) && !examSubsection.test(textOf(item)) && !instructionHeading.test(textOf(item))) : undefined;
  const groups = new Map<number, LayoutItem[]>();
  for (const item of headings) {
    const group = groups.get(item.group) ?? [];
    group.push(item);
    groups.set(item.group, group);
  }
  const styles = new Map<string, { role: ElementKind; mainTitle?: boolean }>();
  for (const group of groups.values()) {
    const first = group[0];
    const value = group.map(textOf).join('').trim();
    const mainTitle = Boolean(main && (first.group === main.group || (
      first.level === 1 && first.box[1] >= main.box[3] && first.box[1] - main.box[3] <= (main.box[3] - main.box[1]) * 1.5
      && Math.abs(first.box[0] + first.box[2] - main.box[0] - main.box[2]) <= page.size[0] * .12
    )));
    let role: ElementKind;
    if (first.role === 'instructions' || instructionHeading.test(value)) role = 'instructions';
    else if (mainTitle) role = 'heading1';
    else if (value.length > 68) role = examSection.test(value) ? 'body' : 'instructions';
    else if (examSection.test(value)) role = 'heading2';
    else if (examSubsection.test(value) || first.level === 1) role = 'heading3';
    else role = `heading${Math.max(2, Math.min(9, first.level!))}` as ElementKind;
    for (const item of group) styles.set(item.id, {
      role: item.roleOverride ?? role, mainTitle: mainTitle && (!item.roleOverride || item.roleOverride === 'heading1'),
    });
  }
  return styles;
}

export function detectFooter(page: LayoutPage) {
  const footerItems = page.items.filter(item => item.kind === 'text' && item.text
    && (['footer', 'page_number'].includes(item.role) || item.box[1] >= page.size[1] * .8));
  for (const item of footerItems) {
    const height = item.box[3] - item.box[1];
    const sameLine = footerItems.filter(other => other.line === item.line
      || Math.abs(other.box[3] - item.box[3]) <= height * .28).sort((a, b) => a.box[0] - b.box[0]);
    let left = sameLine.indexOf(item), right = left;
    while (left > 0 && sameLine[left].box[0] - sameLine[left - 1].box[2] <= height * 4) left--;
    while (right + 1 < sameLine.length && sameLine[right + 1].box[0] - sameLine[right].box[2] <= height * 4) right++;
    const parts = sameLine.slice(left, right + 1);
    const value = parts.map(part => part.text!.trim()).join(' ').trim();
    if (value.length > 120) continue;
    const format = value
      .replace(/(第\s*)[0-9０-９]+(?=\s*页)/u, '$1{page}')
      .replace(/(共\s*)[0-9０-９]+(?=\s*页)/u, '$1{pages}')
      .replace(/(\bPage\s+)[0-9]+(\s+of\s+)[0-9]+/iu, '$1{page}$2{pages}');
    if (format.includes('{page}') && format.includes('{pages}')) return { format, ids: parts.map(part => part.id) };
  }
}

export const detectFooterPattern = (page: LayoutPage) => detectFooter(page)?.format;

export function applyLayoutRoles(page: LayoutPage, roles: LayoutRoles) {
  if (!Object.keys(roles).length) return;
  page.items = page.items.map(item => {
    const role = roles[item.id];
    if (!role || (item.kind !== 'text' && item.kind !== 'formula')) return item;
    const kind = role === 'formula' || (item.kind === 'formula' && (role === 'stem' || role === 'option')) ? 'formula' : 'text';
    return { ...item, role, roleOverride: role, kind,
      level: role.startsWith('heading') ? Number(role.slice(7)) : undefined,
      sourceCrop: kind === 'formula' && item.sourceCrop };
  });
  if (page.questionBlocks) page.questionBlocks = groupQuestionBlocks(page.items);
}

export function questionTextFrames(page: LayoutPage, layout: QuestionLayout = 'merged-options'): QuestionBlock[] {
  const byId = new Map(page.items.map(item => [item.id, item]));
  return (page.questionBlocks ?? groupQuestionBlocks(page.items)).flatMap(block => {
    const stem: string[][] = [];
    const options: string[][][] = [];
    let option: string[][] | undefined;
    let optionGroup: number | undefined;
    for (const line of block.lines) {
      let segment: string[] = [];
      for (const id of line) {
        const item = byId.get(id)!;
        if (item.roleOverride === 'stem' && option) {
          if (segment.length) option.push(segment);
          option = undefined;
          segment = [];
        }
        const startsOption = item.kind === 'text' && item.roleOverride !== 'stem' && optionMarker.test(item.text ?? '');
        if (startsOption || ((item.roleOverride ?? item.role) === 'option' && (!option || optionGroup !== item.group))) {
          if (segment.length) (option ?? stem).push(segment);
          option = [];
          optionGroup = item.group;
          options.push(option);
          segment = [];
        }
        segment.push(id);
      }
      if (segment.length) (option ?? stem).push(segment);
    }
    const optionLines = new Map<number, string[]>();
    for (const option of options) for (const line of option) {
      const row = block.lines.findIndex(ids => ids.includes(line[0]));
      optionLines.set(row, [...optionLines.get(row) ?? [], ...line]);
    }
    const frames = layout === 'separate-options' ? [stem, ...options] : [stem, [...optionLines.values()]];
    const optionHeight = Math.max(0, ...options.map(lines => {
      const [, top, , bottom] = groupBox(lines.flat().map(id => byId.get(id)!));
      return bottom - top;
    }));
    return frames.filter(lines => lines.length).map(lines => {
      const box: Box = [...groupBox(lines.flat().map(id => byId.get(id)!))];
      if (layout === 'separate-options' && options.includes(lines)) box[3] = box[1] + optionHeight;
      return { number: block.number, box, lines };
    });
  });
}

export function pageTextRows(page: LayoutPage): QuestionBlock {
  const items = page.items.filter(item => item.kind === 'text' || item.kind === 'formula' || (item.kind === 'table' && !item.asset && item.text));
  return { box: [0, 0, ...page.size], lines: positionRows(items) };
}

function positionRows(items: LayoutItem[]) {
  const rows: LayoutItem[][] = [];
  for (const item of [...items].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])) {
    const row = rows.find(candidate => {
      if (candidate.some(other => other.line === item.line && other.group === item.group)) return true;
      const [, top, , bottom] = candidate[0].box;
      const overlap = Math.min(bottom, item.box[3]) - Math.max(top, item.box[1]);
      return overlap >= 0.65 * Math.min(bottom - top, item.box[3] - item.box[1]);
    });
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map(row => row.sort((a, b) => a.box[0] - b.box[0]).map(item => item.id));
}

export function groupQuestionBlocks(items: LayoutItem[]): QuestionBlock[] {
  const result: QuestionBlock[] = [];
  let current: LayoutItem[] = [];
  let number: string | undefined;
  const finish = () => {
    if (!current.length) return;
    result.push({ number, box: groupBox(current), lines: positionRows(current) });
    current = [];
    number = undefined;
  };
  for (const item of items) {
    if (item.kind === 'image' || item.kind === 'table') continue;
    if (item.level || ['header', 'footer', 'page_number', 'instructions'].includes(item.role) || item.role.includes('caption')) {
      // Captions are anchored separately, even if OCR lists them amid a question.
      if (!item.role.includes('caption')) finish();
      continue;
    }
    const firstOnLine = !current.some(other => other.line === item.line && other.group === item.group);
    const nextNumber = item.kind === 'text' && item.roleOverride !== 'option' && firstOnLine
      ? item.text?.match(/^([0-9０-９]{1,3})[.．、](?=\s|[\p{Script=Han}A-Za-z（(]|$)/u)?.[1] : undefined;
    if (nextNumber || (!number && current.length && item.group !== current[0].group && item.kind !== 'formula' && item.role !== 'option')) finish();
    if (nextNumber) number = nextNumber;
    current.push(item);
  }
  finish();
  return result;
}

export const missingPositionMessage = '这个解析结果只提供部分段落的整块坐标。请使用普通段落模板，或用 Pipeline 结果做原位复刻。';

export const mixedModes = { 'mixed-fixed': 'fixed', 'mixed-flow': 'flow' } as const;
export type MixedModel = keyof typeof mixedModes;

export function mixedMode(model: string) {
  return Object.prototype.hasOwnProperty.call(mixedModes, model) ? mixedModes[model as MixedModel] : undefined;
}

function isBox(value: unknown): value is Box {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[2] > value[0] && value[3] > value[1];
}

function equationParts(raw: string): { kind: 'formula' | 'text'; text: string; sourceCrop?: boolean }[] {
  const literal = raw.match(/^(?:\\(?:text|mathrm|mathbf|operatorname)\s*\{\s*)?([\p{Script=Han}\p{P}\s]+?)\s*\}?$/u)?.[1];
  if (literal && /\p{Script=Han}/u.test(literal)) return [{ kind: 'text', text: literal.replace(/\s+/g, '') }];

  // Only split prose at the outer level. Braces can enclose legitimate math labels.
  const parts: ReturnType<typeof equationParts> = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '\\') { index++; continue; }
    if (raw[index] === '{') depth++;
    if (raw[index] === '}') depth--;
    if (depth !== 0) continue;
    const prose = raw.slice(index).match(/^[\p{Script=Han}][\p{Script=Han}，。；：、！？]*/u)?.[0];
    if (!prose) continue;
    const formula = raw.slice(start, index).trim();
    // A bare glyph directly after a script marker is ambiguous. Keep the original glyphs.
    if (/[_^]\s*$/.test(formula)) return [{ kind: 'formula', text: raw, sourceCrop: true }];
    if (formula) parts.push({ kind: 'formula', text: formula });
    parts.push({ kind: 'text', text: prose });
    index += prose.length - 1;
    start = index + 1;
  }
  const tail = raw.slice(start).trim();
  if (tail || !parts.length) parts.push({ kind: 'formula', text: tail,
    sourceCrop: /[_^]\s*\{[^{}]*\p{Script=Han}/u.test(tail) });
  return parts;
}

function resolveOverlappingFormulas(items: LayoutItem[]): LayoutItem[] {
  const lines = new Map<number, LayoutItem[]>();
  for (const item of items) {
    const line = lines.get(item.line) ?? [];
    line.push(item);
    lines.set(item.line, line);
  }
  return items.filter(item => {
    if (item.kind !== 'formula' || !item.text) return true;
    if (item.sharedPosition) {
      item.sourceCrop = false;
      return true;
    }
    const [left, top, right, bottom] = item.box;
    for (const neighbor of lines.get(item.line) ?? []) {
      if (neighbor.kind !== 'text' || !neighbor.text || !/\p{Script=Han}/u.test(neighbor.text)) continue;
      if (item.box.every((coordinate, index) => coordinate === neighbor.box[index])) continue;
      const [x0, y0, x1, y1] = neighbor.box;
      const overlap = Math.min(right, x1) - Math.max(left, x0);
      const vertical = Math.min(bottom, y1) - Math.max(top, y0);
      if (vertical < Math.min(bottom - top, y1 - y0) * 0.6
        || x1 - x0 < (right - left) * 2) continue;
      if (overlap > 0 && overlap < (right - left) * 0.8 && x0 < left && x1 < right) {
        // A formula extending past the text may contain more than the OCR suffix.
        const suffix = neighbor.text.match(/[A-Za-z][0-9₀-₉]+$/)?.[0];
        const leading = item.text.match(/^([A-Za-z])\s*_\s*\{\s*([0-9]+)\s*\}/);
        if (suffix && leading && suffix.normalize('NFKC') === leading[1] + leading[2]) {
          neighbor.text = neighbor.text.slice(0, -suffix.length);
          neighbor.box = [x0, y0, left, y1];
        }
        continue;
      }
      if (overlap < (right - left) * 0.8) continue;
      // Keep recognized fractions that fill a missing token after a phrase like “为”.
      if (/\\(?:d?frac|tfrac)\b/.test(item.text) && /[为是=][，,。；;：:]/.test(neighbor.text)) continue;
      return false;
    }
    const height = bottom - top;
    const body = (lines.get(item.line) ?? []).filter(neighbor => neighbor.kind === 'text' && /\p{Script=Han}{2}/u.test(neighbor.text ?? ''));
    const heights = body.map(({ box }) => box[3] - box[1]).sort((a, b) => a - b);
    const textHeight = heights[Math.floor(heights.length / 2)];
    const nestedAccents = item.text.match(/\\(?:dot|ddot|hat|bar|overline|underline|vec)\b/g)?.length ?? 0;
    item.sourceCrop ||= /^(?:\{\s*\}\s*)?[_^]/.test(item.text)
      || Boolean(textHeight && right - left < textHeight * 1.3 && height < textHeight * 1.7 && nestedAccents >= 3);
    return true;
  });
}

function pageLayout(source: SourcePage, splitInlineProse: boolean): LayoutPage {
  if (!Number.isInteger(source.page_idx) || source.page_idx < 0 || !Array.isArray(source.page_size)
    || source.page_size.length !== 2 || source.page_size.some(size => !Number.isFinite(size) || size <= 0)) {
    throw new Error('解析结果包含无效的页码或尺寸。');
  }
  const page: LayoutPage = { number: source.page_idx + 1, size: source.page_size, items: [], approximateLines: false };
  let group = 0;
  let lineNumber = 0;
  let inInstructions = false;
  let ordinal = 0;
  const add = (item: Omit<LayoutItem, 'id' | 'group' | 'line'>, suffix = 0) => {
    if (!suffix) ordinal++;
    page.items.push({ ...item, group, line: lineNumber, id: `${page.number}-${ordinal}${suffix ? `.${suffix}` : ''}` });
  };

  function readBlock(block: Block, level?: number) {
    const heading = block.type === 'title' ? block.level ?? 1 : level;
    for (const child of block.blocks ?? []) readBlock(child, heading);
    for (const line of block.lines ?? []) {
      lineNumber++;
      const inlineSpans = (line.spans ?? []).filter(span => span.type === 'text' || span.type === 'inline_equation');
      const positions = new Set(inlineSpans.map(span => (isBox(span.bbox) ? span.bbox : line.bbox)?.join(',')));
      const sharedPosition = inlineSpans.length > positions.size;
      if (sharedPosition) page.approximateLines = true;
      const lineText = (line.spans ?? []).map(span => span.content ?? '').join('').trim();
      if (/^(?:(?:考生)?注意事项|答题须知|答卷前|考试须知|温馨提示)/.test(lineText)) inInstructions = true;
      else if ((heading || /选择题|填空题|实验题|解答题/.test(lineText)) && /^(?:第[一二三四ⅠⅡIV\d]+[卷部分]|[一二三四五六七八九十]+[、.．]|[一二三四五六七八九十]+\s*(?:选择题|填空题))/.test(lineText)) inInstructions = false;
      for (const span of line.spans ?? []) {
        const box = isBox(span.bbox) ? span.bbox : isBox(line.bbox) ? line.bbox : block.bbox;
        if (!isBox(box)) continue;
        const raw = typeof span.content === 'string' ? span.content.trim() : '';
        const asset = span.image_path?.replace(/^images\//, '');
        const role = inInstructions && (block.type === 'text' || block.type === 'title') ? 'instructions' : block.type;
        if (span.type === 'table' || role === 'table_body') {
          add({ kind: 'table', role, box, text: span.html || raw, asset });
        } else if (span.type.includes('equation')) {
          const parts = equationParts(raw);
          if (!splitInlineProse && parts.length > 1) {
            add({ kind: 'formula', role, box, text: raw, asset, sourceCrop: true, sharedPosition });
            continue;
          }
          // Keep the original span ID and use suffixes for additional inline runs.
          const weights = parts.map(part => Math.max(1, part.kind === 'text' ? [...part.text].length * 2
            : part.text.replace(/\\[a-z]+|[{}\s]/gi, '').length));
          const total = weights.reduce((sum, weight) => sum + weight, 0);
          let x = box[0];
          for (const [index, part] of parts.entries()) {
            const right = index === parts.length - 1 ? box[2] : x + (box[2] - box[0]) * weights[index] / total;
            add({ ...part, role, box: [x, box[1], right, box[3]], asset: parts.length === 1 ? asset : undefined, sharedPosition }, index);
            x = right;
          }
        } else if (asset) {
          add({ kind: 'image', role, box, asset });
        } else if (raw) {
          const lines = raw.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
          if (lines.length > 1) page.approximateLines = true;
          const height = (box[3] - box[1]) / lines.length;
          lines.forEach((text, index) => {
            const top = box[1] + height * index;
            add({ kind: 'text', role: optionMarker.test(text) ? 'option' : role,
              box: [box[0], top, box[2], top + height], text, level: heading });
          });
        }
      }
    }
  }

  for (const block of source.para_blocks ?? []) { group++; readBlock(block); }
  for (const block of source.discarded_blocks ?? []) {
    if (['header', 'footer', 'page_number'].includes(block.type)) { group++; readBlock(block); }
  }
  page.items = resolveOverlappingFormulas(page.items);
  const items = new Map(page.items.map(item => [item.id, item]));
  for (const block of groupQuestionBlocks(page.items)) {
    let optionGroup: number | undefined;
    for (const row of block.lines) {
      let inOption = false;
      for (const id of row) {
        const item = items.get(id)!;
        if (item.role === 'option') { inOption = true; optionGroup = item.group; }
        if (inOption || item.group === optionGroup) item.role = 'option';
        else if (block.number) item.role = 'stem';
      }
    }
  }
  return page;
}

export async function openMineruArchive(filename: string, { splitInlineProse = false } = {}) {
  const zip = await unzipper.Open.file(filename);
  const entries = new Map(zip.files.filter(entry => entry.type === 'File').map(entry => [entry.path, entry]));
  const layout = entries.get('layout.json');
  if (!layout) throw new Error('MinerU 结果包缺少 layout.json。');
  return {
    entries,
    async *pages(): AsyncGenerator<LayoutPage> {
      const stream = streamArray();
      pipeline(layout.stream(), parser(), pick({ filter: 'pdf_info' }), stream, () => {});
      let lastPage = 0;
      try {
        for await (const { value } of stream) {
          const page = pageLayout(value, splitInlineProse);
          if (page.number <= lastPage) throw new Error('解析结果的页码顺序无效。');
          lastPage = page.number;
          yield page;
        }
      } finally {
        stream.destroy();
      }
    },
  };
}

function overlapRatio(a: Box, b: Box) {
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const intersection = width * height;
  return intersection / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection);
}

export interface LayoutSource {
  archive: string;
  pairedArchive?: string;
  mixedMode?: 'fixed' | 'flow';
}

function proseGroups(page: LayoutPage) {
  const groups = new Map<number, LayoutItem[]>();
  for (const item of page.items) {
    const items = groups.get(item.group) ?? [];
    items.push(item);
    groups.set(item.group, items);
  }
  return [...groups.values()].filter(items => items.every(item => item.kind === 'text' && item.text));
}

function groupBox(items: LayoutItem[]): Box {
  return items.reduce<Box>((box, { box: [left, top, right, bottom] }) => [
    Math.min(box[0], left), Math.min(box[1], top), Math.max(box[2], right), Math.max(box[3], bottom),
  ], items[0].box);
}

function proseTokens(text: string) {
  // Treat whitespace and common full-width punctuation as equivalent when finding line boundaries.
  return [...text.matchAll(/\S/gu)].map(match => ({ index: match.index!,
    value: match[0].normalize('NFKC').replace(/。/g, '.').replace(/[、]/g, ',') }));
}

function alignProse(items: LayoutItem[], replacement: string): string[] | undefined {
  const lines = items.map(item => proseTokens(item.text!));
  const original = lines.flat();
  const revised = proseTokens(replacement);
  const n = original.length;
  const m = revised.length;
  if (!n || !m || n > 600 || m > 600 || Math.abs(n - m) > n * 0.12) return;
  const cost = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Uint16Array(m + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1,
      cost[i - 1][j - 1] + Number(original[i - 1].value !== revised[j - 1].value));
  }
  if (cost[n][m] > n * 0.12) return;
  const ends = new Array<number>(n + 1);
  let i = n;
  let j = m;
  while (i > 0) {
    ends[i] ??= j;
    if (j > 0 && cost[i][j] === cost[i - 1][j - 1] + Number(original[i - 1].value !== revised[j - 1].value)) { i--; j--; }
    else if (cost[i][j] === cost[i - 1][j] + 1) i--;
    else j--;
  }
  let tokens = 0;
  let start = 0;
  const parts = lines.map(line => {
    tokens += line.length;
    const end = revised[ends[tokens]]?.index ?? replacement.length;
    const part = replacement.slice(start, end).trim();
    start = end;
    return part;
  });
  return parts.every((part, index) => part && Math.abs(proseTokens(part).length - lines[index].length) <= Math.max(1, lines[index].length * 0.2))
    ? parts : undefined;
}

function adoptVlmProse(page: LayoutPage, vlm: LayoutPage, scale: (box: Box) => Box) {
  const candidates = proseGroups(vlm).map(items => ({
    box: scale(groupBox(items)), text: items.map(item => item.text).join(' '),
  }));
  const groups = proseGroups(page).map(items => ({
    items, matches: candidates.filter(candidate => overlapRatio(groupBox(items), candidate.box) >= 0.7),
  }));
  const counts = new Map<typeof candidates[number], number>();
  for (const { matches } of groups) for (const match of matches) counts.set(match, (counts.get(match) ?? 0) + 1);
  let changed = 0;
  for (const { items, matches } of groups) {
    if (matches.length !== 1 || counts.get(matches[0]) !== 1) continue;
    const aligned = alignProse(items, matches[0].text);
    if (aligned) items.forEach((item, index) => {
      if (item.text !== aligned[index]) changed++;
      item.text = aligned[index];
    });
  }
  return changed;
}

export async function openLayoutSource(source: LayoutSource, options?: { splitInlineProse?: boolean }) {
  const base = await openMineruArchive(source.archive, options);
  if (!source.pairedArchive || !source.mixedMode) return base;
  const otherArchive = await openMineruArchive(source.pairedArchive);
  const flow = source.mixedMode === 'flow';
  const entries = new Map(base.entries);
  const aliases = new Map<string, string>();
  for (const [name, entry] of flow ? otherArchive.entries : []) {
    if (!name.startsWith('images/')) continue;
    const asset = name.slice('images/'.length);
    let alias = `paired-${asset}`;
    while (entries.has(`images/${alias}`)) alias = `paired-${alias}`;
    entries.set(`images/${alias}`, entry);
    aliases.set(asset, alias);
  }
  return {
    entries,
    async *pages(): AsyncGenerator<LayoutPage> {
      const paired = otherArchive.pages();
      try {
        let next = await paired.next();
        for await (const page of base.pages()) {
          const images = page.items.filter(item => item.kind === 'image');
          const stats = { changedText: 0, pipelineImages: flow ? 0 : images.length, unmatchedImages: flow ? images.length : 0 };
          page.mixed = stats;
          while (!next.done && next.value.number < page.number) next = await paired.next();
          if (!next.done && next.value.number === page.number) {
            const other = next.value;
            const scaleX = page.size[0] / other.size[0];
            const scaleY = page.size[1] / other.size[1];
            if (Math.abs(scaleX / scaleY - 1) < 0.02) {
              const scale = (box: Box) => box.map((value, index) => value * (index % 2 ? scaleY : scaleX)) as Box;
              if (!flow) {
                stats.changedText = adoptVlmProse(page, other, scale);
                page.questionBlocks = groupQuestionBlocks(page.items);
                yield page;
                continue;
              }
              const candidates = other.items.filter(item => item.kind === 'image' && item.asset && aliases.has(item.asset))
                .map(item => ({ asset: aliases.get(item.asset!), box: scale(item.box) }));
              const matches = page.items.map(item => item.kind === 'image' && item.asset
                ? candidates.filter(candidate => overlapRatio(item.box, candidate.box) >= 0.9) : []);
              const counts = new Map<typeof candidates[number], number>();
              for (const choices of matches) for (const choice of choices) counts.set(choice, (counts.get(choice) ?? 0) + 1);
              page.items = page.items.map((item, index) => {
                const [match] = matches[index];
                if (matches[index].length !== 1 || counts.get(match) !== 1) return item;
                stats.pipelineImages++;
                stats.unmatchedImages--;
                return { ...item, asset: match.asset, box: match.box };
              });
            }
          }
          if (!flow) page.questionBlocks = groupQuestionBlocks(page.items);
          yield page;
        }
      } finally {
        await paired.return(undefined);
      }
    },
  };
}
