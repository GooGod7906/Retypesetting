import { Router, Request, Response, NextFunction } from 'express';
import { upload } from '../middleware/uploadMiddleware';
import { storageService } from '../services/storageService';

const router = Router();

/**
 * POST /api/upload
 * 上传 PDF 文件
 */
router.post('/', upload.single('file'), (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请上传 PDF 文件',
      });
    }

    const storedFile = storageService.registerFile(
      req.file.path,
      req.file.originalname
    );

    res.json({
      success: true,
      data: {
        fileId: storedFile.id,
        fileName: storedFile.originalName,
        size: storedFile.size,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as uploadRouter };
