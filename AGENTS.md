# LuminaMind 项目指南

## 一、软件基本架构

### 整体结构

```directory
LuminaMind/
├── backend/          # Python FastAPI 后端
│   ├── main.py       # 应用入口，所有 API 路由
│   ├── lumina/       # 核心逻辑模块
│   │   ├── config.py       # 配置管理（AppSettings）
│   │   ├── db.py           # SQLite 数据库初始化和连接
│   │   ├── vault.py        # 仓库目录初始化
│   │   ├── models.py       # Pydantic 数据模型
│   │   ├── embedding.py    # Embedding 提供者（LocalHash / Ollama）
│   │   ├── indexer.py      # 文本分块和向量索引
│   │   ├── retrieval.py    # 混合检索（语义+关键词+链接+重要度+新鲜度）
│   │   ├── llm.py          # LLM 调用（DeepSeek / Ollama）
│   │   ├── conversations.py # 对话 CRUD
│   │   ├── suggestions.py   # 记忆建议的生成/接受/拒绝
│   │   └── memory/
│   │       ├── markdown.py  # Markdown 笔记解析/序列化
│   │       └── store.py     # 记忆 CRUD + 扫描
│   └── tests/        # pytest 测试
│       ├── test_memory_core.py  # 核心层单元测试
│       └── test_api.py          # API 集成测试（TestClient）
│
└── frontend/         # React + TypeScript + Vite + Electron
    ├── index.html
    ├── vite.config.ts
    ├── electron/
    │   ├── main.cjs          # Electron 主进程
    │   └── preload.cjs       # 预加载脚本
    └── src/
        ├── main.tsx          # React 入口
        ├── App.tsx           # 主导航和页面路由
        ├── styles.css        # 全局样式（CSS Grid，无框架）
        ├── services/
        │   └── api.ts        # API 客户端（封装 fetch）
        ├── pages/
        │   ├── ChatPage.tsx      # 聊天页面
        │   ├── MemoryPage.tsx    # 记忆浏览页面
        │   ├── ReviewPage.tsx    # 记忆建议审查页面
        │   └── SettingsPage.tsx  # 设置页面
        └── test/
            └── setup.ts      # 测试配置
```

### 后端架构要点

- **框架**: FastAPI + uvicorn，所有路由挂载在 `/api` 下
- **数据库**: SQLite（通过标准库 `sqlite3`），数据库文件位于 `{vault_root}/.agent/index.db`
- **状态管理**: `AppState` 类在内存中持有当前 `vault_root`，路由守卫通过 `require_vault()` 实现
- **配置持久化**: 仓库目录下的 `.agent/config.json`
- **向量索引**: 可选 ChromaDB，回退到 JSON 文件 `.agent/vector_index/fallback_vectors.json`
- **核心流程**: 选仓库 → 扫描 Markdown 文件 → 构建索引 → 检索 → LLM 回答 → 生成记忆建议 → 用户审查 → 写入记忆

### 前端架构要点

- **框架**: React 18 + TypeScript，Vite 5 构建，Electron 31 桌面壳
- **状态管理**: 无全局状态库，组件内管理状态，通过 App.tsx 层级下发
- **API 通信**: 统一 `request<T>()` 封装，base URL 来自 `VITE_API_BASE_URL` 环境变量
- **页面路由**: App.tsx 内部状态机实现简单路由（chat/memory/review/settings）
- **启动方式**: 三个进程并行（后端 uvicorn + Vite dev server + Electron）

---

## 二、测试规则

### 运行测试

```powershell
# 后端测试（在 backend/ 目录下）
.\.venv\Scripts\python.exe -m pytest tests -v

# 带输出显示运行测试
.\.venv\Scripts\python.exe -m pytest tests -v -s

# 运行单个测试文件
.\.venv\Scripts\python.exe -m pytest tests/test_api.py -v

# 运行单个测试
.\.venv\Scripts\python.exe -m pytest tests/test_api.py::test_api_vault_scan_retrieve_chat_and_review_cycle -v

# 前端测试
cd frontend && npm test -- --run
```

### 测试准则

1. **后端测试**: 使用 `tmp_path` 临时目录，不污染真实文件系统
2. **API 测试**: 每次创建新的 `TestClient` 获得干净应用状态
3. **Mock 策略**: 使用 `monkeypatch.setattr` 模拟 LLM/索引调用，避免外部依赖
4. **修改代码后**: 必须确保所有现有测试通过，再提交

---

## 三、开发工作流

### 修改代码后的测试流程

每次修改代码后，按以下步骤操作：

1. **杀死旧的后端进程**（如果有 uvicorn 在运行）
2. **启动新的后端进程**用于测试
3. **运行测试**验证修改

```powershell
# 步骤1：杀死所有占用 8000 端口的 Python 进程
$process = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
if ($process) { Stop-Process -Id $process -Force }

# 可选：同时杀死所有 python.exe 中运行 uvicorn 的进程
Get-Process python* | Where-Object { $_.CommandLine -match "uvicorn" } | Stop-Process -Force

# 步骤2：等待端口释放
Start-Sleep -Seconds 1

# 步骤3：后台启动新后端
cd D:\VS_project\LuminaMind\backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

# 步骤4：运行测试
.\.venv\Scripts\python.exe -m pytest tests -v
```

### 建议的简化命令

```powershell
# 一键重启后端并测试
$p = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess; if ($p) { Stop-Process -Id $p -Force }; Start-Sleep 1; .\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

> **注意**: `--reload` 模式下 uvicorn 会自动检测文件变化并重启，但端口释放有延迟，偶尔需要手动杀进程。
