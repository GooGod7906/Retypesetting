import { useState } from 'react';
import { FormatTemplate, FontSettings } from '../types/template';
import { FiChevronDown, FiChevronUp, FiDownload, FiSave, FiX } from 'react-icons/fi';

interface CustomTemplateEditorProps {
  initialTemplate?: FormatTemplate;
  onSave: (template: Omit<FormatTemplate, 'id'>) => void;
  onExport?: () => void;
  onCancel: () => void;
}

/** 创建空白自定义模板的默认值 */
function getDefaultTemplate(): Omit<FormatTemplate, 'id'> {
  const defaultHeading: FontSettings = {
    fontSize: 14,
    bold: true,
    color: '#000000',
    letterSpacing: 0,
    lineSpacing: 1.5,
    centered: false,
  };
  return {
    name: '自定义模板',
    description: '用户自定义排版模板',
    isPreset: false,
    pageSettings: {
      pageSize: 'A4',
      orientation: 'portrait',
      margins: { top: 25, bottom: 25, left: 25, right: 25 },
    },
    paragraphSettings: {
      lineSpacing: 1.5,
      paragraphSpacing: 3,
      firstLineIndent: 0,
    },
    fonts: {
      body: {
        chineseFont: 'SimSun',
        englishFont: 'Times New Roman',
        numberFont: 'Times New Roman',
        fontSize: 12,
        color: '#000000',
        letterSpacing: 0,
        lineSpacing: 1.5,
        centered: false,
      },
      headings: {
        level1: { ...defaultHeading, fontSize: 18 },
        level2: { ...defaultHeading, fontSize: 16 },
        level3: { ...defaultHeading, fontSize: 14 },
        level4: { ...defaultHeading, fontSize: 12 },
      },
      special: {
        questionNumber: { fontSize: 12, bold: true, color: '#000000' },
        option: { fontSize: 12, color: '#000000' },
        formula: { fontSize: 12, color: '#000000' },
        tableHeader: { fontSize: 11, bold: true, color: '#000000' },
      },
      footer: { show: false, font: 'SimSun', fontSize: 9, centered: true, footerFormat: '-第{current}页 共{total}页-' },
    },
    styles: {
      questionNumberFormat: '1.',
      showQuestionPoints: true,
      imagePosition: 'inline',
      tableStyle: {
        borderWidth: 0.5,
        borderColor: '#000000',
        headerBgColor: '#F2F2F2',
        cellPadding: 2,
      },
      optionLayout: 'default',
    },
    formulaSettings: { format: 'omml' },
  };
}

/** 可折叠分组面板 */
function Section({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="font-medium text-gray-700">{title}</span>
        {open ? <FiChevronUp className="w-4 h-4 text-gray-500" /> : <FiChevronDown className="w-4 h-4 text-gray-500" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  );
}

/** 通用输入行 — 紧凑布局 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <label className="w-16 shrink-0 text-xs text-gray-600 truncate">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/** 数值输入 */
function NumInput({ value, onChange, min, max, step, unit }: {
  value?: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min} max={max} step={step}
        className="w-16 px-1.5 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />
      {unit && <span className="text-xs text-gray-400 whitespace-nowrap">{unit}</span>}
    </div>
  );
}

/** 文本输入 */
function TextInput({ value, onChange, placeholder }: {
  value?: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
    />
  );
}

/** 选择器 */
function Select({ value, onChange, options }: {
  value?: string; onChange: (v: string) => void; options: { label: string; value: string }[];
}) {
  return (
    <select
      value={value ?? options[0]?.value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-1.5 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** 复选框 */
function Checkbox({ checked, onChange, label }: {
  checked?: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked ?? false}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
      />
      <span className="text-sm text-gray-600">{label}</span>
    </label>
  );
}

/** 颜色选择器 */
function ColorInput({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="color"
        value={value ?? '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="w-7 h-7 border border-gray-300 rounded cursor-pointer"
      />
      <span className="text-xs text-gray-400 font-mono">{value ?? '#000000'}</span>
    </div>
  );
}

/** 标题样式编辑（单级） */
function HeadingFields({ value, onChange }: {
  value: FontSettings;
  onChange: (v: FontSettings) => void;
}) {
  const patch = (partial: Partial<FontSettings>) => onChange({ ...value, ...partial });
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">
        <Field label="中文字体">
          <Select
            value={value.chineseFont ?? ''}
            onChange={(v) => patch({ chineseFont: v })}
            options={[
              { label: '跟随正文', value: '' },
              { label: '宋体', value: 'SimSun' },
              { label: '黑体', value: 'SimHei' },
              { label: '楷体', value: 'KaiTi' },
              { label: '仿宋', value: 'FangSong' },
              { label: '微软雅黑', value: 'Microsoft YaHei' },
            ]}
          />
        </Field>
        <Field label="英文字体">
          <Select
            value={value.englishFont ?? ''}
            onChange={(v) => patch({ englishFont: v })}
            options={[
              { label: '跟随正文', value: '' },
              { label: 'Times New Roman', value: 'Times New Roman' },
              { label: 'Arial', value: 'Arial' },
              { label: 'Calibri', value: 'Calibri' },
              { label: 'Georgia', value: 'Georgia' },
            ]}
          />
        </Field>
        <Field label="字号">
          <NumInput value={value.fontSize} onChange={(v) => patch({ fontSize: v })} min={6} max={72} unit="pt" />
        </Field>
        <Field label="字间距">
          <NumInput value={value.letterSpacing} onChange={(v) => patch({ letterSpacing: v })} min={0} max={10} step={0.1} unit="mm" />
        </Field>
        <Field label="行间距">
          <NumInput value={value.lineSpacing} onChange={(v) => patch({ lineSpacing: v })} min={0.5} max={5} step={0.1} unit="倍" />
        </Field>
        <Field label="颜色">
          <ColorInput value={value.color} onChange={(v) => patch({ color: v })} />
        </Field>
      </div>
      <div className="flex items-center gap-4">
        <Checkbox checked={value.bold} onChange={(v) => patch({ bold: v })} label="加粗" />
        <Checkbox checked={value.centered} onChange={(v) => patch({ centered: v })} label="居中" />
      </div>
    </div>
  );
}

export function CustomTemplateEditor({ initialTemplate, onSave, onExport, onCancel }: CustomTemplateEditorProps) {
  const [tpl, setTpl] = useState<Omit<FormatTemplate, 'id'>>(
    initialTemplate
      ? (() => { const { id, ...rest } = initialTemplate; return rest; })()
      : getDefaultTemplate()
  );

  const patch = <K extends keyof typeof tpl>(key: K, partial: Partial<(typeof tpl)[K]>) => {
    setTpl((prev) => ({ ...prev, [key]: { ...(prev[key] as object), ...partial } }));
  };

  const patchHeading = (level: 'level1' | 'level2' | 'level3' | 'level4', value: FontSettings) => {
    setTpl((prev) => ({
      ...prev,
      fonts: {
        ...prev.fonts,
        headings: { ...prev.fonts.headings, [level]: value },
      },
    }));
  };

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {/* 顶部操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-base font-semibold text-gray-800">
          {initialTemplate ? '编辑模板' : '新建自定义模板'}
        </h4>
        <div className="flex items-center gap-2">
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <FiDownload className="w-4 h-4" />
              导出
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiX className="w-4 h-4" />
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(tpl)}
            className="flex items-center gap-1 px-4 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <FiSave className="w-4 h-4" />
            保存
          </button>
        </div>
      </div>

      {/* 基本信息 */}
      <Section title="基本信息" defaultOpen>
        <Field label="模板名称">
          <TextInput value={tpl.name} onChange={(v) => setTpl((p) => ({ ...p, name: v }))} />
        </Field>
        <Field label="描述">
          <TextInput value={tpl.description} onChange={(v) => setTpl((p) => ({ ...p, description: v }))} />
        </Field>
      </Section>

      {/* 页面设置 */}
      <Section title="页面设置" defaultOpen>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">
          <Field label="纸张">
            <Select
              value={tpl.pageSettings.pageSize}
              onChange={(v) => patch('pageSettings', { pageSize: v as FormatTemplate['pageSettings']['pageSize'] })}
              options={[
                { label: 'A4', value: 'A4' },
                { label: 'A3', value: 'A3' },
                { label: 'B5', value: 'B5' },
                { label: 'Letter', value: 'Letter' },
                { label: '自定义', value: 'Custom' },
              ]}
            />
          </Field>
          <Field label="方向">
            <Select
              value={tpl.pageSettings.orientation ?? 'portrait'}
              onChange={(v) => patch('pageSettings', { orientation: v as 'portrait' | 'landscape' })}
              options={[
                { label: '纵向', value: 'portrait' },
                { label: '横向', value: 'landscape' },
              ]}
            />
          </Field>
          <Field label="总页数">
            <NumInput
              value={tpl.pageSettings.maxPages}
              onChange={(v) => patch('pageSettings', { maxPages: v || undefined })}
              min={0} max={9999}
            />
          </Field>
        </div>
        {tpl.pageSettings.pageSize === 'Custom' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="宽">
              <NumInput value={tpl.pageSettings.customWidth} onChange={(v) => patch('pageSettings', { customWidth: v })} min={50} max={500} unit="mm" />
            </Field>
            <Field label="高">
              <NumInput value={tpl.pageSettings.customHeight} onChange={(v) => patch('pageSettings', { customHeight: v })} min={50} max={500} unit="mm" />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
          <Field label="上">
            <NumInput value={tpl.pageSettings.margins.top} onChange={(v) => patch('pageSettings', { margins: { ...tpl.pageSettings.margins, top: v } })} min={0} max={100} unit="mm" />
          </Field>
          <Field label="下">
            <NumInput value={tpl.pageSettings.margins.bottom} onChange={(v) => patch('pageSettings', { margins: { ...tpl.pageSettings.margins, bottom: v } })} min={0} max={100} unit="mm" />
          </Field>
          <Field label="左">
            <NumInput value={tpl.pageSettings.margins.left} onChange={(v) => patch('pageSettings', { margins: { ...tpl.pageSettings.margins, left: v } })} min={0} max={100} unit="mm" />
          </Field>
          <Field label="右">
            <NumInput value={tpl.pageSettings.margins.right} onChange={(v) => patch('pageSettings', { margins: { ...tpl.pageSettings.margins, right: v } })} min={0} max={100} unit="mm" />
          </Field>
        </div>
      </Section>

      {/* 一级标题 */}
      <Section title="一级标题样式">
        <HeadingFields value={tpl.fonts.headings.level1} onChange={(v) => patchHeading('level1', v)} />
      </Section>

      {/* 二级标题 */}
      <Section title="二级标题样式">
        <HeadingFields value={tpl.fonts.headings.level2} onChange={(v) => patchHeading('level2', v)} />
      </Section>

      {/* 三级标题 */}
      <Section title="三级标题样式">
        <HeadingFields value={tpl.fonts.headings.level3} onChange={(v) => patchHeading('level3', v)} />
      </Section>

      {/* 四级标题 */}
      <Section title="四级标题样式">
        <HeadingFields value={tpl.fonts.headings.level4} onChange={(v) => patchHeading('level4', v)} />
      </Section>

      {/* 正文样式 */}
      <Section title="正文样式" defaultOpen>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">
          <Field label="中文字体">
            <Select
              value={tpl.fonts.body.chineseFont}
              onChange={(v) => patch('fonts', { body: { ...tpl.fonts.body, chineseFont: v } })}
              options={[
                { label: '宋体', value: 'SimSun' },
                { label: '黑体', value: 'SimHei' },
                { label: '楷体', value: 'KaiTi' },
                { label: '仿宋', value: 'FangSong' },
                { label: '微软雅黑', value: 'Microsoft YaHei' },
              ]}
            />
          </Field>
          <Field label="英文字体">
            <Select
              value={tpl.fonts.body.englishFont}
              onChange={(v) => patch('fonts', { body: { ...tpl.fonts.body, englishFont: v } })}
              options={[
                { label: 'Times New Roman', value: 'Times New Roman' },
                { label: 'Arial', value: 'Arial' },
                { label: 'Calibri', value: 'Calibri' },
                { label: 'Georgia', value: 'Georgia' },
              ]}
            />
          </Field>
          <Field label="字号">
            <NumInput value={tpl.fonts.body.fontSize} onChange={(v) => patch('fonts', { body: { ...tpl.fonts.body, fontSize: v } })} min={6} max={72} unit="pt" />
          </Field>
          <Field label="字间距">
            <NumInput value={tpl.fonts.body.letterSpacing} onChange={(v) => patch('fonts', { body: { ...tpl.fonts.body, letterSpacing: v } })} min={0} max={10} step={0.1} unit="mm" />
          </Field>
          <Field label="行间距">
            <NumInput value={tpl.paragraphSettings.lineSpacing} onChange={(v) => patch('paragraphSettings', { lineSpacing: v })} min={0.5} max={5} step={0.1} unit="倍" />
          </Field>
          <Field label="段间距">
            <NumInput value={tpl.paragraphSettings.paragraphSpacing} onChange={(v) => patch('paragraphSettings', { paragraphSpacing: v })} min={0} max={50} unit="mm" />
          </Field>
          <Field label="首行缩进">
            <NumInput value={tpl.paragraphSettings.firstLineIndent} onChange={(v) => patch('paragraphSettings', { firstLineIndent: v })} min={0} max={50} unit="mm" />
          </Field>
          <Field label="颜色">
            <ColorInput value={tpl.fonts.body.color} onChange={(v) => patch('fonts', { body: { ...tpl.fonts.body, color: v } })} />
          </Field>
        </div>
        <Checkbox
          checked={tpl.fonts.body.centered}
          onChange={(v) => patch('fonts', { body: { ...tpl.fonts.body, centered: v } })}
          label="正文居中"
        />
        <Field label="选项布局">
          <Select
            value={tpl.styles.optionLayout}
            onChange={(v) => patch('styles', { optionLayout: v as 'default' | 'even' })}
            options={[
              { label: '默认', value: 'default' },
              { label: '均匀分布', value: 'even' },
            ]}
          />
        </Field>
        <p className="text-xs text-gray-400 ml-16">
          均匀分布：检测到 A B C D 等选项时，自动排为一行两个或每行一个
        </p>
      </Section>

      {/* 页脚设置 */}
      <Section title="页脚设置">
        <Checkbox
          checked={tpl.fonts.footer.show}
          onChange={(v) => patch('fonts', { footer: { ...tpl.fonts.footer, show: v } })}
          label="显示页脚"
        />
        {tpl.fonts.footer.show && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">
              <Field label="字体">
                <TextInput
                  value={tpl.fonts.footer.font}
                  onChange={(v) => patch('fonts', { footer: { ...tpl.fonts.footer, font: v } })}
                  placeholder="SimSun"
                />
              </Field>
              <Field label="字号">
                <NumInput
                  value={tpl.fonts.footer.fontSize}
                  onChange={(v) => patch('fonts', { footer: { ...tpl.fonts.footer, fontSize: v } })}
                  min={6} max={24} unit="pt"
                />
              </Field>
              <Field label="居中">
                <Checkbox
                  checked={tpl.fonts.footer.centered}
                  onChange={(v) => patch('fonts', { footer: { ...tpl.fonts.footer, centered: v } })}
                  label="居中"
                />
              </Field>
            </div>
            <Field label="页脚格式">
              <TextInput
                value={tpl.fonts.footer.footerFormat ?? '-第{current}页 共{total}页-'}
                onChange={(v) => patch('fonts', { footer: { ...tpl.fonts.footer, footerFormat: v } })}
              />
            </Field>
            <p className="text-xs text-gray-400 ml-16">
              {'{current}'} = 当前页码，{'{total}'} = 总页数。示例：-第{'{current}'}页 共{'{total}'}页-
            </p>
          </div>
        )}
      </Section>

      {/* LaTeX / 公式渲染 */}
      <Section title="公式渲染方式">
        <Field label="渲染方式">
          <Select
            value={tpl.formulaSettings?.format ?? 'omml'}
            onChange={(v) => setTpl((p) => ({ ...p, formulaSettings: { format: v as 'omml' | 'image' | 'latex' } }))}
            options={[
              { label: 'OMML (Word 原生)', value: 'omml' },
              { label: '图片渲染', value: 'image' },
              { label: 'LaTeX 源码', value: 'latex' },
            ]}
          />
        </Field>
      </Section>
    </div>
  );
}
