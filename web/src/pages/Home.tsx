import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUploader } from '../components/FileUploader';
import { ParseProgress } from '../components/ParseProgress';
import { TemplateSelector } from '../components/TemplateSelector';
import { PreviewPanel } from '../components/PreviewPanel';
import { DownloadButton } from '../components/DownloadButton';
import { useTaskStore } from '../store/taskStore';
import { useTemplateStore } from '../store/templateStore';
import * as api from '../services/api';
import { FiRefreshCw, FiFileText } from 'react-icons/fi';

export function Home() {
  const task = useTaskStore();
  const selectedTemplateId = useTemplateStore((s) => s.selectedTemplateId);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  // 上传文件
  const handleFileSelect = useCallback(
    async (file: File) => {
      task.reset();
      task.setState('uploading');

      try {
        const { fileId, fileName } = await api.uploadFile(file);
        task.setFile(fileId, fileName);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '上传失败';
        task.setError(msg);
      }
    },
    [task]
  );

  // 开始解析
  const handleStartParse = useCallback(async () => {
    if (!task.fileId) return;

    try {
      const { batchId } = await api.createParseTask(task.fileId);
      task.setBatchId(batchId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建解析任务失败';
      task.setError(msg);
    }
  }, [task]);

  // 轮询任务状态
  useEffect(() => {
    if (task.state !== 'parsing' || !task.batchId) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        const status = await api.getTaskStatus(task.batchId!);

        if (status.progress) {
          task.setProgress(
            status.progress.extracted_pages,
            status.progress.total_pages,
            status.progress.start_time
          );
        }

        if (status.state === 'done') {
          // 获取解析结果
          const result = await api.getParseResult(task.batchId!);
          task.setParseResult(result.markdown, result.images);
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        } else if (status.state === 'failed') {
          task.setError(status.errMsg || '解析失败');
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch {
        // 轮询失败不中断
      }
    };

    // 立即查询一次
    poll();
    // 每 3 秒轮询
    pollingRef.current = setInterval(poll, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [task.state, task.batchId, task]);

  // 执行排版
  const handleFormat = useCallback(async () => {
    if (!task.batchId || !selectedTemplateId) return;
    task.setState('formatting');

    try {
      const { fileId, fileName } = await api.formatDocument(
        task.batchId,
        selectedTemplateId
      );
      task.setOutputFile(fileId, fileName);
      // 生成完成后收起预览，滚动到下载区域
      setPreviewCollapsed(true);
      setTimeout(() => {
        downloadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '排版失败';
      task.setError(msg);
    }
  }, [task, selectedTemplateId]);

  // 重新开始
  const handleReset = useCallback(() => {
    task.reset();
    setPreviewCollapsed(false);
  }, [task]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <FiFileText className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">扫描件重排版</h1>
              <p className="text-sm text-gray-500">上传 PDF 扫描件，自动识别并按模板重新排版</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Step 1: 上传 */}
        <section className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            1. 上传 PDF 文件
          </h2>
          {task.state === 'idle' || task.state === 'error' ? (
            <FileUploader onFileSelect={handleFileSelect} />
          ) : (
            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <FiFileText className="w-8 h-8 text-blue-500" />
                <div>
                  <p className="font-medium text-gray-800">{task.fileName}</p>
                  <p className="text-sm text-gray-500">文件已上传</p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <FiRefreshCw className="w-4 h-4" />
                重新上传
              </button>
            </div>
          )}
        </section>

        {/* Step 2: 解析 */}
        {task.state === 'uploaded' && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              2. 开始解析
            </h2>
            <p className="text-gray-600 mb-4">
              文件将上传到 MinerU 进行 OCR 识别和结构化解析
            </p>
            <button
              onClick={handleStartParse}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                         transition-colors font-medium"
            >
              开始解析
            </button>
          </section>
        )}

        {/* 进度显示 */}
        {(task.state === 'parsing' || task.state === 'formatting') && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              {task.state === 'parsing' ? '2. 正在解析' : '4. 正在排版'}
            </h2>
            <ParseProgress
              state={task.state}
              progress={task.progress}
              error={task.error}
            />
          </section>
        )}

        {/* 错误显示 */}
        {task.state === 'error' && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <ParseProgress state="error" error={task.error} />
          </section>
        )}

        {/* Step 3: 选择模板（解析完成后始终显示，方便重新生成） */}
        {(task.state === 'parsed' || task.state === 'done') && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <TemplateSelector />
          </section>
        )}

        {/* 预览 */}
        {task.markdown && (task.state === 'parsed' || task.state === 'done') && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <PreviewPanel
              markdown={task.markdown}
              collapsed={previewCollapsed}
              onToggleCollapse={() => setPreviewCollapsed((c) => !c)}
            />
          </section>
        )}

        {/* Step 4: 生成（解析完成后始终显示，方便重新生成） */}
        {(task.state === 'parsed' || task.state === 'done') && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              {task.state === 'done' ? '重新生成' : '3. 生成文档'}
            </h2>
            <button
              onClick={handleFormat}
              disabled={!selectedTemplateId}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                         transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              生成 DOCX
            </button>
          </section>
        )}

        {/* Step 5: 下载（仅在生成完成后显示） */}
        {task.state === 'done' && (
          <section ref={downloadRef} className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              下载结果
            </h2>
            <div className="flex items-center gap-4">
              <DownloadButton
                fileId={task.outputFileId}
                fileName={task.outputFileName}
              />
              <button
                onClick={handleReset}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                处理新文件
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
