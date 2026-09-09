import {
  MathFraction,
  MathSuperScript,
  MathSubScript,
  MathSubSuperScript,
  MathRadical,
  MathSum,
  MathIntegral,
  MathFunction,
  MathRoundBrackets,
  MathSquareBrackets,
  MathCurlyBrackets,
  MathComponent,
} from 'docx';
import {
  mathAccent,
  mathBar,
  mathBorderBox,
  mathDelimiter,
  mathLimitLower,
  mathLimitUpper,
  mathMatrix,
  mathRun,
} from './ommlExtras';

/**
 * 解析 LaTeX 数学公式为 docx 的 OMML（Word 原生公式）结构。
 *
 * 支持的常用子集：
 *  - 字母 / 数字 / 运算符号（+, -, *, /, =, <, > …）
 *  - 希腊字母：\alpha \beta … \Omega（以及大写）
 *  - 上下标：x_i  x^2  x_i^2  ^{2}  _{i}
 *  - 分式：\frac{a}{b}（含 \dfrac \tfrac \cfrac）、\binom
 *  - 根号：\sqrt{x}  \sqrt[n]{x}
 *  - 大型运算符：\sum \int \iint \oint（\prod \bigcup 等用符号 + 侧上下标近似）
 *  - 函数名：\sin \cos \log \ln \lim …（渲染为正体函数）
 *  - 定界符：\left( \right) / \left[ \right] / \left\{ \right\} / \left. \right|（自动拉伸）
 *  - 重音与划线：\vec \overrightarrow \overleftarrow \hat \widehat \tilde \dot \ddot \bar \overline \underline
 *  - 标注：\overset \underset \stackrel \xrightarrow \xleftarrow \boxed
 *  - 环境：matrix / pmatrix / bmatrix / vmatrix / cases / aligned / gathered / array / split …
 *  - 文本：\text{} \mathrm{} \mathbf{} \mathbb{} 等
 *
 * 不支持的构造会抛出 UnsupportedLatexError，由调用方回退为原始 LaTeX 文本，
 * 保证 docx 可正常打开、且仍可在 Word 中用 MathType 的 Alt+\ 手动转换。
 */

export class UnsupportedLatexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedLatexError';
  }
}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const SYMBOLS: Record<string, string> = {
  times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆', circ: '∘',
  bullet: '∙', oplus: '⊕', otimes: '⊗', ominus: '⊖', odot: '⊙',
  pm: '±', mp: '∓',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', asymp: '≍',
  ll: '≪', gg: '≫',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  implies: '⇒', impliedby: '⇐', iff: '⇔',
  mapsto: '↦', longrightarrow: '⟶', longleftarrow: '⟵',
  uparrow: '↑', downarrow: '↓',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
  emptyset: '∅', varnothing: '∅',
  cup: '∪', cap: '∩', subset: '⊂', supset: '⊃', sqcup: '⊔', sqcap: '⊓',
  subseteq: '⊆', supseteq: '⊇', in: '∈', notin: '∉', ni: '∋',
  setminus: '∖', complement: '∁', uplus: '⊎',
  langle: '⟨', rangle: '⟩',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  quad: ' ', qquad: '  ',
  land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  neg: '¬', lnot: '¬', top: '⊤', bot: '⊥',
  prime: '′', surd: '√', propto: '∝', aleph: 'ℵ',
  ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  angle: '∠', triangle: '△', square: '□', '|': '|',
  backslash: '\\',
  leqslant: '≤', geqslant: '≥',
  // 立体几何 / 常用关系
  perp: '⊥', parallel: '∥', nmid: '∤', nparallel: '∦', mid: '∣',
  vert: '|', Vert: '‖', lVert: '‖', rVert: '‖',
  because: '∵', therefore: '∴',
  degree: '°', ell: 'ℓ', hbar: 'ℏ', Im: 'ℑ', Re: 'ℜ',
  dagger: '†', ddagger: '‡', colon: ':',
};

// 用正体函数名渲染的命令
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'sinh', 'cosh', 'tanh', 'coth',
  'log', 'ln', 'lg', 'exp',
  'lim', 'limsup', 'liminf', 'det', 'dim', 'mod', 'gcd',
  'max', 'min', 'arg', 'ker', 'deg', 'hom', 'Pr',
]);

// 用符号 + 侧上下标近似的大型运算符（docx 仅有 MathSum / MathIntegral）
const NARY_SYMBOLS: Record<string, string> = {
  prod: '∏', coprod: '∐',
  bigcup: '⋃', bigcap: '⋂',
  bigoplus: '⊕', bigotimes: '⊗',
  bigvee: '⋁', bigwedge: '⋀', biguplus: '⊎',
};

// 黑板粗体（\mathbb）
const BLACKBOARD: Record<string, string> = {
  R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ',
};

// 重音 / 划线类命令（使用组合字符，Word 中由 Cambria Math 正常显示）
const ACCENTS: Record<string, { kind: 'acc' | 'bar'; chr?: string; pos?: 'top' | 'bot' }> = {
  vec: { kind: 'acc', chr: '\u20D7' },
  overrightarrow: { kind: 'acc', chr: '\u20D7' },
  overleftarrow: { kind: 'acc', chr: '\u20D6' },
  hat: { kind: 'acc', chr: '\u0302' },
  widehat: { kind: 'acc', chr: '\u0302' },
  tilde: { kind: 'acc', chr: '\u0303' },
  widetilde: { kind: 'acc', chr: '\u0303' },
  dot: { kind: 'acc', chr: '\u0307' },
  ddot: { kind: 'acc', chr: '\u0308' },
  check: { kind: 'acc', chr: '\u030C' },
  breve: { kind: 'acc', chr: '\u0306' },
  acute: { kind: 'acc', chr: '\u0301' },
  grave: { kind: 'acc', chr: '\u0300' },
  bar: { kind: 'bar', pos: 'top' },
  overline: { kind: 'bar', pos: 'top' },
  underline: { kind: 'bar', pos: 'bot' },
};

// 环境 → 外层定界符（矩阵类环境）
const ENV_DELIMITERS: Record<string, [string, string]> = {
  pmatrix: ['(', ')'],
  bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'],
  cases: ['{', ''],
  dcases: ['{', ''],
  rcases: ['', '}'],
};

// 网格类环境（行用 \\ 分隔，列用 & 分隔）
const GRID_ENVS = new Set([
  'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix',
  'array', 'subarray', 'cases', 'dcases', 'rcases',
  'aligned', 'align', 'align*', 'alignedat', 'gathered', 'gather', 'gather*', 'split', 'multline',
]);

// 可直接取内部内容的环境
const TRANSPARENT_ENVS = new Set(['equation', 'equation*', 'math', 'displaymath']);

// 无实际排版作用、直接忽略的命令
const IGNORED_COMMANDS = new Set([
  'limits', 'nolimits', 'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle',
  'mathstrut', 'hline', 'allowbreak', 'mathop', 'mathrel', 'mathbin', 'mathord',
  'mathopen', 'mathclose', 'mathpunct', 'mathinner', 'phantom', 'vphantom', 'hphantom',
]);

/** 按顶层 \\ 切分环境体为多行（忽略 \text{} 等花括号内的内容） */
function splitEnvRows(body: string): string[] {
  const rows: string[] = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') { depth++; cur += ch; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); cur += ch; continue; }
    if (ch === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        rows.push(cur);
        cur = '';
        i++;
        // 跳过可选的间距参数 \\[2pt]
        if (body[i + 1] === '[') {
          const close = body.indexOf(']', i + 1);
          if (close !== -1) i = close;
        }
        continue;
      }
      // 其他命令（\text \frac …）整体保留，避免把 \{ 误判为行分隔
      cur += ch;
      i++;
      if (i < body.length && /[a-zA-Z]/.test(body[i])) {
        while (i < body.length && /[a-zA-Z]/.test(body[i])) cur += body[i++];
        i--;
      } else if (i < body.length) {
        cur += body[i];
      }
      continue;
    }
    cur += ch;
  }
  rows.push(cur);
  return rows;
}

/** 按顶层 & 切分一行（矩阵单元格） */
function splitEnvCells(row: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '{') { depth++; cur += ch; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); cur += ch; continue; }
    if (ch === '\\') {
      cur += ch;
      i++;
      if (i < row.length && /[a-zA-Z]/.test(row[i])) {
        while (i < row.length && /[a-zA-Z]/.test(row[i])) cur += row[i++];
        i--;
      } else if (i < row.length) {
        cur += row[i];
      }
      continue;
    }
    if (ch === '&' && depth === 0) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

class Parser {
  private pos = 0;
  constructor(private readonly src: string) {}

  private peek(): string | undefined {
    return this.src[this.pos];
  }
  private next(): string | undefined {
    return this.src[this.pos++];
  }
  private skipSpaces(): void {
    while (this.pos < this.src.length && this.src[this.pos] === ' ') this.pos++;
  }

  parseExpression(stop?: string): MathComponent[] {
    const out: MathComponent[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipSpaces();
      const c = this.peek();
      if (c === undefined) break;
      if (stop && c === stop) { this.next(); break; }
      if (!stop && c === '}') { this.next(); break; }
      const before = this.pos;
      const term = this.parseTerm();
      if (term.length === 0) {
        // 没有产出且位置未推进：强制前进一步，避免死循环
        if (this.pos === before) this.next();
        continue;
      }
      out.push(...term);
    }
    return out;
  }

  private parseTerm(): MathComponent[] {
    const base = this.parseBaseAtom();
    if (base.length === 0) return base;

    let sub: MathComponent[] | null = null;
    let sup: MathComponent[] | null = null;
    // 处理 ^ / _（支持 x_a^b 与 x^b_a 两种顺序）
    for (let k = 0; k < 2; k++) {
      this.skipSpaces();
      const c = this.peek();
      if (c === '^') { this.next(); sup = this.parseScriptArg(); }
      else if (c === '_') { this.next(); sub = this.parseScriptArg(); }
      else break;
    }

    if (sub && sup) return [new MathSubSuperScript({ children: base, subScript: sub, superScript: sup })];
    if (sup) return [new MathSuperScript({ children: base, superScript: sup })];
    if (sub) return [new MathSubScript({ children: base, subScript: sub })];
    return base;
  }

  private parseScriptArg(): MathComponent[] {
    this.skipSpaces();
    if (this.peek() === '{') { this.next(); return this.parseExpression('}'); }
    return this.parseBaseAtom();
  }

  private parseGroupArg(): MathComponent[] {
    this.skipSpaces();
    if (this.peek() === '{') { this.next(); return this.parseExpression('}'); }
    return this.parseBaseAtom();
  }

  private parseBaseAtom(): MathComponent[] {
    this.skipSpaces();
    const c = this.peek();
    if (c === undefined) return [];
    if (c === '{') { this.next(); return this.parseExpression('}'); }
    if (c === '\\') return this.parseCommand();
    if (c === '}' || c === '&') { this.next(); return []; }
    this.next();
    return [mathRun(c)];
  }

  private parseCommand(): MathComponent[] {
    this.next(); // 消费反斜杠
    let name = '';
    while (/[a-zA-Z]/.test(this.peek() || '')) name += this.next();

    if (name === '') {
      // 单字符命令：\\ \{ \} \_ \% \& \$ 等
      const ch = this.peek();
      if (ch === '\\') { this.next(); return []; }            // 换行
      if (ch === ' ' || ch === ',' || ch === ';' || ch === ':') { this.next(); return []; } // 间距
      if (ch === '{' || ch === '}' || ch === '_' || ch === '^' || ch === '%' || ch === '&' || ch === '#' || ch === '$') {
        this.next(); return [mathRun(ch)];
      }
      if (ch !== undefined) { this.next(); return [mathRun(ch)]; }
      return [];
    }

    if (name in GREEK) return [mathRun(GREEK[name])];
    if (name in SYMBOLS) return [mathRun(SYMBOLS[name])];

    // 重音 / 上划线 / 下划线
    if (name in ACCENTS) {
      const cfg = ACCENTS[name];
      const base = this.parseGroupArg();
      return cfg.kind === 'bar'
        ? [mathBar(cfg.pos || 'top', base)]
        : [mathAccent(cfg.chr || '\u0302', base)];
    }

    if (name === 'boxed') return [mathBorderBox(this.parseGroupArg())];

    // 上/下标注记：\overset{上}{下} \underset{下}{上} \stackrel{上}{下}
    if (name === 'overset' || name === 'stackrel') {
      const top = this.parseGroupArg();
      const base = this.parseGroupArg();
      return [mathLimitUpper(base, top)];
    }
    if (name === 'underset') {
      const bottom = this.parseGroupArg();
      const base = this.parseGroupArg();
      return [mathLimitLower(base, bottom)];
    }

    // 带标注的箭头：\xrightarrow[下方]{上方} \xleftarrow[下方]{上方}
    if (name === 'xrightarrow' || name === 'xleftarrow') {
      const arrow = name === 'xrightarrow' ? '→' : '←';
      this.skipSpaces();
      let below: MathComponent[] | null = null;
      if (this.peek() === '[') { this.next(); below = this.parseExpression(']'); }
      const above = this.parseGroupArg();
      let node: MathComponent = mathLimitUpper([mathRun(arrow)], above.length ? above : [mathRun(' ')]);
      if (below) node = mathLimitLower([node], below);
      return [node];
    }

    if (IGNORED_COMMANDS.has(name)) {
      // 这些命令没有排版作用：跳过其可选的 {...} 参数
      this.skipSpaces();
      if (name === 'phantom' || name === 'vphantom' || name === 'hphantom') this.parseGroupArgRaw();
      return [];
    }
    if (name === 'hspace' || name === 'kern' || name === 'mkern' || name === 'mskip' || name === 'rule') {
      this.parseGroupArgRaw();
      return [];
    }

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      const num = this.parseGroupArg();
      const den = this.parseGroupArg();
      return [new MathFraction({ numerator: num, denominator: den })];
    }
    if (name === 'sqrt') {
      let degree: MathComponent[] | undefined;
      this.skipSpaces();
      if (this.peek() === '[') { this.next(); degree = this.parseExpression(']'); }
      const body = this.parseGroupArg();
      return [new MathRadical({ children: body, degree })];
    }
    if (name === 'left') return this.parseLeftRight();
    if (name === 'right') { return []; } // 配对由 \left 消费，落单则忽略

    if (name === 'sum') return this.parseNary('sum');
    if (name === 'int' || name === 'iint' || name === 'iiint' || name === 'oint') return this.parseNary('int');
    if (name in NARY_SYMBOLS) return this.parseSymbolWithLimits(NARY_SYMBOLS[name]);

    if (FUNCTIONS.has(name)) return this.parseFunction(name);
    if (name === 'mathbb') return this.parseBlackboard();

    if (name === 'text' || name === 'mbox' || name === 'mathrm' || name === 'operatorname' ||
        name === 'textbf' || name === 'textit' || name === 'mathsf' || name === 'mathtt') {
      const inner = this.parseGroupArgRaw();
      return [mathRun(inner)];
    }
    if (name === 'mathbf' || name === 'boldsymbol' || name === 'bm' || name === 'mathbfit') {
      const inner = this.parseGroupArgRaw();
      return [mathRun(inner)];
    }

    if (name === 'binom') {
      const top = this.parseGroupArg();
      const bot = this.parseGroupArg();
      return [new MathRoundBrackets({ children: [new MathFraction({ numerator: top, denominator: bot })] })];
    }

    if (name === 'begin') return this.parseBeginEnv();

    throw new UnsupportedLatexError(`不支持的 LaTeX 命令：\\${name}`);
  }

  private parseGroupArgRaw(): string {
    this.skipSpaces();
    if (this.peek() !== '{') return '';
    this.next();
    let depth = 1;
    let out = '';
    while (this.pos < this.src.length && depth > 0) {
      const ch = this.src[this.pos];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { this.next(); break; } }
      out += ch;
      this.next();
    }
    return out;
  }

  private parseBlackboard(): MathComponent[] {
    const inner = this.parseGroupArgRaw();
    const mapped = inner.split('').map((c) => BLACKBOARD[c] || c).join('');
    return [mathRun(mapped)];
  }

  private parseFunction(name: string): MathComponent[] {
    let sub: MathComponent[] | null = null;
    this.skipSpaces();
    if (this.peek() === '_') { this.next(); sub = this.parseScriptArg(); }
    const arg = this.parseTerm();
    const fn = new MathFunction({ name: [mathRun(name)], children: arg });
    if (sub) return [new MathSubScript({ children: [fn], subScript: sub })];
    return [fn];
  }

  private parseNary(type: 'sum' | 'int'): MathComponent[] {
    let sub: MathComponent[] | null = null;
    let sup: MathComponent[] | null = null;
    for (let k = 0; k < 2; k++) {
      this.skipSpaces();
      const c = this.peek();
      if (c === '^') { this.next(); sup = this.parseScriptArg(); }
      else if (c === '_') { this.next(); sub = this.parseScriptArg(); }
      else break;
    }
    const base = this.parseTerm();
    const opts: any = { children: base };
    if (sub) opts.subScript = sub;
    if (sup) opts.superScript = sup;
    return [type === 'int' ? new MathIntegral(opts) : new MathSum(opts)];
  }

  private parseSymbolWithLimits(sym: string): MathComponent[] {
    let sub: MathComponent[] | null = null;
    let sup: MathComponent[] | null = null;
    for (let k = 0; k < 2; k++) {
      this.skipSpaces();
      const c = this.peek();
      if (c === '^') { this.next(); sup = this.parseScriptArg(); }
      else if (c === '_') { this.next(); sub = this.parseScriptArg(); }
      else break;
    }
    const base = [mathRun(sym)];
    if (sub && sup) return [new MathSubSuperScript({ children: base, subScript: sub, superScript: sup })];
    if (sup) return [new MathSuperScript({ children: base, superScript: sup })];
    if (sub) return [new MathSubScript({ children: base, subScript: sub })];
    return base;
  }

  private parseLeftRight(): MathComponent[] {
    this.skipSpaces();
    let open = this.peek();
    this.next();
    if (open === '\\') {
      // 转义定界符：\{ \} \( \) \| 等
      const ch2 = this.peek();
      if (ch2 === '{' || ch2 === '}' || ch2 === '|') { open = ch2; this.next(); }
    }
    const idx = this.findRight();
    let inner: MathComponent[];
    if (idx === -1) {
      inner = new Parser(this.src.slice(this.pos)).parseExpression();
      this.pos = this.src.length;
    } else {
      inner = new Parser(this.src.slice(this.pos, idx)).parseExpression();
      this.pos = idx;
      this.next(); // 反斜杠
      while (/[a-zA-Z]/.test(this.peek() || '')) this.next(); // 跳过 "right"
      this.skipSpaces();
      // 消费右定界符（可能是 \) 、\} 、\| 等转义形式）
      if (this.peek() === '\\') {
        this.next();
        if (this.peek() !== undefined) this.next();
      } else if (this.peek() !== undefined) {
        this.next();
      }
    }
    return this.wrapBracket(open, inner);
  }

  // 找到顶层匹配的 \right 位置
  private findRight(): number {
    let braceDepth = 0;
    let leftDepth = 0;
    let i = this.pos;
    while (i < this.src.length) {
      const ch = this.src[i];
      if (ch === '{') { braceDepth++; i++; continue; }
      if (ch === '}') { braceDepth = Math.max(0, braceDepth - 1); i++; continue; }
      if (ch === '\\') {
        if (this.src.startsWith('left', i + 1) && !/[a-zA-Z]/.test(this.src[i + 5] || '')) {
          leftDepth++; i += 5; continue;
        }
        if (this.src.startsWith('right', i + 1) && !/[a-zA-Z]/.test(this.src[i + 6] || '')) {
          if (leftDepth === 0 && braceDepth === 0) return i;
          leftDepth = Math.max(0, leftDepth - 1); i += 6; continue;
        }
        i++;
        while (i < this.src.length && /[a-zA-Z]/.test(this.src[i])) i++;
        continue;
      }
      i++;
    }
    return -1;
  }

  private wrapBracket(open: string | undefined, inner: MathComponent[]): MathComponent[] {
    if (open === '.') return inner; // \left. 表示无定界符
    if (open === '(') return [new MathRoundBrackets({ children: inner })];
    if (open === '[') return [new MathSquareBrackets({ children: inner })];
    if (open === '{' || open === '\\{') return [new MathCurlyBrackets({ children: inner })];
    if (open === '|') return [mathRun('|'), ...inner, mathRun('|')];
    if (open === '‖') return [mathRun('‖'), ...inner, mathRun('‖')];
    if (open === '⟨') return [mathRun('⟨'), ...inner, mathRun('⟩')];
    return [new MathRoundBrackets({ children: inner })];
  }

  /** 读取 \begin{env} … \end{env} 之间的原始内容（支持同名环境嵌套） */
  private readEnvBody(env: string): string {
    const beginTag = `\\begin{${env}}`;
    const endTag = `\\end{${env}}`;
    let depth = 1;
    let i = this.pos;
    const bodyStart = this.pos;
    while (i < this.src.length) {
      if (this.src.startsWith(beginTag, i)) { depth++; i += beginTag.length; continue; }
      if (this.src.startsWith(endTag, i)) {
        depth--;
        if (depth === 0) {
          const body = this.src.slice(bodyStart, i);
          this.pos = i + endTag.length;
          return body;
        }
        i += endTag.length;
        continue;
      }
      i++;
    }
    // 未闭合：取到末尾，保证不丢内容
    const body = this.src.slice(bodyStart);
    this.pos = this.src.length;
    return body;
  }

  /** 网格环境 → 矩阵（必要时套外层定界符） */
  private parseGridEnv(env: string, body: string): MathComponent[] {
    const rows = splitEnvRows(body)
      .map((row) => splitEnvCells(row).map((cell) => new Parser(cell).parseExpression()))
      .filter((cells) => cells.some((cell) => cell.length > 0));
    if (rows.length === 0) return [];
    const grid = mathMatrix(rows);
    const delimiters = ENV_DELIMITERS[env];
    if (!delimiters) return [grid];
    return [mathDelimiter(delimiters[0], delimiters[1], [grid])];
  }

  private parseBeginEnv(): MathComponent[] {
    this.skipSpaces();
    if (this.peek() !== '{') throw new UnsupportedLatexError('\\begin 缺少 {env}');
    this.next();
    let env = '';
    while (this.peek() !== '}' && this.peek() !== undefined) env += this.next();
    if (this.peek() === '}') this.next();

    // array / subarray 的列格式参数 {lcr} 与可选位置 [t] 直接丢弃
    if (env === 'array' || env === 'subarray') {
      this.skipSpaces();
      if (this.peek() === '[') this.next();
      this.parseGroupArgRaw();
    } else {
      this.skipSpaces();
      if (this.peek() === '[') {
        const close = this.src.indexOf(']', this.pos);
        if (close !== -1) this.pos = close + 1;
      }
    }

    const body = this.readEnvBody(env);

    if (GRID_ENVS.has(env)) return this.parseGridEnv(env, body);
    if (TRANSPARENT_ENVS.has(env)) return new Parser(body).parseExpression();
    throw new UnsupportedLatexError(`不支持的环境：\\begin{${env}}`);
  }
}

/**
 * 将一段 LaTeX 公式转为 OMML 公式对象（数组形式，可直接作为 Math 的 children）。
 * 遇到不支持的构造时抛出 UnsupportedLatexError。
 */
export function latexToOmml(tex: string): MathComponent[] {
  const t = tex.trim();
  if (!t) throw new UnsupportedLatexError('空公式');
  const result = new Parser(t).parseExpression();
  if (result.length === 0) throw new UnsupportedLatexError('解析结果为空');
  return result;
}
