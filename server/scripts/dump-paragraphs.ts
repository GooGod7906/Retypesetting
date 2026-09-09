/** 逐段打印 DOCX 的文本与公式对象分布，定位“只有第一页转换了”的问题 */
import fs from 'fs';
import unzipper from 'unzipper';

async function main() {
  const docxPath = process.argv[2];
  const d = await unzipper.Open.file(docxPath);
  const entry = d.files.find((f) => f.path === 'word/document.xml');
  if (!entry) throw new Error('no document.xml');
  const xml = (await entry.buffer()).toString('utf8');

  console.log('sectPr 数量：' + (xml.match(/<w:sectPr/g) || []).length);
  console.log('分页符数量：' + (xml.match(/w:type="page"/g) || []).length);
  console.log('oMath 总数：' + (xml.match(/<m:oMath[ >]/g) || []).length);
  console.log('oMathPara 数量：' + (xml.match(/<m:oMathPara[ >]/g) || []).length);
  console.log('段落总数：' + (xml.match(/<w:p[ >]/g) || []).length);
  console.log('表格数量：' + (xml.match(/<w:tbl>/g) || []).length);

  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0]);
  paragraphs.forEach((p, i) => {
    const text = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('');
    const mathCount = (p.match(/<m:oMath[ >]/g) || []).length;
    const mathText = [...p.matchAll(/<m:t[^>]*>([\s\S]*?)<\/m:t>/g)].map((m) => m[1]).join('');
    const flag = mathCount > 0 ? `[公式×${mathCount}]` : '';
    console.log(`${String(i + 1).padStart(3)} ${flag} ${text.slice(0, 70)}${mathText ? ' | M:' + mathText.slice(0, 60) : ''}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
