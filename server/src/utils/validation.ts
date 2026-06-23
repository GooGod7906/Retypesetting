/**
 * 参数验证工具
 */

export function validateTaskId(taskId: string): boolean {
  return typeof taskId === 'string' && taskId.length > 0 && taskId.length <= 128;
}

export function validateTemplateId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 64;
}

export function validateFileId(fileId: string): boolean {
  return typeof fileId === 'string' && fileId.length > 0;
}

export function validatePageRanges(pageRanges: string): boolean {
  // 支持格式: "1-5", "1,3,5", "2--2"
  const pattern = /^(\d+(-\d+)?|\d+--?\d+)(,\d+(-\d+)?)*$/;
  return pattern.test(pageRanges);
}
