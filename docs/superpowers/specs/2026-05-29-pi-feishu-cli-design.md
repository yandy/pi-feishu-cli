# pi-feishu-cli 设计文档

## 目标

创建 `pi-feishu-cli` Pi package，包含飞书 CLI skills 和一个飞书 IM 扩展。用户可以通过飞书对话与 Pi 交互，执行全部 Pi 能力（tools、skills、bash 等）。守护进程独立于 Pi TUI 运行，Pi 关闭后仍可在飞书中持续对话。

## 包结构

```
pi-feishu-cli/
├── package.json              # pi package manifest + npm metadata
├── tsconfig.json
├── skills/                   # 从 refs/skills 复制 (26 个 skill 目录)
│   ├── lark-im/
│   ├── lark-doc/
│   ├── lark-shared/
│   └── ...
└── src/
    ├── extension.ts           # Pi extension 入口（command + flag 注册）
    ├── daemon.ts              # 守护进程入口（独立启动）
    ├── config.ts              # 配置加载/校验
    ├── poller.ts              # 飞书长轮询事件监听
    ├── bot.ts                 # 消息路由器（分发到 session）
    ├── session-registry.ts    # chat_id → Session[] 映射管理
    ├── renderer.ts            # Markdown → 飞书消息格式
    ├── cards.ts               # 飞书交互卡片模板
    └── types.ts               # 共享类型定义
```

## 架构

```
┌─────────────────────────────────────────┐
│              pi TUI / RPC               │
│  ┌───────────────────────────────────┐  │
│  │  Extension: feishu-im             │  │
│  │  - /feishu-im start|stop|...      │  │
│  │  - --feishu-im flag               │  │
│  └──────────────┬────────────────────┘  │
└─────────────────│───────────────────────┘
                  │ spawn / signal
┌─────────────────▼───────────────────────┐
│        守护进程 (独立 Node.js)            │
│  ┌──────────┐  ┌───────────────────┐   │
│  │ 长轮询    │  │  Pi SDK Agent     │   │
│  │ (接消息)  │  │  (处理消息)        │   │
│  └────┬─────┘  └────────┬──────────┘   │
│       │                  │              │
│  ┌────▼──────────────────▼──────────┐   │
│  │      Session Registry             │  │
│  │  chat_id → [session1, session2...]│   │
│  └───────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

守护进程是独立 Node.js 进程，通过 spawn 启动。Pi TUI 关闭不影响其运行。单个全局实例（不支持多项目并行）。

## 数据流

```
Feishu Server → Long Polling → Poller → Bot → [ 命令 / 对话消息 ]
                                                       │
                                           ┌───────────┴───────────┐
                                           ▼                       ▼
                                    命令处理 (new/switch/rm)   Pi SDK Agent
                                           │                       │
                                           ▼                       ▼
                                    Session Registry           Renderer
                                           │                       │
                                           └───────────┬───────────┘
                                                       ▼
                                                lark-cli 回复
```

## 配置

### 配置文件

位置：`~/.pi/agent/feishu-im/config.json`

```json
{
  "strategy": "mention",
  "model": "anthropic/claude-opus-4-5",
  "pollInterval": 5,
  "autoStart": false
}
```

所有字段可选，有默认值。飞书认证信息由 lark-cli 管理，不在此配置中。

### 数据目录

```
~/.pi/agent/
├── feishu-im/
│   ├── config.json        # 守护进程配置
│   ├── daemon.pid          # PID 文件
│   └── registry.json       # 飞书会话与 Pi 会话映射
└── sessions/               # Pi session 文件 (Pi 标准目录)
    ├── sess_a1b2.jsonl
    └── ...
```

## 启动方式

### 一：Pi 内命令

```
/feishu-im start    → 启动守护进程
/feishu-im stop     → 停止守护进程
/feishu-im status   → 查看运行状态
/feishu-im restart  → 重启守护进程
```

### 二：CLI flag

```bash
pi --feishu-im    # 等价于 /feishu-im start
```

### 首次运行引导

1. 检查 `lark-cli` 命令是否存在 → 不存在则提示 `npm i -g lark-cli`
2. 检查 `lark-cli config show` 是否已配置 → 未配置则提示 `lark-cli config init`
3. 两项通过 → 启动守护进程

### 重复启动

检测已有守护进程运行 → 提示"已在运行 (PID: xxx)"，不做任何操作。

## 会话管理

### 会话模型

飞书聊天与 Pi 会话是 1:N 关系。每个飞书聊天可以创建多个 Pi 会话，用户可创建/切换/删除。

### 存储结构

Session 文件存储在 Pi 标准目录 `~/.pi/agent/sessions/` 下，以 session ID 命名：

```
~/.pi/agent/sessions/
├── sess_a1b2.jsonl
├── sess_c3d4.jsonl
└── ...
```

### Registry 持久化

`~/.pi/agent/feishu-im/registry.json` 记录飞书聊天与 Pi 会话的映射关系：

```json
{
  "oc_xxx": {
    "sessions": [
      { "id": "sess_a1b2", "name": "修 bug", "createdAt": 1700000000 },
      { "id": "sess_c3d4", "name": "新功能开发", "createdAt": 1700000100 }
    ],
    "active": "sess_c3d4"
  }
}
```

### 飞书内管理命令

| 命令 | 行为 | 反馈 |
|------|------|------|
| `/new [名称]` | 创建新 session，设为活跃 | 文本提示"已创建会话: xxx" |
| `/sessions` | 返回交互卡片，列出所有 session | 卡片，显示名称、状态 |
| `/switch <id>` | 切换活跃 session | 文本提示"已切换到: xxx" |
| `/rm <id>` | 删除指定 session | 确认后删除 |
| `/model` | 打开模型选择卡片 | 可选模型列表 |

### 生命周期规则

- 每个飞书聊天首次对话时自动创建默认 session
- 删除活跃 session 后自动切换到最近使用的
- Session 文件为标准 Pi JSONL 格式

## 消息处理

### 消息类型映射

| 飞书消息类型 | 处理方式 |
|-------------|---------|
| 文本消息 | 直接作为 prompt 发送给 Pi agent |
| 图片消息 | 守护进程下载后以 base64 传入 Pi SDK |
| 文件消息 | 下载文件到临时目录，读取内容后附加到 prompt |
| 语音消息 | 暂不支持 |
| 混合消息 | 文本+图片+文件合并为一条 prompt |
| 卡片交互 | 回传按钮点击 → 映射为对应命令 |

### 群聊策略

| 策略 | 行为 |
|------|------|
| `open` | 回复所有消息（需飞书后台开启"获取群组中所有消息"权限） |
| `mention` | 仅回复 @ 机器人的消息 |

策略在 `feishu-im.json` 中配置，`mention` 为默认值。

## 输出渲染

### Markdown → 飞书消息格式

| Pi 输出 | 飞书消息类型 | 备注 |
|---------|-------------|------|
| 普通文本/段落 | `text` | 直接映射 |
| 加粗/斜体 | `text` + 富文本 | 飞书文本支持部分 markdown |
| 代码块 | `text` (带格式) | 包裹在 ``` 中或分段发送 |
| 列表 | `text` | 缩进 + 序号/符号 |
| 表格 | `interactive` 卡片 | 超过一定行数渲染为图片 |
| 图片/图表 | `image` | 作为图片消息发送 |
| 链接 | `text` + 富文本 | 支持超链接格式 |

大段代码或长表格超出飞书单条消息限制（约 30KB）时，自动分片或以文件附件发送。

## 实时状态显示

使用飞书消息卡片流式更新显示 Pi 任务执行状态：

- `tool_execution_start` → 显示工具名 + 参数摘要
- `tool_execution_end` → 更新为成功/失败状态
- `message_update` (text_delta) → 流式追加文本到消息末尾
- 提供"取消"按钮可中断当前任务

## 外部依赖

### 运行时依赖

| 包 | 用途 |
|---|------|
| `@earendil-works/pi-coding-agent` | Pi SDK：创建 agent session、事件订阅 |
| `@earendil-works/pi-ai` | AI 工具：模型选择、类型工具 |
| `typebox` | 工具参数 schema 校验 |

### 外部工具

| 工具 | 用途 |
|------|------|
| `lark-cli` | 飞书 API 调用（消息收发、文件下载、长轮询） |

## 技术要点

- **守护进程循环**：长轮询间隔默认 5 秒，每次拉取新事件后批量处理
- **进程管理**：PID 文件检测进程存活，start/stop/status/restart 通过 signal 控制
- **Session 隔离**：每个飞书聊天独立 session list，session 文件为标准 Pi JSONL
- **认证委托**：飞书认证完全委托给 lark-cli，守护进程不存储飞书凭证
