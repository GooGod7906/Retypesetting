import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { config } from '../config';
import {
  BatchUploadUrlRequest,
  BatchUploadUrlResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  TaskStatusResponse,
  BatchTaskCreateRequest,
  BatchTaskCreateResponse,
  BatchResultResponse,
} from '../types/mineru';

class MineruService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.mineru.apiBaseUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.mineru.apiToken}`,
      },
      timeout: 30000,
    });

    // 请求拦截器 - 日志
    this.client.interceptors.request.use(
      (request) => {
        console.log('[MinerU] Request:', request.method?.toUpperCase(), request.url);
        console.log('[MinerU] Token (first 20 chars):', config.mineru.apiToken.substring(0, 20) + '...');
        return request;
      }
    );

    // 响应拦截器 - 处理错误
    this.client.interceptors.response.use(
      (response) => {
        console.log('[MinerU] Response:', response.status, response.data);
        return response;
      },
      (error) => {
        if (error.response) {
          const status = error.response.status;
          const data = error.response.data;
          console.error('[MinerU] Error Response:', status, JSON.stringify(data, null, 2));

          if (status === 401) {
            throw new Error('MinerU API Token 无效或已过期，请检查 server/.env 中的 MINERU_API_TOKEN');
          }
          if (status === 403) {
            const detail = data?.msg || data?.message || data?.error || JSON.stringify(data);
            throw new Error(`MinerU API 访问被拒绝 (403): ${detail}`);
          }
          if (data?.msg) {
            throw new Error(`MinerU API 错误 (${status}): ${data.msg}`);
          }
          if (data?.message) {
            throw new Error(`MinerU API 错误 (${status}): ${data.message}`);
          }
          throw new Error(`MinerU API 错误: HTTP ${status}`);
        }
        console.error('[MinerU] Network/Error:', error.message);
        throw new Error(`MinerU 请求失败: ${error.message}`);
      }
    );
  }

  /**
   * 申请批量上传 URL (本地文件上传方式)
   * POST /api/v4/file-urls/batch
   */
  async applyBatchUploadUrl(fileName: string): Promise<BatchUploadUrlResponse> {
    if (!config.mineru.apiToken) {
      throw new Error('MinerU API Token 未配置，请在 server/.env 中设置 MINERU_API_TOKEN');
    }

    const request: BatchUploadUrlRequest = {
      files: [{ name: fileName, is_ocr: true }],
      enable_formula: true,
      enable_table: true,
      language: 'ch',
      extra_formats: ['docx'],
      model_version: 'vlm',
    };

    const response = await this.client.post<BatchUploadUrlResponse>(
      '/file-urls/batch',
      request
    );
    return response.data;
  }

  /**
   * 上传文件到 MinerU OSS
   * PUT <upload_url>
   * 使用原生 http/https 模块，避免 axios 添加额外 headers
   */
  async uploadFile(uploadUrl: string, filePath: string): Promise<void> {
    const fileBuffer = await fs.promises.readFile(filePath);

    console.log('[MinerU] Uploading file to OSS:', uploadUrl.substring(0, 80) + '...');
    console.log('[MinerU] File size:', fileBuffer.length, 'bytes');

    return new Promise((resolve, reject) => {
      const url = new URL(uploadUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'PUT',
        headers: {
          'Content-Length': fileBuffer.length,
        },
        timeout: 300000,
      };

      console.log('[MinerU] Upload options:', {
        hostname: options.hostname,
        path: options.path.substring(0, 50) + '...',
        method: options.method,
        contentLength: options.headers['Content-Length'],
      });

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log('[MinerU] Upload response:', res.statusCode, data.substring(0, 200));
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`OSS 上传失败: HTTP ${res.statusCode} - ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        console.error('[MinerU] Upload request error:', err.message);
        reject(new Error(`OSS 上传请求失败: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OSS 上传超时'));
      });

      req.write(fileBuffer);
      req.end();
    });
  }

  /**
   * 创建单文件解析任务 (URL 方式)
   * POST /api/v4/extract/task
   */
  async createTask(fileUrl: string): Promise<CreateTaskResponse> {
    const request: CreateTaskRequest = {
      url: fileUrl,
      is_ocr: true,
      enable_formula: true,
      enable_table: true,
      language: 'ch',
      extra_formats: ['docx'],
      model_version: 'vlm',
    };

    const response = await this.client.post<CreateTaskResponse>(
      '/extract/task',
      request
    );
    return response.data;
  }

  /**
   * 查询任务状态
   * GET /api/v4/extract/task/{task_id}
   */
  async queryTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await this.client.get<TaskStatusResponse>(
      `/extract/task/${taskId}`
    );
    return response.data;
  }

  /**
   * 创建批量任务 (URL 方式)
   * POST /api/v4/extract/task/batch
   */
  async createBatchTask(fileUrls: string[]): Promise<BatchTaskCreateResponse> {
    const request: BatchTaskCreateRequest = {
      files: fileUrls.map((url) => ({ url, is_ocr: true })),
      enable_formula: true,
      enable_table: true,
      language: 'ch',
      extra_formats: ['docx'],
      model_version: 'vlm',
    };

    const response = await this.client.post<BatchTaskCreateResponse>(
      '/extract/task/batch',
      request
    );
    return response.data;
  }

  /**
   * 查询批量任务结果
   * GET /api/v4/extract-results/batch/{batch_id}
   */
  async queryBatchResult(batchId: string): Promise<BatchResultResponse> {
    const response = await this.client.get<BatchResultResponse>(
      `/extract-results/batch/${batchId}`
    );
    return response.data;
  }

  /**
   * 下载并解压结果 ZIP
   */
  async downloadAndExtractResult(zipUrl: string, outputDir: string): Promise<string> {
    const response = await axios.get(zipUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });

    const zipPath = path.join(outputDir, 'result.zip');
    await fs.promises.writeFile(zipPath, response.data);

    // 解压
    const unzipper = await import('unzipper');
    await unzipper.Open.file(zipPath).then((d) =>
      d.extract({ path: outputDir, concurrency: 5 })
    );

    // 清理 zip 文件
    await fs.promises.unlink(zipPath).catch(() => {});

    return outputDir;
  }

  /**
   * 读取解压后的 Markdown 内容
   */
  async readMarkdownContent(outputDir: string): Promise<string> {
    const mdPath = path.join(outputDir, 'full.md');
    if (fs.existsSync(mdPath)) {
      return await fs.promises.readFile(mdPath, 'utf-8');
    }
    throw new Error('Markdown 文件不存在');
  }

  /**
   * 读取解压后的内容列表
   */
  async readContentList(outputDir: string): Promise<unknown[]> {
    const files = await fs.promises.readdir(outputDir);
    const contentListFile = files.find((f) => f.endsWith('_content_list.json'));
    if (contentListFile) {
      const content = await fs.promises.readFile(
        path.join(outputDir, contentListFile),
        'utf-8'
      );
      return JSON.parse(content);
    }
    throw new Error('Content list 文件不存在');
  }

  /**
   * 获取解压后的图片列表
   */
  async getImageFiles(outputDir: string): Promise<string[]> {
    const imagesDir = path.join(outputDir, 'images');
    if (fs.existsSync(imagesDir)) {
      const files = await fs.promises.readdir(imagesDir);
      return files.filter((f) => /\.(png|jpg|jpeg|gif|bmp)$/i.test(f));
    }
    return [];
  }
}

export const mineruService = new MineruService();
