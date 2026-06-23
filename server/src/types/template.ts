/**
 * 格式模板类型定义
 */

export interface FontSettings {
  chineseFont?: string;
  englishFont?: string;
  fontSize: number;     // pt
  bold?: boolean;
  italic?: boolean;
  color?: string;       // hex color
  lineSpacing?: number;
  letterSpacing?: number; // 字间距 mm
  centered?: boolean;   // 是否居中
}

export interface PageSettings {
  pageSize: 'A4' | 'A3' | 'B5' | 'Letter' | 'Custom';
  customWidth?: number;  // mm
  customHeight?: number; // mm
  orientation?: 'portrait' | 'landscape'; // 纸张方向
  maxPages?: number;     // 总页数限制
  margins: {
    top: number;     // mm
    bottom: number;  // mm
    left: number;    // mm
    right: number;   // mm
  };
}

export interface ParagraphSettings {
  lineSpacing: number;      // 行距倍数
  paragraphSpacing: number; // 段间距 mm
  firstLineIndent: number;  // 首行缩进 mm
}

export interface TableStyleSettings {
  borderWidth: number;  // pt
  borderColor: string;
  headerBgColor: string;
  cellPadding: number;  // mm
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
