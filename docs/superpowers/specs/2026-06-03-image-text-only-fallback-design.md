# 图片附件 Text-Only 模型回退设计

**日期：** 2026-06-03
**目标：** 当模型 `input` 不包含 `"image"` 时，图片附件走文件保存路径而非 base64，确保 text-only 模型也能感知到图片文件存在。

## 背景

当前 `processAttachments` 对所有模型一律将图片转为 base64 `ImageContent`，通过 `session.prompt({ images })` 传入。对于 `input` 仅为 `["text"]` 的模型（如 `amazon.nova-micro-v1:0`），base64 图片无法被模型处理，用户发图后 LLM 完全不知道有附件。

## 架构

```
index.ts                              attachments.ts
─────────────────────                  ─────────────────────────
runtime.session.model?.input ──────►  processAttachments(channel,
    = ["text"] or ["text","image"]         msg, downloadDir,
                                          supportedInput  ← 新增
                                      )
                                          │
                                          ├─ supportedInput.includes("image")
                                          │    → base64 ImageContent（现有行为）
                                          │
                                          └─ !supportedInput.includes("image")
                                               → downloadDir/<fileName>
                                               → "[图片: xxx 已保存到 /path]"
```

## 附件处理策略变更

| 类型 | 原策略 | 新策略 |
|------|--------|--------|
| `image` | 一律 base64 → `ImageContent` | 有图能力 → 同原策略；无图能力 → 保存到文件 + 路径写入 text |

## 文件变更

### 1. `src/feishu/attachments.ts`

新增类型导出和函数签名：

```typescript
export type SupportedInput = ("text" | "image")[];

export async function processAttachments(
  channel: Pick<Channel, "downloadMessageResource">,
  msg: NormalizedMessage,
  downloadDir: string,
  supportedInput: SupportedInput = ["text", "image"],
): Promise<ProcessedAttachments>;
```

图片分支逻辑：

```typescript
if (res.type === "image") {
  if (supportedInput.includes("image")) {
    // 现有逻辑：base64 → ImageContent
    const buf = await channel.downloadMessageResource(...);
    images.push({ type: "image", data: buf.toString("base64"), mimeType: inferMime(fileName) });
  } else {
    // text-only 回退：保存到文件，路径写入 text
    const buf = await channel.downloadMessageResource(...);
    const filePath = join(downloadDir, fileName);
    await writeFile(filePath, buf);
    textParts.push(`[图片: ${fileName} 已保存到 ${filePath}]`);
  }
  continue;
}
```

### 2. `src/index.ts`

第 138 行传入模型输入类型：

```typescript
attachments = await processAttachments(
  channel, msg, downloadDir,
  runtime.session.model?.input
);
```

`model?.input` 类型为 `("text" | "image")[]`，与 `supportedInput` 直接匹配。未知模型时 `undefined` 走默认值 `["text", "image"]`。

### 3. `src/feishu/handler.ts`

不需要变更。text-only 模型下 `attachments.images` 为空数组，handler 中 `images.length > 0` 自然为 false。

## 测试

`tests/feishu/attachments.test.ts` 新增：

- text-only 模型（`supportedInput = ["text"]`）下图片保存到文件路径，text 包含 `[图片: xxx 已保存到 /path]`，images 为空

## 错误处理

- 图片下载失败（text-only 路径）：同现有逻辑，`[图片: xxx 下载失败: <error>]`
- 文件写入失败：同现有 audio/video 路径，由下游 `writeFile` 抛出

## 约束

- `supportedInput` 默认值 `["text", "image"]` 确保未知模型保持现有行为
- 类型与 `model.input` 完全对齐，未来新增模态（如 `"audio"`）无需改签名
