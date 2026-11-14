import { exportFixedDocument } from './services/fixedLayout';
import { examPaperTemplate } from './services/layoutTemplate';

async function main() {
  const args = process.argv.slice(2);
  const flow = args[0] === '--flow';
  if (flow) args.shift();
  const [archive, outputOrPage, singlePageOutput] = args;
  const output = singlePageOutput ?? outputOrPage;
  if (!archive || !output?.toLowerCase().endsWith('.docx')) {
    throw new Error('用法：npm --prefix server run layout:word -- [--flow] <结果.zip> [原页码] <导出.docx>');
  }
  const report = await exportFixedDocument(archive, output, { page: singlePageOutput ? Number(outputOrPage) : undefined,
    template: flow ? examPaperTemplate : undefined });
  console.log(JSON.stringify({ ...report, output, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : '导出失败');
  process.exitCode = 1;
});
