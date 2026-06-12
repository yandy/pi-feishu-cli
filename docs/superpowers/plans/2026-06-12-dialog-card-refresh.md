# 飞书 Dialog 卡片点击后刷新 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户点击 dialog 卡片后，卡片内容刷新为选择结果提示，且 header 由 title 派生而非写死。

**Architecture:** 新建 `src/feishu/cards/dialog.ts` 收口 dialog 卡片构建逻辑；`feishu-ui.ts` 委托给 `buildDialogCard`；`index.ts` 的 `handleCardAction` 在 `feishu_dialog` 分支 fire-and-forget 刷新卡片。

**Tech Stack:** TypeScript, Vitest, 飞书 Open API (`updateCardByToken`)

---

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/feishu/cards/dialog.ts` | `buildDialogCard()` + `buildDialogResultCard()` | 新建 |
| `src/feishu/feishu-ui.ts` | 委托卡片构建给 dialog.ts，存储 header info，返回 header info | 修改 |
| `src/index.ts` | `handleCardAction` 中 `feishu_dialog` 分支刷新卡片 | 修改 |
| `tests/feishu/cards.test.ts` | 新增 dialog card 测试 | 修改 |
| `tests/feishu/feishu-ui.test.ts` | 适配 header 派生 + resolve 新返回值 | 修改 |
| `tests/feishu/wiring.test.ts` | 新增 feishu_dialog 刷新卡片集成测试 | 修改 |

---

### Task 1: 编写 `buildDialogCard` + `buildDialogResultCard` 测试（TDD 第一步）

**Files:**
- Modify: `tests/feishu/cards.test.ts`

- [ ] **Step 1: 在 `tests/feishu/cards.test.ts` 末尾新增测试代码**

```typescript
import { buildDialogCard, buildDialogResultCard } from "../../src/feishu/cards/dialog.js";

describe("dialog card", () => {
  describe("buildDialogCard", () => {
    it("returns card with title-derived header (no truncation when short)", () => {
      const { card, headerTitle, headerTemplate } = buildDialogCard(
        "确认删除",
        ["是", "否"],
        "dialog-1",
      );
      expect(headerTitle).toBe("确认删除");
      expect(headerTemplate).toBe("red");
      expect((card as any).header.title.content).toBe("确认删除");
      expect((card as any).header.template).toBe("red");
    });

    it("truncates long title for header (max 20 chars)", () => {
      const { headerTitle } = buildDialogCard("A".repeat(30), ["选项"], "d-1");
      expect(headerTitle.length).toBeLessThanOrEqual(20);
    });

    it("strips newlines from header title", () => {
      const { headerTitle } = buildDialogCard("标题\n\n描述", ["是"], "d-2");
      expect(headerTitle).not.toContain("\n");
      expect(headerTitle).toBe("标题描述");
    });

    it("includes one button per option with callback value", () => {
      const { card } = buildDialogCard("选择", ["A", "B", "C"], "d-3");
      const buttons = ((card as any).body.elements as any[]).filter(
        (e: any) => e.tag === "button",
      );
      expect(buttons).toHaveLength(3);
      expect(buttons[1].behaviors[0].value).toMatchObject({
        cmd: "feishu_dialog",
        dialog_id: "d-3",
        dialog_choice: "B",
      });
    });

    it("places title markdown and divider before buttons", () => {
      const { card } = buildDialogCard("标题", ["是"], "d-4");
      const els = (card as any).body.elements;
      expect(els[0].tag).toBe("markdown");
      expect(els[1].tag).toBe("hr");
      expect(els[2].tag).toBe("button");
    });

    it("includes schema 2.0 and update_multi config", () => {
      const { card } = buildDialogCard("标题", ["是"], "d-5");
      expect(card.schema).toBe("2.0");
      expect((card as any).config).toMatchObject({
        update_multi: true,
        width_mode: "fill",
      });
    });
  });

  describe("buildDialogResultCard", () => {
    it("builds card showing selected choice with original header", () => {
      const card = buildDialogResultCard("确认删除", "red", "是");
      expect((card as any).header.title.content).toBe("确认删除");
      expect((card as any).header.template).toBe("red");
      const els = (card as any).body.elements;
      expect(els).toHaveLength(1);
      expect(els[0].tag).toBe("markdown");
      expect(els[0].content).toBe("已选择: **是**");
    });

    it("result card has schema 2.0", () => {
      const card = buildDialogResultCard("标题", "red", "选项A");
      expect(card.schema).toBe("2.0");
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
uv run vitest run tests/feishu/cards.test.ts
```

预期：`Cannot find module '../../src/feishu/cards/dialog.js'`

---

### Task 2: 创建 `src/feishu/cards/dialog.ts`（TDD 第二步）

**Files:**
- Create: `src/feishu/cards/dialog.ts`

- [ ] **Step 1: 实现 `buildDialogCard` 和 `buildDialogResultCard`**

```typescript
import type { CardElement } from "./helpers.js";
import {
  buildCard,
  createActionButton,
  createCardHeader,
  createDividerBlock,
  createMarkdownBlock,
} from "./helpers.js";

const MAX_HEADER_CHARS = 20;
const MAX_BUTTON_TEXT = 40;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 2) + "..";
}

export function buildDialogCard(
  title: string,
  options: string[],
  dialogId: string,
): { card: Record<string, unknown>; headerTitle: string; headerTemplate: string } {
  const headerTitle = truncate(title.replace(/\n/g, ""), MAX_HEADER_CHARS);
  const headerTemplate = "red";

  const elements: CardElement[] = [
    createMarkdownBlock(title.replace(/\n/g, "\n\n")),
    createDividerBlock(),
  ];
  for (const option of options) {
    elements.push(
      createActionButton(
        truncate(option, MAX_BUTTON_TEXT),
        {
          cmd: "feishu_dialog",
          dialog_id: dialogId,
          dialog_choice: option,
        },
        "default",
      ),
    );
  }

  const card = buildCard(
    createCardHeader(headerTitle, headerTemplate),
    elements,
  );

  return { card, headerTitle, headerTemplate };
}

export function buildDialogResultCard(
  headerTitle: string,
  headerTemplate: string,
  choice: string,
): Record<string, unknown> {
  return buildCard(
    createCardHeader(headerTitle, headerTemplate),
    [createMarkdownBlock(`已选择: **${choice}**`)],
  );
}
```

- [ ] **Step 2: 运行测试，确认通过**

```bash
uv run vitest run tests/feishu/cards.test.ts
```

预期：全部通过（包括新 dialog card 测试和原有 tests）

- [ ] **Step 3: Commit**

```bash
git add src/feishu/cards/dialog.ts tests/feishu/cards.test.ts
git commit -m "feat: add buildDialogCard and buildDialogResultCard"
```

---

### Task 3: 更新 feishu-ui.test.ts 适配新行为（TDD 第一步）

**Files:**
- Modify: `tests/feishu/feishu-ui.test.ts`

- [ ] **Step 1: 修改测试断言**

需要改动的测试点：

**A. `confirm()` 测试中 header 断言由 `"权限确认"` 改为 title 派生值**

文件 `tests/feishu/feishu-ui.test.ts` line 45:
```typescript
// 修改前
expect(sentCard.header.title.content).toBe("权限确认");

// 修改后 — confirm("确认标题", "确认信息") 的 select title 是 "确认标题\n\n确认信息"
// 去换行后 header = "确认标题确认信息"
expect(sentCard.header.title.content).toBe("确认标题确认信息");
```

**B. `select()` 测试中 header 断言**

Line 101-102 处，`select("选择标题", ...)` 调用的 header:
```typescript
// select("选择标题", ["选项A", "选项B", "选项C"])
expect(sentCard.header.title.content).toBe("选择标题");
```

**C. `resolveFeishuDialog` 调用处，验证返回值**

Line 50 处:
```typescript
// 修改前
resolveFeishuDialog(value as Record<string, unknown>);

// 修改后
const result = resolveFeishuDialog(value as Record<string, unknown>);
expect(result).toBeDefined();
expect(result!.choice).toBe("是");
expect(result!.headerTemplate).toBe("red");
```

Line 66 处:
```typescript
// 修改前
resolveFeishuDialog(value as Record<string, unknown>);

// 修改后
const result2 = resolveFeishuDialog(value as Record<string, unknown>);
expect(result2).toBeDefined();
expect(result2!.choice).toBe("否");
```

Line 109 处:
```typescript
// 修改前
resolveFeishuDialog(value as Record<string, unknown>);

// 修改后
const result3 = resolveFeishuDialog(value as Record<string, unknown>);
expect(result3).toBeDefined();
expect(result3!.choice).toBe("选项B");
```

**D. `resolveFeishuDialog` 独立测试**

Line 179-181:
```typescript
// 修改前
it("is a no-op for unknown dialog ids", () => {
  resolveFeishuDialog({ dialog_id: "nonexistent", dialog_choice: "x" });
});

// 修改后
it("returns undefined for unknown dialog ids", () => {
  expect(
    resolveFeishuDialog({ dialog_id: "nonexistent", dialog_choice: "x" }),
  ).toBeUndefined();
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
uv run vitest run tests/feishu/feishu-ui.test.ts
```

预期：header 断言失败（仍写死 `"权限确认"`）；resolveFeishuDialog 返回值断言失败（仍返回 `void`）

---

### Task 4: 重构 `src/feishu/feishu-ui.ts`（TDD 第二步）

**Files:**
- Modify: `src/feishu/feishu-ui.ts`

- [ ] **Step 1: 重构代码**

改动点：

**A. 替换 import — 删掉卡片构建工具，引入 `buildDialogCard`**

```typescript
// 修改前
import {
  buildCard,
  type CardElement,
  createActionButton,
  createCardHeader,
  createMarkdownBlock,
  createDividerBlock,
} from "./cards/helpers.js";

// 修改后
import { buildDialogCard } from "./cards/dialog.js";
```

**B. PendingDialog 新增 header info 字段**

```typescript
interface PendingDialog {
  resolve: (value: string | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
  headerTitle: string;
  headerTemplate: string;
}
```

**C. `resolveFeishuDialog` 返回 header info**

```typescript
export function resolveFeishuDialog(
  value: Record<string, unknown>,
): { choice: string; headerTitle: string; headerTemplate: string } | undefined {
  const dialogId = value["dialog_id"] as string | undefined;
  const choice = value["dialog_choice"] as string | undefined;
  if (!dialogId) return;
  const dialog = pendingDialogs.get(dialogId);
  if (dialog) {
    pendingDialogs.delete(dialogId);
    clearTimeout(dialog.timer);
    dialog.resolve(choice);
    return {
      choice: choice ?? "",
      headerTitle: dialog.headerTitle,
      headerTemplate: dialog.headerTemplate,
    };
  }
}
```

**D. 删除 `MAX_BUTTON_TEXT`、`truncate` 函数**（已移到 `cards/dialog.ts`）

**E. `select()` 替换内联卡片构建为 `buildDialogCard` 调用**

```typescript
async select(title, options, opts) {
  const ctx = getFeishuContext();
  if (!ctx) return options[0];

  const dialogId = crypto.randomUUID();
  const { card, headerTitle, headerTemplate } = buildDialogCard(
    title,
    options,
    dialogId,
  );

  return new Promise<string | undefined>((resolve) => {
    const timeout = opts?.timeout ?? 60000;
    const timer = setTimeout(() => {
      pendingDialogs.delete(dialogId);
      resolve(undefined);
    }, timeout);

    pendingDialogs.set(dialogId, { resolve, timer, headerTitle, headerTemplate });

    if (opts?.signal) {
      if (opts.signal.aborted) {
        pendingDialogs.delete(dialogId);
        clearTimeout(timer);
        resolve(undefined);
        return;
      }
      opts.signal.addEventListener("abort", () => {
        pendingDialogs.delete(dialogId);
        clearTimeout(timer);
        resolve(undefined);
      }, { once: true });
    }
    ctx.channel.send(ctx.chatId, { card }).catch(() => {});
  });
},
```

- [ ] **Step 2: 运行 `feishu-ui.test.ts` 测试**

```bash
uv run vitest run tests/feishu/feishu-ui.test.ts
```

预期：全部通过

- [ ] **Step 3: 运行全量测试确认没有退化**

```bash
uv run vitest run
```

预期：全部通过

- [ ] **Step 4: Commit**

```bash
git add src/feishu/feishu-ui.ts tests/feishu/feishu-ui.test.ts
git commit -m "refactor: delegate dialog card building to cards/dialog.ts, derive header from title"
```

---

### Task 5: 编写 feishu_dialog 刷新卡片集成测试（TDD 第一步）

**Files:**
- Modify: `tests/feishu/wiring.test.ts`

- [ ] **Step 1: 在 `tests/feishu/wiring.test.ts` 末尾新增集成测试**

需要新增 import：
```typescript
import { createFeishuUIContext } from "../../src/feishu/feishu-ui.js";
import { setFeishuContext } from "../../src/feishu/context.js";
```

新增测试（在最后一个 `describe("handleCardAction", ...)` block 内、`it("does not fail when token is missing", ...)` 之后）：

```typescript
  it("updates card by token on feishu_dialog with selected choice", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    // 1. 设置 feishu 上下文，让 select() 能正常工作
    setFeishuContext({ chatId: "chat-dialog", channel } as any);

    const ui = createFeishuUIContext();

    // 2. 发起 select()，创建 pending dialog
    ui.select("测试标题", ["是", "否"]);
    // send() 是同步调用的，lastCall 立即可用
    const sentCard = (mockChannelSend.mock.lastCall as any)[1]?.card as any;
    const button = sentCard.body.elements.find((e: any) => e.tag === "button");
    const dialogId = button.behaviors[0].value.dialog_id;

    // 清空 send mock，后面好判断是否有额外 send
    mockChannelSend.mockClear();
    (channel.updateCardByToken as any).mockClear();

    // 3. 模拟飞书 cardAction 事件
    const evt = {
      action: {
        value: {
          cmd: "feishu_dialog",
          dialog_id: dialogId,
          dialog_choice: "是",
        },
        tag: "button",
      },
      raw: { token: "t-dialog-refresh" },
    };

    await handleCardAction(
      evt as any,
      runtime as any,
      "/tmp/cwd",
      channel as any,
    );

    // 4. 验证 updateCardByToken 被调用，卡片内容为结果卡片
    expect(channel.updateCardByToken).toHaveBeenCalledWith(
      "t-dialog-refresh",
      expect.objectContaining({ schema: "2.0" }),
    );

    const updatedCard = (channel.updateCardByToken as any).mock.calls[0][1] as any;
    expect(updatedCard.header.title.content).toBe("测试标题");
    expect(updatedCard.header.template).toBe("red");
    const md = updatedCard.body.elements[0];
    expect(md.tag).toBe("markdown");
    expect(md.content).toContain("已选择: **是**");

    // 5. 清理上下文
    setFeishuContext(null);
  });

  it("does not update card on feishu_dialog when token is missing", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    setFeishuContext({ chatId: "chat-d2", channel } as any);
    const ui = createFeishuUIContext();
    ui.select("标题", ["是"]);

    const sentCard = (mockChannelSend.mock.lastCall as any)[1]?.card as any;
    const button = sentCard.body.elements.find((e: any) => e.tag === "button");
    const dialogId = button.behaviors[0].value.dialog_id;

    mockChannelSend.mockClear();
    (channel.updateCardByToken as any).mockClear();

    const evt = {
      action: {
        value: {
          cmd: "feishu_dialog",
          dialog_id: dialogId,
          dialog_choice: "是",
        },
        tag: "button",
      },
      raw: {},  // 无 token
    };

    await handleCardAction(
      evt as any,
      runtime as any,
      "/tmp/cwd",
      channel as any,
    );

    expect(channel.updateCardByToken).not.toHaveBeenCalled();

    setFeishuContext(null);
  });
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
uv run vitest run tests/feishu/wiring.test.ts
```

预期：`"updates card by token on feishu_dialog with selected choice"` 失败 — `updateCardByToken` 未被调用

---

### Task 6: 实现 `handleCardAction` 中 feishu_dialog 卡片刷新（TDD 第二步）

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 新增 import**

在 `src/index.ts` 顶部现有 imports 之后添加：

```typescript
import { buildDialogResultCard } from "./feishu/cards/dialog.js";
```

- [ ] **Step 2: 修改 `feishu_dialog` 分支**

将 `src/index.ts:504-506`:

```typescript
  if (cmd === "feishu_dialog") {
    resolveFeishuDialog(value);
    return;
  }
```

改为：

```typescript
  if (cmd === "feishu_dialog") {
    const info = resolveFeishuDialog(value);
    if (info && token) {
      channel
        .updateCardByToken(
          token,
          buildDialogResultCard(
            info.headerTitle,
            info.headerTemplate,
            info.choice,
          ),
        )
        .catch(() => {});
    }
    return;
  }
```

- [ ] **Step 2: 运行 wiring 测试**

```bash
uv run vitest run tests/feishu/wiring.test.ts
```

预期：新增的两个 feishu_dialog 测试通过

- [ ] **Step 3: 运行全量测试**

```bash
uv run vitest run
```

预期：全部通过

- [ ] **Step 4: Commit**

```bash
git add src/index.ts tests/feishu/wiring.test.ts
git commit -m "feat: refresh dialog card after user selection"
```

---

### Task 7: 验证最终效果 & lint

- [ ] **Step 1: 运行全量测试**

```bash
uv run vitest run
```

- [ ] **Step 2: 运行 biomes lint**

```bash
npx biome check src/ tests/
```

- [ ] **Step 3: 运行 TypeScript 类型检查**

```bash
npx tsc --noEmit
```
