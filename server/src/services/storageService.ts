import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { ensureDir } from '../utils/fileUtils';

export interface StoredFile {
  id: string;
  originalName: string;
  storedPath: string;
  size: number;
  createdAt: Date;
}

// 内存存储 (可扩展为数据库)
const fileRegistry = new Map<string, StoredFile>();

// batchId -> 原始文件名（不含扩展名），用于生成 DOCX 输出文件名
const batchOriginalNames = new Map<string, string>();

class StorageService {
  /**
   * 注册已上传的文件
   */
  registerFile(filePath: string, originalName: string): StoredFile {
    const stats = fs.statSync(filePath);
    const id = uuidv4();
    const file: StoredFile = {
      id,
      originalName,
      storedPath: filePath,
      size: stats.size,
      createdAt: new Date(),
    };
    fileRegistry.set(id, file);
    return file;
  }

  /**
   * 获取文件信息
   */
  getFile(fileId: string): StoredFile | undefined {
    return fileRegistry.get(fileId);
  }

  /**
   * 创建任务输出目录
   */
  createTaskOutputDir(taskId: string): string {
    const dir = path.join(config.storage.outputDir, taskId);
    ensureDir(dir);
    return dir;
  }

  /**
   * 获取任务输出目录
   */
  getTaskOutputDir(taskId: string): string {
    return path.join(config.storage.outputDir, taskId);
  }

  /**
   * 注册 batchId 与原始文件名的映射
   */
  registerBatchOriginalName(batchId: string, originalName: string): void {
    // 去掉扩展名，保留不带后缀的文件名
    const nameWithoutExt = originalName.replace(/\.[^.]+$/, '');
    batchOriginalNames.set(batchId, nameWithoutExt);
  }

  /**
   * 获取 batchId 对应的原始文件名（不含扩展名）
   */
  getBatchOriginalName(batchId: string): string | undefined {
    return batchOriginalNames.get(batchId);
  }

  /**
   * 注册生成的 DOCX 文件
   */
  registerOutputFile(taskId: string, fileName: string, downloadName?: string): StoredFile {
    const filePath = path.join(config.storage.outputDir, taskId, fileName);
    const stats = fs.statSync(filePath);
    const id = uuidv4();
    const file: StoredFile = {
      id,
      originalName: downloadName || fileName,
      storedPath: filePath,
      size: stats.size,
      createdAt: new Date(),
    };
    fileRegistry.set(id, file);
    return file;
  }

  /**
   * 清理任务文件
   */
  cleanupTask(taskId: string): void {
    const dir = path.join(config.storage.outputDir, taskId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

export const storageService = new StorageService();
