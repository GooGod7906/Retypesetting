import { useEffect, useState } from 'react';
import { useTemplateStore } from '../store/templateStore';
import { FormatTemplate } from '../types/template';
import { CustomTemplateEditor } from './CustomTemplateEditor';
import { FiCheck, FiPlus, FiEdit3, FiTrash2 } from 'react-icons/fi';

interface TemplateSelectorProps {
  disabled?: boolean;
}

export function TemplateSelector({ disabled }: TemplateSelectorProps) {
  const {
    templates,
    selectedTemplateId,
    loading,
    editingTemplateId,
    fetchTemplates,
    selectTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    exportTemplate,
    startEditing,
    stopEditing,
  } = useTemplateStore();

  const [showNewEditor, setShowNewEditor] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // 当前正在编辑的模板
  const editingTemplate = editingTemplateId
    ? templates.find((t) => t.id === editingTemplateId)
    : undefined;

  if (loading) {
    return <div className="text-gray-500">加载模板中...</div>;
  }

  const handleSaveNew = async (tpl: Omit<FormatTemplate, 'id'>) => {
    await createTemplate(tpl);
    setShowNewEditor(false);
  };

  const handleSaveEdit = async (tpl: Omit<FormatTemplate, 'id'>) => {
    if (editingTemplateId) {
      await updateTemplate(editingTemplateId, tpl);
      stopEditing();
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除此模板吗？')) {
      await deleteTemplate(id);
    }
  };

  const handleExport = async (id: string) => {
    await exportTemplate(id);
  };

  // 正在编辑已有模板
  if (editingTemplate) {
    return (
      <section className="bg-white rounded-xl shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">编辑模板</h3>
        <CustomTemplateEditor
          initialTemplate={editingTemplate}
          onSave={handleSaveEdit}
          onExport={() => handleExport(editingTemplate.id)}
          onCancel={stopEditing}
        />
      </section>
    );
  }

  // 正在新建自定义模板
  if (showNewEditor) {
    return (
      <section className="bg-white rounded-xl shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">新建自定义模板</h3>
        <CustomTemplateEditor
          onSave={handleSaveNew}
          onCancel={() => setShowNewEditor(false)}
        />
      </section>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-800 mb-3">选择排版模板</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => selectTemplate(template.id)}
            disabled={disabled}
            className={`
              relative p-4 rounded-lg border-2 text-left transition-all
              ${selectedTemplateId === template.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {selectedTemplateId === template.id && (
              <FiCheck className="absolute top-2 right-2 w-5 h-5 text-blue-500" />
            )}
            <p className="font-medium text-gray-800">{template.name}</p>
            {template.description && (
              <p className="text-sm text-gray-500 mt-1">{template.description}</p>
            )}
            <div className="mt-2 text-xs text-gray-400">
              {template.pageSettings.pageSize}
              {template.pageSettings.orientation === 'landscape' ? ' 横向' : ''} ·
              {template.fonts.body.fontSize}pt ·
              {template.paragraphSettings.lineSpacing}倍行距
            </div>
            {template.isPreset && (
              <span className="inline-block mt-2 px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
                预设
              </span>
            )}

            {/* 非预设模板的编辑/删除/导出按钮 */}
            {!template.isPreset && !disabled && (
              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport(template.id);
                  }}
                  className="p-1 text-gray-400 hover:text-green-600 rounded transition-colors"
                  title="导出模板"
                >
                  <FiPlus className="w-3.5 h-3.5 rotate-45" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditing(template.id);
                  }}
                  className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                  title="编辑模板"
                >
                  <FiEdit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(template.id);
                  }}
                  className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
                  title="删除模板"
                >
                  <FiTrash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </button>
        ))}

        {/* 新建自定义模板卡片 */}
        {!disabled && (
          <button
            onClick={() => setShowNewEditor(true)}
            className="p-4 rounded-lg border-2 border-dashed border-gray-300 text-left
                       hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer
                       flex flex-col items-center justify-center gap-2 min-h-[120px]"
          >
            <FiPlus className="w-6 h-6 text-gray-400" />
            <span className="text-sm text-gray-500">自定义模板</span>
          </button>
        )}
      </div>
    </div>
  );
}
