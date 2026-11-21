const assert = require('node:assert/strict');
const { mkdir, mkdtemp, rm, rmdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { Open } = require('unzipper');
const { exportFixedDocument } = require('../dist/services/fixedLayout');
const { bufferPart, writeOfficeZip } = require('../dist/services/officeZip');
const { examPaperTemplate, originalTemplate, parseTemplate, parseTemplateFile, standardTemplate, styleFor } = require('../dist/services/layoutTemplate');
const { editableFormula, flowParagraph, flowText, positionedGap, positionedQuestionLine } = require('../dist/services/wordLayoutXml');
const { answerRules } = require('../dist/services/sourcePageMarks');
const { groupQuestionBlocks, openLayoutSource, questionTextFrames } = require('../dist/services/mineruLayout');

test('positioned text gaps use explicit run spacing without Word tab stops', () => {
  assert.equal(positionedGap(-6350), '');
  const line = positionedQuestionLine(flowText('A', {}) + positionedGap(635 * 120) + flowText('B', {}), 0, 0, 127000);
  assert.match(line, /<w:spacing w:val="115"\/>/);
  assert.doesNotMatch(line, /<w:tab\b|<w:tabs>/);
  assert.match(line, /<w:adjustRightInd w:val="0"\/><w:snapToGrid w:val="0"\/>/);
  assert.match(line, /w:lineRule="atLeast"/);
});

test('paragraph settings keep the Word grid off and serialize minimum spacing, indents, and alignment', () => {
  const { styles } = parseTemplate({ ...originalTemplate, name: '段落', styles: {
    stem: { spaceBeforePt: 3, spaceAfterPt: 6, lineSpacing: 1.2, lineSpacingPt: 16,
      leftIndentMm: 5, rightIndentMm: 2, firstLineIndentMm: -3, alignment: 'justify' },
  } });
  const paragraph = flowParagraph('sample', styles.stem);
  assert.match(paragraph, /w:before="60" w:after="120" w:line="320" w:lineRule="atLeast"/);
  assert.match(paragraph, /w:left="283" w:right="113" w:hanging="170"/);
  assert.match(paragraph, /<w:jc w:val="both"\/>/);
  assert.match(paragraph, /<w:adjustRightInd w:val="0"\/><w:snapToGrid w:val="0"\/>/);
});

test('template emphasis and color survive inheritance and native Word serialization', () => {
  const template = parseTemplate({ ...originalTemplate, name: '排版', styles: {
    body: { color: '#9a2140', underline: true, bold: true },
    heading2: { bold: false }, formula: { bold: true },
  } });
  const heading = flowText('标题', styleFor(template, 'heading2'), 2);
  assert.match(heading, /<w:b w:val="0"\/><w:color w:val="9A2140"\/>/);
  assert.match(heading, /<w:u w:val="single"\/>/);
  const formula = editableFormula('x^2', styleFor(template, 'formula'));
  assert.match(formula, /<m:oMath/);
  assert.match(formula, /<m:sty m:val="bi"\/>/);
  assert.match(formula, /<w:color w:val="9A2140"\/>/);
  assert.throws(() => parseTemplate({ ...template, styles: { body: { underline: 'false' } } }), /正文/);
});

test('exam review preset imports as editable print styles without applying underlining to body text', () => {
  const template = parseTemplateFile({ format: 'typesetting-template', version: 1, template: examPaperTemplate });
  assert.equal(template.mode, 'flow');
  assert.equal(template.formulaMode, 'editable');
  assert.deepEqual([template.widthMm, template.heightMm], [185, 260]);
  assert.equal(styleFor(template, 'body').fontSizePt, 10.5);
  assert.equal(styleFor(template, 'body').lineSpacing, 1.2);
  assert.equal(template.footer, '{auto}');
  assert.equal(template.markerWidth, 'full');
  assert.deepEqual(template.margins, { top: 18, right: 20, bottom: 18, left: 20 });
  assert.equal(styleFor(template, 'formula').font, 'Cambria Math');
  assert.doesNotMatch(flowText('题干', styleFor(template, 'body')), /<w:u /);
  assert.match(flowText('一、选择题', styleFor(template, 'heading2'), 2), /w:eastAsia="SimHei".*<w:sz w:val="24"/);
});

test('question styles fit a narrow box by reducing font size with no horizontal scaling', () => {
  const template = parseTemplate({ ...originalTemplate, name: '试卷', styles: {
    body: { fontSizePt: 12, color: '#003399' },
    stem: { fontSizePt: 13 },
    option: { inheritBody: false, fontSizePt: 10 },
  } });
  const stem = styleFor(template, 'stem');
  const option = styleFor(template, 'option');
  assert.equal(stem.color, '#003399');
  assert.equal(option.color, undefined);
  const fitted = flowText('较窄的题干', stem, undefined, 340_000);
  assert.doesNotMatch(fitted, /<w:w /);
  assert.equal(Number(fitted.match(/<w:sz w:val="(\d+)"/)[1]), 10);
  assert.match(flowText('选项', option), /<w:sz w:val="20"\/>/);
});

test('reflow keeps listening instructions at body size, supports block alignment and finds the first complete footer', async () => {
  const output = path.resolve(__dirname, '../.local');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'word-listening-'));
  const source = path.join(directory, 'source.zip');
  const document = path.join(directory, 'result.docx');
  const block = (type, content, bbox, level) => ({ type, bbox, level, lines: [{ bbox, spans: [{ type: 'text', bbox, content }] }] });
  const layout = { pdf_info: [
    { page_idx: 0, page_size: [600, 840], para_blocks: [
      block('title', '高中三年英语科试卷', [150, 30, 450, 54], 1),
      block('title', '第一部分 听力', [30, 80, 170, 96], 2),
      block('title', '第一节 听下面五段录音。' + '每段录音后有小题，听完后请回答。'.repeat(5), [30, 105, 575, 150], 2),
      block('title', '听第 7 段录音，回答第 8、9 题。', [30, 155, 430, 169], 2),
      block('text', '1.What is the weather like now?', [30, 174, 500, 186]),
    ], discarded_blocks: [block('footer', '第 1 页', [245, 795, 355, 810])] },
    { page_idx: 1, page_size: [600, 840], para_blocks: [],
      discarded_blocks: [block('footer', '高三英语 第 2 页 共 12 页', [245, 795, 355, 810])] },
    { page_idx: 2, page_size: [600, 840], para_blocks: [],
      discarded_blocks: [block('footer', '不同格式 第 3 页 共 12 页', [245, 795, 355, 810])] },
  ] };
  try {
    await writeOfficeZip(source, [bufferPart('layout.json', Buffer.from(JSON.stringify(layout)))]);
    await exportFixedDocument(source, document, { template: examPaperTemplate, alignments: { '1-1': 'left', '1-4': 'center' } });
    const archive = await Open.file(document);
    const xml = String(await archive.files.find(entry => entry.path === 'word/document.xml').buffer());
    const paragraphs = xml.match(/<w:p>[\s\S]*?<\/w:p>/g);
    assert.match(paragraphs.find(p => p.includes('高中三年英语科试卷')), /<w:jc w:val="left"\/>/);
    assert.match(paragraphs.find(p => p.includes('第一部分 听力')), /Heading2.*w:sz w:val="24"/);
    const instructions = paragraphs.find(p => p.includes('听下面五段录音'));
    assert.doesNotMatch(instructions, /Heading|<w:b\b/);
    assert.match(instructions, /w:line="288" w:lineRule="auto".*w:sz w:val="21"/);
    const cue = paragraphs.find(p => p.includes('段录音，回答第'));
    assert.doesNotMatch(cue, /Heading/);
    assert.match(cue, /<w:jc w:val="center"\/>/);
    const question = paragraphs.find(p => p.includes('What is the weather like now'));
    assert.match([...question.matchAll(/<w:t [^>]+>(.*?)<\/w:t>/g)].map(match => match[1]).join(''), /^1．What is the weather like now\?$/);
    const footer = String(await archive.files.find(entry => entry.path === 'word/footer1.xml').buffer());
    assert.match(footer, /高三英语/);
    assert.match(footer, /w:instr=" PAGE "/);
    assert.match(footer, /w:instr=" NUMPAGES "/);
    assert.doesNotMatch(footer, /不同格式/);
  } finally {
    await Promise.all([rm(source, { force: true }), rm(document, { force: true })]);
    await rmdir(directory);
  }
});

test('cross-platform fixed export uses inline page images and explicit page breaks without OCR coordinates', async t => {
  const output = path.resolve(__dirname, '../.local');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'word-portable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePdf = path.join(directory, 'source.pdf');
  const destination = path.join(directory, 'result.docx');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Resources << >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Resources << >> /Contents 5 0 R >>',
    '<< /Length 21 >>\nstream\n0 0 100 100 re 0 g f\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const xref = ['0000000000 65535 f '];
  for (const [index, object] of objects.entries()) {
    xref.push(String(pdf.length).padStart(10, '0') + ' 00000 n ');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const offset = pdf.length;
  pdf += `xref\n0 ${xref.length}\n${xref.join('\n')}\ntrailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  await writeFile(sourcePdf, pdf);
  const report = await exportFixedDocument(path.join(directory, 'unavailable.zip'), destination, {
    sourcePdf, template: { ...examPaperTemplate, mode: 'fixed' }, questionLayout: 'page-images',
  });
  assert.equal(report.pages, 2);
  assert.equal(report.pictures, 2);
  const archive = await Open.file(destination);
  const xml = String(await archive.files.find(entry => entry.path === 'word/document.xml').buffer());
  assert.equal((xml.match(/<wp:inline>/g) ?? []).length, 2);
  assert.equal((xml.match(/<w:pageBreakBefore\/>/g) ?? []).length, 1);
  assert.doesNotMatch(xml, /wp:anchor|w:txbxContent|w:footerReference/);
});

test('exam flow preserves title, option columns, paired figures and embedded table images', async () => {
  const output = path.resolve(__dirname, '../.local');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'word-exam-'));
  const source = path.join(directory, 'source.zip');
  const document = path.join(directory, 'result.docx');
  const block = (type, bbox, data, spanType = 'text') => ({ type, bbox, lines: [{ bbox, spans: [{ type: spanType, bbox, ...data }] }] });
  const text = (content, bbox, type = 'text') => block(type, bbox, { content });
  const image = (name, bbox) => block('image', bbox, { image_path: `images/${name}` }, 'image');
  const layout = { pdf_info: [{ page_idx: 0, page_size: [300, 420], para_blocks: [
    text('物理练习卷', [80, 15, 220, 30], 'title'),
    text('一、选择题', [25, 34, 105, 47], 'title'),
    text('1. 已知物体速度 v，回答问题。', [25, 58, 275, 72]),
    text('A. 甲', [30, 85, 60, 97]), text('B. 乙', [155, 85, 190, 97]),
    image('left.png', [30, 108, 105, 163]), image('right.png', [155, 109, 225, 164]),
    block('table_body', [25, 180, 270, 255], { html: '<table><tr><td>甲</td><td><img src="images/cell.png"></td></tr></table>' }, 'table'),
  ] }] };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCFcAAAAASUVORK5CYII=', 'base64');
  const template = parseTemplate({ ...examPaperTemplate, footerDistanceMm: 8,
    styles: { ...examPaperTemplate.styles, body: { ...examPaperTemplate.styles.body, fontChinese: 'SimSun', fontEnglish: 'Arial', fontPunctuation: 'KaiTi' } } });
  try {
    await writeOfficeZip(source, [bufferPart('layout.json', Buffer.from(JSON.stringify(layout))),
      ...['left.png', 'right.png', 'cell.png'].map(name => bufferPart(`images/${name}`, png))]);
    const report = await exportFixedDocument(source, document, { template });
    assert.equal(report.pictures, 3);
    assert.equal(report.tables, 1);
    const xml = String(await (await Open.file(document)).files.find(entry => entry.path === 'word/document.xml').buffer());
    const paragraphs = xml.match(/<w:p>[\s\S]*?<\/w:p>/g);
    assert.match(paragraphs.find(p => p.includes('物理练习卷')), /<w:jc w:val="center"\/>/);
    assert.doesNotMatch(paragraphs.find(p => p.includes('一、选择题')), /<w:jc w:val="center"\/>/);
    const stem = paragraphs.find(p => p.includes('已知物体速度'));
    assert.match(stem, /w:ascii="Arial"[^]*?>1<\/w:t>/);
    assert.match(stem, /w:ascii="KaiTi"[^]*?>．<\/w:t>/);
    assert.match(stem, /<w:sz w:val="21"\/>/);
    assert.match(paragraphs.find(p => p.includes('>A<\/w:t>') && p.includes('>B<\/w:t>')), /<w:tabs>/);
    const paired = paragraphs.find(p => (p.match(/<wp:inline>/g) ?? []).length === 2);
    assert.match(paired, /<w:tab\/>/);
    for (const [, width, height] of paired.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)) assert.equal(width, height);
    assert.match(xml, /<w:tblBorders>[^]*?<w:bottom w:val="single"[^]*?<w:right w:val="single"/);
    assert.match(xml, /<w:tc>[^]*?<wp:inline>[^]*?<\/w:tc>/);
    assert.match(xml, /w:footer="454"/);
  } finally {
    await Promise.all([rm(source, { force: true }), rm(document, { force: true })]);
    await rmdir(directory);
  }
});

test('adaptive original rows fit subtitles and equations before the next source line', async t => {
  const directory = await mkdtemp(path.resolve(__dirname, '../.local/word-dense-rows-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.zip');
  const document = path.join(directory, 'result.docx');
  const line = (type, content, bbox) => ({ bbox, spans: [{ type, bbox, content }] });
  const layout = { pdf_info: [{ page_idx: 0, page_size: [595, 841], para_blocks: [
    { type: 'title', level: 2, bbox: [48, 334, 573, 367], lines: [
      line('text', '一、选择题：本题共十小题，在每小题给出的选项中，只有一项符合题目要求。', [48, 334, 573, 348]),
      line('text', '请选择一个答案。', [67, 354, 151, 367]),
    ] },
    { type: 'interline_equation', bbox: [60, 375, 150, 394],
      lines: [line('interline_equation', String.raw`\frac{\frac{1}{2}+\frac{3}{4}}{\frac{6}{7}}`, [60, 375, 150, 394])] },
    { type: 'text', bbox: [48, 398, 400, 408], lines: [line('text', 'A. 下列说法正确的是。', [48, 398, 400, 408])] },
  ] }] };
  await writeOfficeZip(source, [bufferPart('layout.json', Buffer.from(JSON.stringify(layout)))]);
  await exportFixedDocument(source, document, { template: { ...examPaperTemplate, mode: 'fixed' }, questionLayout: 'adaptive-rows' });
  const xml = String(await (await Open.file(document)).files.find(entry => entry.path === 'word/document.xml').buffer());
  const anchors = [...xml.matchAll(/<wp:anchor\b[^]*?<\/wp:anchor>/g)].map(match => match[0]);
  assert.equal(anchors.length, 4);
  const rowTop = anchor => Number(anchor.match(/<wp:positionV[^>]*><wp:posOffset>(\d+)/)[1]);
  const rowHeight = anchor => Number(anchor.match(/<wp:extent cx="\d+" cy="(\d+)"/)[1]);
  for (const [index, anchor] of anchors.entries()) {
    assert.match(anchor, /w:lineRule="exact"/);
    if (index + 1 < anchors.length) assert.ok(rowTop(anchor) + rowHeight(anchor) < rowTop(anchors[index + 1]));
  }
  const runSizes = anchor => [...anchor.matchAll(/<w:sz w:val="(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(new Set(runSizes(anchors[0])), new Set(runSizes(anchors[1])));
  assert.ok(runSizes(anchors[0]).every(size => size < 24));
  assert.match(anchors[2], /<m:noBreak\/>/);
  assert.ok(runSizes(anchors[2]).every(size => size < 21));
});

test('fixed-layout DOCX uses integer DrawingML positions and extents', async () => {
  const output = path.resolve(__dirname, '../.local');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'word-layout-test-'));
  const source = path.join(directory, 'source.zip');
  const document = path.join(directory, 'result.docx');
  const bounds = [101.2, 20.3, 401.7, 51.6];
  const layout = {
    pdf_info: [{ page_idx: 0, page_size: [2019, 2788], para_blocks: [{
      type: 'text', bbox: bounds,
      lines: [{ bbox: bounds, spans: [{ type: 'text', bbox: bounds, content: '正文____结束' }] }],
    }, {
      type: 'interline_equation', bbox: [420, 20, 540, 52],
      lines: [{ bbox: [420, 20, 540, 52], spans: [{
        type: 'interline_equation', bbox: [420, 20, 540, 52], content: '\\frac{1}{2}',
      }] }],
    }] }],
  };

  try {
    await writeOfficeZip(source, [bufferPart('layout.json', Buffer.from(JSON.stringify(layout)))]);
    const report = await exportFixedDocument(source, document);
    assert.equal(report.formulas, 1);
    const archive = await Open.file(document);
    const xml = String(await archive.files.find(entry => entry.path === 'word/document.xml').buffer());
    assert.match(xml, /<m:boxPr><m:noBreak\/><\/m:boxPr>/);
    assert.match(xml, /<wps:bodyPr[^>]+anchor="ctr"/);
    const extents = [...xml.matchAll(/<(?:wp:extent|a:ext) cx="([^"]+)" cy="([^"]+)"\/>/g)];
    assert.equal(extents.length, 4);
    for (const [, width, height] of extents) {
      assert.match(width, /^[1-9]\d*$/);
      assert.match(height, /^[1-9]\d*$/);
    }
    for (const [, offset] of xml.matchAll(/<wp:posOffset>([^<]+)<\/wp:posOffset>/g)) assert.match(offset, /^-?\d+$/);
    await exportFixedDocument(source, document, { template: examPaperTemplate });
    const flowing = String(await (await Open.file(document)).files.find(entry => entry.path === 'word/document.xml').buffer());
    assert.doesNotMatch(flowing, /<w:txbxContent/);
    assert.match(flowing, /<m:oMath/);
    assert.match(flowing, /<w:u w:val="single"\/>.*?<w:t xml:space="preserve">\u2007{4}<\/w:t>/);
    await exportFixedDocument(source, document, { template: { ...examPaperTemplate, mode: 'fixed' }, questionLayout: 'adaptive-rows' });
    const adaptive = String(await (await Open.file(document)).files.find(entry => entry.path === 'word/document.xml').buffer());
    assert.match(adaptive, /<w:txbxContent>[^]*?<m:f>/);
    assert.match(adaptive, /<w:u w:val="single"\/>.*?<w:t xml:space="preserve">\u2007{4}<\/w:t>/);
    assert.doesNotMatch(adaptive, /<w:w\b|<w:tabs?\b/);
    assert.match(adaptive, /<m:noBreak\/>/);
    const first = layout.pdf_info[0];
    layout.pdf_info.push({ ...first, page_idx: 1 }, { ...first, page_idx: 2, page_size: [2019, 2900] });
    await rm(source);
    await writeOfficeZip(source, [bufferPart('layout.json', Buffer.from(JSON.stringify(layout)))]);
    assert.equal((await exportFixedDocument(source, document)).pages, 3);
    const paged = String(await (await Open.file(document)).files.find(entry => entry.path === 'word/document.xml').buffer());
    assert.equal((paged.match(/<w:pageBreakBefore\/>/g) ?? []).length, 1);
    assert.equal((paged.match(/<w:sectPr>/g) ?? []).length, 2);
    assert.match(paged, /<w:pageBreakBefore\/>[^]*?<wp:anchor/);
  } finally {
    await Promise.all([rm(source, { force: true }), rm(document, { force: true })]);
    await rmdir(directory);
  }
});

test('inline math inherits the stem or option role and adaptive export preserves picture coordinates', async () => {
  const directory = await mkdtemp(path.resolve(__dirname, '../.local/word-adaptive-'));
  const source = path.join(directory, 'source.zip');
  const target = path.join(directory, 'result.docx');
  const bounds = [20, 20, 200, 45];
  const formula = [100, 20, 122, 45];
  const figure = [240, 60, 290, 160];
  const line = (content, y) => ({ bbox: bounds, spans: [
    { type: 'text', bbox: [20, y, 100, y + 20], content },
    { type: 'inline_equation', bbox: formula.map((value, index) => index % 2 ? value + y - 20 : value), content: '\\frac{L}{2}' },
  ] });
  const layout = { pdf_info: [{ page_idx: 0, page_size: [300, 400], para_blocks: [
    { type: 'text', bbox: bounds, lines: [line('1. 已知', 20), line('E. 选项', 70)] },
    { type: 'image', bbox: figure, lines: [{ bbox: figure, spans: [{ type: 'image', bbox: figure, image_path: 'images/figure.png' }] }] },
  ] }] };
  try {
    await writeOfficeZip(source, [bufferPart('layout.json', Buffer.from(JSON.stringify(layout))),
      bufferPart('images/figure.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCFcAAAAASUVORK5CYII=', 'base64'))]);
    const archive = await openLayoutSource({ archive: source });
    for await (const page of archive.pages()) {
      const formulas = page.items.filter(item => item.kind === 'formula');
      assert.deepEqual(formulas.map(item => item.role), ['stem', 'option']);
      const frames = questionTextFrames(page, 'separate-options');
      assert.ok(frames[0].lines.flat().includes(formulas[0].id));
      assert.ok(frames[1].lines.flat().includes(formulas[1].id));
    }
    const exportedPicture = async questionLayout => {
      await exportFixedDocument(source, target, { questionLayout });
      const doc = await Open.file(target);
      const xml = String(await doc.files.find(entry => entry.path === 'word/document.xml').buffer());
      const picture = [...xml.matchAll(/<wp:anchor\b[^]*?<\/wp:anchor>/g)].find(match => match[0].includes('<pic:pic>'))[0];
      return picture.match(/<wp:posOffset>\d+<\/wp:posOffset>|<wp:extent[^>]*>/g);
    };
    assert.deepEqual(await exportedPicture('adaptive-rows'), await exportedPicture('page-paragraphs'));
  } finally {
    await rm(source, { force: true });
    await rm(target, { force: true });
    await rmdir(directory);
  }
});

test('OCR text wins over a duplicate or spurious formula inside the same Chinese span', async () => {
  const { openMineruArchive } = require('../dist/services/mineruLayout');
  const directory = await mkdtemp(path.resolve(__dirname, '../.local/ocr-overlap-test-'));
  const source = path.join(directory, 'source.zip');
  const spans = [
    { type: 'text', bbox: [10, 20, 160, 31], content: '固定在O1点，将矿泉水瓶置于桌面' },
    { type: 'inline_equation', bbox: [45, 19, 58, 31], content: 'O _ { 1 }' },
    { type: 'inline_equation', bbox: [85, 18, 94, 30], content: '\\sqrt [ ] { \\psi }' },
    { type: 'inline_equation', bbox: [165, 20, 182, 31], content: '_ { m g }' },
    { type: 'inline_equation', bbox: [190, 20, 215, 31], content: '\\frac{1}{2}' },
    { type: 'inline_equation', bbox: [220, 20, 250, 31], content: '示，x_2' },
    { type: 'inline_equation', bbox: [255, 20, 275, 31], content: 'x_{示}' },
    { type: 'text', bbox: [280, 20, 310, 31], content: '后续正文' },
  ];
  const layout = { pdf_info: [{ page_idx: 0, page_size: [500, 700], para_blocks: [{
    type: 'text', bbox: [10, 18, 215, 31], lines: [{ bbox: [10, 18, 215, 31], spans }],
  }] }] };
  try {
    await writeOfficeZip(source, [bufferPart('layout.json', Buffer.from(JSON.stringify(layout)))]);
    const fixed = await openMineruArchive(source);
    for await (const page of fixed.pages()) {
      assert.deepEqual(page.items.find(item => item.id === '1-6').box, spans[5].bbox);
      assert.equal(page.items.find(item => item.id === '1-6').sourceCrop, true);
      assert.equal(page.items.some(item => item.id === '1-6.1'), false);
    }
    const archive = await openMineruArchive(source, { splitInlineProse: true });
    for await (const page of archive.pages()) {
      assert.deepEqual(page.items.map(item => [item.id, item.text, Boolean(item.sourceCrop)]), [
        ['1-1', spans[0].content, false],
        ['1-4', spans[3].content, true],
        ['1-5', spans[4].content, false],
        ['1-6', '示，', false],
        ['1-6.1', 'x_2', false],
        ['1-7', 'x_{示}', true],
        ['1-8', '后续正文', false],
      ]);
    }
  } finally {
    await rm(source, { force: true });
    await rmdir(directory);
  }
});

test('short answer rules stop at the following text', () => {
  const width = 90;
  const height = 50;
  const pixels = new Uint8Array(width * height * 4).fill(255);
  const ink = (x, y) => pixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  for (let x = 32; x <= 51; x++) ink(x, 21);
  const items = [
    { id: '1-1', box: [5, 10, 30, 20], text: '填空' },
    { id: '1-2', box: [50, 10, 80, 20], text: '后续文字' },
  ].map(item => ({ ...item, group: 1, line: 1, kind: 'text', role: 'text' }));
  assert.deepEqual(answerRules({ number: 1, size: [width, height], items }, pixels, width, height), [
    { box: [32, 21, 49, 22], after: '1-1' },
  ]);
});

test('question stems are independent of merged or equal-height individual option frames', () => {
  const items = [
    ['1. 选择正确答案', [10, 10, 120, 22]],
    ['A. 甲', [10, 30, 60, 40]],
    ['B. 乙', [85, 30, 140, 43]],
    ['C. 丙', [10, 50, 60, 60]],
    ['D. 丁', [85, 50, 140, 60]],
  ].map(([text, box], i) => ({ id: String(i), text, box, line: i, group: i, kind: 'text', role: 'text' }));
  const page = { items, questionBlocks: groupQuestionBlocks(items) };
  const merged = questionTextFrames(page, 'merged-options');
  assert.deepEqual(merged.map(frame => frame.lines), [[['0']], [['1', '2'], ['3', '4']]]);
  const separate = questionTextFrames(page, 'separate-options');
  assert.deepEqual(separate.map(frame => frame.lines), [[['0']], [['1']], [['2']], [['3']], [['4']]]);
  assert.deepEqual(separate.slice(1).map(({ box }) => box[3] - box[1]), [13, 13, 13, 13]);
  assert.deepEqual(items[1].box, [10, 30, 60, 40]);
});

test('mixed original layout keeps Pipeline figures and mixed flow only uses tightly matched Pipeline bounds', async () => {
  const output = path.resolve(__dirname, '../.local');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'word-layout-mixed-'));
  const archive = path.join(directory, 'pipeline.zip');
  const figureArchive = path.join(directory, 'vlm.zip');
  const upper = [10, 10, 150, 30];
  const lower = [10, 35, 130, 55];
  const paragraph = [10, 10, 150, 55];
  const mismatch = [10, 60, 150, 80];
  const figure = [160, 20, 210, 80];
  const ambiguous = [220, 20, 270, 80];
  const line = (bbox, content) => ({ bbox, spans: [{ type: 'text', bbox, content }] });
  const prose = (bbox, lines) => ({ type: 'text', bbox, lines });
  const image = (bbox, image_path) => ({ type: 'image', bbox, lines: [{ bbox, spans: [{ type: 'image', bbox, image_path }] }] });
  const write = (name, blocks, assets) => writeOfficeZip(name, [
    bufferPart('layout.json', Buffer.from(JSON.stringify({ pdf_info: [{ page_idx: 0, page_size: [300, 400], para_blocks: blocks }] }))),
    ...assets.map(asset => bufferPart(`images/${asset}`, Buffer.from(asset))),
  ]);
  try {
    await write(archive, [
      prose(paragraph, [line(upper, '小球由静止开始'), line(lower, '做匀加速直线运动')]),
      prose(mismatch, [line(mismatch, '速度随时间增大')]),
      image(figure, 'old.png'), image(ambiguous, 'keep.png'),
    ], ['old.png', 'keep.png']);
    await write(figureArchive, [
      prose(paragraph, [line(paragraph, '小球由静止开始做匀减速直线运动')]),
      prose(mismatch, [line(mismatch, '截然不同的文字')]),
      image([161, 20, 210, 80], 'old.png'),
      image(ambiguous, 'candidate.png'), image([222, 20, 270, 80], 'duplicate.png'),
    ], ['old.png', 'candidate.png', 'duplicate.png']);
    const mixed = await openLayoutSource({ archive, pairedArchive: figureArchive, mixedMode: 'fixed' });
    for await (const page of mixed.pages()) {
      assert.deepEqual(page.items.map(item => [item.id, item.text ?? item.asset, item.box]), [
        ['1-1', '小球由静止开始', upper],
        ['1-2', '做匀减速直线运动', lower],
        ['1-3', '速度随时间增大', mismatch],
        ['1-4', 'old.png', figure],
        ['1-5', 'keep.png', ambiguous],
      ]);
      assert.equal(page.approximateLines, false);
      assert.deepEqual(page.mixed, { changedText: 1, pipelineImages: 2, unmatchedImages: 0 });
    }
    const flow = await openLayoutSource({ archive: figureArchive, pairedArchive: archive, mixedMode: 'flow' });
    for await (const page of flow.pages()) {
      assert.deepEqual(page.items.filter(item => item.kind === 'image').map(item => [item.asset, item.box]), [
        ['paired-old.png', figure],
        ['candidate.png', ambiguous],
        ['duplicate.png', [222, 20, 270, 80]],
      ]);
      assert.deepEqual(page.mixed, { changedText: 0, pipelineImages: 1, unmatchedImages: 2 });
    }
  } finally {
    await Promise.all([rm(archive, { force: true }), rm(figureArchive, { force: true })]);
    await rmdir(directory);
  }
});

test('shared OCR coordinates cannot produce stacked textboxes but preserve inline formulas in paragraphs', async () => {
  const output = path.resolve(__dirname, '../.local');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'word-layout-shared-'));
  const source = path.join(directory, 'source.zip');
  const document = path.join(directory, 'result.docx');
  const bbox = [20, 20, 300, 90];
  const spans = [
    { type: 'text', bbox, content: '已知加速度为' },
    { type: 'inline_equation', bbox, content: 'a_1' },
    { type: 'text', bbox, content: '，求位移。' },
  ];
  const layout = { pdf_info: [{ page_idx: 0, page_size: [500, 700], para_blocks: [
    { type: 'text', bbox, lines: [{ bbox, spans }] },
  ] }] };
  try {
    await writeOfficeZip(source, [bufferPart('layout.json', Buffer.from(JSON.stringify(layout)))]);
    await assert.rejects(exportFixedDocument(source, document), /整块坐标/);
    const report = await exportFixedDocument(source, document, { template: standardTemplate });
    assert.equal(report.formulas, 1);
    const archive = await Open.file(document);
    const xml = String(await archive.files.find(entry => entry.path === 'word/document.xml').buffer());
    assert.doesNotMatch(xml, /<wp:anchor|<w:txbxContent/);
    assert.match(xml, /已知加速度为.*<m:oMath.*，求位移。/);
  } finally {
    await Promise.all([rm(source, { force: true }), rm(document, { force: true })]);
    await rmdir(directory);
  }
});
