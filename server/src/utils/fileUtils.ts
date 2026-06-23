import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 生成唯一文件 ID
 */
export function generateFileId(): string {
  return uuidv4();
}

/**
 * 获取文件扩展名
 */
export function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

/**
 * 清理临时文件
 */
export function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Failed to cleanup file: ${filePath}`, err);
  }
}

/**
 * 读取 JSON 文件
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * 写入 JSON 文件
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(filePath, content, 'utf-8');
}
