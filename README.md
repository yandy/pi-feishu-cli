# pi-feishu-cli

在飞书中与 Pi 对话的 [pi package](https://pi.dev/docs/latest/packages)。包含 26 个飞书 CLI skills 和一个飞书 IM 守护进程。

## 安装

```bash
pi install ./pi-feishu-cli
```

## 启动

在 Pi 中通过扩展命令启动守护进程：

```
/feishu-im start    启动守护进程
/feishu-im status   查看状态
/feishu-im stop     停止守护进程
/feishu-im restart  重启守护进程
```

首次启动会自动检查 `lark-cli` 是否安装和配置，如未完成会给出引导提示。

## 前置依赖

- [lark-cli](https://github.com/larksuite/lark-cli) — 飞书 API 调用工具
- 飞书机器人应用凭证（通过 `lark-cli config init` 配置）

## 配置

`~/.pi/agent/feishu-im/config.json`：

```json
{
  "strategy": "mention",
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `strategy` | `"open"` \| `"mention"` | `"mention"` | 群聊策略：mention 仅回复 @机器人的消息，open 回复全部。**私聊不受此限制**，始终回复 |
| `model` | `string` | 空 | 新会话默认模型，不设置则用 Pi 默认 |
| `botName` | `string` | 空 | 机器人名称，用于群聊 @ 匹配（不设置则按任意 @ 匹配） |

## 架构

```
Pi extension → spawn daemon (jiti loads TS directly)
                      │
           ┌──────────▼──────────┐
           │     daemon.ts        │
           │  ┌────────────────┐  │
           │  │  consumer.ts   │  │ 长轮询飞书消息
           │  │  (长轮询事件)    │  │
           │  └───────┬───────┘  │
           │          ▼          │
           │  ┌────────────────┐  │
           │  │  processor.ts  │  │ 消息路由 Bot
           │  │  命令/对话分发   │  │ 命令/对话分发
           │  └───────┬───────┘  │
           │          ▼          │
           │  ┌────────────────┐  │
           │  │  messaging.ts  │  │ Pi SDK 交互
           │  │  消息收发+Agent  │  │ 处理消息回复
           │  └────────────────┘  │
           │                      │
           │  shared services:    │
           │  bot.ts / cards.ts   │
           │  renderer.ts /       │
           │  session-registry.ts │
           │  config.ts / logger  │
           └──────────────────────┘
```

守护进程使用 `jiti` 直接加载 TypeScript，无需预编译。独立于 Pi TUI 运行，关闭 Pi 后仍可继续对话。

## 飞书内命令

| 命令 | 说明 |
|------|------|
| `/new [名称]` | 创建新会话 |
| `/sessions` | 查看会话列表（卡片） |
| `/switch <id>` | 切换会话 |
| `/rm <id>` | 删除会话 |
| `/model` | 切换模型（卡片） |

## 数据目录

```
~/.pi/agent/
├── feishu-im/
│   ├── config.json         # 配置
│   ├── daemon.pid          # PID
│   ├── daemon.log          # 日志
│   └── registry.json       # 飞书↔Pi 会话映射
└── sessions/               # Pi session 文件
```

## Skills

包含 26 个飞书 CLI skills，覆盖 IM、日历、文档、表格、审批、OKR 等飞书服务。通过 Pi 的技能系统自动加载，对话中按需调用。

## 开发

```bash
npm install
npx vitest run        # 运行测试
npx vitest            # 监听模式
```
