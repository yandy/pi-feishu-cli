# Streaming: Feishu Bot 实时增量消息

## 问题

用户发送消息给飞书机器人后，机器人要等到 Pi 完全生成完回复才一次性显示，体验不佳。

## 目标

Pi 生成回复时，飞书客户端实时显示逐字打字动画效果。

## 方案

利用 `@larksuiteoapi/node-sdk` 已原生支持的 stream API（`streaming_mode: true` 卡片 + `MarkdownStreamController.append()`），将 Daemon 中积累后统一发送的模式改为边收边发。

### 当前流程（问题）

```
Extension  ──stream(IPC)──→  Daemon 积累 chunks[]
Extension  ──streamEnd──→  Daemon → channel.stream() 一次性发送全部
```

### 新流程

```
Extension  ──stream(IPC #1)──→  Daemon → channel.stream() 立即启动
                                         │
                                    markdown producer 进入等待循环:
                                    while (!ended || pendingChunks.length > 0):
                                        chunk 在队 → controller.append(chunk)
                                        空队       → await notify()

Extension  ──stream(IPC #N)──→  chunk 入队 pendingChunks → notify() 唤醒 producer
Extension  ──streamEnd──────→  ended=true → notify() → producer 退出 → stream 完成
```

### Channel 配置

创建 channel 时透传 `outbound` 配置给 SDK：

```typescript
createFeishuChannel({
    appId, appSecret,
    outbound: {
        streamInitialText: "🤔 Pi 思考中...",
    },
})
```

### 预期效果

1. 用户发送消息 → 飞书立刻显示 "🤔 Pi 思考中..." 卡片，打字光标闪烁
2. Pi 逐步生成 → Feishu SDK 按 `print_strategy: 'fast'` + `print_frequency_ms: 70` 驱动原生打字动画
3. 生成完成 → SDK 自动调用 `finishStreamingCard`，卡片定型，光标消失

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/daemon/index.ts` | 重构 stream/streamEnd 处理器，streamMap 改为 StreamSession（含 pendingChunks + notify 机制） |
| `src/channel/index.ts` | `CreateChannelOptions` 透传 `outbound` 字段给 SDK |
| `src/ipc/protocol.ts` | 不变 |

## 错误处理

- 流中 append 失败 → SDK 内部标记 `streamingFailed`，静默跳过后续更新
- `streamEnd` 未收到（超时）→ 依赖 Feishu 自动关闭（10min）
- extension 断连 → stream 在 producer 下一次 await notify() 时永挂起，Daemon 重启时清理
