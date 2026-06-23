import { FiChevronDown, FiChevronUp } from 'react-icons/fi';

interface PreviewPanelProps {
  markdown?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function PreviewPanel({ markdown, collapsed, onToggleCollapse }: PreviewPanelProps) {
  if (!markdown) {
    return (
      <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
        暂无预览内容
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div
        className="border-b bg-gray-50 px-4 py-2 flex items-center justify-between cursor-pointer select-none"
        onClick={onToggleCollapse}
      >
        <h3 className="font-medium text-gray-700">解析结果预览</h3>
        {collapsed ? (
          <span className="flex items-center gap-1 text-sm text-gray-500">
            展开 <FiChevronDown className="w-4 h-4" />
          </span>
        ) : (
          <span className="flex items-center gap-1 text-sm text-gray-500">
            收起 <FiChevronUp className="w-4 h-4" />
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="p-6 max-h-[600px] overflow-y-auto">
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
            {markdown}
          </pre>
        </div>
      )}
    </div>
  );
}
