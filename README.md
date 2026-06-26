# pi-feishu

一个 CLI 工具，在终端中以 TUI 方式运行 [Pi](https://pi.ai)，并将其连接到飞书机器人以实现远程交互。TUI 与飞书机器人共享同一个 AgentSessionRuntime 会话 — 可在任一界面中交替使用。

## 前置要求

- Node.js >= 22
- 已配置 Pi API 密钥（`~/.pi/agent/auth.json`）
- 已启用机器人能力的飞书应用（权限：`im:message`、`im:message.group_msg`、`card.action.trigger`）

## 安装

```bash
npm install -g pi-feishu-cli
```

或不安装直接运行：

```bash
npx pi-feishu
```

### feishu cli(可选)

> feishu cli 是飞书skill的依赖项，同时可用于创建机器人

```sh
npm install -g @larksuite/cli

lark-cli config init
lark-cli auth login --recommend
lark-cli auth status
```

## 快速开始

```bash
pi-feishu --app-id cli_xxx --app-secret xxx
```

如果缺少凭证，CLI 会交互式提示输入并将其保存到 `~/.pi/pi-feishu/auth.json`。

## CLI 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--app-id <id>` | — | 飞书 App ID |
| `--app-secret <key>` | — | 飞书 App Secret |
| `--config <path>` | — | JSON 配置文件路径 |
| `--log-level <level>` | `warn` | 可选值：`fatal`、`error`、`warn`、`info`、`debug`、`trace` |
| `--bot-name <name>` | `PI Agent` | 帮助卡片中显示的机器人名称 |
| `--no-bundle-feishu-skills` | — | 跳过加载项目 `skills/` 目录 |
| `--help`、`-h` | — | 显示帮助并退出 |

## 配置

飞书凭证按以下优先级解析（高优先级覆盖低优先级）：

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1（最高） | CLI 参数 | `pi-feishu --app-id xxx --app-secret xxx` |
| 2 | 配置文件 | `.pi/feishu-auth.json` 或 `~/.pi/pi-feishu/auth.json`（按顺序查找） |
| 3（最低） | 环境变量 | `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BOT_NAME`、`FEISHU_NO_BUNDLE_SKILLS` |

配置文件格式：

```json
{ "appId": "cli_xxx", "appSecret": "xxx", "botName": "My Bot", "noBundleFeishuSkills": true }
```

使用 `--config` 覆盖配置文件路径：

```bash
pi-feishu --config /path/to/config.json
```

## 飞书机器人命令

| 命令 | 操作 |
|------|------|
| `/sessions` | 显示会话管理卡片 — 列出、切换、删除和创建会话 |
| `/models` | 显示模型和 thinking level 选择卡片 |
| `/help` | 显示使用说明 |
| *其他任意消息* | 与 Pi 对话 — 通过飞书卡片流式输出（打字机效果） |

### 卡片交互

卡片上的可点击按钮支持以下操作：

- **会话管理：** 新建、切换、删除
- **模型管理：** 选择 provider/model/thinking level（`off`、`minimal`、`low`、`medium`、`high`、`xhigh`）
- **帮助卡片导航：** 跳转到会话或模型卡片

## 架构

```
cli.ts (根目录)              CLI 入口 — 解析 CLI 参数，调用 main()
  └─ src/index.ts            主入口 — 加载配置、初始化 runtime、连接飞书、启动 TUI
       ├─ src/config.ts      凭证解析 CLI > 配置文件 > 环境变量
       ├─ src/runtime.ts     AgentSessionRuntime 初始化 + skill 加载
       │                     + send_file_to_chat 工具注册（extension factory）
       ├─ src/types.ts       FeishuConfig 类型定义
       ├─ src/feishu/
       │    ├─ channel.ts    LarkChannel 封装 — WebSocket、发送、流式、卡片、文件/图片
       │    ├─ handler.ts    消息路由 — 命令 vs 对话
       │    ├─ streaming.ts  会话事件 → 飞书卡片流式输出（打字机效果）
       │    ├─ attachments.ts 下载并处理消息附件（图片、文件、音频、视频）
       │    ├─ context.ts    当前飞书聊天上下文（chatId + channel），供工具调用
       │    └─ cards/
       │         ├─ sessions.ts  会话管理卡片
       │         ├─ models.ts    模型选择卡片
       │         ├─ help.ts      帮助卡片
       │         └─ helpers.ts   共享卡片构建工具函数
       └─ InteractiveMode       TUI（来自 @earendil-works/pi-coding-agent）
```

### Channel API

`createChannel(opts)` 封装了 `@larksuiteoapi/node-sdk` 的 `createLarkChannel`，返回一个 `Channel` 接口。

**事件：**

| 事件 | 处理器 | 说明 |
|------|--------|------|
| `message` | `(msg: NormalizedMessage) => void` | 收到飞书消息 |
| `cardAction` | `(evt: CardActionEvent) => void` | 卡片按钮点击 |
| `error` | `(err: Error) => void` | 通道级别错误 |
| `reconnecting` | `() => void` | SDK 正在重连 |
| `reconnected` | `() => void` | SDK 重连成功 |
| `botAdded` | `() => void` | 机器人被添加到聊天 |
| `onRawEvent(type, handler)` | — | 在底层 dispatcher 上注册原始 SDK 事件处理器 |

**方法：** `connect`、`disconnect`、`send`、`stream`、`updateCard`、`updateCardByToken`、`sendFile`、`sendImage`、`downloadMessageResource`、`onRawEvent`

### 数据流

```
飞书用户 → WebSocket → channel.on("message")
  ├── /sessions  → setupFeishuHandlers → channel.send(card)
  ├── /models    → setupFeishuHandlers → channel.send(card)
  ├── /help      → setupFeishuHandlers → channel.send(card)
  └── text       → setFeishuContext() + processAttachments() → channel.stream()
                     → handler.ts: createMessageHandler → session.prompt(text)
                     → streaming.ts: createStreamingHandler → stream.append()

卡片点击 → channel.on("cardAction") → index.ts: handleCardAction()
  ├── session: new / switch / delete → runtime.* → updateCardByToken(token, card)
  ├── model: select → session.setModel() + setThinkingLevel() → updateCardByToken(token, card)
  └── help: navigate → buildSessionsCard / buildModelsCard → updateCardByToken(token, card)

工具调用 → runtime extension factory → send_file_to_chat
  └── getFeishuContext() → channel.sendFile(chatId, filePath)
```

## 注册的工具

### `send_file_to_chat`

一个运行时注册的自定义工具，允许 Pi 将文件发送到当前飞书聊天窗口。

- **参数：** `filePath`（字符串，必填）、`fileName`（字符串，可选）
- **限制：** 仅在飞书对话会话中可用；文件大小限制 20MB
- **Prompt 引导：** 模型被指示在生成可交付文件（docx、pdf、xlsx、图片等）时自动使用此工具

## Skills

`skills/` 目录包含 26 个 Lark API skills，为 Pi 提供飞书生态的知识：文档、日历、邮件、电子表格、知识库、审批、考勤、任务、会议纪要、白板等。启动时通过 `loadSkillsFromDir()` 自动加载。使用 `--no-bundle-feishu-skills` 可跳过加载这些 skills。

Skills 可从飞书 well-known endpoint 刷新：

```bash
npm run update-skills
```

## 开发

```bash
npm install
npm run build       # tsc 编译到 dist/
npm run typecheck   # tsc --noEmit 类型检查
npm run check       # biome 格式 & lint 检查
npm run dev         # tsc --watch
npm test            # vitest run
npm run test:watch  # vitest
```

### 测试结构

测试文件与 `src/` 目录结构对应，位于 `tests/` 下，使用 Vitest：

```bash
npx vitest run tests/feishu/channel.test.ts
```

## 发布

通过 GitHub Release 发布到 npm（CI 工作流在 `.github/workflows/publish.yml` 中）。

```bash
npm version patch
git push --tags
# 创建 GitHub Release → 自动以 --provenance 发布
```

## 许可证

MIT
