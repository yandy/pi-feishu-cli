# `/help` 命令设计

## 背景

飞书机器人增加 `/help` 命令，返回面向用户的使用说明卡片。

## 配置：Bot 名称

| 层级 | 来源 | 字段 |
|------|------|------|
| CLI 参数 | `--bot-name` | `MainOptions.botName` |
| Config 文件 | `.pi/feishu.json` / `~/.pi/agent/feishu.json` | `FeishuConfig.botName` |
| 环境变量 | `FEISHU_BOT_NAME` | - |
| 默认值 | - | `"PI Agent"` |

优先级：CLI args > config 文件 > 环境变量 > 默认值。

### 涉及文件

- `src/types.ts` — `FeishuConfig` 增加 `botName?: string`
- `src/config.ts` — `loadConfig` 读取 `FEISHU_BOT_NAME` 环境变量，config 文件中读取 `botName`
- `cli.ts` — 增加 `--bot-name` 参数解析
- `src/index.ts` — `MainOptions` 增加 `botName`，传入 `setupFeishuHandlers`

## 卡片构建：`src/feishu/cards/help.ts`

新增文件，导出 `buildHelpCard(botName: string)`。

卡片结构：

```
header: "使用帮助"
div:    "你好！我是 {botName}，你可以直接发送消息与我对话。"
hr
div:    "**如何使用**\n· 发送文字、图片、文件等附件，我会理解并回复\n· 回复会实时流式输出\n· 支持多轮对话，上下文保留"
hr
div:    "**可用命令**"
action: 按钮"管理会话" → { cmd: "help", action: "sessions" }
action: 按钮"选择模型" → { cmd: "help", action: "models" }
div:    "/help · 显示此帮助"
note:   "💡 对话历史自动保存，可随时点击上方按钮管理"
```

## Handler 扩展：`src/feishu/handler.ts`

`createMessageHandler` 增加第三个参数 `handleHelp: FeishuCommandHandler`，内部增加 `/help` 路由。

## 命令注册 & 卡片回调：`src/index.ts`

- `setupFeishuHandlers` 实现 `handleHelp`（调 `buildHelpCard` + `channel.send`）
- `handleSessions`、`handleModels` 提升到闭包外，供 `handleCardAction` 复用
- `handleCardAction` 增加 `cmd === "help"` 分支：
  - `action === "sessions"` → 调 `handleSessions(chatId)`
  - `action === "models"` → 调 `handleModels(chatId)`
- `channel.on("message")` 流式门控条件增加 `/help`

## 数据流

```
cli.ts --bot-name
  ↓
MainOptions.botName
  ↓
main() → 合并 FEISHU_BOT_NAME env / config → setupFeishuHandlers(botName)
  ↓
handleHelp → buildHelpCard(botName) → channel.send(chatId, { card })
```

## 涉及文件清单

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `FeishuConfig` + `botName?: string` |
| `src/config.ts` | 读取 `FEISHU_BOT_NAME` env 和 config 中 `botName` |
| `cli.ts` | + `--bot-name` 参数 |
| `src/index.ts` | `MainOptions` + `botName`；实现 `handleHelp`；提升 handlers；增加 `/help` 流式门控和 card action |
| `src/feishu/handler.ts` | `createMessageHandler` + `handleHelp` 参数 + `/help` 路由 |
| `src/feishu/cards/help.ts` | 新建，导出 `buildHelpCard` |
| `src/feishu/cards/models.ts` | 优化排版：按钮文字去前缀，model 名称加粗，模型间加分隔线 |

## 附：Models Card 排版优化

当前问题：
- Thinking 按钮文字冗余：`Think:high` → 缩写 `high`
- Model 名称被 6 个按钮淹没
- 模型之间无分隔

改进：
- 按钮文字去掉 `Think:` 前缀，级别名称缩写：`minimal`→`min`、`medium`→`med`
- Model 名称用 `**加粗**` 显示
- 每个 model 的按钮组前加 `hr` 分隔线
- "当前"区域的 thinking 显示也去掉 `Thinking:` 前缀
