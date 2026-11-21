# ReTypesetting - 扫描件重排版

将扫描版 PDF（试卷、学习资料等）通过 OCR 识别后重排版为格式化的 DOCX 文档。

## 新版试卷重排版

使用 Node.js 22.13 或更新版本。在项目根目录运行 `npm ci`、`npm --prefix server ci`，然后运行 `npm run dev`（也可运行 `npm run typesetting`），然后打开 `http://127.0.0.1:4174`。从已有的识别记录点「打开排版」，或上传新的 PDF，逐页预览、校对后生成整卷 Word。旧版 React 界面使用 `npm run dev:legacy` 启动。

- 支持 Pipeline、VLM 和双模型批量识别，显示上传进度和各模型已识别的页数。双模型可使用混合重排或混合原位，单模型可在导出设置中选择排版方式。原位版式包括原位自适应、按页无框、选项合框、选项分框和跨平台原位。原位自适应保留插图坐标。跨平台原位将原 PDF 逐页嵌入 Word，适合跨应用查看。
- 默认模板「试卷校对稿」采用 16 开纵向、宋体 10.5 磅正文、1.2 倍行距、黑体主标题与大题标题，以及全角题号和选项标点。页脚自动识别原卷样式，也可自定义页脚、页脚下边距和纸张大小。
- 校对时以有文本层的原卷 PDF 为准，扫描卷用于辨认模糊字形。模板沿用现有答题横线恢复和可编辑公式。字符级加点、波浪线和删除线仍需对照原卷核查。
- 模板可以分别设置各级标题、正文、选项、注意事项等元素的字体、倍数行距、最小行高、段前段后、左右缩进、首行或悬挂缩进及对齐。公式默认使用可编辑的 Word 公式，也可以渲染成图片或保留 LaTeX。
- 在「排版模板」中可以新建模板、复制预设、修改自定义模板，并预览未保存的样式。模板可下载为 JSON，也可导入成一份新的自定义模板。
- 校对支持逐行调整题干、选项与公式，模板重排时可以设置段落居中或左对齐。切换页面、关闭校对侧栏或生成 Word 前会保存草稿。新任务的两种排版方式各自保存校对。
- 新任务默认从开始上传起保留 30 分钟。使用 `TYPESETTING_RETENTION_MINUTES=1–60` 调整时长，或设为 `0` 使用手动清除。旧记录可继续打开和导出。
- 可手动清除整批任务，也可在完整收到 Word 后清除。同批上传的 PDF、解析包、校对记录及 Word 导出会一起删除。自定义模板可继续使用。留存设置适用于本站任务文件。

新上传需要在 `server/.env` 设置 `MINERU_API_TOKEN`。部署时设置 `DATABASE_URL`，先运行 `npm run build`，再用 `NODE_ENV=production` 和 `npm run start:typesetting` 启动。服务监听回环地址，Word 导出一次处理一份文档。识别任务、模板、校对和导出状态存 PostgreSQL，PDF、ZIP 和 Word 存在 `TYPESETTING_DATA_DIR`（默认 `server/outputs/mineru-lab`）。本地开发未配置 PostgreSQL 时使用文件保存记录。

新版工作台的历史记录、校对和导出对访问同一实例的用户共享。生产环境使用反向代理的访问认证控制成员权限。经反向代理部署时，在 `MINERU_LAB_ALLOWED_HOSTS` 填写代理转发的站点主机名。局域网直连时同时设置 `MINERU_LAB_HOST=0.0.0.0`，并把实际访问的主机名或 IP 加入允许列表。只需向能共同查看和编辑这些文件的人开放站点。

## 旧版 React 界面

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

### 旧版快速开始

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
npm run dev:legacy
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
| POST | `/api/parse/create` | 接收 `fileId`，上传 PDF 到 MinerU 并返回 `data.batchId` |
| GET | `/api/parse/status/:batchId` | 查询解析任务状态和进度 |
| GET | `/api/parse/result/:batchId` | 获取已完成任务的 Markdown 和图片信息 |
| GET | `/api/templates` | 获取模板列表 |
| POST | `/api/format` | 执行排版生成 DOCX |
| GET | `/api/download/:fileId` | 下载生成的文件 |

MinerU 精准解析 API 支持每个 PDF 最多 200 MB、200 页。[项目接入说明](PLAN.md#mineru-api-集成方案) · [MinerU 官方接口文档](https://mineru.net/apiManage/docs)

## 工作流程

```
上传 PDF → MinerU OCR 解析 → 选择排版模板 → 生成 DOCX → 下载
```

## License

Private
