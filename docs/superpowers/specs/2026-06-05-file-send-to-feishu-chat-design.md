# pi 生成文件通过飞书机器人发回聊天窗口 设计文档

> 2026-06-05

## 背景

用户通过飞书机器人与 pi 对话时，pi 可以生成产出文件（Word 文档、图片、Excel 表格等）。用户希望 pi 能将这些文件直接通过飞书聊天窗口发送给自己，而不是仅告知文件路径让用户手动获取。

当前 pi 的核心问题是：
1. **不知道聊天窗口的存在** — pi 的 tool/skill 系统没有"飞书聊天"这一环境概念
2. **没有发文件的通道** — `Channel` 接口只支持 `send(card / text / markdown)`，不支持发送文件/图片类消息

## 问题分析

### 现有架构

```
Feishu 用户发消息 → channel.on("message")
  → setFeishuContext({ chatId, channel })
  → channel.stream() → markdown 回调
    → createStreamingHandler(runtime.session, s)
    → session.prompt(text, { streamingBehavior: "steer" })
      → pi agent loop → tool execution → streaming events
    → s.append(chunk)  （流式输出 markdown）
```

- 流式输出只处理 `text_delta`、`thinking_delta`、`tool_execution_*` 的**文本状态**，不处理文件
- pi 的工具结果（`write`、`bash` 创建的本地文件）没有通往飞书的路径
- TUI 和飞书共享 session，需要隔离上下文

### 已知约束

- **steer 在当前架构下可能不会生效**：`channel.stream()` 内部 `await raw.stream()` 会阻塞在 markdown producer 上，而 producer 中 `await session.prompt()` 又阻塞到 agent loop 结束。消息 handler 全程被阻塞，第二条消息无法到达 handler，steer 实际上不会触发。保留 `steer` 作为占位参数并加注释说明限制，不做修复。
- **TUI 和飞书共享 session**：工具注册后所有渠道都能看到，但通过 context 有无来区分渠道。

### 飞书文件发送 API

飞书提供了三种文件类消息的发送方式：

| 消息类型 | 上传端点 | 发送参数 |
|----------|----------|----------|
| 文件 | `POST /open-apis/im/v1/files` | `msg_type: "file"`, `content: { file_key }` |
| 图片 | `POST /open-apis/im/v1/images` | `msg_type: "image"`, `content: { image_key }` |
| 媒体（音频/视频） | `POST /open-apis/im/v1/medias` | `msg_type: "media"`, `content: { file_key, ... }` |

所有端点均通过 `raw.rawClient.request()` 直接调用。

## 方案设计

### 架构

```
之前:
  pi write "/tmp/xxx.docx" → tool_execution_end → 文本状态输出到卡片
  用户看不到文件，只能自己去拿

之后:
  pi write "/tmp/xxx.docx"
    → pi 看到 send_file_to_chat 工具（promptGuidelines）
    → pi 调用 send_file_to_chat({ filePath: "/tmp/xxx.docx" })
    → 工具从 FeishuContext 读取 chatId + channel
    → channel.sendFile(chatId, "/tmp/xxx.docx")
    → 飞书 API: 上传文件 → 发送文件消息 → 文件出现在聊天窗口
```

### 数据流

```
Feishu 用户发消息
  → setFeishuContext({ chatId, channel })
  → session.prompt(text)
  → pi 被 promptGuidelines 引导调用 send_file_to_chat
  → 工具 execute:
      ├─ getFeishuContext() → null? → "当前不在飞书对话中，无法发送文件。"
      └─ 有 context → channel.sendFile(chatId, filePath)
        → rawClient.request("POST", "/open-apis/im/v1/files", formData) → file_key
        → rawClient.request("POST", "/open-apis/im/v1/messages", { msg_type: "file", ... }) → 文件发到聊天
  → TUI 触发时无 FeishuContext，工具返回友好提示
```

### 组件改动

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/feishu/channel.ts` | ① 新增 `sendFile`/`sendImage` 方法；② `createLarkChannel` 加 `outbound.allowedFileDirs: [cwd]` | ① 委托给 `raw.send()`，利用 SDK 内置文件上传能力；② 安全限制 |
| `src/feishu/context.ts` | **新文件** | `setFeishuContext` / `getFeishuContext`，模块级状态管理当前 turn 的 chatId 和 channel |
| `src/runtime.ts` | ① `resourceLoaderOptions` 追加 `extensionFactories`，注册 `send_file_to_chat` 工具；② `skillsOverride` 改为 `additionalSkillPaths` | ① 工具含 `promptGuidelines`，引导 pi 在飞书环境中发送文件；② 详见下方"技能加载简化"章节 |
| `src/index.ts` | prompt 前调 `setFeishuContext`；`streamingBehavior` 处加注释说明 steer 阻塞问题 | context 在 TUI prompt 前自动为 null |

### Channel 新增方法

SDK 的 `LarkChannel.send()` 本身支持 `SendInput` 联合类型，其中包含 `{ file: {...} }` 和 `{ image: {...} }`，内部 `MediaUploader` 自动处理上传 + 发送。只需在 `Channel` 接口中暴露即可。

```typescript
// src/feishu/channel.ts

export interface Channel {
  // ... 已有方法 ...

  sendFile(chatId: string, filePath: string, fileName?: string): Promise<void>;
  sendImage(chatId: string, imagePath: string): Promise<void>;
}
```

实现：

```typescript
async sendFile(chatId: string, filePath: string, fileName?: string) {
    const name = fileName ?? path.basename(filePath);
    await raw.send(chatId, { file: { source: filePath, fileName: name } });
}

async sendImage(chatId: string, imagePath: string) {
    await raw.send(chatId, { image: { source: imagePath } });
}
```

SDK 内部自动完成：`Buffer` 读取 → `client.im.v1.file.create()` 上传 → `client.im.v1.message.create({ msg_type: 'file' })` 发送。

### 文件大小检查

飞书 API 限制：

| 消息类型 | 最大文件大小 |
|----------|-------------|
| 文件 (`msg_type: "file"`) | 20 MB |
| 图片 (`msg_type: "image"`) | 10 MB |

在 `sendFile` 和 `sendImage` 方法中上传前检查文件大小，超出限制时抛出带明确上限信息的错误：

```typescript
const MAX_FILE_SIZE = 20 * 1024 * 1024;  // 20 MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

async sendFile(chatId: string, filePath: string, fileName?: string) {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
        throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，飞书文件消息上限为 20MB`);
    }
    const name = fileName ?? path.basename(filePath);
    await raw.send(chatId, { file: { source: filePath, fileName: name } });
}
```

工具层 `catch` 此错误后将消息返回给 LLM，pi 可据此提示用户或尝试压缩文件。

### `allowedFileDirs` 安全配置

SDK 的 `MediaUploader` 会对本地文件路径做安全检查。默认不设 `allowedFileDirs` 时仅拦截 POSIX 系统路径（`/etc/`、`/proc/`、`/sys/`、`/dev/`），其他路径均可上传。为加强安全性，在 `createLarkChannel` 中配置 `outbound.allowedFileDirs` 限制为当前工作目录：

```typescript
const raw = createLarkChannel({
    // ... 已有配置 ...
    outbound: {
        allowedFileDirs: [cwd],
    },
});
```

`cwd` 需从 `ChannelOptions` 传入 `createChannel`。

| 配置 | 效果 |
|------|------|
| 不设（默认） | 仅拦截 POSIX 系统路径，其余放行 |
| `allowedFileDirs: [cwd]` | 只允许 cwd 下的文件上传 |

**注意**：如果 pi 通过 `bash` 工具在 `/tmp` 等非 cwd 目录生成文件，`send_file_to_chat` 调用会因路径不在白名单中而失败。工具层面可提示 pi 将文件移至 cwd 后再发送，或后续扩展 `allowedFileDirs` 列表。

### FeishuContext 模块

```typescript
// src/feishu/context.ts

import type { Channel } from "./channel.js";

export interface FeishuContextValue {
  chatId: string;
  channel: Channel;
}

let current: FeishuContextValue | null = null;

/** 在每条飞书消息处理开始前调用 */
export function setFeishuContext(ctx: FeishuContextValue | null): void {
  current = ctx;
}

/** 工具执行时读取当前飞书上下文，TUI 场景返回 null */
export function getFeishuContext(): FeishuContextValue | null {
  return current;
}
```

串行场景下直接赋值即可，无竞态问题。

### 工具注册

```typescript
// src/runtime.ts — 在 createRuntime 工厂中
resourceLoaderOptions: {
  extensionFactories: [
    (pi) => {
      pi.registerTool({
        name: "send_file_to_chat",
        label: "发送文件到飞书聊天",
        description:
          "发送本地文件到当前的飞书聊天窗口。仅当处于飞书对话环境中时才可使用。",
        promptGuidelines: [
          "当你生成了需要交付给用户的文件时（如 Word文档 .docx、图片 .png/.jpg、PDF .pdf、Excel表格 .xlsx 等），请主动调用 send_file_to_chat 工具将文件发送到聊天窗口。",
          "发送前确认文件已成功创建且路径正确。",
          "文件名应能清楚表达文件内容。",
        ],
        parameters: Type.Object({
          filePath: Type.String({ description: "要发送的本地文件路径" }),
          fileName: Type.Optional(
            Type.String({ description: "显示给用户的文件名，不传则用文件路径中的文件名" })
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const ctx = getFeishuContext();
          if (!ctx) {
            return {
              content: [
                { type: "text", text: "当前不在飞书对话中，无法发送文件。请在飞书聊天中直接请求发送。如果需要在 TUI 终端中查看文件，请直接告知文件路径。" },
              ],
            };
          }
          try {
            await ctx.channel.sendFile(ctx.chatId, params.filePath, params.fileName);
            return {
              content: [{ type: "text", text: `文件 "${params.fileName ?? params.filePath}" 已发送到飞书聊天窗口。` }],
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `文件发送失败: ${(err as Error).message}` }],
            };
          }
        },
      });
    },
  ],
}
```

### index.ts 改动点

```typescript
// src/index.ts — setupFeishuHandlers 中
channel.on("message", async (msg: NormalizedMessage) => {
  const content = msg.content.trim();
  if (content.startsWith("/sessions") || content.startsWith("/models") || content.startsWith("/help")) {
    await messageHandler(msg);
    return;
  }

  // 设置飞书上下文，使工具可以读取当前 chatId 和 channel
  setFeishuContext({ chatId: msg.chatId, channel });

  let attachments: ProcessedAttachments | undefined;
  let downloadDir: string | undefined;
  if (msg.resources.length > 0) { /* ... 保持原逻辑 ... */ }

  // 注意：此处 streamingBehavior 使用 "steer"，
  // 但由于 channel.stream() 内部阻塞在 markdown producer 上，
  // 而 producer 又阻塞在 session.prompt() 上，消息 handler 会被全程阻塞。
  // 因此实际效果是串行处理，steer 不会真正触发。
  // 保留 "steer" 作为未来正确实现流式中断时的占位参数。
  await channel.stream(msg.chatId, {
    marketdown: async (s) => {
      const unbind = createStreamingHandler(runtime.session, s);
      try {
        await messageHandler(msg, attachments);
      } finally {
        unbind();
        if (downloadDir) {
          rm(downloadDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    },
  }, { replyTo: msg.messageId });
});
```

### 技能加载简化：`skillsOverride` → `additionalSkillPaths`

当前 `runtime.ts` 使用 `skillsOverride` + 自定义 `loadSkillsFromDir` 函数加载项目 `skills/` 目录下的飞书技能：

```typescript
// 现状：自定义加载 + 完全替换
const customSkills = loadSkillsFromDir(skillsDir);
const skillsOverride = (current) => ({
    skills: customSkills,            // 全部替换，丢弃其他来源的技能
    diagnostics: current.diagnostics,
});
```

**问题**：`skillsOverride` 是完全替换，而非追加。其他来源（用户全局 `~/.pi/agent/skills/`、扩展包、`additionalSkillPaths`）的技能全部被丢弃，用户能看到的只有项目 `skills/` 目录下的 26 个 lark-* 技能。

**改为使用 SDK 内置的 `additionalSkillPaths`**：

```typescript
// 改为：标准追加路径
resourceLoaderOptions: {
    additionalSkillPaths: noBundle ? [] : [skillsDir],
}
```

这样无需自定义 `loadSkillsFromDir` 函数和 `skillsOverride` 闭包，SDK 的 `loadSkills()` 会自动扫描 `skills/` 子目录中的 `SKILL.md`，并与其他来源的技能正常合并（按名称去重，首个胜出）。

**改动**：

```diff
- const customSkills = noBundle ? [] : loadSkillsFromDir(skillsDir);
- const skillsOverride = (current) => ({ skills: customSkills, ... });
- resourceLoaderOptions: { skillsOverride }

+ resourceLoaderOptions: {
+     additionalSkillPaths: noBundle ? [] : [skillsDir],
+ }
```

同时删除不再使用的 `loadSkillsFromDir` 函数。

### 风险与限制

| 维度 | 说明 |
|------|------|
| `allowedFileDirs` | 默认配置为 `[cwd]`。pi 在 `/tmp` 等非 cwd 目录生成文件时 `send_file_to_chat` 会失败，工具会返回错误提示。后续可扩展白名单列表。 |
| 文件大小 | 飞书文件消息上限 20MB，图片 10MB。`sendFile`/`sendImage` 上传前检查，超限抛错误，LLM 通过工具结果感知。 |
| TUI 与飞书隔离 | 通过 `FeishuContext` 是否为 null 区分。TUI prompt 不设 context → 工具返回提示。 |
| steer 阻塞 | 不修复，加注释说明原因。消息串行处理，不引入竞态。 |

### 后续扩展

- **扩展 `allowedFileDirs`**：如果 pi 常用 `/tmp` 等路径生成文件，添加到白名单
