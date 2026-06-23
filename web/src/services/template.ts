import axios from 'axios';
import { FormatTemplate } from '../types/template';

const api = axios.create({ baseURL: '/api/templates' });

export async function getAllTemplates(): Promise<FormatTemplate[]> {
  const response = await api.get('/');
  return response.data.data;
}

export async function getTemplate(id: string): Promise<FormatTemplate> {
  const response = await api.get(`/${id}`);
  return response.data.data;
}

export async function createTemplate(template: Omit<FormatTemplate, 'id'>): Promise<FormatTemplate> {
  const response = await api.post('/', template);
  return response.data.data;
}

export async function updateTemplate(id: string, updates: Partial<FormatTemplate>): Promise<FormatTemplate> {
  const response = await api.put(`/${id}`, updates);
  return response.data.data;
}

export async function deleteTemplate(id: string): Promise<void> {
  await api.delete(`/${id}`);
}

/**
 * 导出模板为 JSON 文件并触发下载
 */
export async function exportTemplate(id: string): Promise<void> {
  const response = await api.get(`/export/${id}`, { responseType: 'blob' });

  // 从 Content-Disposition 获取文件名
  const disposition = response.headers['content-disposition'] as string | undefined;
  let fileName = 'template.json';
  if (disposition) {
    const match = disposition.match(/filename\*=UTF-8''(.+)/);
    if (match) {
      fileName = decodeURIComponent(match[1]);
    }
  }

  const url = URL.createObjectURL(response.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
