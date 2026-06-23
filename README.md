# ReTypesetting - 扫描件重排版

将扫描版 PDF（试卷、学习资料等）通过 OCR 识别后重排版为格式化的 DOCX 文档。

## 功能特性

- **PDF 上传** — 支持最大 200MB 的 PDF 文件上传
- **智能解析** — 集成 [MinerU API](https://mineru.net) 进行 OCR 识别，支持公式、表格识别
- **格式模板** — 内置多种排版模板（标准试卷、练习册、复习资料等），支持自定义
- **DOCX 生成** — 使用 `docx` 库在后端直接生成格式化的 Word 文档
- **实时进度** — 前端实时展示解析进度

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS + Zustand |
| 后端 | Express + TypeScript + Multer |
| OCR 解析 | MinerU API v4 |
| DOCX 生成 | docx |

## 项目结构

```
├── web/                    # 前端
│   └── src/
│       ├── components/     # UI 组件 (FileUploader, ParseProgress, DownloadButton)
│       ├── services/       # API 调用封装
│       ├── store/          # Zustand 状态管理
│       └── types/          # TypeScript 类型定义
├── server/                 # 后端
│   └── src/
│       ├── routes/         # API 路由 (upload, parse, template, format, download)
│       ├── services/       # 业务服务
│       ├── middleware/      # 中间件 (错误处理、文件上传)
│       └── utils/          # 工具函数
└── PLAN.md                 # 项目设计文档
```

## 快速开始

### 环境要求

- Node.js >= 18
- MinerU API Token（从 [mineru.net](https://mineru.net) 获取）

### 安装

```bash
# 安装所有依赖
npm run install:all
```

### 配置

复制环境变量示例文件并填入你的 MinerU API Token：

```bash
# 后端
cp server/.env.example server/.env

# 前端
cp web/.env.example web/.env
```

编辑 `server/.env`：

```env
MINERU_API_TOKEN=your_api_token_here
```

### 启动开发服务器

```bash
npm run dev
```

前端运行在 `http://localhost:5173`，后端运行在 `http://localhost:3000`。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload` | 上传 PDF 文件 |
| POST | `/api/parse/create` | 创建 MinerU 解析任务 |
| GET | `/api/parse/status/:taskId` | 查询解析任务状态 |
| GET | `/api/parse/result/:taskId` | 获取解析结果 |
| GET | `/api/templates` | 获取模板列表 |
| POST | `/api/format` | 执行排版生成 DOCX |
| GET | `/api/download/:fileId` | 下载生成的文件 |

## 工作流程

```
上传 PDF → MinerU OCR 解析 → 选择排版模板 → 生成 DOCX → 下载
```

## License

Private
