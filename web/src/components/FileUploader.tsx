import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { FiUploadCloud, FiFile } from 'react-icons/fi';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export function FileUploader({ onFileSelect, disabled }: FileUploaderProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFileSelect(acceptedFiles[0]);
      }
    },
    [onFileSelect]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: 200 * 1024 * 1024, // 200MB
    multiple: false,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
        transition-all duration-200 ease-in-out
        ${isDragActive && !isDragReject ? 'border-blue-400 bg-blue-50' : ''}
        ${isDragReject ? 'border-red-400 bg-red-50' : ''}
        ${!isDragActive ? 'border-gray-300 hover:border-blue-400 hover:bg-gray-50' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-4">
        {isDragActive ? (
          <FiUploadCloud className="w-12 h-12 text-blue-500" />
        ) : (
          <FiFile className="w-12 h-12 text-gray-400" />
        )}
        <div>
          <p className="text-lg font-medium text-gray-700">
            {isDragActive
              ? isDragReject
                ? '仅支持 PDF 文件'
                : '释放文件以上传'
              : '拖拽 PDF 文件到此处，或点击选择文件'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            支持最大 200MB 的 PDF 文件
          </p>
        </div>
      </div>
    </div>
  );
}
