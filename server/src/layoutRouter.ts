import express, { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { exportFixedDocument, LayoutCorrections, LayoutReport } from './services/fixedLayout';
import { applyLayoutRoles, defaultQuestionLayout, detectFooterPattern, flowHeadingStyles, LayoutAlignments, LayoutPage, LayoutRoles, LayoutSource, missingPositionMessage, mixedMode, openLayoutSource, openMineruArchive, QuestionLayout, questionLayouts, questionTextFrames } from './services/mineruLayout';
import { elementKinds, elementLabels, examPaperTemplate, LayoutTemplate, originalTemplate, parseTemplate, parseTemplateFile, standardTemplate, styleDefaults } from './services/layoutTemplate';
import { WorkspaceStore } from './services/workspaceStore';
import { openSourcePdf, recoverSourceMarks } from './services/sourcePageMarks';

const sourceRoute = '/runs/:id/:fileId/:model';
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

interface Template extends LayoutTemplate { id: string; name: string; preset?: boolean; default?: boolean }
interface Source extends LayoutSource {
  name: string;
  original?: string;
  expiresAt?: number;
  separateLayoutCorrections?: boolean;
}
type SourceIds = { id: string; fileId: string; model: string };
type ResolveSource = (ids: SourceIds) => Promise<Source | undefined>;

interface ExportRecord {
  id: string;
  source: SourceIds;
  filename: string;
  state: 'queued' | 'running' | 'ready' | 'failed';
  template: Template;
  createdAt: number;
  corrections: LayoutCorrections;
  roles?: LayoutRoles;
  alignments?: LayoutAlignments;
  questionLayout?: QuestionLayout;
  report?: LayoutReport;
  error?: string;
}

const defaultTemplate: Template = { ...examPaperTemplate, preset: true, default: true };
const fixedTemplate: Template = { ...originalTemplate, id: 'original', name: '原位复刻', preset: true };
const presets: Template[] = [
  defaultTemplate,
  { ...standardTemplate, id: 'a4', name: 'A4 标准试卷', preset: true },
  { ...originalTemplate, id: 'compact', name: '紧凑练习', mode: 'flow', heightMm: 297, marginMm: 12, showPageMarks: false, footer: '{page} / {pages}',
    styles: { body: { fontSizePt: 10, lineSpacing: 1.18 }, heading1: { fontSizePt: 15 }, heading2: { fontSizePt: 12 } }, preset: true },
  fixedTemplate,
];

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
}

function sourceIds(req: Request): SourceIds {
  return { id: req.params.id, fileId: req.params.fileId, model: req.params.model };
}

const correctionPrefix = (ids: SourceIds, source: Source, flow: boolean) => {
  const suffix = source.separateLayoutCorrections && flow && !source.mixedMode ? '-flow' : '';
  return `${ids.id}_${ids.fileId}_${ids.model}${suffix}_`;
};
const usesFlowLayout = (source: SourceIds, mode: unknown) =>
  (mixedMode(source.model) ?? mode) === 'flow';
const publicExport = ({ corrections: _corrections, roles: _roles, alignments: _alignments, ...job }: ExportRecord) => job;
function questionLayout(value: unknown): QuestionLayout | undefined {
  return questionLayouts.find(layout => layout === value);
}

async function readPage(source: LayoutSource, number: number, splitInlineProse: boolean): Promise<LayoutPage | undefined> {
  if (!Number.isSafeInteger(number) || number < 1) return;
  const archive = await openLayoutSource(source, { splitInlineProse });
  for await (const page of archive.pages()) if (page.number === number) return page;
}

export function createLayoutRouter(store: WorkspaceStore, output: string, resolveSource: ResolveSource) {
  const router = express.Router();
  const queue: ExportRecord[] = [];
  let previewRaster = Promise.resolve();
  let working = false;
  let running: ExportRecord | undefined;
  const mutations = new Map<string, number>();
  const destination = (id: string) => path.join(output, `${id}.docx`);
  const persist = (job: ExportRecord) => store.save('exports', job.id, job);
  const json = express.json({ limit: '128kb' });
  const findTemplate = async (id: unknown): Promise<Template | undefined> => {
    if (typeof id !== 'string') return;
    return presets.find(template => template.id === id)
      ?? (uuid.test(id) ? await store.get<Template>('templates', id) : undefined);
  };
  const localAction = (req: Request, res: Response, next: NextFunction) => {
    if (req.get('X-MinerU-Lab') !== '1') return res.sendStatus(403);
    next();
  };
  const changeSource = (handler: (req: Request, res: Response) => Promise<unknown>) => route(async (req, res) => {
    const id = req.params.id;
    mutations.set(id, (mutations.get(id) ?? 0) + 1);
    try { await handler(req, res); }
    finally {
      const count = mutations.get(id)!;
      if (count === 1) mutations.delete(id);
      else mutations.set(id, count - 1);
    }
  });

  async function drain() {
    if (working) return;
    working = true;
    try {
      while (queue.length) {
        const job = running = queue.shift()!;
        try {
          job.state = 'running';
          await persist(job);
          const source = await resolveSource(job.source);
          if (!source) throw new Error('找不到这份试卷的原始解析结果。');
          const signal = source.expiresAt === undefined ? undefined : AbortSignal.timeout(Math.max(0, source.expiresAt - Date.now()));
          job.report = await exportFixedDocument(source.archive, destination(job.id), { template: job.template,
            corrections: job.corrections, sourceName: path.parse(source.name).name, sourcePdf: source.original, pairedSource: source,
            questionLayout: job.questionLayout, roles: job.roles, alignments: job.alignments, signal });
          job.state = 'ready';
        } catch (error) {
          job.state = 'failed';
          job.error = error instanceof Error ? error.message : '生成 Word 失败。';
        }
        await persist(job).catch(error => console.error('保存 Word 导出状态失败', error));
        running = undefined;
      }
    } finally {
      working = false;
    }
  }

  router.get('/templates', route(async (_req, res) => res.json([...presets, ...await store.list<Template>('templates')])));
  router.get('/template-elements', (_req, res) => res.json(elementKinds.map(id => ({ id, label: elementLabels[id] }))));
  router.get('/template-style-defaults', (_req, res) => res.json(styleDefaults));
  router.get('/templates/:template/download', route(async (req, res) => {
    const template = await findTemplate(req.params.template);
    if (!template) return res.sendStatus(404);
    const { id: _id, preset: _preset, default: _default, ...configuration } = template;
    const filename = template.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    res.attachment(`${filename}.json`).json({ format: 'typesetting-template', version: 1, template: configuration });
  }));
  router.post('/templates/import', localAction, json, route(async (req, res) => {
    const template = { id: randomUUID(), ...parseTemplateFile(req.body) };
    await store.save('templates', template.id, template);
    res.status(201).json(template);
  }));
  router.post('/templates', localAction, json, route(async (req, res) => {
    const template = { id: randomUUID(), ...parseTemplate(req.body ?? {}) };
    await store.save('templates', template.id, template);
    res.status(201).json(template);
  }));
  router.put('/templates/:template', localAction, json, route(async (req, res) => {
    const id = req.params.template;
    if (!uuid.test(id) || !await store.get('templates', id)) return res.sendStatus(404);
    const template = { id, ...parseTemplate(req.body ?? {}) };
    await store.save('templates', id, template);
    res.json(template);
  }));
  router.delete('/templates/:template', localAction, route(async (req, res) => {
    if (!uuid.test(req.params.template)) return res.sendStatus(404);
    await store.delete('templates', req.params.template);
    res.sendStatus(204);
  }));

  router.get(`${sourceRoute}/pages`, route(async (req, res) => {
    const ids = sourceIds(req);
    const source = await resolveSource(ids);
    if (!source) return res.sendStatus(404);
    const archive = await openMineruArchive(source.archive);
    const pages = [];
    const headingLevels = new Set<number>();
    let supportsFixed = true;
    let footerPattern: string | undefined;
    for await (const page of archive.pages()) {
      const { number, items, approximateLines } = page;
      pages.push(number);
      if (approximateLines) supportsFixed = false;
      footerPattern ??= detectFooterPattern(page);
      for (const { level } of items) {
        if (typeof level === 'number' && Number.isInteger(level) && level >= 1) headingLevels.add(Math.min(level, 9));
      }
    }
    const sourcePdf = source.original ? 'upload' : [...archive.entries.keys()].some(name => name.endsWith('_origin.pdf')) ? 'archive' : null;
    const layoutMode = mixedMode(ids.model);
    res.json({ pages, sourcePdf, supportsFixed, layoutMode, footerPattern, layoutControlsTemplateMode: Boolean(layoutMode),
      headingLevels: [...headingLevels].sort((a, b) => a - b) });
  }));
  router.get(`${sourceRoute}/pages/:page`, route(async (req, res) => {
    const ids = sourceIds(req);
    const source = await resolveSource(ids);
    if (!source) return res.sendStatus(404);
    const number = Number(req.params.page);
    if (!Number.isSafeInteger(number) || number < 1) return res.sendStatus(404);
    const flow = usesFlowLayout(ids, req.query.mode);
    const archive = await openLayoutSource(source, { splitInlineProse: flow });
    for await (const page of archive.pages()) {
      if (page.number !== number) continue;
      const key = `${correctionPrefix(ids, source, flow)}${page.number}`;
      const [corrections = {}, roles = {}, alignments = {}] = await Promise.all([
        store.get<LayoutCorrections>('corrections', key), store.get<LayoutRoles>('roles', key),
        store.get<LayoutAlignments>('alignments', key),
      ]);
      applyLayoutRoles(page, roles);
      const headings = flowHeadingStyles(page, corrections);
      const origin = source.original ?? [...archive.entries.values()].find(entry => entry.path.endsWith('_origin.pdf'));
      const chosen = questionLayout(req.query.questionLayout) ?? defaultQuestionLayout;
      const readMarks = previewRaster.then(async () => {
        if (!origin || res.destroyed || chosen === 'page-images') return;
        const pdf = await openSourcePdf(origin);
        try { return await recoverSourceMarks(pdf, page, !flow); }
        finally { await pdf.destroy(); }
      }).catch(() => undefined);
      previewRaster = readMarks.then(() => undefined);
      const marks = await readMarks;
      const frames = chosen === 'merged-options' || chosen === 'separate-options' ? questionTextFrames(page, chosen) : [];
      return res.json({ ...page, footerPattern: detectFooterPattern(page), questionBlocks: frames, rules: marks?.rules ?? [], items: page.items.map(item => {
        const table = marks?.tableCrops.get(item.id);
        const heading = headings.get(item.id);
        const crop = table?.png ?? (corrections[item.id] === undefined ? marks?.crops.get(item.id) : undefined);
        return { ...item, ...(table && { box: table.box }), text: item.kind === 'table' ? undefined : corrections[item.id] ?? item.text,
          flowRole: heading?.role, mainTitle: heading?.mainTitle, alignmentOverride: alignments[item.id], crop: crop?.toString('base64') };
      }) });
    }
    return res.sendStatus(404);
  }));
  router.put(`${sourceRoute}/pages/:page`, localAction, json, changeSource(async (req, res) => {
    const ids = sourceIds(req);
    const source = await resolveSource(ids);
    if (!source) return res.sendStatus(404);
    const flow = usesFlowLayout(ids, req.query.mode);
    const page = await readPage(source, Number(req.params.page), flow);
    if (!page) return res.sendStatus(404);
    const corrections = req.body?.corrections ?? {};
    const roles = req.body?.roles ?? {};
    const alignments = req.body?.alignments ?? {};
    const allowed = new Set(page.items.filter(item => item.kind === 'text' || item.kind === 'formula').map(item => item.id));
    if (typeof corrections !== 'object' || Array.isArray(corrections)
      || Object.entries(corrections).some(([id, value]) => !allowed.has(id) || typeof value !== 'string' || value.length > 4000)
      || typeof roles !== 'object' || Array.isArray(roles)
      || Object.entries(roles).some(([id, value]) => !allowed.has(id) || (value !== null && (value === 'table' || !elementKinds.some(kind => kind === value))))
      || typeof alignments !== 'object' || Array.isArray(alignments)
      || Object.entries(alignments).some(([id, value]) => !flow || !allowed.has(id) || (value !== null && value !== 'left' && value !== 'center'))) {
      return res.status(400).json({ error: '校对内容或元素编号不正确。' });
    }
    const key = `${correctionPrefix(ids, source, flow)}${page.number}`;
    await Promise.all([store.patch('corrections', key, corrections), store.patch('roles', key, roles), store.patch('alignments', key, alignments)]);
    res.json({ saved: Object.keys(corrections).length + Object.keys(roles).length + Object.keys(alignments).length });
  }));

  router.get(`${sourceRoute}/asset/:asset`, route(async (req, res) => {
    const source = await resolveSource(sourceIds(req));
    const asset = req.params.asset;
    if (!source || !/\.(jpe?g|png|gif|bmp|webp)$/i.test(asset)) return res.sendStatus(404);
    const archive = await openLayoutSource(source);
    const entry = archive.entries.get(`images/${asset}`);
    if (!entry) return res.sendStatus(404);
    res.type(path.extname(asset)).set('X-Content-Type-Options', 'nosniff');
    await pipeline(entry.stream(), res);
  }));
  router.get(`${sourceRoute}/source-pdf`, route(async (req, res) => {
    const source = await resolveSource(sourceIds(req));
    if (!source) return res.sendStatus(404);
    if (source.original) return res.type('application/pdf').sendFile(source.original);
    const archive = await openMineruArchive(source.archive);
    const entry = [...archive.entries.values()].find(file => file.path.endsWith('_origin.pdf'));
    if (!entry) return res.sendStatus(404);
    res.type('application/pdf').set('X-Content-Type-Options', 'nosniff');
    await pipeline(entry.stream(), res);
  }));
  router.get(`${sourceRoute}/native-word`, route(async (req, res) => {
    if (mixedMode(req.params.model)) return res.sendStatus(404);
    const source = await resolveSource(sourceIds(req));
    if (!source) return res.sendStatus(404);
    const archive = await openMineruArchive(source.archive);
    const entry = archive.entries.get('full.docx');
    if (!entry) return res.sendStatus(404);
    res.attachment(`${path.parse(source.name).name}-MinerU.docx`);
    await pipeline(entry.stream(), res);
  }));

  router.get(`${sourceRoute}/exports`, route(async (req, res) => {
    const ids = sourceIds(req);
    if (!await resolveSource(ids)) return res.sendStatus(404);
    const jobs = await store.list<ExportRecord>('exports');
    res.json(jobs.filter(job => job.source.id === ids.id && job.source.fileId === ids.fileId && job.source.model === ids.model)
      .sort((a, b) => b.createdAt - a.createdAt).map(publicExport));
  }));
  router.post(`${sourceRoute}/exports`, localAction, json, changeSource(async (req, res) => {
    const ids = sourceIds(req);
    const source = await resolveSource(ids);
    if (!source) return res.sendStatus(404);
    const mixed = mixedMode(ids.model);
    const requestedMode = req.body?.mode;
    if (requestedMode !== undefined && ((requestedMode !== 'flow' && requestedMode !== 'fixed') || (mixed && mixed !== requestedMode))) {
      return res.status(400).json({ error: '请选择有效的排版方式。' });
    }
    const selectedTemplate = req.body?.template === undefined
      ? defaultTemplate
      : await findTemplate(req.body.template);
    if (!selectedTemplate) return res.status(400).json({ error: '请选择排版模板。' });
    const formulaMode = req.body?.formulaMode;
    if (formulaMode !== undefined && formulaMode !== 'editable' && formulaMode !== 'image' && formulaMode !== 'latex') {
      return res.status(400).json({ error: '请选择有效的公式处理方式。' });
    }
    const mode = mixed ?? requestedMode ?? selectedTemplate.mode ?? 'fixed';
    const template: Template = {
      ...selectedTemplate,
      mode,
      ...(formulaMode === undefined ? {} : { formulaMode }),
    };
    const requested = questionLayout(req.body?.questionLayout);
    if (req.body?.questionLayout !== undefined && (mode !== 'fixed' || !requested)) {
      return res.status(400).json({ error: '请选择有效的按题原位版式。' });
    }
    const chosen = mode === 'fixed' ? requested ?? defaultQuestionLayout : undefined;
    if (template.mode !== 'flow') {
      const archive = await openMineruArchive(source.archive);
      if (chosen === 'page-images') {
        if (!source.original && ![...archive.entries.keys()].some(name => name.endsWith('_origin.pdf'))) {
          return res.status(422).json({ error: '此任务缺少原 PDF，无法生成兼容原位版。' });
        }
      } else {
        for await (const page of archive.pages()) {
          if (page.approximateLines) return res.status(422).json({ error: missingPositionMessage });
        }
      }
    }
    const prefix = correctionPrefix(ids, source, mode === 'flow');
    const [correctionRecords, roleRecords, alignmentRecords] = await Promise.all([
      store.list<LayoutCorrections>('corrections', prefix), store.list<LayoutRoles>('roles', prefix),
      store.list<LayoutAlignments>('alignments', prefix),
    ]);
    const corrections = Object.assign({}, ...correctionRecords);
    const roles = Object.assign({}, ...roleRecords);
    const alignments = Object.assign({}, ...alignmentRecords);
    const layoutName = { 'adaptive-rows': '原位自适应', 'page-paragraphs': '按页原位无框', 'separate-options': '按题原位选项分框', 'merged-options': '按题原位', 'page-images': '跨平台原位' };
    const suffix = chosen ? layoutName[chosen] : mixed ? '混合重排' : '模板重排';
    const job: ExportRecord = { id: randomUUID(), source: ids, template, corrections, roles, alignments, questionLayout: chosen, state: 'queued', createdAt: Date.now(),
      filename: `${path.parse(source.name).name}-${suffix}-${template.name}.docx` };
    await persist(job);
    queue.push(job);
    res.status(202).json(publicExport(job));
    void drain();
  }));
  router.get('/exports/:exportId', route(async (req, res) => {
    const id = req.params.exportId;
    const job = uuid.test(id) ? await store.get<ExportRecord>('exports', id) : undefined;
    if (!job || !await resolveSource(job.source)) return res.sendStatus(404);
    res.json(publicExport(job));
  }));
  router.get('/exports/:exportId/download', route(async (req, res) => {
    const id = req.params.exportId;
    const job = uuid.test(id) ? await store.get<ExportRecord>('exports', id) : undefined;
    if (job?.state !== 'ready' || !await resolveSource(job.source)) return res.sendStatus(404);
    res.download(destination(id), job.filename);
  }));

  return { router, busy(id: string) {
    return mutations.has(id) || running?.source.id === id || queue.some(job => job.source.id === id);
  }, async clear(id: string) {
    for (const job of await store.list<ExportRecord>('exports')) {
      if (job.source.id !== id) continue;
      await rm(destination(job.id), { force: true });
      await store.delete('exports', job.id);
    }
    await Promise.all([store.deletePrefix('corrections', id + '_'), store.deletePrefix('roles', id + '_'), store.deletePrefix('alignments', id + '_')]);
  }, async start() {
    await mkdir(output, { recursive: true });
    const unfinished = (await store.list<ExportRecord>('exports')).filter(job => job.state === 'queued' || job.state === 'running');
    queue.push(...unfinished.sort((a, b) => a.createdAt - b.createdAt));
    void drain();
  } };
}
