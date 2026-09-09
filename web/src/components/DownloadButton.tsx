import { FiDownload } from 'react-icons/fi';

interface DownloadButtonProps {
  fileId?: string;
  fileName?: string;
}

export function DownloadButton({ fileId, fileName }: DownloadButtonProps) {
  if (!fileId) return null;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `./api/download/${fileId}`;
    link.download = fileName || 'output.docx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <button
      onClick={handleDownload}
      className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg
                 hover:bg-green-700 transition-colors font-medium"
    >
      <FiDownload className="w-5 h-5" />
      下载 DOCX 文件
      {fileName && <span className="text-green-200 text-sm">({fileName})</span>}
    </button>
  );
}
