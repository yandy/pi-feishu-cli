# 飞书附件透传 Pi 设计文档

**日期：** 2026-06-02
**目标：** 支持通过飞书向机器人发送带附件的消息，附件内容经 Pi 传给 LLM。

## 架构

```
飞书用户发消息 + 附件
        │
        ▼
  Channel.on("message") ── NormalizedMessage { content, resources[] }
        │
        ▼
  attachments.processAttachments(channel, msg, downloadDir)
        │   ├── image  → Buffer → base64 → ImageContent
        │   ├── file  ≤32KB 且可读文本 → 拼入 text
        │   └── file  >32KB 或非文本 → 存盘，路径写入 text
        │
        ▼
  ProcessedAttachments { images: ImageContent[], text: string }
        │
        ▼
  session.prompt(fullText, { images, streamingBehavior: "steer" })
```

## 附件处理策略

| 类型 | 判断 | 处理 |
|------|------|------|
| `image` | 直接 | 下载 Buffer → 推断 mimeType → base64 → `ImageContent` |
| `file` | ≤32KB 且为文本 | 下载 Buffer → UTF-8 解码 → 拼入提示词 |
| `file` | >32KB 或非文本 | 下载 → 保存到 `downloadDir/<fileName>` → 路径说明写入提示词 |
| `audio/video` | 全部 | 下载 → 保存到 `downloadDir` → 路径说明写入提示词 |
| `sticker` | — | 飞书暂不支持下载，忽略 |

**文本检测：** 读前 4096 字节，不含 `\0` 即为文本。

**MIME 推断：** 按文件扩展名映射（png/jpg/jpeg/gif/webp/bmp/tiff），未知 fallback `image/png`。

**文件命名：** 优先 `ResourceDescriptor.fileName`，无则 `${fileKey}.bin`。

**下载目录：** `/tmp/pi-feishu/<sessionId>/`，会话结束时清理。

## 文件变更

### 1. `src/feishu/channel.ts` — Channel 接口扩展

`Channel` 接口新增方法：

```typescript
downloadMessageResource(messageId: string, fileKey: string, type: string): Promise<Buffer>;
```

`createChannel` 实现中用 `rawClient.im.v1.messageResource.get()` + `getReadableStream()` 攒流为 Buffer 返回。

### 2. `src/feishu/attachments.ts` — 新文件：附件处理模块

对外导出：

```typescript
export interface ProcessedAttachments {
  images: ImageContent[];
  text: string;
}

export async function processAttachments(
  channel: Channel,
  msg: NormalizedMessage,
  downloadDir: string,
): Promise<ProcessedAttachments>;
```

内部依赖 `@earendil-works/pi-ai` 的 `ImageContent` 类型和 `channel.ts` 的 `Channel`/`NormalizedMessage` 类型。

### 3. `src/feishu/handler.ts` — Handler 参数扩展

`createMessageHandler` 改为接收已处理好的 `ProcessedAttachments`：

```typescript
export function createMessageHandler(
  runtime: AgentSessionRuntime,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
  handleHelp: FeishuCommandHandler,
): (msg: NormalizedMessage, attachments?: ProcessedAttachments) => Promise<void>;
```

内部将 `attachments.text` 拼入 `msg.content`，`attachments.images` 传入 `session.prompt(text, { images })`。

### 4. `src/index.ts` — 组装依赖

在 `setupFeishuHandlers` 的消息事件回调中：

1. 创建 `downloadDir`（若消息有附件）
2. 调用 `processAttachments`
3. 将结果传入 `messageHandler`
4. 每条消息处理完成后清理该消息的临时文件
5. `process.on("exit")` 注册兜底清理整个下载目录

## 类型依赖关系

```
attachments.ts  ──→ @earendil-works/pi-ai (ImageContent)
attachments.ts  ──→ channel.ts (Channel, NormalizedMessage)
handler.ts      ──→ attachments.ts (ProcessedAttachments)
index.ts        ──→ attachments.ts (processAttachments)
```

## 错误处理

- 飞书服务端拒绝下载（超 100MB/权限问题）→ 捕获异常，在提示词中告知用户该附件下载失败
- 网络超时 → 同上
- Buffer → text 解码失败 → 视为非文本文件，存盘处理

## 约束

- 飞书 `messageResource.get` 限制单文件 100MB
- 文本检测阈值 32KB（约 8K tokens）
- 图片不做主动压缩，保持原始质量
- 下载目录 `/tmp/pi-feishu/<sessionId>/`
