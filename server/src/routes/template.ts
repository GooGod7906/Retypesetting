import { Router, Request, Response, NextFunction } from 'express';
import { templateService } from '../services/templateService';

const router = Router();

/**
 * GET /api/templates
 * 获取所有模板
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const templates = await templateService.getAllTemplates();
    res.json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/templates/export/:id
 * 导出模板为 JSON 文件
 */
router.get('/export/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const json = await templateService.exportTemplate(req.params.id);
    if (!json) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    const template = await templateService.getTemplate(req.params.id);
    const fileName = `${template!.name || 'template'}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(json);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/templates/:id
 * 获取单个模板
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const template = await templateService.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/templates
 * 创建模板
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const template = await templateService.createTemplate(req.body);
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/templates/:id
 * 更新模板
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const template = await templateService.updateTemplate(req.params.id, req.body);
    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/templates/:id
 * 删除模板
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const success = await templateService.deleteTemplate(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export { router as templateRouter };
