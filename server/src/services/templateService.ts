import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { FormatTemplate } from '../types/template';
import { ensureDir, readJsonFile, writeJsonFile } from '../utils/fileUtils';

const TEMPLATES_FILE = 'templates.json';

// 预设模板
const PRESET_TEMPLATES: FormatTemplate[] = [
  {
    id: 'preset-standard',
    name: '标准试卷模板',
    description: '标准自定义排版模板',
    isPreset: true,
    pageSettings: {
      pageSize: 'A4',
      orientation: 'portrait',
      margins: { top: 18, bottom: 20, left: 20, right: 18 },
      maxPages: 16,
    },
    paragraphSettings: {
      lineSpacing: 1.25,
      paragraphSpacing: 3,
      firstLineIndent: 0,
      centered: true,
    },
    fonts: {
      body: {
        chineseFont: 'SimHei',
        englishFont: 'Times New Roman',
        numberFont: 'Times New Roman',
        fontSize: 10.5,
        color: '#000000',
        letterSpacing: 0,
        lineSpacing: 1.5,
      },
      headings: {
        level1: { fontSize: 18, bold: true, color: '#000000', letterSpacing: 0, lineSpacing: 1.25, centered: true, chineseFont: 'SimSun' },
        level2: { fontSize: 12, bold: true, color: '#000000', letterSpacing: 0, lineSpacing: 1.25, centered: false },
        level3: { fontSize: 14, bold: true, color: '#000000', letterSpacing: 0, lineSpacing: 1.25 },
        level4: { fontSize: 12, bold: true, color: '#000000', letterSpacing: 0, lineSpacing: 1.25 },
      },
      special: {
        questionNumber: { fontSize: 12, bold: true, color: '#000000' },
        option: { fontSize: 12, color: '#000000' },
        formula: { fontSize: 12, color: '#000000' },
        tableHeader: { fontSize: 11, bold: true, color: '#000000' },
      },
      footer: { show: true, font: 'SimSun', fontSize: 9, centered: true, footerFormat: '-第{current}页 共{total}页-' },
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
      optionLayout: 'even',
    },
    formulaSettings: { format: 'omml' },
  },
];

class TemplateService {
  private templatesPath: string;
  private templates: Map<string, FormatTemplate> = new Map();
  private initialized = false;

  constructor() {
    this.templatesPath = path.join(config.storage.templateDir, TEMPLATES_FILE);
  }

  /**
   * 初始化模板服务
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    ensureDir(config.storage.templateDir);

    if (fs.existsSync(this.templatesPath)) {
      const templates = await readJsonFile<FormatTemplate[]>(this.templatesPath);
      templates.forEach((t) => this.templates.set(t.id, t));
    }

    // 确保预设模板存在且为最新定义（预设模板不可修改，直接覆盖）
    for (const preset of PRESET_TEMPLATES) {
      this.templates.set(preset.id, preset);
    }

    await this.save();
    this.initialized = true;
  }

  /**
   * 保存模板到文件
   */
  private async save(): Promise<void> {
    const templates = Array.from(this.templates.values());
    await writeJsonFile(this.templatesPath, templates);
  }

  /**
   * 获取所有模板
   */
  async getAllTemplates(): Promise<FormatTemplate[]> {
    await this.init();
    return Array.from(this.templates.values());
  }

  /**
   * 获取单个模板
   */
  async getTemplate(id: string): Promise<FormatTemplate | undefined> {
    await this.init();
    return this.templates.get(id);
  }

  /**
   * 创建模板
   */
  async createTemplate(template: Omit<FormatTemplate, 'id'>): Promise<FormatTemplate> {
    await this.init();
    const newTemplate: FormatTemplate = {
      ...template,
      id: uuidv4(),
    };
    this.templates.set(newTemplate.id, newTemplate);
    await this.save();
    return newTemplate;
  }

  /**
   * 更新模板
   */
  async updateTemplate(id: string, updates: Partial<FormatTemplate>): Promise<FormatTemplate | undefined> {
    await this.init();
    const existing = this.templates.get(id);
    if (!existing) return undefined;

    // 预设模板不可修改核心属性
    if (existing.isPreset) {
      throw new Error('预设模板不可修改');
    }

    const updated = { ...existing, ...updates, id };
    this.templates.set(id, updated);
    await this.save();
    return updated;
  }

  /**
   * 删除模板
   */
  async deleteTemplate(id: string): Promise<boolean> {
    await this.init();
    const existing = this.templates.get(id);
    if (!existing) return false;

    if (existing.isPreset) {
      throw new Error('预设模板不可删除');
    }

    this.templates.delete(id);
    await this.save();
    return true;
  }

  /**
   * 导出模板为 JSON 字符串
   */
  async exportTemplate(id: string): Promise<string | undefined> {
    await this.init();
    const template = this.templates.get(id);
    if (!template) return undefined;
    return JSON.stringify(template, null, 2);
  }
}

export const templateService = new TemplateService();
