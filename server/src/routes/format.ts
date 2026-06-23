import { Router, Request, Response, NextFunction } from 'express';
import { generateDocx } from '../services/formatService';
import { templateService } from '../services/templateService';
import { storageService } from '../services/storageService';
import { mineruService } from '../services/mineruService';
import path from 'path';

const router = Router();

/**
 * POST /api/format
 * 根据模板排版生成 DOCX
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId, templateId } = req.body;
    if (!batchId || !templateId) {
      return res.status(400).json({
        success: false,
        error: '缺少 batchId 或 templateId',
      });
    }

    // 获取模板
    const template = await templateService.getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }

    // 获取解析结果目录
    const outputDir = storageService.getTaskOutputDir(batchId);

    // 读取 Markdown
    const markdown = await mineruService.readMarkdownContent(outputDir);
    const imagesDir = path.join(outputDir, 'images');

    // 生成 DOCX
    const docxPath = await generateDocx(markdown, template, outputDir, imagesDir);

    // 获取原始文件名，生成对应的 DOCX 文件名
    const originalName = storageService.getBatchOriginalName(batchId);
    const outputFileName = originalName ? `${originalName}.docx` : 'output.docx';

    // 注册输出文件（使用原始文件名作为下载名）
    const storedFile = storageService.registerOutputFile(batchId, 'output.docx', outputFileName);

    res.json({
      success: true,
      data: {
        fileId: storedFile.id,
        fileName: outputFileName,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as formatRouter };
