/**
 * 用 Markdown 生成 DOCX 并检查公式渲染情况（排查“公式没变成 OMML”时用）
 * 用法：
 *   cd server && npm run render:md -- <full.md> <输出目录> [omml|latex]
 * 例：
 *   npm run render:md -- outputs/xxxx/full.md ./tmp omml
 */
import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import { generateDocx } from '../src/services/formatService';
import { FormatTemplate } from '../src/types/template';

const [mdPath, outDir, format = 'omml'] = process.argv.slice(2);
if (!mdPath || !outDir) {
  console.error('用法：npm run render:md -- <full.md> <输出目录> [omml|latex]');
  process.exit(1);
}

const templates: FormatTemplate[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'templates/templates.json'), 'utf8')
);

async function inspect(docxPath: string): Promise<void> {
  const d = await unzipper.Open.file(docxPath);
  const entry = d.files.find((f) => f.path === 'word/document.xml');
  if (!entry) throw new Error('word/document.xml 不存在');
  const xml = (await entry.buffer()).toString('utf8');

  const oMath = (xml.match(/<m:oMath[ >]/g) || []).length;
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0]);
  const leftover: string[] = [];
  for (const p of paragraphs) {
    const text = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('');
    if (text.includes('$')) leftover.push(text.slice(0, 200));
  }

  console.log(`\nDOCX 检查：${path.basename(docxPath)}`);
  console.log(`  OMML 公式对象：${oMath} 个`);
  console.log(`  残留 LaTeX 源码段落：${leftover.length} 个`);
  for (const t of leftover.slice(0, 10)) console.log(`    ${t}`);
  if (leftover.length > 10) console.log(`    … 其余 ${leftover.length - 10} 段`);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const template: FormatTemplate = { ...templates[0], formulaSettings: { format: format as any } };
  const md = fs.readFileSync(mdPath, 'utf8');
  const out = await generateDocx(md, template, outDir);
  console.log('生成：' + out);
  await inspect(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
