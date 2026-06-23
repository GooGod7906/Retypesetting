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

### 生产构建

```bash
# 1. 构建前端
cd web && npm run build

# 2. 构建后端
cd ../server && npm run build

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 MINERU_API_TOKEN
```

### 部署方式一：直接启动

```bash
cd server && npm start
```

访问 `http://localhost:3000`，后端自动托管前端构建产物并处理 `/api/*` 请求。

### 部署方式二：Nginx 反向代理

将 `web/dist/` 目录内容复制到 nginx 静态目录，然后配置 nginx：

```nginx
server {
    listen 80;
    server_name your_domain;

    # 前端静态文件（修改为实际路径）
    root /var/www/html;
    index index.html;

    # 前端页面（子路径部署时需要 try_files）
    location /retypesetting/ {
        try_files $uri $uri/ /retypesetting/index.html;
    }

    # API 反向代理
    location /retypesetting/api/ {
        proxy_pass http://127.0.0.1:3003/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 200m;
    }
}
```

> **注意：** 子路径部署时需确保 `vite.config.ts` 中 `base` 与 nginx 路径一致（如 `base: '/retypesetting/'`），构建前端后将 `web/dist/` 内容复制到 nginx 对应目录。

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
