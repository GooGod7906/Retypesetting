import { Router, Request, Response, NextFunction } from 'express';
import { mineruService } from '../services/mineruService';
import { storageService } from '../services/storageService';
import { validateTaskId } from '../utils/validation';

const router = Router();

// 任务状态缓存 (task_id -> { batchId, state })
const taskCache = new Map<string, { batchId?: string; fileId?: string }>();

/**
 * POST /api/parse/create
 * 创建解析任务: 上传文件到 MinerU
 */
router.post('/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fileId } = req.body;
    if (!fileId) {
      return res.status(400).json({ success: false, error: '缺少 fileId' });
    }

    const storedFile = storageService.getFile(fileId);
    if (!storedFile) {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    console.log('[Parse] Creating task for file:', storedFile.originalName);

    // 1. 申请上传 URL
    let batchResponse;
    try {
      batchResponse = await mineruService.applyBatchUploadUrl(storedFile.originalName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '申请上传 URL 失败';
      console.error('[Parse] Apply upload URL failed:', message);
      return res.status(502).json({ success: false, error: message });
    }
    if (batchResponse.code !== 0) {
      console.error('[Parse] MinerU returned error code:', batchResponse.code, batchResponse.msg);
      return res.status(502).json({
        success: false,
        error: `申请上传 URL 失败: ${batchResponse.msg}`,
      });
    }

    const { batch_id, file_urls } = batchResponse.data;
    console.log('[Parse] Got batch_id:', batch_id, 'upload URLs:', file_urls.length);

    // 2. 上传文件到 MinerU OSS
    try {
      await mineruService.uploadFile(file_urls[0], storedFile.storedPath);
      console.log('[Parse] File uploaded successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '文件上传失败';
      console.error('[Parse] File upload failed:', message);
      return res.status(502).json({
        success: false,
        error: `文件上传到 MinerU 失败: ${message}。请检查文件是否过大或网络连接是否正常。`
      });
    }

    // 缓存 batchId
    taskCache.set(batch_id, { fileId });

    // 注册 batchId 与原始文件名的映射，用于后续生成 DOCX 文件名
    storageService.registerBatchOriginalName(batch_id, storedFile.originalName);

    res.json({
      success: true,
      data: {
        batchId: batch_id,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/parse/status/:batchId
 * 查询解析任务状态
 */
router.get('/status/:batchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;
    if (!batchId) {
      return res.status(400).json({ success: false, error: '缺少 batchId' });
    }

    const result = await mineruService.queryBatchResult(batchId);
    if (result.code !== 0) {
      return res.status(500).json({
        success: false,
        error: `查询失败: ${result.msg}`,
      });
    }

    const extractResult = result.data.extract_result[0];
    if (!extractResult) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    res.json({
      success: true,
      data: {
        batchId,
        state: extractResult.state,
        progress: extractResult.extract_progress,
        fullZipUrl: extractResult.full_zip_url,
        errMsg: extractResult.err_msg,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/parse/result/:batchId
 * 获取解析结果 (下载并解压)
 */
router.get('/result/:batchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;
    if (!batchId) {
      return res.status(400).json({ success: false, error: '缺少 batchId' });
    }

    // 查询任务状态
    const statusResult = await mineruService.queryBatchResult(batchId);
    if (statusResult.code !== 0) {
      return res.status(500).json({ success: false, error: '查询任务状态失败' });
    }

    const extractResult = statusResult.data.extract_result[0];
    if (!extractResult || extractResult.state !== 'done' || !extractResult.full_zip_url) {
      return res.status(400).json({
        success: false,
        error: '任务尚未完成',
        data: { state: extractResult?.state },
      });
    }

    // 创建输出目录并下载结果
    const outputDir = storageService.createTaskOutputDir(batchId);
    await mineruService.downloadAndExtractResult(extractResult.full_zip_url, outputDir);

    // 读取 Markdown
    const markdown = await mineruService.readMarkdownContent(outputDir);
    const images = await mineruService.getImageFiles(outputDir);

    res.json({
      success: true,
      data: {
        batchId,
        markdown,
        images,
        outputDir,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as parseRouter };
