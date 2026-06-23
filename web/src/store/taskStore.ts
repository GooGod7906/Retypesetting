import { create } from 'zustand';
import { TaskState_data, TaskState } from '../types/task';

interface TaskStore extends TaskState_data {
  setFile: (fileId: string, fileName: string) => void;
  setBatchId: (batchId: string) => void;
  setState: (state: TaskState) => void;
  setProgress: (extractedPages: number, totalPages: number, startTime?: string) => void;
  setParseResult: (markdown: string, images: string[]) => void;
  setOutputFile: (fileId: string, fileName: string) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialState: TaskState_data = {
  state: 'idle',
};

export const useTaskStore = create<TaskStore>((set) => ({
  ...initialState,

  setFile: (fileId, fileName) =>
    set({ fileId, fileName, state: 'uploaded' }),

  setBatchId: (batchId) =>
    set({ batchId, state: 'parsing' }),

  setState: (state) =>
    set({ state }),

  setProgress: (extractedPages, totalPages, startTime) =>
    set({
      progress: { extractedPages, totalPages, startTime },
    }),

  setParseResult: (markdown, images) =>
    set({ markdown, images, state: 'parsed' }),

  setOutputFile: (fileId, fileName) =>
    set({ outputFileId: fileId, outputFileName: fileName, state: 'done' }),

  setError: (error) =>
    set({ error, state: 'error' }),

  reset: () =>
    set(initialState),
}));
