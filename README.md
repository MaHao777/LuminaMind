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

## 2. 核心设计

### 2.1 白盒化 Markdown 记忆系统

长期记忆存储为 Markdown 原子笔记，数据库和向量索引只是辅助结构：

- 用户可直接打开、编辑、删除、合并或拆分记忆文件。
- 记忆可被其他 Markdown 工具读取，不被锁死在平台内部。
- 记忆既是 Agent 的上下文，也是用户自己的知识资产。

### 2.2 双轨制混合检索

1. **Embedding 语义向量检索** — 召回语义相似、表达不同但含义接近的记忆。
2. **Obsidian 式双链文本网络检索** — 保留显式的知识关系、任务关系、因果链路。

两种机制结合后，系统既能处理模糊查询，又能沿着笔记之间的逻辑关系进行上下文扩展。

### 2.3 用户可审查的记忆写入

Agent 不直接静默写入长期记忆，而是生成候选记忆（新增 / 更新 / 废弃 / 忽略），由用户审查确认后写入 Markdown 记忆库，降低 AI 误记、乱记和过度记录的问题。

### 2.4 本地优先与可迁移

用户选择本地文件夹作为记忆库路径。核心记忆以 Markdown 文件存在，便于备份、同步、迁移和审查。

---

## 3. 产品形态

独立桌面应用。用户安装后选择本地文件夹作为记忆库，应用扫描 Markdown 文件并建立索引，用户在聊天窗口与 Agent 对话，Agent 基于本地记忆回答，对话结束后生成候选记忆供用户审查。

### 3.1 文件夹结构

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
   ├─ index.db
   ├─ vector_index/
   ├─ config.json
   └─ cache/
```

- `Memories/` — 用户可见、可编辑的 Markdown 记忆。
- `Inbox/` — 临时导入或待整理内容。
- `Attachments/` — 附件。
- `.agent/` — 系统内部索引、缓存和配置。

---

## 4. 技术架构

### 4.1 总体架构

```text
独立桌面应用
├─ 前端界面
│  ├─ Chat 聊天窗口
│  ├─ Memory 记忆库浏览
│  ├─ Review 记忆审查
│  ├─ Task 任务面板
│  └─ Settings 设置页面
│
├─ 本地 Agent 引擎
│  ├─ 对话管理
│  ├─ 记忆检索
│  ├─ 记忆提取
│  ├─ 任务规划
│  └─ 工具调用
│
├─ 记忆系统
│  ├─ Markdown 原子笔记
│  ├─ 双链关系图谱
│  ├─ Embedding 向量索引
│  ├─ 关键词全文检索
│  └─ 记忆更新机制
│
└─ 本地数据层
   ├─ 用户选择的 Markdown 文件夹
   ├─ SQLite 元数据库
   ├─ 向量索引数据库
   └─ 聊天历史数据库
```

### 4.2 推荐技术栈

```text
桌面端：Electron + React + TypeScript
后端：  Python + FastAPI
本地存储：Markdown + SQLite
向量索引：Chroma / LanceDB / FAISS
Embedding：OpenAI Embedding / bge-m3
LLM：    OpenAI / DeepSeek / Qwen / Ollama
文件监听：watchdog / chokidar
```

### 4.3 前端模块结构

```text
frontend/
├─ src/
│  ├─ pages/
│  │  ├─ ChatPage.tsx
│  │  ├─ MemoryPage.tsx
│  │  ├─ ReviewPage.tsx
│  │  ├─ TaskPage.tsx
│  │  └─ SettingsPage.tsx
│  ├─ components/
│  │  ├─ ChatWindow.tsx
│  │  ├─ MemoryCard.tsx
│  │  ├─ MemorySourcePanel.tsx
│  │  ├─ MarkdownEditor.tsx
│  │  ├─ FileTree.tsx
│  │  └─ SuggestionCard.tsx
│  ├─ services/
│  │  ├─ api.ts
│  │  ├─ chatService.ts
│  │  ├─ memoryService.ts
│  │  └─ settingsService.ts
│  └─ store/
│     ├─ chatStore.ts
│     ├─ memoryStore.ts
│     └─ settingsStore.ts
```

前端职责：聊天界面、展示被唤醒的记忆、编辑 Markdown 记忆、审查记忆建议、配置模型/API Key/记忆库路径。

### 4.4 后端模块结构

```text
backend/
├─ main.py
├─ config.py
├─ agent/
│  ├─ chat_agent.py
│  ├─ planner.py
│  ├─ prompts.py
│  └─ tools.py
├─ memory/
│  ├─ markdown_store.py
│  ├─ parser.py
│  ├─ extractor.py
│  ├─ retriever.py
│  ├─ updater.py
│  └─ graph.py
├─ index/
│  ├─ indexer.py
│  ├─ vector_index.py
│  ├─ fulltext_index.py
│  └─ reranker.py
├─ llm/
│  ├─ client.py
│  ├─ embedding.py
│  └─ model_config.py
├─ db/
│  ├─ sqlite.py
│  └─ schema.sql
└─ utils/
   ├─ file_hash.py
   ├─ text_splitter.py
   └─ time_utils.py
```

后端职责：Markdown 读写、YAML frontmatter 解析、双链解析、Embedding 生成、向量索引、全文索引、混合检索与重排序、调用 LLM、从对话中提取候选记忆。

---

## 5. Markdown 记忆格式

每条长期记忆以 Markdown 文件保存，包含 YAML frontmatter。

### 5.1 示例

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
created: 2026-05-23
updated: 2026-05-23
links:
  - "[[白盒化记忆系统]]"
  - "[[个人知识管理]]"
  - "[[学习工作助手]]"
---

用户正在开发一个面向学习与工作的个人长期 Agent 应用。项目核心创新是将 Agent 的长期记忆存储为用户可编辑的 Markdown 原子笔记，并结合双链文本网络与 Embedding 语义向量进行双轨制检索。
```

### 5.2 字段说明

| 字段 | 含义 |
|---|---|
| `id` | 记忆唯一标识 |
| `title` | 记忆标题 |
| `type` | 记忆类型：profile / project / concept / task / log |
| `tags` | 标签列表 |
| `importance` | 重要程度 1–5 |
| `confidence` | 置信度 0–1 |
| `source` | 来源：chat / file / manual / import |
| `status` | 状态：active / outdated / archived |
| `created` | 创建日期 |
| `updated` | 更新日期 |
| `links` | 显式双链关系 `[[笔记标题]]` |

---

## 6. 混合检索机制

### 6.1 检索流程

```text
用户问题 q
  ↓
Step 1：对 q 生成 Embedding
  ↓
Step 2：从向量索引中召回语义相似记忆 (top_k)
  ↓
Step 3：通过关键词 / BM25 全文检索召回显式命中记忆
  ↓
Step 4：从初始召回结果出发，沿 [[双链]] 进行一跳或二跳扩展
  ↓
Step 5：融合语义相似度、关键词命中、链接关系、重要度和时间新鲜度
  ↓
Step 6：选出最终记忆上下文
  ↓
Step 7：输入给 LLM 生成回答
```

### 6.2 综合评分公式

```text
FinalScore =
  0.45 × SemanticScore
  + 0.20 × KeywordScore
  + 0.15 × LinkScore
  + 0.10 × ImportanceScore
  + 0.10 × RecencyScore
```

- `SemanticScore`：Embedding 语义相似度。
- `KeywordScore`：关键词或 BM25 命中分数。
- `LinkScore`：双链图谱中的关联强度。
- `ImportanceScore`：记忆重要程度。
- `RecencyScore`：时间新鲜度。

权重可在后续根据实际效果动态调整。

---

## 7. 数据库设计

SQLite 用于保存元数据、索引状态和聊天历史，不作为长期记忆本体。

### 7.1 notes

```sql
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    type TEXT,
    tags TEXT,
    created_at TEXT,
    updated_at TEXT,
    file_hash TEXT,
    status TEXT DEFAULT 'active'
);
```

### 7.2 links

```sql
CREATE TABLE links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_note_id TEXT NOT NULL,
    target_note_title TEXT NOT NULL,
    target_note_id TEXT,
    link_type TEXT DEFAULT 'wikilink',
    FOREIGN KEY (source_note_id) REFERENCES notes(id)
);
```

### 7.3 chunks

```sql
CREATE TABLE chunks (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY (note_id) REFERENCES notes(id)
);
```

### 7.4 conversations

```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT,
    updated_at TEXT
);
```

### 7.5 messages

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

### 7.6 memory_suggestions

```sql
CREATE TABLE memory_suggestions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    action TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    target_note_id TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT,
    updated_at TEXT
);
```

---

## 8. API 设计

后端使用 FastAPI 提供本地接口。

### 8.1 系统配置

```http
GET  /api/settings
POST /api/settings
```

### 8.2 记忆库管理

```http
POST /api/vault/select
POST /api/vault/scan
GET  /api/vault/status
```

### 8.3 记忆 CRUD

```http
GET    /api/memories
GET    /api/memories/{memory_id}
POST   /api/memories
PUT    /api/memories/{memory_id}
DELETE /api/memories/{memory_id}
```

### 8.4 索引

```http
POST /api/index/rebuild
POST /api/index/update
GET  /api/index/status
```

### 8.5 检索

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
      "path": "Memories/Projects/personal_agent.md"
    }
  ]
}
```

### 8.6 聊天

```http
GET  /api/conversations
POST /api/conversations
GET  /api/conversations/{conversation_id}/messages
POST /api/chat
```

聊天消息会写入 SQLite 的 `conversations` / `messages` 表。`POST /api/chat` 若未传 `conversation_id` 会自动创建新会话；若传入已有 `conversation_id`，后端会读取该会话最近消息作为短期上下文，并和长期记忆检索结果一起注入 LLM Prompt。

请求体：

```json
{
  "conversation_id": "conv_001",
  "message": "我这个 Agent 项目第一版应该先做什么？"
}
```

返回体：

```json
{
  "answer": "第一版建议先完成本地 Markdown 记忆库扫描、Embedding 索引和混合检索闭环...",
  "used_memories": [
    {
      "memory_id": "mem_20260523_001",
      "title": "个人长期 Agent 项目方向",
      "score": 0.91
    }
  ]
}
```

### 8.7 记忆建议

```http
POST /api/memory-suggestions/generate
GET  /api/memory-suggestions
POST /api/memory-suggestions/{suggestion_id}/accept
POST /api/memory-suggestions/{suggestion_id}/reject
POST /api/memory-suggestions/{suggestion_id}/edit
```

---

## 9. 记忆写入策略

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
- **废弃记忆**：旧信息已经不再成立。
- **合并记忆**：多个碎片指向同一主题。
- **忽略记忆**：信息不值得长期保存。

---

## 10. Prompt 设计

### 10.1 检索增强回答

```text
你是用户的个人长期 Agent。你需要基于用户当前问题和系统检索出的长期记忆进行回答。

要求：
1. 优先使用已提供的记忆内容。
2. 如果记忆不足，明确说明哪些部分是推断。
3. 不要编造用户没有提供过的个人信息。
4. 回答应具体、可执行，适合用户当前学习或工作场景。
5. 如果引用了记忆，请在内部保持来源对应，便于前端展示。

用户问题：
{user_message}

相关记忆：
{retrieved_memories}
```

### 10.2 记忆提取

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

请输出 JSON：
[
  {
    "action": "create | update | archive | ignore",
    "title": "记忆标题",
    "type": "profile | project | concept | task | log",
    "content": "记忆正文",
    "tags": ["标签1", "标签2"],
    "importance": 1,
    "confidence": 0.9,
    "target_note_id": null,
    "reason": "为什么值得保存或更新"
  }
]

对话内容：
{conversation}

已有相关记忆：
{related_memories}
```

---

## 11. 用户界面布局

### 11.1 Chat 页面

```text
┌──────────────┬────────────────────────────┬──────────────────────┐
│ 会话列表      │          Agent 对话          │      唤醒的记忆        │
│              │                            │                      │
│ 学习规划      │  用户：帮我整理项目路线       │  1. Agent 项目方向     │
│ 项目复盘      │  Agent：根据你的长期记忆...   │  2. 白盒记忆系统       │
│ 论文阅读      │                            │  3. 双轨制检索         │
└──────────────┴────────────────────────────┴──────────────────────┘
```

### 11.2 Memory 页面

```text
┌──────────────┬────────────────────────────────────────┐
│ 文件树        │              Markdown 记忆内容          │
│              │                                        │
│ Profile      │  # 个人长期 Agent 项目方向               │
│ Projects     │  tags: Agent, Markdown, Embedding       │
│ Concepts     │                                        │
│ Tasks        │  用户正在开发一个面向学习与工作的...      │
└──────────────┴────────────────────────────────────────┘
```

### 11.3 Review 页面

```text
Agent 建议保存以下长期记忆：

[新增] 个人长期 Agent 项目方向
原因：这是用户正在推进的长期项目，对后续回答有持续帮助。

[更新] 软件形态选择
原因：用户已经明确倾向于独立应用，而不是 Obsidian 插件。

按钮：
[保存] [编辑后保存] [忽略]
```

---

## 12. MVP 与开发路线

### 12.1 MVP 必做功能

- 选择本地记忆库文件夹，自动创建基础目录结构。
- 扫描 Markdown 文件，解析 YAML frontmatter、标签和双链。
- 建立 SQLite 元数据索引和 Embedding 向量索引。
- 支持关键词检索、双链图谱扩展、混合检索排序。
- 实现聊天窗口，显示本次回答调用的记忆来源。
- 从对话中生成候选记忆，用户确认后写入 Markdown。

### 12.2 MVP 暂不做

多 Agent 协作、自动操作电脑、邮件/日历集成、云同步、插件市场、移动端、团队协作、复杂权限系统。

### 12.3 开发阶段

**Phase 0：项目初始化**
- 初始化 Electron + React + TypeScript 前端。
- 初始化 Python + FastAPI 后端。
- 建立前后端通信，完成基础页面框架。

**Phase 1：本地记忆库管理**
- 实现选择文件夹，自动创建 `Memories/`、`Inbox/`、`Attachments/`、`.agent/`。
- 扫描 Markdown 文件，解析标题、正文、YAML、tags 和双链。
- 将元数据写入 SQLite，前端展示记忆列表。

**Phase 2：索引系统**
- 实现文本切块，接入 Embedding 模型。
- 建立向量索引和关键词全文索引。
- 支持手动重新索引和基于文件 hash 的增量更新。

**Phase 3：混合检索**
- 实现语义检索、关键词检索、双链扩展、综合评分。
- 前端展示检索结果和命中原因。

**Phase 4：聊天 Agent**
- 实现聊天会话，聊天时自动检索相关记忆。
- 将记忆上下文注入 LLM，返回回答，右侧显示被唤醒的记忆来源。

**Phase 5：记忆写入闭环**
- 对话结束后提取候选记忆（区分新增、更新、废弃）。
- 在 Review 页面展示，用户确认后写入 Markdown 并自动更新索引。

**Phase 6：产品化增强**
- 文件变化自动监听、Markdown 编辑器增强、记忆图谱可视化。
- 多模型配置、本地模型支持、数据导入导出、UI 美化与打包发布。

---

## 13. 安装与运行

```bash
# 启动后端
cd backend
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000

# 启动前端
cd frontend
npm install
npm run dev

# 启动桌面应用
npm run electron:dev
```

当前 MVP 已按上述结构实现，开发期默认前后端分跑：

```powershell
# Terminal 1: FastAPI
cd D:\VS_project\LuminaMind\backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: Vite
cd D:\VS_project\LuminaMind\frontend
npm run dev

# Terminal 3: Electron
cd D:\VS_project\LuminaMind\frontend
npm run electron:dev
```

验证命令：

```powershell
cd D:\VS_project\LuminaMind\backend
.\.venv\Scripts\python.exe -m pytest tests

cd D:\VS_project\LuminaMind\frontend
npm test -- --run
npm run build
```

模型默认值：

- LLM：可在 Settings 中选择 `deepseek` 或 `ollama`。
- DeepSeek 默认模型：`deepseek-chat`。
- Ollama 默认聊天模型：`qwen2.5:7b`。
- Embedding 固定使用 Ollama `bge-m3`，若本地 Ollama 不可用，MVP 会回退到本地 hash embedding，以便开发和测试闭环不断。

---

## 14. 环境变量

后端 `.env` 示例：

```env
APP_ENV=development
APP_HOST=127.0.0.1
APP_PORT=8000

LLM_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

VECTOR_STORE=chroma
SQLITE_DB_PATH=.agent/index.db
```

---

## 15. 项目边界

第一阶段专注于核心问题：

> 如何让个人 Agent 拥有可控、可编辑、可迁移、可解释的长期记忆？

优先保证：记忆格式清晰、检索链路稳定、用户可见 Agent 使用了哪些记忆、用户可控制哪些内容被长期保存、Markdown 记忆库可独立存在。

只要完成本地 Markdown 扫描 → Embedding 索引 → 双链解析 → 混合检索 → 基于记忆的聊天回答 → 候选记忆审查写入 这个闭环，项目核心 Demo 即可成立。
