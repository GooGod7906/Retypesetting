/**
 * 公式渲染方式自检脚本
 * 用法：cd server && npm run check:formula
 *（等价于 npx tsx scripts/check-formula.ts）
 *
 * 对每种 formulaSettings.format 生成一次 DOCX，解压 word/document.xml，
 * 检查是否包含 OMML 公式对象（<m:oMath）、原始 LaTeX 源码（$...$）等特征。
 *
 * 期望结果：
 *  - omml / equation / image → 存在 <m:oMath>，正文不含 $ 定界符
 *  - latex / mathtype        → 无 <m:oMath>，正文保留 $...$ 源码
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import unzipper from 'unzipper';
import { generateDocx } from '../src/services/formatService';
import { FormatTemplate } from '../src/types/template';

const templates: FormatTemplate[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'templates/templates.json'), 'utf8')
);
const base = templates[0];

const MARKDOWN = `# 公式测试

行内公式 $\\frac{1}{2}$ 与 $x^2+y_1$ 混排测试。

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

不支持的矩阵公式：

$$
\\begin{matrix} a & b \\\\ c & d \\end{matrix}
$$

| 项目 | 公式 |
| --- | --- |
| 圆面积 | $S=\\pi r^2$ |
`;

const FORMATS = ['omml', 'equation', 'latex', 'mathtype', 'image'];

async function readDocumentXml(docxPath: string): Promise<string> {
  const directory = await unzipper.Open.file(docxPath);
  const entry = directory.files.find((f) => f.path === 'word/document.xml');
  if (!entry) throw new Error('word/document.xml not found');
  return (await entry.buffer()).toString('utf8');
}

async function main() {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'formula-check-'));
  for (const format of FORMATS) {
    const dir = path.join(outRoot, format);
    fs.mkdirSync(dir, { recursive: true });
    const template: FormatTemplate = { ...base, formulaSettings: { format: format as any } };
    let xml = '';
    let err = '';
    try {
      const p = await generateDocx(MARKDOWN, template, dir);
      xml = await readDocumentXml(p);
    } catch (e) {
      err = (e as Error).message;
    }
    const oMathCount = (xml.match(/<m:oMath[ >]/g) || []).length;
    const textOnly = xml.replace(/<[^>]+>/g, '');
    console.log(
      `${format.padEnd(9)} oMath=${String(oMathCount).padEnd(3)} ` +
        `dollar=${(textOnly.match(/\$/g) || []).length} ` +
        `snippet=${JSON.stringify(textOnly.slice(0, 150))}` +
        (err ? ` ERROR=${err}` : '')
    );
  }
  console.log('\n输出目录：' + outRoot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
