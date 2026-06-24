# LuminaMind Agent

> 一个面向学习与工作的个人长期 Agent 桌面应用。通过"可编辑 Markdown 原子笔记 + 双链文本网络 + Embedding 语义检索"的混合记忆系统，让 AI 从一次性问答工具变成能够长期理解用户、持续积累知识并辅助复杂任务的个人智能伙伴。

---

## 1. 项目简介

当前大多数 AI 助手存在以下问题：

1. **记忆黑盒化**：用户不知道 AI 记住了什么，也无法直接修改记忆。
2. **长期上下文缺失**：AI 很难持续理解用户长期项目、学习进度和个人偏好。
3. **记忆不可迁移**：记忆绑定在某个平台或数据库中，用户难以导出和复用。
4. **检索方式单一**：仅依赖向量相似度容易忽略显式逻辑关系和因果链路。
5. **缺少用户审查机制**：AI 自动写入记忆容易产生错误、过期或隐私风险。

LuminaMind Agent 的核心目标是：

> 让个人 Agent 拥有可控、可编辑、可迁移、可解释的长期记忆，让 AI 能够基于长期积累的个人知识库进行问答、规划、复盘和任务辅助。

---

## 2. QuickStart

### 前置依赖

- Python 3.10+
- Node.js 18+
- 可选：Ollama（本地 Embedding/LLM）或 DeepSeek/OpenRouter API Key

### 克隆与启动

```bash
# 1. 后端
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000

# 2. 前端（新终端）
cd frontend
npm install
npm run dev

# 3. 桌面应用（可选，新终端）
cd frontend
npm run electron:dev
```

### 初始化记忆库

1. 打开浏览器访问 `http://127.0.0.1:5173`
2. 进入 **Settings → Vault**，选择或新建一个本地文件夹作为记忆库
3. 系统自动创建 `Memories/`、`Inbox/`、`Attachments/` 等目录
4. 在 **Settings → Models** 中配置 LLM（DeepSeek / Ollama / OpenRouter）

### 验证运行

```powershell
# 后端测试
cd backend
.\.venv\Scripts\python.exe -m pytest tests

# 前端测试与构建
cd frontend
npm test -- --run
npm run build
```

### 桌面应用端测试与重新构建流程

如果本次改动需要在真实 Electron 应用窗口里验证，不要只看浏览器页面。按改动类型选择下面一种流程。

#### A. 日常应用端调试：开发壳

适合验证前端交互、后端 API、设置页、选仓库、聊天、记忆审查等功能。这个流程不生成安装包，但运行的是 Electron 桌面壳。

```powershell
# 1. 关闭旧的 8000/5173 监听，避免旧后端或旧 Vite 进程干扰
$ports = 8000, 5173
foreach ($port in $ports) {
  $pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $pids) {
    if ($processId) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
  }
}
Start-Sleep -Seconds 1

# 2. 终端一：启动后端
cd D:\VS_project\LuminaMind\backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

# 3. 终端二：启动前端开发服务器
cd D:\VS_project\LuminaMind\frontend
npm run dev -- --host 127.0.0.1 --port 5173

# 4. 终端三：启动 Electron 桌面壳
cd D:\VS_project\LuminaMind\frontend
npm run electron:dev
```

应用打开后，在桌面窗口里完成手动验证。选过的 Vault 会记录在用户级应用状态里；如果要模拟第一次启动，可先关闭应用并删除：

```powershell
Remove-Item "$env:APPDATA\LuminaMind\state.json" -Force -ErrorAction SilentlyContinue
```

#### B. 重新构建桌面应用：免安装目录版

适合每次代码改完后做“接近真实发布”的应用端测试。这个流程会构建前端、打包后端，并生成可直接运行的 Electron 应用目录，不需要安装。它不是单文件 Portable EXE，运行和分发时必须保留整个 `release\win-unpacked` 目录。

首次使用 `dist:dir` 或 `dist:win` 前，确保 `pnpm` 可用，因为脚本内部会通过 `pnpm dlx electron-builder` 调用 Electron Builder。可用下面任一方式准备：

```powershell
corepack enable
# 或
npm install -g pnpm
```

```powershell
cd D:\VS_project\LuminaMind\frontend

# 构建前必须关闭 Vite 开发服务器，否则 Windows 文件监听可能锁住
# release\win-unpacked.tmp，导致 electron-builder 报 EPERM rename 错误
$pids = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $pids) {
  if ($processId) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
}

# 同时关闭正在运行的旧免安装版，并清理失败构建留下的目录
Get-Process LuminaMind -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item .\release\win-unpacked, .\release\win-unpacked.tmp `
  -Recurse -Force -ErrorAction SilentlyContinue

npm run dist:dir

# 构建完成后运行
.\release\win-unpacked\LuminaMind.exe
```

如果只看到 `release\win-unpacked.tmp\electron.exe` 和 `resources\default_app.asar`，说明构建停在原始 Electron 运行时解压阶段，并未生成 LuminaMind 应用。不要运行或分发这个 `electron.exe`；先关闭 5173、清理 `.tmp` 目录，再重新执行 `npm run dist:dir`。

优先用 `dist:dir` 做频繁测试，因为它比安装包快，也不会反复改系统安装状态。

#### C. 测试安装包

只有需要验证安装、卸载、桌面入口、安装目录等发布行为时，才构建安装包。

```powershell
cd D:\VS_project\LuminaMind\frontend
npm run dist:win

# 构建完成后运行 release 目录里的安装包
.\release\LuminaMind-0.1.0-Setup.exe
```

版本号来自 `frontend/package.json`。如果版本号改了，安装包文件名也会跟着变。

#### 每次改完后的最低验证顺序

```powershell
# 后端自动测试
cd D:\VS_project\LuminaMind\backend
.\.venv\Scripts\python.exe -m pytest tests -v

# 前端测试与类型/构建检查
cd D:\VS_project\LuminaMind\frontend
npm test -- --run
npm run build

# 然后根据需要进入 A 或 B，在 Electron 应用窗口里手动测试
```

---

## 3. 核心设计

### 3.1 白盒化 Markdown 记忆系统

长期记忆存储为 Markdown 原子笔记，数据库和向量索引只是辅助结构：

- 用户可直接打开、编辑、删除、合并或拆分记忆文件。
- 记忆可被其他 Markdown 工具读取，不被锁死在平台内部。
- 记忆既是 Agent 的上下文，也是用户自己的知识资产。

### 3.2 双轨制混合检索

1. **Embedding 语义向量检索** — 召回语义相似、表达不同但含义接近的记忆。
2. **Obsidian 式双链文本网络检索** — 保留显式的知识关系、任务关系、因果链路。

两种机制结合后，系统既能处理模糊查询，又能沿着笔记之间的逻辑关系进行上下文扩展。

### 3.3 用户可审查的记忆写入

Agent 不直接静默写入长期记忆，而是生成候选记忆（新增 / 更新 / 废弃 / 忽略），由用户审查确认后写入 Markdown 记忆库，降低 AI 误记、乱记和过度记录的问题。支持 **手动审查** 和 **自动接受** 两种模式。

### 3.4 本地优先与可迁移

用户选择本地文件夹作为记忆库路径。核心记忆以 Markdown 文件存在，便于备份、同步、迁移和审查。

---

## 4. 产品形态

独立桌面应用（Electron），开发期前后端分离运行。用户安装后选择本地文件夹作为记忆库，应用扫描 Markdown 文件并建立索引，用户在聊天窗口与 Agent 对话，Agent 基于本地记忆回答，对话结束后生成候选记忆供用户审查。

### 4.1 文件夹结构

```text
MyAgentMemory/
├─ Memories/
│  ├─ Profile/
│  ├─ Projects/
│  ├─ Concepts/
│  ├─ Tasks/
│  └─ Logs/
├─ Inbox/
│  └─ 待整理记忆.md
├─ Attachments/
│  └─ 上传的文件、图片、PDF
└─ .agent/
   ├─ index.db            # SQLite 元数据库
   ├─ vector_index/       # 向量索引（Chroma / JSON fallback）
   ├─ config.json         # 用户配置
   └─ cache/
```

- `Memories/` — 用户可见、可编辑的 Markdown 记忆。
- `Inbox/` — 临时导入或待整理内容。
- `Attachments/` — 附件。
- `.agent/` — 系统内部索引、缓存和配置。

---

## 5. 技术架构

### 5.1 总体架构

```text
独立桌面应用
├─ 前端界面
│  ├─ Chat 聊天窗口
│  ├─ Memory 记忆库浏览
│  ├─ Review 记忆审查
│  ├─ Settings 设置页面
│  └─ Appearance 主题切换
│
├─ 本地 Agent 引擎
│  ├─ 对话管理
│  ├─ 记忆检索
│  ├─ 记忆提取
│  ├─ 记忆建议生成
│  └─ 工具调用
│
├─ 记忆系统
│  ├─ Markdown 原子笔记
│  ├─ 双链关系图谱
│  ├─ Embedding 向量索引
│  ├─ FTS5 全文检索
│  └─ 记忆更新机制
│
└─ 本地数据层
   ├─ 用户选择的 Markdown 文件夹
   ├─ SQLite 元数据库（notes/links/chunks）
   ├─ 向量索引数据库（Chroma / JSON fallback）
   └─ 聊天历史数据库
```

### 5.2 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面端 | Electron + React 18 + TypeScript |
| 后端 | Python + FastAPI + Pydantic v2 |
| 本地存储 | Markdown + SQLite + FTS5 |
| 向量索引 | ChromaDB（可选 fallback JSON） |
| Embedding | Ollama bge-m3 / LocalHash 384d / OpenRouter |
| LLM | DeepSeek Chat / Ollama / OpenRouter |
| 前端构建 | Vite + Vitest |

### 5.3 实际模块结构

```text
backend/
├─ main.py                    # FastAPI 入口与路由
├─ requirements.txt
└─ lumina/
   ├─ config.py               # AppSettings 模型与持久化
   ├─ db.py                   # SQLite 连接与 Schema
   ├─ models.py               # Pydantic 数据模型
   ├─ vault.py                # 记忆库初始化
   ├─ embedding.py            # Embedding 提供者（LocalHash/Ollama/OpenRouter）
   ├─ indexer.py              # 文本分块与向量索引构建
   ├─ llm.py                  # LLM 调用与 Prompt 构建
   ├─ retrieval.py            # 混合检索（语义+关键词+双链+评分）
   ├─ conversations.py        # 会话 CRUD 与消息管理
   ├─ suggestions.py          # 记忆建议生成与审查流程
   └─ memory/
      ├─ markdown.py          # Markdown 解析与构建（YAML frontmatter + 双链）
      └─ store.py             # 记忆 CRUD 与文件写入

frontend/
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
├─ electron/
│  ├─ main.cjs               # Electron 主进程
│  └─ preload.cjs             # IPC preload 桥接
└─ src/
   ├─ main.tsx                # React 入口
   ├─ App.tsx                 # 应用 Shell + 导航
   ├─ styles.css              # 全局样式（多主题）
   ├─ services/
   │  ├─ api.ts               # API 客户端
   │  └─ uiPreferences.ts     # 本地 UI 偏好
   ├─ pages/
   │  ├─ ChatPage.tsx         # 聊天 + 会话管理 + 模型选择
   │  ├─ MemoryPage.tsx       # 记忆库浏览
   │  ├─ ReviewPage.tsx       # 记忆审查
   │  └─ SettingsPage.tsx     # 配置（Vault / Review / Models / Appearance）
   ├─ components/
   │  └─ MarkdownContent.tsx  # Markdown 渲染（GFM + LaTeX + 代码高亮）
   └─ test/
      ├─ setup.ts
      ├─ api.test.ts
      └─ pages.test.tsx
```

---

## 6. Markdown 记忆格式

每条长期记忆以 Markdown 文件保存，包含 YAML frontmatter。

### 6.1 示例

```markdown
---
id: mem_20260523_001
title: 个人长期 Agent 项目方向
type: project
tags:
  - Agent
  - 长期记忆
  - Markdown
  - 双链
  - Embedding
importance: 5
confidence: 0.95
source: chat
status: active
pinned: false
created: 2026-05-23
updated: 2026-05-23
links:
  - "[[白盒化记忆系统]]"
  - "[[个人知识管理]]"
  - "[[学习工作助手]]"
---

用户正在开发一个面向学习与工作的个人长期 Agent 应用。项目核心创新是将 Agent 的长期记忆存储为用户可编辑的 Markdown 原子笔记，并结合双链文本网络与 Embedding 语义向量进行双轨制检索。
```

### 6.2 字段说明

| 字段 | 含义 |
| --- | --- |
| `id` | 记忆唯一标识 |
| `title` | 记忆标题 |
| `type` | 记忆类型：profile / project / concept / task / log |
| `tags` | 标签列表 |
| `importance` | 重要程度 1–5 |
| `confidence` | 置信度 0–1 |
| `source` | 来源：chat / file / manual / import |
| `status` | 状态：active / outdated / archived |
| `pinned` | 是否置顶 |
| `created` | 创建日期 |
| `updated` | 更新日期 |
| `links` | 显式双链关系 `[[笔记标题]]` |

---

## 7. 混合检索机制

### 7.1 检索流程

```text
用户问题 q
  ↓
Step 1：对 q 生成 Embedding
  ↓
Step 2：从向量索引中召回语义相似记忆 (top_k)
  ↓
Step 3：通过关键词 / FTS5 全文检索召回显式命中记忆
  ↓
Step 4：从初始召回结果出发，沿 [[双链]] 进行一跳或二跳扩展
  ↓
Step 5：融合语义相似度、关键词命中、链接关系、重要度和时间新鲜度
  ↓
Step 6：选出最终记忆上下文
  ↓
Step 7：输入给 LLM 生成回答
```

### 7.2 综合评分公式

```text
FinalScore =
  0.45 × SemanticScore
  + 0.20 × KeywordScore
  + 0.15 × LinkScore
  + 0.10 × ImportanceScore
  + 0.10 × RecencyScore
```

- `SemanticScore`：Embedding 语义相似度。
- `KeywordScore`：关键词或 FTS5 命中分数。
- `LinkScore`：双链图谱中的关联强度。
- `ImportanceScore`：记忆重要程度。
- `RecencyScore`：时间新鲜度（指数衰减，半衰期 365 天）。

权重可在后续根据实际效果动态调整，命中原因会在搜索结果中展示。

---

## 8. 数据库设计

SQLite 用于保存元数据、索引状态和聊天历史，不作为长期记忆本体。

### 8.1 notes

```sql
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    type TEXT,
    tags TEXT,
    content TEXT,
    importance INTEGER DEFAULT 3,
    confidence REAL DEFAULT 0.9,
    source TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'active',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    file_hash TEXT
);
```

### 8.2 links

```sql
CREATE TABLE links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_note_id TEXT NOT NULL,
    target_note_title TEXT NOT NULL,
    target_note_id TEXT,
    link_type TEXT DEFAULT 'wikilink',
    FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

### 8.3 chunks

```sql
CREATE TABLE chunks (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

### 8.4 conversations / messages

```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT,
    updated_at TEXT,
    pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

### 8.5 全文索引

```sql
CREATE VIRTUAL TABLE notes_fts USING fts5(
    note_id UNINDEXED,
    title,
    content,
    tags
);
```

### 8.6 memory_suggestions

```sql
CREATE TABLE memory_suggestions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    action TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'log',
    tags TEXT,
    importance INTEGER DEFAULT 3,
    confidence REAL DEFAULT 0.8,
    target_note_id TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT,
    updated_at TEXT
);
```

---

## 9. API 设计

后端使用 FastAPI 提供本地接口。

### 9.1 系统配置

```http
GET  /api/settings              # 获取当前配置
POST /api/settings              # 保存配置（含 Vault 初始化）
```

### 9.2 记忆库管理

```http
POST /api/vault/select          # 选择/创建记忆库
POST /api/vault/scan            # 扫描记忆库 Markdown 文件
GET  /api/vault/status          # 记忆库状态
```

### 9.3 记忆 CRUD

```http
GET    /api/memories            # 列出所有记忆（支持排序）
GET    /api/memories/{id}       # 获取单条记忆
POST   /api/memories            # 创建记忆
PUT    /api/memories/{id}       # 更新记忆
PATCH  /api/memories/{id}       # 切换置顶
DELETE /api/memories/{id}       # 删除记忆
```

### 9.4 索引

```http
POST /api/index/rebuild         # 重建索引
POST /api/index/update          # 先扫描后重建
GET  /api/index/status          # 索引状态
```

### 9.5 检索

```http
POST /api/retrieve
```

请求体：

```json
{
  "query": "帮我整理一下个人长期 Agent 项目的技术路线",
  "top_k": 8,
  "include_graph_expand": true
}
```

返回体：

```json
{
  "results": [
    {
      "memory_id": "mem_20260523_001",
      "title": "个人长期 Agent 项目方向",
      "score": 0.91,
      "reason": "语义相似 + 双链关联",
      "path": "Memories/Projects/personal_agent.md",
      "content": "用户正在开发...",
      "type": "project",
      "tags": ["Agent", "长期记忆"]
    }
  ]
}
```

### 9.6 聊天

```http
GET    /api/conversations             # 列出会话（支持搜索）
POST   /api/conversations             # 创建会话（复用空草稿）
PATCH  /api/conversations/{id}        # 置顶/取消置顶
DELETE /api/conversations/{id}        # 删除会话
GET    /api/conversations/{id}/messages  # 获取会话消息与唤醒记忆
POST   /api/chat                      # 发送消息（自动 RAG）
```

`POST /api/chat` 请求体：

```json
{
  "conversation_id": "conv_001",
  "message": "我这个 Agent 项目第一版应该先做什么？",
  "chat_model_id": "deepseek_chat"
}
```

返回体：

```json
{
  "conversation_id": "conv_001",
  "answer": "第一版建议先完成本地 Markdown 记忆库扫描、Embedding 索引和混合检索闭环...",
  "used_memories": [
    { "memory_id": "mem_20260523_001", "title": "个人长期 Agent 项目方向", "score": 0.91 }
  ],
  "memory_suggestions": [],
  "memory_index_refresh_required": false
}
```

### 9.7 记忆建议

```http
POST /api/memory-suggestions/generate           # 从对话生成候选记忆
GET  /api/memory-suggestions                     # 列出所有候选
POST /api/memory-suggestions/{id}/accept         # 接受（写入 Markdown + 重建索引）
POST /api/memory-suggestions/{id}/reject         # 拒绝
POST /api/memory-suggestions/{id}/edit           # 编辑后写入
```

### 9.8 模型提供者

```http
GET /api/provider-models/openrouter?capability=chat      # 拉取 OpenRouter 模型目录
```

---

## 10. 记忆写入策略

### 应该保存

- 用户长期目标、正在推进的项目、明确表达的偏好、稳定的学习方向。
- 重要任务和阶段性进展、反复出现的问题和需求。
- 对后续回答有长期帮助的信息。

### 不应该保存

- 一次性闲聊、明显短期的信息、不确定或低置信度内容。
- 重复信息、用户不希望保存的信息、不必要的隐私信息。

### 记忆操作类型

- **新增记忆**：用户提供了新的长期信息。
- **更新记忆**：已有信息发生变化。
- **废弃记忆**：旧信息已经不再成立（archive）。
- **合并记忆**：多个碎片指向同一主题。
- **忽略记忆**：信息不值得长期保存。

---

## 11. Prompt 设计

### 11.1 检索增强回答

```text
你是用户的个人 Agent。下面提供的是帮助回答当前问题的背景上下文。

要求：
1. 使用相关背景来提高回答的准确性，但不要主动提及记忆库、检索过程或上下文注入机制。
2. 同一会话内的历史对话是短期上下文，必须用于理解代词、省略和连续问题。
3. 当引用用户过去已经表达的目标、偏好或决定有帮助时，可以自然地说"你之前提到……"。
4. 只有当用户询问依据、背景存在冲突或不确定性会影响结论时，才解释信息来源或推断边界。
5. 如果背景不足，不要将推断包装成用户已确认的信息。
6. 不要编造用户没有提供过的个人信息。
7. 回答应具体、可执行。

本次会话历史：
{history}

用户问题：
{user_message}

相关背景：
{context}
```

### 11.2 记忆提取

```text
你是一个长期记忆提取器。请从以下对话中判断是否存在值得保存到长期记忆库的信息。

请只提取对未来回答有持续帮助的信息，包括：
- 用户长期目标
- 用户项目背景
- 用户学习方向
- 用户稳定偏好
- 重要任务进展
- 已发生变化的旧记忆

不要保存：
- 闲聊
- 临时信息
- 重复信息
- 低置信度猜测
- 用户没有明确表达的敏感信息

请只输出 JSON 数组，不要输出解释文字。
...
```

---

## 12. 用户界面

### 12.1 Chat 页面

三栏布局：会话列表 | Agent 对话 | 唤醒的记忆来源

- 左侧：会话列表（支持搜索、置顶、右键菜单删除）
- 中间：对话窗口（Markdown 渲染，含代码高亮和 LaTeX）
- 右侧：当前回答使用的记忆来源及评分
- 底部：Composer 输入框，支持模型切换

### 12.2 Memory 页面

双栏布局：文件树 | Markdown 记忆内容

- 按类型目录（Profile/Projects/Concepts/Tasks/Logs）组织
- YAML frontmatter 元数据显示
- 双链引用解析与展示

### 12.3 Review 页面

列出 Agent 生成的候选记忆列表，每条包含：

- 操作类型：新增 / 更新 / 废弃
- 标题、内容、类型、标签
- 置信度与重要性
- LLM 给出的保存理由
- 操作按钮：[接受] [拒绝]

支持手动审查与自动接受两种模式。

### 12.4 Settings 页面

四组配置：

| 分组 | 配置项 |
| --- | --- |
| Vault | 选择/创建记忆库，扫描状态 |
| Review | 手动审查 / 自动接受 |
| Models | DeepSeek / Ollama / OpenRouter 连接配置，模型管理与分配 |
| Appearance | 主题切换（默认 / Dark / 暖黄） |

---

## 13. 开发路线

### ✅ 已完成（MVP）

- 本地记忆库初始化与目录创建
- Markdown 文件扫描、YAML frontmatter、标签和双链解析
- SQLite 元数据索引 + FTS5 全文索引
- Embedding 向量索引（Ollama bge-m3 / LocalHash fallback / OpenRouter）
- ChromaDB 向量存储（fallback JSON）
- 混合检索：语义 + 关键词 + 双链扩展 + 综合评分
- 聊天会话管理（新建、搜索、置顶、删除）
- RAG 聊天：检索增强回答 + 记忆来源展示
- 对话历史上下文窗口管理（token 预算控制）
- 候选记忆生成（LLM 提取）+ 用户审查确认
- 记忆 CRUD：增删改查、置顶
- 审查模式：手动 / 自动
- 多模型配置体系（DeepSeek / Ollama / OpenRouter）
- 主题切换
- 记忆索引自动刷新

### 🔜 规划中

- 文件变化自动监听（watchdog / chokidar）
- Markdown 编辑器增强
- 记忆图谱可视化
- 本地模型支持（llama.cpp / Ollama 深度集成）
- 数据导入导出
- 多 Agent 协作
- 插件系统

---

## 14. 环境变量

后端 `.env` 示例（可选，大部分配置可通过 Settings 页面管理）：

```env
APP_ENV=development
APP_HOST=127.0.0.1
APP_PORT=8000

LLM_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4o-mini

VECTOR_STORE=chroma
SQLITE_DB_PATH=.agent/index.db
```

前端可通过环境变量配置 API 地址：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

---

## 15. 项目边界

第一阶段专注于核心问题：

> 如何让个人 Agent 拥有可控、可编辑、可迁移、可解释的长期记忆？

优先保证：记忆格式清晰、检索链路稳定、用户可见 Agent 使用了哪些记忆、用户可控制哪些内容被长期保存、Markdown 记忆库可独立存在。

已完成本地 Markdown 扫描 → Embedding 索引 → 双链解析 → 混合检索 → 基于记忆的聊天回答 → 候选记忆审查写入 的完整闭环。
