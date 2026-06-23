export type TaskState =
  | 'idle'
  | 'uploading'
  | 'uploaded'
  | 'parsing'
  | 'parsed'
  | 'formatting'
  | 'done'
  | 'error';

export interface TaskProgress {
  extractedPages: number;
  totalPages: number;
  startTime?: string;
}

export interface TaskState_data {
  fileId?: string;
  fileName?: string;
  batchId?: string;
  state: TaskState;
  progress?: TaskProgress;
  markdown?: string;
  images?: string[];
  outputFileId?: string;
  outputFileName?: string;
  error?: string;
}
