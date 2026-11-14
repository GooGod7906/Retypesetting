import axios from 'axios';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { copyFile, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config';
import { createLayoutRouter } from './layoutRouter';
import { mixedMode } from './services/mineruLayout';
import { WorkspaceStore } from './services/workspaceStore';
import type { BatchResultResponse, BatchUploadUrlResponse, ExtractProgress, TaskState } from './types/mineru';

const models = ['vlm', 'pipeline'] as const;
type Model = typeof models[number];
type ResultState = TaskState | 'submitting' | 'uploading' | 'downloading' | 'ready';

interface Result {
  fileId: string;
  name: string;
  model: Model;
  state: ResultState;
  progress?: ExtractProgress;
  uploadedAt?: number;
  parsedAt?: number;
  batchId?: string;
  downloadAttempt?: number;
  error?: string;
}

interface Run {
  id: string;
  createdAt?: number;
  expiresAt?: number;
  separateLayoutCorrections?: boolean;
  purging?: boolean;
  results: Result[];
}

const serverDirectory = path.resolve(__dirname, '..');
const outputDirectory = process.env.TYPESETTING_DATA_DIR ? path.resolve(process.env.TYPESETTING_DATA_DIR) : path.join(serverDirectory, 'outputs', 'mineru-lab');
const uploadDirectory = path.join(serverDirectory, 'uploads', 'mineru-lab');
const maxFiles = 50;
const maxFileBytes = 200 * 1024 * 1024;
const retentionMinutes = Number(process.env.TYPESETTING_RETENTION_MINUTES ?? 30);
if (!Number.isInteger(retentionMinutes) || retentionMinutes < 0 || retentionMinutes > 60) {
  throw new Error('TYPESETTING_RETENTION_MINUTES 必须是 0 到 60 的整数。');
}
const runUnavailable = (run: Run) => run.purging || (run.expiresAt !== undefined && run.expiresAt <= Date.now());
const runTimeoutMs = 20 * 60 * 1000;
const idPattern = /^[a-f0-9-]{36}$/;
const isFinished = (result: Result) => result.state === 'ready' || result.state === 'failed';
const runDirectory = (id: string) => path.join(outputDirectory, id);
const zipName = (result: Result) => `${result.fileId}-${result.model}.zip`;
const originalPath = (run: Run, result: Result) => path.join(runDirectory(run.id), `${result.fileId}.pdf`);
const activeRuns = new Map<string, Run>();
const store = new WorkspaceStore(path.join(outputDirectory, 'workspace'), process.env.DATABASE_URL);
const runWrites = new Map<string, Promise<void>>();
const retryingRuns = new Set<string>();
const purgingRuns = new Set<string>();

mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  dest: uploadDirectory,
  limits: { files: maxFiles, fileSize: maxFileBytes, fields: 1 },
}).array('files', maxFiles);

const apiBase = new URL(config.mineru.apiBaseUrl);
const api = axios.create({
  baseURL: apiBase.href,
  headers: { Authorization: `Bearer ${config.mineru.apiToken}` },
  timeout: 30_000,
  maxRedirects: 0,
});

function signedUrl(value: string): string {
  const url = new URL(value);
  const localTestEndpoint = ['localhost', '127.0.0.1', '[::1]'].includes(apiBase.hostname) && url.origin === apiBase.origin;
  if (url.protocol !== 'https:' && !localTestEndpoint) throw new Error('MinerU 返回了非 HTTPS 文件链接');
  return url.href;
}

function failureMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : '处理失败';
  const status = error.response?.status;
  if (status === 401) return 'MinerU 拒绝认证（HTTP 401）。请更新 server/.env 中的 MINERU_API_TOKEN，然后重启。';
  if (status) return `MinerU 请求失败（HTTP ${status}）`;
  return `MinerU 网络请求失败（${error.code || '未知错误'}）`;
}

function upstreamMessage(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const token = config.mineru.apiToken;
  return (token ? message.split(token).join('[已隐藏]') : message)
    .replace(/https?:\/\/\S+/g, '[链接已隐藏]').slice(0, 300);
}

async function saveRun(run: Run): Promise<void> {
  const snapshot = structuredClone(run);
  const previous = runWrites.get(run.id) ?? Promise.resolve();
  const saved = previous.catch(() => {}).then(() => store.save('runs', run.id, snapshot));
  runWrites.set(run.id, saved);
  try { await saved; } finally {
    if (runWrites.get(run.id) === saved) runWrites.delete(run.id);
  }
}

async function legacyRun(id: string): Promise<Run | undefined> {
  const file = path.join(runDirectory(id), 'run.json');
  try {
    const run: Run = JSON.parse(await readFile(file, 'utf8'));
    run.createdAt ??= (await stat(file)).mtimeMs;
    return run;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function getRun(id: string, includeUnavailable = false): Promise<Run | undefined> {
  if (!idPattern.test(id) || purgingRuns.has(id)) return;
  const active = activeRuns.get(id);
  if (active) return includeUnavailable || !runUnavailable(active) ? active : undefined;
  const run = await store.get<Run>('runs', id) ?? await legacyRun(id);
  if (!run || purgingRuns.has(id) || (!includeUnavailable && runUnavailable(run))) return;
  for (const result of run.results) {
    if (isFinished(result)) continue;
    result.state = 'failed';
    result.error = result.batchId && result.parsedAt
      ? '本地服务在下载完成前退出，可以重试下载。'
      : '本地服务在任务完成前退出，请重新提交。';
  }
  return run;
}

async function downloadZip(url: string, destination: string, deadlineSignal: AbortSignal): Promise<void> {
  const temporary = `${destination}.part`;
  const signal = AbortSignal.any([deadlineSignal, AbortSignal.timeout(120_000)]);
  try {
    const response = await axios.get(signedUrl(url), {
      responseType: 'stream', maxRedirects: 3, signal,
    });
    await pipeline(response.data, createWriteStream(temporary), { signal });
    await rename(temporary, destination);
  } catch (error) {
    if (signal.aborted) throw Object.assign(new Error('下载结果超时'), { code: 'ETIMEDOUT' });
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

function canRetryDownload(error: unknown) {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status) return [401, 403, 404, 408, 410, 429].includes(status) || status >= 500;
  return ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNABORTED',
    'ERR_NETWORK', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_BAD_RESPONSE'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

async function queryBatch(batchId: string, signal: AbortSignal) {
  const { data } = await api.get<BatchResultResponse>(`extract-results/batch/${encodeURIComponent(batchId)}`, { signal });
  return data;
}

function resultRow<T extends { data_id?: string; file_name: string }>(rows: T[], result: Result) {
  const byId = rows.find(row => row.data_id === result.fileId);
  if (byId) return byId;
  const byName = rows.filter(row => !row.data_id && row.file_name === result.name);
  return byName.length === 1 ? byName[0] : undefined;
}

function retryAction(run: Run, result: Result) {
  if (result.state !== 'failed' || !result.parsedAt) return;
  if (result.batchId) return 'download';
  if (idPattern.test(result.fileId) && existsSync(originalPath(run, result))) return 'recognize';
}

function publicRun(run: Run) {
  return { id: run.id, createdAt: run.createdAt, expiresAt: run.expiresAt, results: run.results.map(result => {
    const { batchId: _batchId, ...publicResult } = result;
    return { ...publicResult, retryAction: retryAction(run, result) };
  }) };
}

function runSignal(run: Run) {
  return run.expiresAt === undefined ? new AbortController().signal : AbortSignal.timeout(Math.max(0, run.expiresAt - Date.now()));
}

async function fetchResultZip(run: Run, result: Result, initialUrl?: string, signal = runSignal(run)) {
  let url = initialUrl;
  result.state = 'downloading';
  delete result.error;
  try {
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted();
      result.downloadAttempt = attempt;
      await saveRun(run);
      try {
        if (!url) {
          const response = await queryBatch(result.batchId!, signal);
          if (response.code !== 0) throw new Error(upstreamMessage(response.msg, '无法查询原任务的下载链接'));
          const row = resultRow(response.data.extract_result, result);
          if (row?.state !== 'done' || !row.full_zip_url) throw new Error('原任务未提供可下载结果，链接可能已过期。');
          url = row.full_zip_url;
        }
        await downloadZip(url, path.join(runDirectory(run.id), zipName(result)), signal);
        result.state = 'ready';
        break;
      } catch (error) {
        if (signal.aborted || attempt >= 4 || !canRetryDownload(error)) throw error;
        url = undefined;
        await delay(1000 * 2 ** (attempt - 1), undefined, { signal });
      }
    }
  } catch (error) {
    result.state = 'failed';
    result.error = `下载结果失败。${failureMessage(error)}`;
  } finally {
    delete result.downloadAttempt;
  }
}

async function runModel(run: Run, model: Model, files: Pick<Express.Multer.File, 'path' | 'size'>[],
  results = run.results.filter(result => result.model === model)): Promise<void> {
  const signal = runSignal(run);
  try {
    const { data: response } = await api.post<BatchUploadUrlResponse>('file-urls/batch', {
      files: results.map(result => ({ name: result.name, data_id: result.fileId, is_ocr: true })),
      model_version: model,
      language: 'ch',
      enable_formula: true,
      enable_table: true,
      extra_formats: ['docx'],
    }, { signal });
    if (response.code !== 0) throw new Error(upstreamMessage(response.msg, 'MinerU 未接受提交'));
    const { batch_id: batchId, file_urls: urls } = response.data;
    if (!batchId || urls?.length !== files.length) throw new Error('MinerU 返回的批次或上传链接数量不正确');
    for (const result of results) result.batchId = batchId;
    await saveRun(run);

    for (const [index, result] of results.entries()) {
      signal.throwIfAborted();
      const file = files[index];
      result.state = 'uploading';
      try {
        await axios.put(signedUrl(urls[index]), createReadStream(file.path), {
          headers: { 'Content-Type': false, 'Content-Length': file.size },
          maxBodyLength: maxFileBytes, maxRedirects: 0, signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
        });
        result.uploadedAt = Date.now();
        result.state = 'pending';
      } catch (error) {
        result.state = 'failed';
        result.error = `上传 PDF 失败。${failureMessage(error)}`;
      }
    }

    const deadline = Date.now() + runTimeoutMs;
    while (results.some(result => !isFinished(result))) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) throw new Error('等待 MinerU 解析超时');
      let response: BatchResultResponse;
      try {
        response = await queryBatch(batchId, signal);
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status && status < 500 && status !== 429) throw error;
        await delay(5000, undefined, { signal });
        continue;
      }
      if (response.code !== 0) throw new Error(upstreamMessage(response.msg, '无法查询 MinerU 任务'));
      for (const row of response.data.extract_result) {
        const result = results.find(item => item.fileId === row.data_id)
          ?? results.find(item => !row.data_id && results.filter(other => other.name === row.file_name).length === 1 && item.name === row.file_name);
        if (!result || isFinished(result) || result.state === 'downloading') continue;
        result.state = row.state;
        result.progress = row.extract_progress ?? result.progress;
        if (row.state === 'failed') result.error = upstreamMessage(row.err_msg, 'MinerU 解析失败');
        if (row.state !== 'done' || !row.full_zip_url) continue;

        result.parsedAt = Date.now();
        await fetchResultZip(run, result, row.full_zip_url, signal);
      }
      await saveRun(run);
      if (results.some(result => !isFinished(result))) await delay(4000, undefined, { signal });
    }
  } catch (error) {
    for (const result of results.filter(result => !isFinished(result))) {
      result.state = 'failed';
      result.error = failureMessage(error);
    }
  }
  await saveRun(run);
}

async function removeUploads(files: Express.Multer.File[]): Promise<void> {
  await Promise.allSettled(files.map(file => rm(file.path, { force: true })));
}

async function isPdf(file: Express.Multer.File): Promise<boolean> {
  const input = await open(file.path);
  try {
    const header = Buffer.alloc(5);
    await input.read(header);
    return header.toString() === '%PDF-';
  } finally {
    await input.close();
  }
}

const port = Number(process.env.MINERU_LAB_PORT || 4174);
const listenHost = process.env.MINERU_LAB_HOST || '127.0.0.1';
const publicHosts = new Set((process.env.MINERU_LAB_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean));
export const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.hostname !== '127.0.0.1' && req.hostname !== 'localhost' && !publicHosts.has(req.hostname.toLowerCase())) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/', (_req, res) => res.sendFile(path.join(serverDirectory, 'mineru-lab', 'index.html')));
app.use('/static', express.static(path.join(serverDirectory, 'mineru-lab', 'static')));
app.use('/katex', express.static(path.join(serverDirectory, 'node_modules', 'katex', 'dist')));
app.get('/api/config', (_req, res) => res.json({ tokenConfigured: Boolean(config.mineru.apiToken), mixedLayouts: true, retentionMinutes, maxUploadMiB: maxFileBytes / 1024 ** 2 }));

app.get('/api/runs', async (_req, res, next) => {
  try {
    const records = new Map((await store.list<Run>('runs')).map(run => [run.id, run]));
    const entries = await readdir(outputDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !idPattern.test(entry.name) || records.has(entry.name)) continue;
      const run = await legacyRun(entry.name);
      if (run) records.set(run.id, run);
    }
    for (const run of activeRuns.values()) records.set(run.id, run);
    res.json([...records.values()].filter(run => !runUnavailable(run) && !purgingRuns.has(run.id)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).map(publicRun));
  } catch (error) { next(error); }
});

app.post('/api/runs', (req, res, next) => {
  if (req.get('X-MinerU-Lab') !== '1') return res.sendStatus(403);
  if (!config.mineru.apiToken) return res.status(503).json({ error: '请先在 server/.env 中设置 MINERU_API_TOKEN 并重启。' });
  res.locals.uploadStartedAt = Date.now();
  upload(req, res, next);
}, async (req, res, next) => {
  const files = req.files as Express.Multer.File[];
  const originals: string[] = [];
  try {
    const choice = req.body.model;
    if (choice !== 'both' && choice !== 'vlm' && choice !== 'pipeline') throw new Error('请选择解析模型');
    if (!files?.length || !(await Promise.all(files.map(isPdf))).every(Boolean)) throw new Error('请选择有效的 PDF 文件');

    const selected: readonly Model[] = choice === 'both' ? models : [choice];
    const id = randomUUID();
    const createdAt = res.locals.uploadStartedAt as number;
    const expiresAt = retentionMinutes ? createdAt + retentionMinutes * 60_000 : undefined;
    if (expiresAt && expiresAt <= Date.now()) throw new Error('上传已超过任务有效期，请重新提交。');
    const run: Run = { id, createdAt, expiresAt, separateLayoutCorrections: true, results: files.flatMap(file => {
      const fileId = randomUUID();
      const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
      return selected.map(model => ({ fileId, name, model, state: 'submitting' }));
    }) };
    mkdirSync(runDirectory(id), { recursive: true });
    for (const [index, file] of files.entries()) {
      const original = path.join(runDirectory(id), `${run.results[index * selected.length].fileId}.pdf`);
      originals.push(original);
      await copyFile(file.path, original);
    }
    await saveRun(run);
    activeRuns.set(id, run);
    res.status(202).json(publicRun(run));
    void Promise.allSettled(selected.map(model => runModel(run, model, files)))
      .finally(async () => {
        await removeUploads(files);
        activeRuns.delete(id);
      });
  } catch (error) {
    await removeUploads(files ?? []);
    await Promise.allSettled(originals.map(original => rm(original, { force: true })));
    next(error);
  }
});

app.get('/api/runs/:id', async (req, res, next) => {
  try {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: '本地找不到这次测试记录' });
    res.json(publicRun(run));
  } catch (error) { next(error); }
});

app.post('/api/runs/:id/:fileId/:model/retry', express.json({ limit: '1kb' }), async (req, res, next) => {
  if (req.get('X-MinerU-Lab') !== '1') return res.sendStatus(403);
  const { id, fileId, model } = req.params;
  if (!idPattern.test(id) || !idPattern.test(fileId)) return res.sendStatus(404);
  if (!config.mineru.apiToken) return res.status(503).json({ error: '请先配置 MinerU Token。' });
  if (retryingRuns.has(id) || activeRuns.has(id)) return res.status(409).json({ error: '这条记录仍在处理，请在本批任务结束后重试。' });
  retryingRuns.add(id);
  try {
    const run = await getRun(id);
    const result = run?.results.find(item => item.fileId === fileId && item.model === model);
    if (!run || !result) return res.sendStatus(404);
    const action = retryAction(run, result);
    if (!action || action !== req.body?.action) return res.status(409).json({ error: '这条结果当前无法执行此重试操作。' });
    const original = originalPath(run, result);
    const size = action === 'recognize' ? (await stat(original)).size : 0;
    activeRuns.set(id, run);
    if (action === 'recognize') {
      result.state = 'submitting';
      delete result.error;
      delete result.progress;
      delete result.parsedAt;
    }
    const work = action === 'download' ? fetchResultZip(run, result) : runModel(run, result.model, [{ path: original, size }], [result]);
    try {
      res.status(202).json(publicRun(run));
      await work;
      await saveRun(run);
    } finally {
      activeRuns.delete(id);
    }
  } catch (error) { next(error); }
  finally { retryingRuns.delete(id); }
});

app.get('/api/runs/:id/:fileId/:model/zip', async (req, res, next) => {
  try {
    const run = await getRun(req.params.id);
    const result = run?.results.find(item => item.fileId === req.params.fileId && item.model === req.params.model);
    if (!run || result?.state !== 'ready') return res.sendStatus(404);
    const downloadName = `${path.parse(result.name).name}-${result.model}.zip`;
    res.download(path.join(runDirectory(run.id), zipName(result)), downloadName);
  } catch (error) { next(error); }
});

const layout = createLayoutRouter(store, path.join(outputDirectory, 'word'), async ids => {
  const run = await getRun(ids.id);
  const mode = mixedMode(ids.model);
  const baseModel = mode === 'fixed' ? 'pipeline' : mode === 'flow' ? 'vlm' : ids.model;
  const result = run?.results.find(item => item.fileId === ids.fileId && item.model === baseModel);
  if (!run || result?.state !== 'ready') return;
  const figures = mode && run.results.find(item => item.fileId === ids.fileId && item.model !== baseModel && item.state === 'ready');
  if (mode && !figures) return;
  const directory = runDirectory(run.id);
  const original = path.join(directory, `${result.fileId}.pdf`);
  return { name: result.name, expiresAt: run.expiresAt, separateLayoutCorrections: run.separateLayoutCorrections,
    archive: path.join(directory, zipName(result)), original: existsSync(original) ? original : undefined,
    pairedArchive: figures ? path.join(directory, zipName(figures)) : undefined, mixedMode: mode };
});
async function clearRun(run: Run) {
  const { id } = run;
  if (activeRuns.has(id) || retryingRuns.has(id) || purgingRuns.has(id) || layout.busy(id)) return false;
  purgingRuns.add(id);
  try {
    await saveRun({ ...run, purging: true });
    await layout.clear(id);
    await rm(runDirectory(id), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    await store.delete('runs', id);
    return true;
  } finally {
    purgingRuns.delete(id);
  }
}

app.delete('/api/runs/:id', async (req, res, next) => {
  if (req.get('X-MinerU-Lab') !== '1') return res.sendStatus(403);
  try {
    const run = await getRun(req.params.id, true);
    if (!run) return res.sendStatus(404);
    if (!await clearRun(run)) return res.status(409).json({ error: '任务正在处理，请稍后清除。' });
    res.sendStatus(204);
  } catch (error) { next(error); }
});

async function clearExpiredRuns() {
  try {
    for (const run of await store.list<Run>('runs')) {
      if (idPattern.test(run.id) && runUnavailable(run)) await clearRun(run).catch(() => {
        console.error('清理试卷任务失败，将在下次扫描时重试。');
      });
    }
  } finally {
    setTimeout(() => void clearExpiredRuns().catch(() => console.error('读取到期任务失败。')), 15_000).unref();
  }
}

app.use('/api', layout.router);

app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: '一次最多选择 50 份 PDF，每份最大 200 MB。' });
  }
  res.status(400).json({ error: failureMessage(error) });
});

export async function initialize() {
  await store.init();
  await layout.start();
  void clearExpiredRuns().catch(() => console.error('读取到期任务失败。'));
}

if (require.main === module) {
  void initialize().then(() => {
    const server = app.listen(port, listenHost, () => console.log(`试卷重排版 · ${listenHost}:${port}`));
    server.on('error', (error: NodeJS.ErrnoException) => {
      console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请停止旧服务，或用 MINERU_LAB_PORT 设置另一个端口。` : `启动失败：${error.message}`);
      process.exitCode = 1;
    });
  }).catch(error => {
    console.error('启动失败：', failureMessage(error));
    process.exitCode = 1;
  });
}
