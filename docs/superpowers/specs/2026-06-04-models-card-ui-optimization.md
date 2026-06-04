# Models 卡片 UI 优化

## 现状问题

- 分割线过多，每个 model 前后各有一个 `hr`，视觉碎片化
- Thinking level 在每个 model 下重复 6 个按钮，但 thinking level 是所有 model **共享**的配置
- Model 缺少关键信息：`input` modality（text/image）、context window
- 当前模型状态不够突出（只是普通文本）
- 结构扁平，缺少视觉分组

## 设计

### 布局

```
┌─ Model 管理 ─────────────────────────────────────┐
│  当前                                              │
│  Claude Sonnet 4 (anthropic) · med · 📝+🖼️ · 200K │
│  ─────────────────────────────────────────         │
│  ── Anthropic ──                                   │
│  Claude Sonnet 4 · text+image · 200K   [当前 ✓]   │
│  Claude Haiku 3.5 · text+image · 200K  [选取]     │
│  ── OpenAI ──                                      │
│  GPT-4o · text+image · 128K             [选取]     │
│  ─────────────────────────────────────────         │
│  思考级别                                           │
│  [off] [min] [low] [med] [high] [xhigh]            │
└────────────────────────────────────────────────────┘
```

### 交互

所有按钮 callback 统一为 `action:"select"`，携带完整 payload：

| 按钮 | Provider | ModelId | ThinkingLevel |
|------|----------|---------|---------------|
| 模型 [选取] | 该模型的 `provider` | 该模型的 `id` | `session.thinkingLevel`（当前级别） |
| think level 按钮 | `session.model.provider` | `session.model.id` | 点击的 level |

服务端统一处理：

```
session.setModel(model)
session.setThinkingLevel(level)
```

### 变更文件

| 文件 | 变更内容 |
|------|---------|
| `src/feishu/cards/models.ts` | 重写 `buildModelsCard()` — 新布局、分组、信息展示、think level 移到底部 |
| `src/feishu/cards/helpers.ts` | 可选扩展 `CardElement` 类型（如需 `div` 容器元素） |

### 不做的变更

- ❌ Tab 切换（平铺 + 分组标题替代）
- ❌ 预览 / 待确认状态（无状态，即点即生效）
- ❌ 应用确认按钮
- ❌ 修改 `src/index.ts` `handleCardAction`（已有逻辑完全兼容）
