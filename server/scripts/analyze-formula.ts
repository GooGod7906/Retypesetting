/**
 * 公式转换覆盖率分析
 * 用法：
 *   cd server && npm run analyze:formula                # 扫描 outputs 下所有 full.md
 *   cd server && npm run analyze:formula -- <full.md>    # 只分析指定文档
 *
 * 提取 Markdown 中的行内 $...$ 与独立 $$...$$ 公式，逐个尝试 latexToOmml，
 * 统计可转 OMML 的比例，并按失败原因分组列出示例（用于定位缺失的 LaTeX 支持）。
 */
import fs from 'fs';
import path from 'path';
import { latexToOmml, UnsupportedLatexError } from '../src/services/latexToOmml';

function extractFormulas(text: string): string[] {
  const out: string[] = [];
  let inDisplay = false;
  let buf: string[] = [];
  for (const line of text.split('\n')) {
    if (inDisplay) {
      const end = line.indexOf('$$');
      if (end !== -1) {
        if (end > 0) buf.push(line.slice(0, end));
        out.push(buf.join('\n').trim());
        inDisplay = false;
        buf = [];
      } else buf.push(line);
      continue;
    }
    const start = line.indexOf('$$');
    if (start !== -1) {
      const rest = line.slice(start + 2);
      const end = rest.indexOf('$$');
      if (end !== -1) out.push(rest.slice(0, end).trim());
      else { inDisplay = true; buf = [rest]; }
      continue;
    }
    const re = /\$([^$\n]+)\$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) out.push(m[1].trim());
  }
  return out;
}

const arg = process.argv[2];
let targets: Array<{ name: string; text: string }>;

if (arg) {
  targets = [{ name: path.basename(arg), text: fs.readFileSync(arg, 'utf8') }];
} else {
  const outRoot = path.join(process.cwd(), 'outputs');
  targets = fs
    .readdirSync(outRoot)
    .filter((d) => fs.statSync(path.join(outRoot, d)).isDirectory())
    .map((d) => ({ name: d, file: path.join(outRoot, d, 'full.md') }))
    .filter((t) => fs.existsSync(t.file!))
    .map((t) => ({ name: t.name, text: fs.readFileSync(t.file!, 'utf8') }));
}

const failByMsg = new Map<string, { count: number; example: string; files: Set<string> }>();
let total = 0;
let ok = 0;

for (const t of targets) {
  const formulas = extractFormulas(t.text);
  for (const tex of formulas) {
    total++;
    try {
      latexToOmml(tex);
      ok++;
    } catch (e) {
      const msg = e instanceof UnsupportedLatexError ? e.message : `其他错误：${(e as Error).message}`;
      const rec = failByMsg.get(msg) || { count: 0, example: tex, files: new Set<string>() };
      rec.count++;
      rec.files.add(t.name);
      failByMsg.set(msg, rec);
    }
  }
  console.log(`${t.name}: ${formulas.length} 个公式`);
}

console.log(
  `\n合计：${targets.length} 份文档，公式 ${total} 个，可转 OMML ${ok} 个（${((ok / Math.max(total, 1)) * 100).toFixed(1)}%）`
);
if (failByMsg.size > 0) {
  console.log('\n回退原因排行：');
  for (const [msg, rec] of [...failByMsg.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`【${rec.count} 处 / ${rec.files.size} 份文档】${msg}`);
    console.log(`    例：${rec.example.slice(0, 140).replace(/\n/g, ' ⏎ ')}`);
  }
}
