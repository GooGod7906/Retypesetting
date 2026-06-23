import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ImageRun,
  PageOrientation,
  Footer,
  PageNumber,
} from 'docx';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { FormatTemplate, FontSettings } from '../types/template';

interface TableCellData {
  text: string;
  rowSpan?: number;
  colSpan?: number;
}

interface ContentBlock {
  type: 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'paragraph' | 'table' | 'image' | 'formula' | 'list';
  content: string;
  level?: number;
  items?: string[];
  rows?: TableCellData[][];
  imageUrl?: string;
  imageData?: Buffer;
}

/**
 * 从图片 Buffer 中检测宽高（支持 PNG / JPEG / GIF / BMP / WEBP）
 * 返回 { width, height } 像素值，检测失败返回 null
 */
function detectImageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;

  // PNG: 8-byte signature, then IHDR chunk (width at offset 16, height at offset 20, big-endian)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w > 0 && h > 0) return { width: w, height: h };
  }

  // JPEG: starts with FF D8, scan for SOF marker (FF C0-C3)
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    while (offset < buf.length - 9) {
      if (buf[offset] !== 0xFF) { offset++; continue; }
      const marker = buf[offset + 1];
      // SOF0-SOF3
      if (marker >= 0xC0 && marker <= 0xC3) {
        const h = buf.readUInt16BE(offset + 5);
        const w = buf.readUInt16BE(offset + 7);
        if (w > 0 && h > 0) return { width: w, height: h };
      }
      // skip to next marker
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }

  // GIF: "GIF8", width at offset 6, height at offset 8 (little-endian)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    const w = buf.readUInt16LE(6);
    const h = buf.readUInt16LE(8);
    if (w > 0 && h > 0) return { width: w, height: h };
  }

  // BMP: "BM", width at offset 18, height at offset 22 (little-endian)
  if (buf[0] === 0x42 && buf[1] === 0x4D) {
    const w = buf.readUInt32LE(18);
    const h = Math.abs(buf.readInt32LE(22));
    if (w > 0 && h > 0) return { width: w, height: h };
  }

  // WEBP: "RIFF....WEBP", VP8 lossy: width/height at offset 26
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    // VP8 lossy
    if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x20) {
      const w = buf.readUInt16LE(26) & 0x3FFF;
      const h = buf.readUInt16LE(28) & 0x3FFF;
      if (w > 0 && h > 0) return { width: w, height: h };
    }
    // VP8L lossless
    if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x4C && buf.length > 25) {
      const bits = buf.readUInt32LE(21);
      const w = (bits & 0x3FFF) + 1;
      const h = ((bits >> 14) & 0x3FFF) + 1;
      if (w > 0 && h > 0) return { width: w, height: h };
    }
  }

  return null;
}

/**
 * 计算图片适配尺寸（像素），保持宽高比。
 * 最大宽度 = 500px，最大高度 = 400px。
 * @returns { width, height } 像素值，供 docx ImageRun 使用
 */
function calcFittedImageSize(imgBuf: Buffer): { width: number; height: number } {
  const MAX_W = 200;
  const MAX_H = 200;
  const DEFAULT_W = 150;
  const DEFAULT_H = 100;

  const detected = detectImageSize(imgBuf);
  if (!detected) {
    return { width: DEFAULT_W, height: DEFAULT_H };
  }

  let { width: w, height: h } = detected;

  // 按宽度缩放
  if (w > MAX_W) {
    h = Math.round(h * (MAX_W / w));
    w = MAX_W;
  }
  // 按高度缩放
  if (h > MAX_H) {
    w = Math.round(w * (MAX_H / h));
    h = MAX_H;
  }

  return { width: Math.max(w, 1), height: Math.max(h, 1) };
}

function parseInlineSegments(text: string, settings: FontSettings, addBreak = false): TextRun[] {
  const processed = text.replace(/\\_/g, '_');
  const runs: TextRun[] = [];
  const cfg = {
    font: settings.chineseFont || settings.englishFont || 'SimSun',
    size: settings.fontSize * 2,
    bold: settings.bold,
    italics: settings.italic,
    color: (settings.color || '#000000').replace('#', ''),
    characterSpacing: settings.letterSpacing ? settings.letterSpacing * 20 : undefined,
  };

  const mkRun = (t: string, opts: any = {}) => new TextRun({ ...cfg, text: t, ...opts });

  // ^内容+空格 → 上标，_内容+空格 → 下标，连续下划线不匹配
  const regex = /\^([^\s{}_]+)\s|(?<!_)_([^\s{}]+)\s(?!_)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let first = true;

  while ((m = regex.exec(processed)) !== null) {
    if (m.index > lastIndex) {
      const before = processed.slice(lastIndex, m.index);
      if (before) { runs.push(mkRun(before, { break: addBreak && first ? 1 : undefined })); first = false; }
    }
    const isSuper = m[1] !== undefined;
    runs.push(mkRun(isSuper ? m[1] : m[2], { superScript: isSuper, subScript: !isSuper, break: addBreak && first ? 1 : undefined }));
    first = false;
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < processed.length) {
    const remaining = processed.slice(lastIndex);
    if (remaining) runs.push(mkRun(remaining, { break: addBreak && first ? 1 : undefined }));
  }

  if (runs.length === 0) runs.push(mkRun(processed, { break: addBreak ? 1 : undefined }));

  return runs;
}

/**
 * 从 URL 下载图片为 Buffer
 */
function downloadImage(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      // 跟随重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location).then(resolve);
        return;
      }
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      } else {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * 解析 HTML 表格为 TableCellData 二维数组（行×列），支持 rowspan / colspan
 */
function parseHtmlTable(html: string): TableCellData[][] {
  const rows: TableCellData[][] = [];
  // 匹配 <tr>...</tr>
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const cells: TableCellData[] = [];
    // 匹配完整的 <td ...>...</td> 或 <th ...>...</th>
    const cellRe = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      const attrs = cellMatch[1];
      const text = cellMatch[2].replace(/<[^>]+>/g, '').trim();
      const rsMatch = attrs.match(/rowspan\s*=\s*["']?(\d+)/i);
      const csMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
      const cell: TableCellData = { text };
      if (rsMatch) cell.rowSpan = parseInt(rsMatch[1], 10);
      if (csMatch) cell.colSpan = parseInt(csMatch[1], 10);
      cells.push(cell);
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  return rows;
}

/**
 * 将 LaTeX 公式转为可读文本（供行内公式和独立公式共用）
 */
function convertFormulaToText(formula: string): string {
  return formula
    // 结构类（带花括号参数）
    .replace(/\\boxed\s*\{([^}]*)\}/g, '[$1]')
    .replace(/\\xrightarrow\s*\{([^}]*)\}/g, '→($1)')
    .replace(/\\xleftarrow\s*\{([^}]*)\}/g, '←($1)')
    .replace(/\\xleftrightarrow\s*\{([^}]*)\}/g, '↔($1)')
    .replace(/\\overrightarrow\s*\{([^}]*)\}/g, '→($1)')
    .replace(/\\overleftarrow\s*\{([^}]*)\}/g, '←($1)')
    .replace(/\\overline\s*\{([^}]*)\}/g, '‾($1)')
    .replace(/\\underline\s*\{([^}]*)\}/g, '_($1)')
    .replace(/\\hat\s*\{([^}]*)\}/g, '^($1)')
    .replace(/\\vec\s*\{([^}]*)\}/g, '→($1)')
    .replace(/\\dot\s*\{([^}]*)\}/g, '·($1)')
    .replace(/\\ddot\s*\{([^}]*)\}/g, '··($1)')
    .replace(/\\tilde\s*\{([^}]*)\}/g, '~($1)')
    .replace(/\\widetilde\s*\{([^}]*)\}/g, '~($1)')
    .replace(/\\widehat\s*\{([^}]*)\}/g, '^($1)')
    // OCR 丢失花括号的变体：\boxed\text内容、\xrightarrow① 等
    .replace(/\\boxed\s*\\text\s*([^\s\\{]+)/g, '[$1]')
    .replace(/\\xrightarrow\s*([①②③④⑤⑥⑦⑧⑨⑩])/g, '→$1')
    .replace(/\\xleftarrow\s*([①②③④⑤⑥⑦⑧⑨⑩])/g, '←$1')
    // 文本/字体类 — 保留内容
    .replace(/\\text\s*\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\s*\{([^}]*)\}/g, '$1')
    .replace(/\\textbf\s*\{([^}]*)\}/g, '$1')
    .replace(/\\textit\s*\{([^}]*)\}/g, '$1')
    .replace(/\\mathbf\s*\{([^}]*)\}/g, '$1')
    .replace(/\\mathit\s*\{([^}]*)\}/g, '$1')
    .replace(/\\mathcal\s*\{([^}]*)\}/g, '$1')
    .replace(/\\mathbb\s*\{([^}]*)\}/g, (_, content) => {
      const bb: Record<string, string> = {
        'R': 'ℝ', 'N': 'ℕ', 'Z': 'ℤ', 'Q': 'ℚ', 'C': 'ℂ', 'P': 'ℙ',
      };
      return content.split('').map((c: string) => bb[c] || c).join('');
    })
    .replace(/\\mathfrak\s*\{([^}]*)\}/g, '$1')
    .replace(/\\boldsymbol\s*\{([^}]*)\}/g, '$1')
    .replace(/\\bm\s*\{([^}]*)\}/g, '$1')
    // \text 无花括号（OCR 丢失）：\text果汁 → 果汁
    .replace(/\\text\s+([^\s\\{}]+)/g, '$1')
    .replace(/\\mathrm\s+([^\s\\{}]+)/g, '$1')
    // 分数/根号
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\dfrac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\cfrac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^}]*)\}/g, '√($1)')
    .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^}]*)\}/g, '$1√($2)')
    // 大型运算符
    .replace(/\\sum(?=\s|[_^\\{]|$)/g, 'Σ')
    .replace(/\\prod(?=\s|[_^\\{]|$)/g, 'Π')
    .replace(/\\int(?=\s|[_^\\{]|$)/g, '∫')
    .replace(/\\iint(?=\s|[_^\\{]|$)/g, '∬')
    .replace(/\\oint(?=\s|[_^\\{]|$)/g, '∮')
    .replace(/\\lim(?=\s|[_^\\{]|$)/g, 'lim')
    .replace(/\\infty/g, '∞')
    .replace(/\\partial/g, '∂')
    .replace(/\\nabla/g, '∇')
    // 箭头
    .replace(/\\rightarrow|\\to(?=\s|[^a-zA-Z]|$)/g, '→')
    .replace(/\\leftarrow/g, '←')
    .replace(/\\leftrightarrow/g, '↔')
    .replace(/\\Rightarrow/g, '⇒')
    .replace(/\\Leftarrow/g, '⇐')
    .replace(/\\Leftrightarrow/g, '⇔')
    .replace(/\\uparrow/g, '↑')
    .replace(/\\downarrow/g, '↓')
    // 三角/对数函数
    .replace(/\\(sin|cos|tan|cot|sec|csc|log|ln|lim|max|min|exp|sup|inf)\b/g, '$1')
    .replace(/\\(arcsin|arccos|arctan)\b/g, '$1')
    // 上下标
    .replace(/\^(\{[^}]*\}|[a-zA-Z0-9])/g, (_, exp) => {
      const e = exp.replace(/[{}]/g, '');
      return `^${e}`;
    })
    .replace(/_(\{[^}]*\}|[a-zA-Z0-9])/g, (_, sub) => {
      const s = sub.replace(/[{}]/g, '');
      return `_${s}`;
    })
    // 换行和空格
    .replace(/\\\\/g, '')
    .replace(/\\[,;!\s]/g, ' ')
    .replace(/\\(quad|qquad|enspace|thinspace)/g, '  ')
    // 运算符
    .replace(/\\(cdot|times|div|pm|mp|ast|star|circ|bullet|oplus|otimes)/g, (m) => {
      const ops: Record<string, string> = {
        '\\cdot': '·', '\\times': '×', '\\div': '÷', '\\pm': '±', '\\mp': '∓',
        '\\ast': '∗', '\\star': '⋆', '\\circ': '∘', '\\bullet': '•',
        '\\oplus': '⊕', '\\otimes': '⊗',
      };
      return ops[m] || m;
    })
    // 关系符
    .replace(/\\(leq|geq|neq|approx|equiv|sim|simeq|cong|propto|ll|gg|subset|supset|subseteq|supseteq|in|notin|perp|parallel)/g, (m) => {
      const syms: Record<string, string> = {
        '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈',
        '\\equiv': '≡', '\\sim': '∼', '\\simeq': '≃', '\\cong': '≅',
        '\\propto': '∝', '\\ll': '≪', '\\gg': '≫',
        '\\subset': '⊂', '\\supset': '⊃', '\\subseteq': '⊆', '\\supseteq': '⊇',
        '\\in': '∈', '\\notin': '∉', '\\perp': '⊥', '\\parallel': '∥',
      };
      return syms[m] || m;
    })
    // 希腊字母
    .replace(/\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)/g, (m) => {
      const greek: Record<string, string> = {
        '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
        '\\epsilon': 'ε', '\\varepsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η',
        '\\theta': 'θ', '\\vartheta': 'ϑ', '\\iota': 'ι', '\\kappa': 'κ',
        '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ',
        '\\pi': 'π', '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ',
        '\\upsilon': 'υ', '\\phi': 'φ', '\\varphi': 'φ', '\\chi': 'χ',
        '\\psi': 'ψ', '\\omega': 'ω',
        '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ',
        '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Upsilon': 'Υ',
        '\\Phi': 'Φ', '\\Psi': 'Ψ', '\\Omega': 'Ω',
      };
      return greek[m] || m;
    })
    // 集合/逻辑
    .replace(/\\(emptyset|cap|cup|setminus|complement|forall|exists|neg|land|lor)/g, (m) => {
      const syms: Record<string, string> = {
        '\\emptyset': '∅', '\\cap': '∩', '\\cup': '∪', '\\setminus': '∖',
        '\\complement': '∁', '\\forall': '∀', '\\exists': '∃',
        '\\neg': '¬', '\\land': '∧', '\\lor': '∨',
      };
      return syms[m] || m;
    })
    // 杂项符号
    .replace(/\\(angle|triangle|degree|prime|dagger|ell|hbar|Im|Re|aleph)/g, (m) => {
      const syms: Record<string, string> = {
        '\\angle': '∠', '\\triangle': '△', '\\degree': '°', '\\prime': '′',
        '\\dagger': '†', '\\ell': 'ℓ', '\\hbar': 'ℏ', '\\Im': 'ℑ', '\\Re': 'ℜ', '\\aleph': 'ℵ',
      };
      return syms[m] || m;
    })
    // 括号修饰
    .replace(/\\left\s*([([{|])/g, '$1')
    .replace(/\\right\s*([)\]}|])/g, '$1')
    // 环境标记
    .replace(/\\begin\s*\{[^}]*\}/g, '')
    .replace(/\\end\s*\{[^}]*\}/g, '')
    // 其余未知命令：去掉反斜杠，保留命令名
    .replace(/\\([a-zA-Z]+)/g, '$1')
    // 最后移除剩余花括号
    .replace(/[{}]/g, '')
    .trim();
}

/**
 * 解析 Markdown 内容为结构化块
 */
async function parseMarkdownToBlocks(markdown: string, imagesDir?: string): Promise<ContentBlock[]> {
  const lines = markdown.split('\n');
  const blocks: ContentBlock[] = [];
  let currentParagraph = '';
  let inTable = false;
  let tableRows: TableCellData[][] = [];
  let inHtmlTable = false;
  let htmlTableLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 标题 — 必须从最长前缀开始匹配，否则 ## 会被 # 先捕获
    if (line.startsWith('#### ')) {
      flushParagraph();
      blocks.push({ type: 'heading4', content: line.slice(5).trim() });
      continue;
    }
    if (line.startsWith('### ')) {
      flushParagraph();
      blocks.push({ type: 'heading3', content: line.slice(4).trim() });
      continue;
    }
    if (line.startsWith('## ')) {
      flushParagraph();
      blocks.push({ type: 'heading2', content: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith('# ')) {
      flushParagraph();
      blocks.push({ type: 'heading1', content: line.slice(2).trim() });
      continue;
    }

    // HTML 表格 <table>...</table>
    if (line.includes('<table')) {
      flushParagraph();
      htmlTableLines = [line];
      // 单行 HTML 表格：开闭标签在同一行
      if (line.includes('</table>')) {
        const htmlRows = parseHtmlTable(line);
        if (htmlRows.length > 0) {
          blocks.push({ type: 'table', content: '', rows: htmlRows });
        }
        htmlTableLines = [];
      } else {
        inHtmlTable = true;
      }
      continue;
    }
    if (inHtmlTable) {
      htmlTableLines.push(line);
      if (line.includes('</table>')) {
        inHtmlTable = false;
        const htmlRows = parseHtmlTable(htmlTableLines.join('\n'));
        if (htmlRows.length > 0) {
          blocks.push({ type: 'table', content: '', rows: htmlRows });
        }
        htmlTableLines = [];
      }
      continue;
    }

    // 图片
    const imgMatch = line.match(/!\[.*?\]\((.*?)\)/);
    if (imgMatch) {
      flushParagraph();
      const rawPath = imgMatch[1];
      // URL 图片：直接下载
      if (/^https?:\/\//.test(rawPath)) {
        const data = await downloadImage(rawPath);
        if (data) {
          blocks.push({ type: 'image', content: rawPath, imageData: data });
        }
      } else if (imagesDir) {
        // 本地图片：尝试多种路径解析
        const candidates = [
          path.join(imagesDir, rawPath),                        // imagesDir + 原始路径
          path.join(imagesDir, path.basename(rawPath)),         // imagesDir + 文件名（去掉 images/ 前缀）
          path.resolve(imagesDir, '..', rawPath),               // 上级目录 + 原始路径
        ];
        let found = false;
        for (const imgPath of candidates) {
          if (fs.existsSync(imgPath)) {
            blocks.push({
              type: 'image',
              content: rawPath,
              imageData: fs.readFileSync(imgPath),
            });
            found = true;
            break;
          }
        }
        if (!found) {
          console.warn('[Format] Image not found:', rawPath, 'tried:', candidates);
        }
      }
      continue;
    }

    // 表格
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        flushParagraph();
        inTable = true;
        tableRows = [];
      }
      // 跳过分隔行
      if (line.includes('---')) continue;
      const cells = line
        .split('|')
        .filter((c) => c.trim() !== '')
        .map((c) => ({ text: c.trim() }));
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      inTable = false;
      blocks.push({ type: 'table', content: '', rows: tableRows });
      tableRows = [];
    }

    // 公式块 $$...$$
    if (line.startsWith('$$')) {
      flushParagraph();
      let formula = line.slice(2);
      if (formula.endsWith('$$')) {
        // 开闭 $$ 在同一行
        formula = formula.slice(0, -2);
      } else {
        // 开始 $$ 在行首，向后寻找闭合 $$
        let closed = false;
        i++;
        while (i < lines.length) {
          const subLine = lines[i];
          if (subLine.trim().startsWith('$$')) {
            // 闭合 $$ 在此行行首（此行无公式内容）
            closed = true;
            break;
          }
          const closeIdx = subLine.indexOf('$$');
          if (closeIdx !== -1) {
            // 闭合 $$ 在此行中间
            if (closeIdx > 0) {
              formula += '\n' + subLine.slice(0, closeIdx);
            }
            closed = true;
            break;
          }
          formula += '\n' + subLine;
          i++;
        }
        if (!closed) {
          console.warn('[Format] Unclosed $$ formula block, consumed', formula.split('\n').length, 'lines');
        }
      }
      blocks.push({ type: 'formula', content: formula.trim() });
      continue;
    }

    // 行内公式 $...$ （非 $$）— 转为可读文本保留在段落内
    if (line.includes('$') && !line.startsWith('$$')) {
      const inlineFormulaRe = /\$([^$\n]+)\$/g;
      let inlineMatch: RegExpExecArray | null;
      let lastEnd = 0;
      let hasInline = false;
      let convertedLine = '';
      while ((inlineMatch = inlineFormulaRe.exec(line)) !== null) {
        hasInline = true;
        const before = line.slice(lastEnd, inlineMatch.index);
        convertedLine += before;
        // 将行内公式转为可读文本，保留在段落中
        convertedLine += convertFormulaToText(inlineMatch[1]);
        lastEnd = inlineMatch.index + inlineMatch[0].length;
      }
      if (hasInline) {
        convertedLine += line.slice(lastEnd);
        // 替换当前行，继续作为普通段落累积
        lines[i] = convertedLine.trim();
        i--; // 回退一行重新处理
        continue;
      }
    }

    // 空行 = 段落结束
    if (line === '') {
      flushParagraph();
      continue;
    }

    // 累积段落内容
    if (currentParagraph) {
      currentParagraph += ' ' + line;
    } else {
      currentParagraph = line;
    }
  }

  flushParagraph();

  if (inTable && tableRows.length > 0) {
    blocks.push({ type: 'table', content: '', rows: tableRows });
  }

  return blocks;

  function flushParagraph() {
    if (currentParagraph.trim()) {
      blocks.push({ type: 'paragraph', content: currentParagraph.trim() });
      currentParagraph = '';
    }
  }
}

/**
 * 创建文本运行数组，解析上标/下标标记。
 */
function createTextRuns(text: string, settings: FontSettings, addBreak = false): TextRun[] {
  return parseInlineSegments(text, settings, addBreak);
}

/**
 * 创建单个 TextRun（用于不需要上标/下标的场景）。
 */
function createTextRun(text: string, settings: FontSettings, addBreakBefore = false): TextRun {
  return new TextRun({
    text,
    font: settings.chineseFont || settings.englishFont || 'SimSun',
    size: settings.fontSize * 2,
    bold: settings.bold,
    italics: settings.italic,
    color: (settings.color || '#000000').replace('#', ''),
    characterSpacing: settings.letterSpacing ? settings.letterSpacing * 20 : undefined,
    break: addBreakBefore ? 1 : undefined,
  });
}

/**
 * 将段落文本按选项标记分割，在每个选项前插入换行。
 * 匹配 A-G 的 A. / A、/ A）等常见格式，不要求前面有空格。
 */
function splitAtOptionA(text: string): string[] {
  const regex = /([A-Ga-g][.、）)])/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    lastIndex = match.index;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.filter(Boolean);
}

// 匹配选项标记：A. A、A）A) 等，不要求前面有空格
const OPTION_MARKER_RE = /([A-Ga-g][.、）)])/;

/**
 * 从段落中分离题干和选项。
 * 返回 { question, options[] }，若无选项则 options 为空。
 */
function extractOptions(text: string): { question: string; options: string[] } {
  const m = text.match(OPTION_MARKER_RE);
  if (!m || m.index === undefined) {
    return { question: text, options: [] };
  }
  const question = text.slice(0, m.index).trim();
  const rest = text.slice(m.index);
  // 按选项标记拆分：保留标记和内容配对
  const parts = rest.split(OPTION_MARKER_RE).filter(Boolean);
  const options: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (/^[A-Ga-g][.、）)]$/.test(parts[i])) {
      // 选项标记，下一个元素是内容
      const content = (i + 1 < parts.length) ? parts[i + 1].trim() : '';
      options.push(parts[i] + content);
      i++; // 跳过内容
    } else if (parts[i].trim()) {
      options.push(parts[i].trim());
    }
  }
  return { question, options };
}

/**
 * 估算文本等效字符宽度（中文=2, 英文/数字/标点=1）。
 */
function estimateCharWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += /[一-鿿　-〿＀-￯]/.test(ch) ? 2 : 1;
  }
  return w;
}

/**
 * 根据选项布局模式，将段落内容拆分为多个段落文本。
 * - default: 仅在 A 选项前换行（返回单元素数组，由 TextRun break 处理）
 * - even: 智能均匀分布
 */
function reformatParagraph(text: string, optionLayout: 'default' | 'even', bodyFontSize: number): string[] {
  if (optionLayout === 'default') {
    return [text];
  }

  const { question, options } = extractOptions(text);
  if (options.length === 0) {
    return [text];
  }

  // A4 可用宽度约 160mm，中文字符宽度 ≈ fontSize * 0.35mm
  // 每行可用等效字符数 ≈ 160 / (fontSize * 0.35) / 2（中文字符占2宽度）
  const charWidth = bodyFontSize * 0.35; // 单个中文字符的 mm 宽度
  const availableChars = Math.floor(160 / charWidth / 2);

  // 题干宽度
  const questionWidth = question ? estimateCharWidth(question) : 0;

  // 检查题干 + 所有选项能否放一行（间隔 2 字符）
  const totalWidth = questionWidth + options.reduce((s, o) => s + estimateCharWidth(o), 0) + (options.length - 1) * 2;
  if (totalWidth <= availableChars) {
    // 题干 + 所有选项一行放得下
    const parts = question ? [question, ...options] : options;
    return [parts.join('  ')];
  }

  // 检查仅选项能否一行放下（不含题干）
  const optionsOnlyWidth = options.reduce((s, o) => s + estimateCharWidth(o), 0) + (options.length - 1) * 2;
  if (optionsOnlyWidth <= availableChars) {
    // 选项一行放得下，题干单独一行
    return question ? [question, options.join('  ')] : [options.join('  ')];
  }

  // 检查能否两个选项一行
  let canFitTwo = true;
  for (let i = 0; i < options.length; i += 2) {
    const pair = options.slice(i, i + 2);
    const pairW = pair.reduce((s, o) => s + estimateCharWidth(o), 0) + 2;
    if (pairW > availableChars) {
      canFitTwo = false;
      break;
    }
  }
  if (canFitTwo) {
    const lines: string[] = [];
    if (question) lines.push(question);
    for (let i = 0; i < options.length; i += 2) {
      lines.push(options.slice(i, i + 2).join('  '));
    }
    return lines;
  }

  // 每行一个选项
  return question ? [question, ...options] : [...options];
}

/**
 * 根据模板生成 DOCX
 */
export async function generateDocx(
  markdown: string,
  template: FormatTemplate,
  outputDir: string,
  imagesDir?: string
): Promise<string> {
  const blocks = await parseMarkdownToBlocks(markdown, imagesDir);
  const { fonts, paragraphSettings, pageSettings, styles } = template;

  const children: (Paragraph | Table)[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'heading1': {
        const h1 = fonts.headings.level1;
        children.push(
          new Paragraph({
            children: [createTextRun(block.content, h1)],
            heading: HeadingLevel.HEADING_1,
            alignment: h1.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 240, after: 120, line: (h1.lineSpacing ?? 1.5) * 240 },
          })
        );
        break;
      }

      case 'heading2': {
        const h2 = fonts.headings.level2;
        children.push(
          new Paragraph({
            children: [createTextRun(block.content, h2)],
            heading: HeadingLevel.HEADING_2,
            alignment: h2.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 200, after: 100, line: (h2.lineSpacing ?? 1.5) * 240 },
          })
        );
        break;
      }

      case 'heading3': {
        const h3 = fonts.headings.level3;
        children.push(
          new Paragraph({
            children: [createTextRun(block.content, h3)],
            heading: HeadingLevel.HEADING_3,
            alignment: h3.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 160, after: 80, line: (h3.lineSpacing ?? 1.5) * 240 },
          })
        );
        break;
      }

      case 'heading4': {
        const h4 = fonts.headings.level4;
        children.push(
          new Paragraph({
            children: [createTextRun(block.content, h4)],
            heading: HeadingLevel.HEADING_4,
            alignment: h4.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 120, after: 60, line: (h4.lineSpacing ?? 1.5) * 240 },
          })
        );
        break;
      }

      case 'paragraph': {
        const bodyFont = { ...fonts.body, chineseFont: fonts.body.chineseFont };
        const optionLayout = styles.optionLayout || 'default';
        const { options: detectedOpts } = extractOptions(block.content);
        const hasOptions = detectedOpts.length > 0;

        if (optionLayout === 'even' && hasOptions) {
          // 均匀模式：拆分为多个段落（题干 + 选项行），所有行均不缩进
          const lines = reformatParagraph(block.content, 'even', fonts.body.fontSize);
          for (const line of lines) {
            children.push(
              new Paragraph({
                children: createTextRuns(line, bodyFont),
                alignment: fonts.body.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
                spacing: {
                  line: paragraphSettings.lineSpacing * 240,
                  before: paragraphSettings.paragraphSpacing * 20,
                },
                // 均匀模式下所有行均不缩进
                indent: undefined,
              })
            );
          }
        } else {
          // 默认模式（或无选项时）：在选项前插入换行
          const segments = hasOptions ? splitAtOptionA(block.content) : [block.content];
          const runs: TextRun[] = [];
          segments
            .filter((seg) => seg.length > 0)
            .forEach((seg, idx) => {
              // 第一段不需要 break，后续段落需要
              const segRuns = createTextRuns(seg, bodyFont, idx > 0);
              runs.push(...segRuns);
            });
          if (runs.length > 0) {
            children.push(
              new Paragraph({
                children: runs,
                alignment: fonts.body.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
                spacing: {
                  line: paragraphSettings.lineSpacing * 240,
                  before: paragraphSettings.paragraphSpacing * 20,
                },
                // 默认模式：始终应用首行缩进（firstLine 仅影响段落第一行，即题干行）
                // 选项行使用软换行（break: 1），不会被首行缩进影响
                indent: paragraphSettings.firstLineIndent > 0
                  ? { firstLine: paragraphSettings.firstLineIndent * 56.7 }
                  : undefined,
              })
            );
          }
        }
        break;
      }

      case 'table':
        if (block.rows && block.rows.length > 0) {
          const allRows = block.rows;
          // docx 库的 Table 类会自动根据 rowSpan 插入 CONTINUE 单元格，
          // 因此只需在每个原始行中放入实际单元格，设置 rowSpan / columnSpan 即可。
          // 使用 grid 跳过被上方 rowspan 占据的单元格，避免重复插入。
          const occupied: boolean[][] = [];
          for (let r = 0; r < allRows.length; r++) occupied[r] = [];

          const tableRows: TableRow[] = allRows.map((row, r) => {
            const children: TableCell[] = [];
            let col = 0;
            for (let c = 0; c < row.length; c++) {
              // 跳过被上方 rowspan 占据的列
              while (col < occupied[r].length && occupied[r][col]) col++;
              const cell = row[c];
              const rs = cell.rowSpan || 1;
              const cs = cell.colSpan || 1;
              const isHeader = r === 0;
              const cellProps: any = {
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cell.text,
                        font: isHeader
                          ? fonts.special.tableHeader.chineseFont || fonts.body.chineseFont
                          : fonts.body.chineseFont,
                        size: isHeader
                          ? fonts.special.tableHeader.fontSize * 2
                          : fonts.body.fontSize * 2,
                        bold: isHeader ? true : undefined,
                      }),
                    ],
                    alignment: isHeader ? AlignmentType.CENTER : undefined,
                  }),
                ],
              };
              if (rs > 1) cellProps.rowSpan = rs;
              if (cs > 1) cellProps.columnSpan = cs;
              if (isHeader) {
                cellProps.shading = { fill: styles.tableStyle.headerBgColor.replace('#', '') };
              }
              children.push(new TableCell(cellProps));
              // 标记 rowspan/colspan 占据的区域
              for (let dr = 0; dr < rs; dr++) {
                for (let dc = 0; dc < cs; dc++) {
                  if (dr === 0 && dc === 0) continue;
                  const tr = r + dr;
                  const tc = col + dc;
                  if (tr < allRows.length) {
                    while (occupied[tr].length <= tc) occupied[tr].push(false);
                    occupied[tr][tc] = true;
                  }
                }
              }
              col += cs;
            }
            return new TableRow({ children });
          });

          const table = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          });
          children.push(table);
        }
        break;

      case 'image':
        if (block.imageData && block.imageData.length > 0) {
          const size = calcFittedImageSize(block.imageData);
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: block.imageData,
                  transformation: size,
                }),
              ],
              alignment: AlignmentType.CENTER,
            })
          );
        }
        break;

      case 'formula': {
        // 去除 $ 定界符
        let formulaText = block.content;
        if (formulaText.startsWith('$$') && formulaText.endsWith('$$')) {
          formulaText = formulaText.slice(2, -2).trim();
        } else if (formulaText.startsWith('$') && formulaText.endsWith('$')) {
          formulaText = formulaText.slice(1, -1).trim();
        }
        formulaText = convertFormulaToText(formulaText);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: formulaText,
                font: 'Cambria Math',
                size: fonts.special.formula.fontSize * 2,
                italics: true,
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
          })
        );
        break;
      }
    }
  }

  const orientation = pageSettings.orientation === 'landscape'
    ? PageOrientation.LANDSCAPE
    : PageOrientation.PORTRAIT;

  // 页脚
  const footer = fonts.footer || { show: false };
  console.log('[Format] Footer config:', JSON.stringify(footer));
  const sectionFooter = footer.show ? (() => {
    const format = footer.footerFormat || '-第{current}页 共{total}页-';
    const font = footer.font || 'SimSun';
    const size = (footer.fontSize || 9) * 2;
    const footerChildren: TextRun[] = [];
    // 解析格式字符串，{current} 和 {total} 为占位符
    const parts = format.split(/(\{current\}|\{total\})/);
    for (const part of parts) {
      if (part === '{current}') {
        footerChildren.push(new TextRun({ children: [PageNumber.CURRENT], font, size }));
      } else if (part === '{total}') {
        footerChildren.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size }));
      } else if (part) {
        footerChildren.push(new TextRun({ text: part, font, size }));
      }
    }
    return {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: footer.centered !== false ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: footerChildren,
          }),
        ],
      }),
    };
  })() : undefined;

  // 定义自定义标题样式，覆盖 Word 默认样式（否则 HeadingLevel 的内置字号会覆盖 TextRun 的 size）
  const headingStyles = [
    { id: 'Heading1', name: 'Heading 1', level: HeadingLevel.HEADING_1, settings: fonts.headings.level1 },
    { id: 'Heading2', name: 'Heading 2', level: HeadingLevel.HEADING_2, settings: fonts.headings.level2 },
    { id: 'Heading3', name: 'Heading 3', level: HeadingLevel.HEADING_3, settings: fonts.headings.level3 },
    { id: 'Heading4', name: 'Heading 4', level: HeadingLevel.HEADING_4, settings: fonts.headings.level4 },
  ].map(({ id, name, settings }) => ({
    id,
    name,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: {
      size: settings.fontSize * 2,
      bold: settings.bold,
      color: (settings.color || '#000000').replace('#', ''),
      font: settings.chineseFont || settings.englishFont || 'SimSun',
    },
    paragraph: {
      spacing: { line: (settings.lineSpacing ?? 1.5) * 240 },
    },
  }));

  const doc = new Document({
    styles: {
      paragraphStyles: headingStyles,
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation,
              width: (pageSettings.customWidth || getPageWidth(pageSettings.pageSize)) * 56.7,
              height: (pageSettings.customHeight || getPageHeight(pageSettings.pageSize)) * 56.7,
            },
            margin: {
              top: pageSettings.margins.top * 56.7,
              bottom: pageSettings.margins.bottom * 56.7,
              left: pageSettings.margins.left * 56.7,
              right: pageSettings.margins.right * 56.7,
            },
          },
        },
        children,
        ...(sectionFooter ? { footers: sectionFooter } : {}),
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outputPath = path.join(outputDir, 'output.docx');
  await fs.promises.writeFile(outputPath, buffer);

  return outputPath;
}

function getPageWidth(pageSize: string): number {
  switch (pageSize) {
    case 'A4': return 210;
    case 'A3': return 297;
    case 'B5': return 176;
    case 'Letter': return 216;
    default: return 210;
  }
}

function getPageHeight(pageSize: string): number {
  switch (pageSize) {
    case 'A4': return 297;
    case 'A3': return 420;
    case 'B5': return 250;
    case 'Letter': return 279;
    default: return 297;
  }
}
