import { XmlComponent, MathComponent } from 'docx';

/**
 * docx 8.x 的公式组件只覆盖 分式/上下标/根号/大型运算符/函数/定界符，
 * 缺少 重音(acc)、上划线(bar)、矩阵(m)、边框(borderBox)、上/下限(limUpp/limLow)。
 * 这里用 docx 的 XmlComponent 直接构造这些 OMML 元素，交给同一个序列化器输出。
 */

class RawOmml extends XmlComponent {
  constructor(rootKey: string, children: unknown[]) {
    super(rootKey);
    for (const child of children) this.root.push(child as any);
  }
}

/** 构造一个 OMML 元素 */
export function omml(rootKey: string, children: unknown[] = []): MathComponent {
  return new RawOmml(rootKey, children) as unknown as MathComponent;
}

/** OMML 属性值，如 <m:chr m:val="⃗"/> */
const attr = (value: string) => ({ _attr: { 'm:val': value } });

/**
 * 数学文本运行（m:r）。
 * docx 的 MathRun 不写字体信息，Word 会自动用 Cambria Math，
 * 但 WPS 等阅读器会退化成正文/主题字体（公式看起来像普通文字）。
 * 这里显式指定 Cambria Math，保证跨阅读器渲染一致。
 */
export function mathRun(text: string): MathComponent {
  return omml('m:r', [
    omml('w:rPr', [
      omml('w:rFonts', [
        { _attr: { 'w:ascii': 'Cambria Math', 'w:hAnsi': 'Cambria Math', 'w:cs': 'Cambria Math' } },
      ]),
    ]),
    omml('m:t', [{ _attr: { 'xml:space': 'preserve' } }, text]),
  ]);
}

/** 重音：\vec \hat \dot \tilde \overrightarrow … */
export function mathAccent(character: string, base: MathComponent[]): MathComponent {
  return omml('m:acc', [
    omml('m:accPr', [omml('m:chr', [attr(character)])]),
    omml('m:e', base),
  ]);
}

/** 上划线 / 下划线：\overline \underline \bar */
export function mathBar(position: 'top' | 'bot', base: MathComponent[]): MathComponent {
  return omml('m:bar', [
    omml('m:barPr', [omml('m:pos', [attr(position)])]),
    omml('m:e', base),
  ]);
}

/** 边框：\boxed */
export function mathBorderBox(base: MathComponent[]): MathComponent {
  return omml('m:borderBox', [omml('m:e', base)]);
}

/** 上标标注（\overset / \xrightarrow 的上方内容） */
export function mathLimitUpper(base: MathComponent[], limit: MathComponent[]): MathComponent {
  return omml('m:limUpp', [omml('m:e', base), omml('m:lim', limit)]);
}

/** 下标标注（\underset / \xrightarrow 的下方内容） */
export function mathLimitLower(base: MathComponent[], limit: MathComponent[]): MathComponent {
  return omml('m:limLow', [omml('m:e', base), omml('m:lim', limit)]);
}

/** 矩阵 / 对齐环境：rows[r][c] = 单元格内容 */
export function mathMatrix(rows: MathComponent[][][]): MathComponent {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const mcPr = omml('m:mcPr', [
    omml('m:count', [attr(String(cols))]),
    omml('m:mcJc', [attr('center')]),
  ]);
  const mcs = omml('m:mcs', [omml('m:mc', [mcPr])]);
  return omml('m:m', [
    omml('m:mPr', [mcs]),
    ...rows.map((cells) => omml('m:mr', cells.map((cell) => omml('m:e', cell)))),
  ]);
}

/** 定界符：\left\{ … \right. 形式的成对括号（begin 为空表示无左括号） */
export function mathDelimiter(begin: string, end: string, inner: MathComponent[]): MathComponent {
  return omml('m:d', [
    omml('m:dPr', [omml('m:begChr', [attr(begin)]), omml('m:endChr', [attr(end)])]),
    omml('m:e', inner),
  ]);
}
