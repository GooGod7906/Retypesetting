# 扫描件重排版项目设计方案

## 项目概述

本项目旨在开发一个 Web 应用，用于将扫描件（主要是试卷等学习资料的 PDF 扫描版）重排版为指定格式。用户上传 PDF 文件后，系统通过 MinerU API 进行识别解析，然后根据用户设置或预设模板进行排版，最终生成格式化的 DOCX 文件。

## 技术架构

### 前端 (Vite + React + TypeScript)

```
web/
├── src/
│   ├── components/          # UI 组件
│   │   ├── FileUploader/    # PDF 上传组件 (限制 200MB)
│   │   ├── TemplateEditor/  # 格式模板编辑器
│   │   ├── PresetTemplates/ # 预设模板选择
│   │   ├── ParseProgress/   # 解析进度显示
│   │   ├── PreviewPanel/    # 结果预览面板
│   │   └── DownloadButton/  # 下载按钮
│   ├── pages/
│   │   ├── Home/            # 主页 - 上传和设置
│   │   ├── Editor/          # 模板编辑页
│   │   └── History/         # 历史记录页
│   ├── services/
│   │   ├── api.ts           # API 调用封装
│   │   ├── mineru.ts        # MinerU API 服务
│   │   └── template.ts      # 模板管理服务
│   ├── store/
│   │   ├── taskStore.ts     # 任务状态管理
│   │   ├── templateStore.ts # 模板状态管理
│   ├── types/
│   │   ├── mineru.ts        # MinerU 相关类型定义
│   │   ├── template.ts      # 模板相关类型定义
│   │   └── task.ts          # 任务相关类型定义
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── public/
├── package.json
├── vite.config.ts
├── tsconfig.json
└── .env.example
```

### 后端 (Express + TypeScript)

```
server/
├── src/
│   ├── routes/
│   │   ├── upload.ts        # 文件上传路由
│   │   ├── parse.ts         # MinerU 解析路由
│   │   ├── template.ts      # 模板管理路由
│   │   ├── format.ts        # 排版处理路由
│   │   └── download.ts      # 文件下载路由
│   ├── services/
│   │   ├── mineruService.ts # MinerU API 集成
│   │   ├── formatService.ts # 排版服务 (调用 skills)
│   │   ├── storageService.ts# 文件存储服务
│   │   └── templateService.ts# 模板存储服务
│   ├── middleware/
│   │   ├── uploadMiddleware.ts # 上传文件处理
│   │   ├── errorHandler.ts     # 错误处理
│   │   ├── authMiddleware.ts   # 认证中间件 (可选)
│   ├── utils/
│   │   ├── fileUtils.ts     # 文件处理工具
│   │   ├── validation.ts    # 参数验证
│   ├── types/
│   │   ├── mineru.ts        # MinerU 类型定义
│   │   ├── template.ts      # 模板类型定义
│   ├── config/
│   │   ├── index.ts         # 配置加载
│   ├── app.ts               # Express 应用入口
│   └── server.ts            # 服务器启动
├── uploads/                 # 临时上传目录
├── outputs/                 # 输出文件目录
├── templates/               # 模板存储目录
├── package.json
├── tsconfig.json
└── .env.example
```

## MinerU API 集成方案

根据 MinerU API 文档，系统将使用 **精准解析 API**（支持大文件），主要流程：

### 1. 文件上传流程（批量上传接口）

```
POST https://mineru.net/api/v4/file-urls/batch
Authorization: Bearer {token}
Content-Type: application/json

Request Body:
{
  "files": [
    {"name": "exam_paper.pdf", "data_id": "unique_id"}
  ],
  "model_version": "vlm",  // 或 "pipeline"
  "is_ocr": true,          // 开启 OCR（扫描件必须）
  "enable_formula": true,  // 开启公式识别
  "enable_table": true,    // 开启表格识别
  "language": "ch",        // 中文
  "extra_formats": ["docx", "html"]  // 导出格式
}

Response:
{
  "code": 0,
  "data": {
    "batch_id": "...",
    "file_urls": ["https://oss-upload-url..."]
  }
}
```

然后 PUT 上传文件到返回的 `file_url`。

### 2. 任务状态查询

```
GET https://mineru.net/api/v4/extract/task/{task_id}
Authorization: Bearer {token}

Response:
{
  "code": 0,
  "data": {
    "task_id": "...",
    "state": "done",  // pending/running/done/failed
    "full_zip_url": "https://cdn.../result.zip",
    "extract_progress": {
      "extracted_pages": 5,
      "total_pages": 10
    }
  }
}
```

### 3. 解析结果结构

解析完成后下载 `full_zip_url`，包含：
- `full.md` - Markdown 解析结果
- `content_list.json` - 内容列表
- `model.json` - 模型推理结果
- `images/` - 图片文件夹
- `*.docx` - DOCX 格式（如果设置了 extra_formats）

## 格式模板设计

### 模板数据结构

```typescript
interface FormatTemplate {
  id: string;
  name: string;
  description?: string;
  isPreset: boolean;  // 是否预设模板
  
  // 页面设置
  pageSettings: {
    pageSize: 'A4' | 'A3' | 'B5' | 'Letter' | 'Custom';
    customWidth?: number;  // mm
    customHeight?: number; // mm
    margins: {
      top: number;     // mm
      bottom: number;  // mm
      left: number;    // mm
      right: number;   // mm
    };
  };
  
  // 段落设置
  paragraphSettings: {
    lineSpacing: number;      // 行距倍数
    paragraphSpacing: number; // 段间距 mm
    firstLineIndent: number;  // 首行缩进 mm
  };
  
  // 字体设置
  fonts: {
    // 正文
    body: {
      chineseFont: string;  // 中文字体
      englishFont: string;  // 英文字体
      numberFont: string;   // 数字字体
      fontSize: number;     // pt
    };
    
    // 各级标题
    headings: {
      level1: FontSettings;
      level2: FontSettings;
      level3: FontSettings;
      level4: FontSettings;
    };
    
    // 特殊内容
    special: {
      questionNumber: FontSettings;  // 题号
      option: FontSettings;          // 选项
      formula: FontSettings;         // 公式
      tableHeader: FontSettings;     // 表格标题
    };
  };
  
  // 其他样式
  styles: {
    questionNumberFormat: '1.' | '1、' | '(1)' | '①';
    showQuestionPoints: boolean;  // 显示分值
    imagePosition: 'inline' | 'float';
    tableStyle: TableStyleSettings;
  };
}

interface FontSettings {
  chineseFont?: string;
  englishFont?: string;
  fontSize: number;     // pt
  bold?: boolean;
  italic?: boolean;
  color?: string;       // hex color
  lineSpacing?: number;
}
```

### 预设模板

1. **标准试卷模板** - A4 纸，宋体正文，黑体标题
2. **考试答题模板** - 答题区域空白，适合打印填写
3. **练习册模板** - 题目间距大，适合手写练习
4. **复习资料模板** - 紧凑排版，节省纸张
5. **英文试卷模板** - Times New Roman 字体

## 核心工作流程

### 完整流程图

```
用户上传 PDF (≤200MB)
    ↓
后端接收文件 → 申请 MinerU 上传 URL → 上传到 MinerU OSS
    ↓
创建解析任务 → 返回 task_id 给前端
    ↓
前端轮询任务状态 (或 WebSocket 实时推送)
    ↓
任务完成 → 获取解析结果 ZIP
    ↓
解压 ZIP → 解析 Markdown/JSON 内容结构
    ↓
用户选择/编辑格式模板
    ↓
调用 skills(docx) 进行排版
    ↓
生成格式化 DOCX 文件
    ↓
用户下载结果文件
```

### API 路径设计

| 功能 | 方法 | 路径 | 描述 |
|------|------|------|------|
| 上传文件 | POST | `/api/upload` | 上传 PDF 文件到后端 |
| 创建解析任务 | POST | `/api/parse/create` | 调用 MinerU 创建任务 |
| 查询任务状态 | GET | `/api/parse/status/:taskId` | 查询 MinerU 任务状态 |
| 获取解析结果 | GET | `/api/parse/result/:taskId` | 获取解析结果内容 |
| 获取模板列表 | GET | `/api/templates` | 获取预设和自定义模板 |
| 创建模板 | POST | `/api/templates` | 创建新模板 |
| 更新模板 | PUT | `/api/templates/:id` | 更新模板 |
| 删除模板 | DELETE | `/api/templates/:id` | 删除模板 |
| 执行排版 | POST | `/api/format` | 根据模板排版生成 DOCX |
| 下载文件 | GET | `/api/download/:fileId` | 下载生成的文件 |

## 环境配置

### .env 文件结构

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# MinerU API Configuration
MINERU_API_TOKEN=your_api_token_here
MINERU_API_BASE_URL=https://mineru.net/api/v4

# File Storage
UPLOAD_DIR=./uploads
OUTPUT_DIR=./outputs
TEMPLATE_DIR=./templates
MAX_FILE_SIZE=209715200  # 200MB in bytes

# CORS Configuration
CORS_ORIGIN=http://localhost:5173

# Optional: Database (for persistence)
# DATABASE_URL=sqlite://./data.db
```

### .env.example

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# MinerU API Configuration
MINERU_API_TOKEN=
MINERU_API_BASE_URL=https://mineru.net/api/v4

# File Storage
UPLOAD_DIR=./uploads
OUTPUT_DIR=./outputs
TEMPLATE_DIR=./templates
MAX_FILE_SIZE=209715200

# CORS Configuration
CORS_ORIGIN=http://localhost:5173
```

## 技术选型细节

### 前端依赖

```json
{
  "dependencies": {
    "react": "^18.x",
    "react-dom": "^18.x",
    "react-router-dom": "^6.x",
    "axios": "^1.x",
    "zustand": "^4.x",  // 状态管理
    "react-dropzone": "^14.x",  // 文件上传
    "react-icons": "^5.x",
    "tailwindcss": "^3.x",  // UI 样式
    "@types/react": "^18.x"
  },
  "devDependencies": {
    "vite": "^5.x",
    "typescript": "^5.x",
    "@vitejs/plugin-react": "^4.x"
  }
}
```

### 后端依赖

```json
{
  "dependencies": {
    "express": "^4.x",
    "cors": "^2.x",
    "multer": "^1.x",  // 文件上传处理
    "axios": "^1.x",
    "dotenv": "^16.x",
    "uuid": "^9.x",
    "archiver": "^7.x",  // ZIP 处理
    "unzipper": "^0.x",  // 解压
    "@types/express": "^4.x",
    "@types/node": "^20.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "ts-node": "^10.x",
    "nodemon": "^3.x"
  }
}
```

## skills(docx) 排版集成

根据用户需求，排版将通过调用 `skills(docx)` 进行。实现方案：

### 排版服务接口

```typescript
interface FormatRequest {
  taskId: string;
  templateId: string;
  options?: {
    preserveImages?: boolean;
    preserveTables?: boolean;
    preserveFormulas?: boolean;
  };
}

interface FormatResult {
  fileId: string;
  fileName: string;
  downloadUrl: string;
  pageCount: number;
}
```

### 排版流程

1. 获取 MinerU 解析的 Markdown 内容
2. 解析内容结构（标题层级、段落、图片、表格、公式）
3. 根据模板设置应用样式
4. 生成 DOCX 文件

## 数据存储策略

- **临时文件**: `uploads/` 和 `outputs/` 目录，定期清理
- **模板数据**: JSON 文件存储在 `templates/`，或可选数据库
- **任务状态**: 内存存储 + 可选持久化

## 安全考虑

1. 文件大小限制 (200MB)
2. 文件类型验证 (仅 PDF)
3. API Token 安全存储
4. 上传文件定期清理
5. CORS 配置

## 项目启动脚本

### package.json (root)

```json
{
  "name": "pdf-typesetting",
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:web\"",
    "dev:server": "cd server && npm run dev",
    "dev:web": "cd web && npm run dev",
    "build": "cd web && npm run build",
    "install:all": "cd web && npm install && cd ../server && npm install"
  }
}
```

## 开发阶段规划

### Phase 1: 基础架构
- 项目初始化
- 前端/后端基础框架搭建
- MinerU API 集成

### Phase 2: 核心功能
- 文件上传
- 解析任务管理
- 状态轮询/显示
- 结果获取

### Phase 3: 模板系统
- 模板编辑器 UI
- 预设模板实现
- 模板存储

### Phase 4: 排版生成
- skills(docx) 集成
- DOCX 生成
- 下载功能

### Phase 5: 优化完善
- 错误处理
- UI/UX 优化
- 性能优化
- 文档完善

---

## 已确认决策

1. **DOCX 生成方式**: 使用 `docx` npm 库本地生成，在后端直接处理排版
2. **用户认证**: 目前不需要，但架构设计预留扩展空间
3. **数学公式处理**: 作为模板的可选项，支持三种方式：
   - 转换为 Word 公式对象 (OMML)
   - 转换为图片
   - 保留 LaTeX 文本形式

## docx 库集成方案

使用 `docx` npm 库（https://github.com/dolanmiu/docx）进行 DOCX 生成：

```typescript
import { Document, Packer, Paragraph, TextRun, HeadingLevel, 
         Table, TableRow, TableCell, WidthType, 
         AlignmentType, BorderStyle, ImageRun } from 'docx';

// 示例：生成试卷段落
const createQuestionParagraph = (question: QuestionContent, template: FormatTemplate) => {
  return new Paragraph({
    children: [
      new TextRun({
        text: question.number,
        font: template.fonts.special.questionNumber.chineseFont,
        size: template.fonts.special.questionNumber.fontSize * 2, // half-points
        bold: template.fonts.special.questionNumber.bold,
      }),
      new TextRun({
        text: question.content,
        font: template.fonts.body.chineseFont,
        size: template.fonts.body.fontSize * 2,
      }),
    ],
    spacing: {
      line: template.paragraphSettings.lineSpacing * 240, // 240 = single line
      before: template.paragraphSettings.paragraphSpacing * 20, // twips
    },
  });
};
```

### 公式处理可选方案

在模板中添加 `formulaFormat` 选项：

```typescript
interface TemplateFormulaSettings {
  format: 'omml' | 'image' | 'latex';
  // omml: 使用 docx 库的 Math 组件
  // image: 将公式渲染为 PNG 后嵌入
  // latex: 保留 $$...$$ 格式的纯文本
}
```

## 后端依赖更新

```json
{
  "dependencies": {
    // ... 其他依赖
    "docx": "^8.x",           // DOCX 生成库
    "mathjax": "^3.x",        // 公式渲染（可选，用于图片模式）
    "sharp": "^0.x"           // 图片处理（可选）
  }
}
```