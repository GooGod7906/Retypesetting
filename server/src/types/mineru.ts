/**
 * MinerU API 类型定义
 * 基于 MinerU 精准解析 API v4
 */

// 任务状态
export type TaskState =
  | 'waiting-file'
  | 'pending'
  | 'running'
  | 'converting'
  | 'done'
  | 'failed';

// 模型版本
export type ModelVersion = 'pipeline' | 'vlm' | 'MinerU-HTML';

// ============ 批量上传申请 URL ============

export interface BatchUploadFileRequest {
  name: string;
  is_ocr?: boolean;
  data_id?: string;
  page_ranges?: string;
}

export interface BatchUploadUrlRequest {
  files: BatchUploadFileRequest[];
  enable_formula?: boolean;
  enable_table?: boolean;
  language?: string;
  callback?: string;
  seed?: string;
  extra_formats?: string[];
  model_version?: ModelVersion;
}

export interface BatchUploadUrlResponse {
  code: number;
  msg: string;
  trace_id: string;
  data: {
    batch_id: string;
    file_urls: string[];
  };
}

// ============ 单文件创建任务 ============

export interface CreateTaskRequest {
  url: string;
  is_ocr?: boolean;
  enable_formula?: boolean;
  enable_table?: boolean;
  language?: string;
  data_id?: string;
  callback?: string;
  seed?: string;
  extra_formats?: string[];
  page_ranges?: string;
  model_version?: ModelVersion;
  no_cache?: boolean;
  cache_tolerance?: number;
}

export interface CreateTaskResponse {
  code: number;
  msg: string;
  trace_id: string;
  data: {
    task_id: string;
  };
}

// ============ 任务状态查询 ============

export interface ExtractProgress {
  extracted_pages: number;
  total_pages: number;
  start_time: string;
}

export interface TaskStatusResponse {
  code: number;
  msg: string;
  trace_id: string;
  data: {
    task_id: string;
    data_id?: string;
    state: TaskState;
    full_zip_url?: string;
    err_msg?: string;
    extract_progress?: ExtractProgress;
  };
}

// ============ 批量任务创建 (URL 方式) ============

export interface BatchTaskFileRequest {
  url: string;
  is_ocr?: boolean;
  data_id?: string;
  page_ranges?: string;
}

export interface BatchTaskCreateRequest {
  files: BatchTaskFileRequest[];
  enable_formula?: boolean;
  enable_table?: boolean;
  language?: string;
  callback?: string;
  seed?: string;
  extra_formats?: string[];
  model_version?: ModelVersion;
  no_cache?: boolean;
  cache_tolerance?: number;
}

export interface BatchTaskCreateResponse {
  code: number;
  msg: string;
  trace_id: string;
  data: {
    batch_id: string;
  };
}

// ============ 批量结果查询 ============

export interface BatchExtractResult {
  file_name: string;
  state: TaskState;
  err_msg?: string;
  full_zip_url?: string;
  data_id?: string;
  extract_progress?: ExtractProgress;
}

export interface BatchResultResponse {
  code: number;
  msg: string;
  trace_id: string;
  data: {
    batch_id: string;
    extract_result: BatchExtractResult[];
  };
}

// ============ 解析结果结构 ============

export interface ParseResult {
  taskId: string;
  batchId?: string;
  state: TaskState;
  fullZipUrl?: string;
  markdown?: string;
  contentList?: ContentListItem[];
  images?: string[];
  errMsg?: string;
  progress?: ExtractProgress;
}

export interface ContentListItem {
  type: string;
  text?: string;
  img_path?: string;
  table?: string[][];
  [key: string]: unknown;
}
