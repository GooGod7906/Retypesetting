/**
 * 格式模板类型定义（前端）
 */

export interface FontSettings {
  chineseFont?: string;
  englishFont?: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  lineSpacing?: number;
  letterSpacing?: number; // 字间距 mm
  centered?: boolean;   // 是否居中
}

export interface PageSettings {
  pageSize: 'A4' | 'A3' | 'B5' | 'Letter' | 'Custom';
  customWidth?: number;
  customHeight?: number;
  orientation?: 'portrait' | 'landscape';
  maxPages?: number;
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

export interface ParagraphSettings {
  lineSpacing: number;
  paragraphSpacing: number;
  firstLineIndent: number;
}

export interface TableStyleSettings {
  borderWidth: number;
  borderColor: string;
  headerBgColor: string;
  cellPadding: number;
}

export interface TemplateFormulaSettings {
  format: 'omml' | 'image' | 'latex';
}

export interface FooterSettings {
  show: boolean;
  font?: string;
  fontSize?: number;
  centered?: boolean;
  footerFormat?: string; // 页脚格式，如 "-第{current}页 共{total}页-"
}

export interface FormatTemplate {
  id: string;
  name: string;
  description?: string;
  isPreset: boolean;

  pageSettings: PageSettings;
  paragraphSettings: ParagraphSettings;

  fonts: {
    body: FontSettings & {
      chineseFont: string;
      englishFont: string;
      numberFont: string;
    };
    headings: {
      level1: FontSettings;
      level2: FontSettings;
      level3: FontSettings;
      level4: FontSettings;
    };
    special: {
      questionNumber: FontSettings;
      option: FontSettings;
      formula: FontSettings;
      tableHeader: FontSettings;
    };
    footer: FooterSettings;
  };

  styles: {
    questionNumberFormat: '1.' | '1、' | '(1)' | '①';
    showQuestionPoints: boolean;
    imagePosition: 'inline' | 'float';
    tableStyle: TableStyleSettings;
    optionLayout: 'default' | 'even'; // 选项布局：默认 / 均匀分布
  };

  formulaSettings?: TemplateFormulaSettings;
}
