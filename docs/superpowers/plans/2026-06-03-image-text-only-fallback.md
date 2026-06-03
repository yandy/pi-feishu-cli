# 图片附件 Text-Only 模型回退实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 图片附件按模型 input 能力分流：有图能力走 base64，无图能力走文件保存路径

**Architecture:** `processAttachments` 新增 `SupportedInput` 参数匹配 `model.input`，图片分支根据 `supportedInput.includes("image")` 分流

**Tech Stack:** TypeScript, Vitest

---

## 文件结构

| 文件 | 职责 | 变更 |
|------|------|------|
| `src/feishu/attachments.ts` | 附件处理模块 | 修改：新增 `SupportedInput` 类型 + 参数 + 图片分流逻辑 |
| `tests/feishu/attachments.test.ts` | 附件模块单元测试 | 修改：新增 text-only 模型图片测试 |
| `src/index.ts` | 主入口组装 | 修改：传入 `runtime.session.model?.input` |

---

### Task 1: attachments.ts — 新增 SupportedInput 参数和图片分流逻辑

**Files:**
- Modify: `src/feishu/attachments.ts`

- [ ] **Step 1: 新增 SupportedInput 类型导出**

在 import 块之后、`ImageContent` 接口之前插入：

```typescript
export type SupportedInput = ("text" | "image" | "video")[];
```

- [ ] **Step 2: 修改 processAttachments 函数签名，增加 supportedInput 参数**

修改第 41-45 行函数签名：

```typescript
export async function processAttachments(
  channel: Pick<Channel, "downloadMessageResource">,
  msg: NormalizedMessage,
  downloadDir: string,
  supportedInput: SupportedInput = ["text", "image"],
): Promise<ProcessedAttachments> {
```

- [ ] **Step 3: 修改图片处理分支，加入 supportedInput.includes("image") 判断**

替换第 58-69 行图片处理块：

```typescript
    if (res.type === "image") {
      if (supportedInput.includes("image")) {
        try {
          const buf = await channel.downloadMessageResource(msg.messageId, res.fileKey, res.type);
          images.push({
            type: "image",
            data: buf.toString("base64"),
            mimeType: inferMime(fileName),
          });
        } catch (err) {
          textParts.push(`[图片: ${fileName} 下载失败: ${(err as Error).message}]`);
        }
      } else {
        try {
          const buf = await channel.downloadMessageResource(msg.messageId, res.fileKey, res.type);
          const filePath = join(downloadDir, fileName);
          await writeFile(filePath, buf);
          textParts.push(`[图片: ${fileName} 已保存到 ${filePath}]`);
        } catch (err) {
          textParts.push(`[图片: ${fileName} 下载失败: ${(err as Error).message}]`);
        }
      }
      continue;
    }
```

- [ ] **Step 4: 运行现有测试确保不破坏原有行为**

```bash
npx vitest run tests/feishu/attachments.test.ts
```

预期：所有已有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/feishu/attachments.ts
git commit -m "feat: processAttachments 新增 SupportedInput 参数，图片按模型能力分流"
```

---

### Task 2: 新增 text-only 模型测试用例

**Files:**
- Modify: `tests/feishu/attachments.test.ts`

- [ ] **Step 1: 在测试文件末尾（第 192 行 `})` 之前）新增测试用例**

```typescript
  it("text-only 模型下图片保存到文件并在 text 中提示路径", async () => {
    const pngBuffer = Buffer.from("fake-png-data");
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(pngBuffer),
    };

    const msg = testMsg([
      { type: "image", fileKey: "img-1", fileName: "photo.png" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test", ["text"]);

    expect(channel.downloadMessageResource).toHaveBeenCalledWith("msg-1", "img-1", "image");
    expect(result.images).toHaveLength(0);
    expect(result.text).toContain("[图片: photo.png");
    expect(result.text).toContain("/tmp/test/photo.png");
  });
```

- [ ] **Step 2: 运行测试验证新用例通过**

```bash
npx vitest run tests/feishu/attachments.test.ts
```

预期：所有测试 PASS（包括新用例）

- [ ] **Step 3: Commit**

```bash
git add tests/feishu/attachments.test.ts
git commit -m "test: text-only 模型图片附件走文件保存路径"
```

---

### Task 3: index.ts — 传入 model.input 到 processAttachments

**Files:**
- Modify: `src/index.ts:136-139`

- [ ] **Step 1: 修改 processAttachments 调用，传入模型 input**

将第 137-138 行：

```typescript
      downloadDir = join(tmpdir(), "pi-feishu", runtime.session.sessionId ?? "unknown");
      attachments = await processAttachments(channel, msg, downloadDir);
```

改为：

```typescript
      downloadDir = join(tmpdir(), "pi-feishu", runtime.session.sessionId ?? "unknown");
      attachments = await processAttachments(channel, msg, downloadDir, runtime.session.model?.input);
```

- [ ] **Step 2: 运行全量测试确保组装正确**

```bash
npx vitest run
```

预期：所有测试 PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: 传入 model.input 到 processAttachments 实现图片能力感知"
```

---

### Task 4: 类型检查

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
npx tsc --noEmit
```

预期：无类型错误

- [ ] **Step 2: 如有类型错误，根据错误提示修复后重新运行**

---

## 验证清单

- [ ] `processAttachments` 默认参数（不传 supportedInput）行为不变
- [ ] `supportedInput = ["text", "image"]` 时图片走 base64 ImageContent
- [ ] `supportedInput = ["text"]` 时图片保存到文件 + text 提示路径
- [ ] 图片下载失败两种路径都有错误提示
- [ ] `runtime.session.model` 为 undefined 时走默认值 `["text", "image"]`
