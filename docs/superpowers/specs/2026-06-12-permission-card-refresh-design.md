# 飞书 Dialog 卡片点击后刷新

## 问题

1. 用户点击 dialog 卡片（如权限确认）按钮后，pi 能收到选择结果，但卡片内容不变、按钮依然可见，无视觉反馈。
2. `select()` 中卡片 header 写死为 `"权限确认"`，但 `select()` 是通用 dialog，不一定是权限确认。

## 目标

1. 用户点击按钮后，卡片刷新为选择结果提示，按钮消失。
2. `select()` 的卡片 header 由传入的 `title` 参数派生，不再写死 `"权限确认"`。

## 方案

**策略**：resolve Promise 后 fire-and-forget 异步刷新卡片。

### 变更 1: `src/feishu/feishu-ui.ts`

- `PendingDialog` 新增 `headerTitle: string` 和 `headerTemplate: string` 字段，记录原始卡片的 header 信息
- `select()` 中用 `title` 派生 header（截取前 20 字符，避免超出飞书 card header 限制），不再写死 `"权限确认"`
- `select()` 中 `pendingDialogs.set` 时传入 header info
- `resolveFeishuDialog()` 返回 `{ title: string; choice: string; headerTitle: string; headerTemplate: string } | undefined`（原返回 `void`）

### 变更 2: `src/index.ts`

`handleCardAction()` 的 `feishu_dialog` 分支：

```ts
if (cmd === "feishu_dialog") {
  const info = resolveFeishuDialog(value);
  if (info && token) {
    const newCard = buildCard(
      createCardHeader(info.headerTitle, info.headerTemplate),
      [createMarkdownBlock(`已选择: **${info.choice}**`)],
    );
    channel.updateCardByToken(token, newCard).catch(() => {});
  }
  return;
}
```

New imports from `"./feishu/cards/helpers.js"`: `buildCard`, `createCardHeader`, `createMarkdownBlock`

### 卡片内容对比

| 点击前 | 点击后 |
|--------|--------|
| header: title前20字符 (red) | header: title前20字符 (red) |
| body: title (markdown) + 分隔线 + [按钮...] | body: 已选择: **选项** |

## 约束

- `resolveFeishuDialog` 仍是同步调用，pi 不等待卡片刷新
- 卡片刷新失败不影响功能（fire-and-forget + `.catch(() => {})`）
- 现有 `confirm()` 行为不变 — 它通过 `select()` 实现
- 飞书 card header plain_text 有长度限制，title 取前 20 字符作为 header

## 测试

- `feishu-ui.test.ts`: 适配 `resolveFeishuDialog` 新返回类型；验证 header 由 title 派生
- `wiring.test.ts`: 新增 `feishu_dialog` 刷新卡片测试，验证 `updateCardByToken` 被正确调用
