import { FiLoader, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';

interface ParseProgressProps {
  state: string;
  progress?: {
    extractedPages: number;
    totalPages: number;
    startTime?: string;
  };
  error?: string;
}

export function ParseProgress({ state, progress, error }: ParseProgressProps) {
  if (state === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <FiAlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-800">解析失败</p>
            <p className="text-sm text-red-600">{error || '未知错误'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'done' || state === 'parsed') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <FiCheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
          <p className="font-medium text-green-800">解析完成</p>
        </div>
      </div>
    );
  }

  if (state === 'parsing' || state === 'formatting') {
    const percent = progress
      ? Math.round((progress.extractedPages / Math.max(progress.totalPages, 1)) * 100)
      : 0;

    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-3">
          <FiLoader className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
          <p className="font-medium text-blue-800">
            {state === 'parsing' ? '正在解析文档...' : '正在生成文档...'}
          </p>
        </div>
        {progress && (
          <div>
            <div className="flex justify-between text-sm text-blue-700 mb-1">
              <span>进度</span>
              <span>{progress.extractedPages} / {progress.totalPages} 页</span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
