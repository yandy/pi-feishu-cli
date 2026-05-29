# pi-feishu-cli

在飞书中与 Pi 对话的 [pi package](https://pi.dev/docs/latest/packages)。包含 26 个飞书 CLI skills 和一个飞书 IM 守护进程。

## 安装

```bash
pi install ./pi-feishu-cli
```

## 启动

**方式一：Pi 内命令**

```
/feishu-im start    启动守护进程
/feishu-im status   查看状态
/feishu-im stop     停止守护进程
/feishu-im restart  重启守护进程
```

**方式二：CLI flag**

```bash
pi --feishu-im
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
  "model": "anthropic/claude-sonnet-4-20250514",
  "pollInterval": 5
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `strategy` | `"open"` \| `"mention"` | `"mention"` | 群聊策略：mention 仅回复 @机器人，open 回复全部 |
| `model` | `string` | 空 | 新会话默认模型，不设置则用 Pi 默认 |
| `pollInterval` | `number` | `5` | 长轮询间隔（秒） |

## 架构

```
pi TUI → extension(/feishu-im start)
                    │
               spawn daemon
                    │
         ┌──────────▼──────────┐
         │  守护进程 (Node.js)   │
         │  ┌───────────────┐  │
         │  │  长轮询事件     │  │
         │  └───────┬───────┘  │
         │          ▼          │
         │  ┌───────────────┐  │
         │  │  消息路由 Bot   │  │
         │  │  命令/对话分发  │  │
         │  └───────┬───────┘  │
         │          ▼          │
         │  ┌───────────────┐  │
         │  │  Pi SDK Agent  │  │
         │  │  处理消息回复   │  │
         │  └───────────────┘  │
         └─────────────────────┘
```

守护进程独立于 Pi TUI 运行，关闭 Pi 后仍可继续对话。

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
