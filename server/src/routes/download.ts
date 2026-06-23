import { Router, Request, Response, NextFunction } from 'express';
import { storageService } from '../services/storageService';
import path from 'path';
import fs from 'fs';

const router = Router();

/**
 * GET /api/download/:fileId
 * 下载生成的文件
 */
router.get('/:fileId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fileId } = req.params;
    const storedFile = storageService.getFile(fileId);

    if (!storedFile || !fs.existsSync(storedFile.storedPath)) {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    // 对非 ASCII 文件名使用 RFC 5987 编码，确保中文文件名不乱码
    const encodedName = encodeURIComponent(storedFile.originalName);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.sendFile(path.resolve(storedFile.storedPath));
  } catch (err) {
    next(err);
  }
});

export { router as downloadRouter };
