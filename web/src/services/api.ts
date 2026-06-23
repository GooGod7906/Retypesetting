import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// 上传文件
export async function uploadFile(file: File): Promise<{ fileId: string; fileName: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000, // 5 min for large files
  });
  return response.data.data;
}

// 创建解析任务
export async function createParseTask(fileId: string): Promise<{ batchId: string }> {
  const response = await api.post('/parse/create', { fileId });
  return response.data.data;
}

// 查询任务状态
export async function getTaskStatus(batchId: string): Promise<{
  batchId: string;
  state: string;
  progress?: { extracted_pages: number; total_pages: number; start_time: string };
  fullZipUrl?: string;
  errMsg?: string;
}> {
  const response = await api.get(`/parse/status/${batchId}`);
  return response.data.data;
}

// 获取解析结果
export async function getParseResult(batchId: string): Promise<{
  batchId: string;
  markdown: string;
  images: string[];
}> {
  const response = await api.get(`/parse/result/${batchId}`);
  return response.data.data;
}

// 执行排版
export async function formatDocument(batchId: string, templateId: string): Promise<{
  fileId: string;
  fileName: string;
}> {
  const response = await api.post('/format', { batchId, templateId });
  return response.data.data;
}

// 下载文件
export function getDownloadUrl(fileId: string): string {
  return `/api/download/${fileId}`;
}
