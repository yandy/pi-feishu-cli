# pi-feishu-cli

在飞书中与 Pi 对话的 [Pi package](https://pi.dev/docs/latest/packages)。包含一个 Pi Extension（飞书 IM 集成）和 26 个飞书 CLI skills。

## 安装

```bash
pi install npm:pi-feishu-cli
```

## 使用

在 Pi 交互终端中使用命令管理飞书通信：

| 命令 | 说明 |
|------|------|
| `/feishu-im start` | 启动 Daemon 并连接飞书 |
| `/feishu-im status` | 查看 Daemon 运行状态 |
| `/feishu-im stop` | 停止 Daemon |

首次启动时若无飞书凭据，会引导在 Pi 终端中输入 App ID 和 App Secret。凭据通过后自动持久化到 `~/.pi/agent/feishu-im/auth.json`。

## 前置依赖

- [飞书开放平台](https://open.feishu.cn/) 自建应用（需开通机器人、事件订阅、消息权限）
- 飞书应用凭据（App ID / App Secret）

## 架构

```
 Pi 进程                                    独立进程
┌─────────────────────┐                  ┌──────────────────┐
│  Extension           │   Unix Socket   │  Daemon           │
│  extensions/         │ ◄──────────────►│  src/daemon/      │
│  index.ts            │   JSON-line     │  index.ts         │
│                      │   1:1           │                   │
│  • /feishu-im 命令   │                 │  • Feishu Channel │
│  • chatId↔session    │                 │    SDK (WebSocket) │
│  • Pi 事件 hooks     │                 │  • 消息收发/流式   │
└─────────────────────┘                  └──────────────────┘
```

- **Extension**：运行在 Pi 进程内，注册命令、管理会话映射、监听 Pi 事件实现飞书→Pi 消息转发
- **Daemon**：独立进程（`spawn` detach + unref），基于 `@larksuiteoapi/node-sdk` Channel 模块维护飞书 WebSocket 长连接，Pi 关闭后仍可运行
- **IPC**：Unix domain socket (`/tmp/pi-feishu-im.sock`)，JSON-line 协议，Daemon 同时只接受一个 Extension 连接

## 飞书对话

用户通过飞书机器人发送消息（支持文字、图片、文件等），消息经 Channel SDK 归一化后转发至 Pi。Pi 的回复以流式（markdown）形式返回飞书。

## 管理操作

通过飞书内向机器人发送消息可进行管理操作：

| 操作 | 说明 |
|------|------|
| `/sessions` | 会话列表（卡片，含切换、删除、新建） |
| `/model` | 切换模型（卡片，下拉选择） |
| 卡片按钮回调 | 经 cardAction 事件处理 |

## 数据目录

```
~/.pi/agent/feishu-im/
├── auth.json       # 飞书应用凭据
├── daemon.pid      # Daemon PID
├── registry.json   # 飞书 chatId → Pi session 映射
└── daemon.log      # 运行日志
```

## Skills

包含 26 个飞书 CLI skills（lark-*），覆盖 IM、日历、文档、多维表格、审批、OKR、视频会议、白板等飞书服务。通过 Pi 的技能系统自动加载，对话中按需调用。

## 开发

```bash
npm install
npx vitest run        # 运行测试
npx vitest            # 监听模式
npx tsc --noEmit      # 类型检查
```
