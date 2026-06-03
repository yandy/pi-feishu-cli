# Think 块引用格式状态机设计

**日期：** 2026-06-03
**目标：** 飞书机器人回复中，think 块始终保持 blockquote 格式（`> `），text 块为纯文本，think 与 text 正确切换不互相干扰。

## 背景

原始代码 `stream.append(`> ${sub.delta ?? ""}`)` 对每个 `thinking_delta` chunk 只加一次 `> ` 前缀。

当 chunk 内容包含换行符（多段落 think）时，只有第一行获得 `> `，后续行渲染为普通文本，与后续 text 内容混在一起无法区分。

此外，chunk 之间不做状态跟踪，会导致：
- 内部换行符后的行缺少 `> `（首行修正后，需要每行都有 `>` 前缀）
- chunk 边界处可能产生 `> > `（嵌套 blockquote）或缺少 `> `（续写行丢失格式）

## 期望输出格式

```
> think
> think
text
> think
text
text
```

规则：
1. 连续 `thinking_delta` → 单一 blockquote，每行 `> ` 前缀
2. `text_delta` → 纯文本，关闭当前 blockquote
3. text 之后的 `thinking_delta` → 新 blockquote
4. 连续 `text_delta` → 直接拼接，不额外换行

## 架构

状态由三个变量驱动，全部在 `createStreamingHandler` 闭包内：

| 变量 | 类型 | 作用 |
|------|------|------|
| `inThinkBlock` | `boolean` | 是否处于 think 块中 |
| `needsQuotePrefix` | `boolean` | 下一个输出字符前是否需要插入 `"> "` |
| `needLineBreak` | `boolean` | 下一个 think 块开始前是否需要插入 `"\n"` |

### 状态转换

**`thinking_delta` 到达时：**

```
1. if needLineBreak: stream.append("\n"), needLineBreak = false
2. 遍历 delta 每个字符:
   a. if needsQuotePrefix: stream.append("> "), needsQuotePrefix = false
   b. stream.append(ch)
   c. if ch === "\n": needsQuotePrefix = true
3. inThinkBlock = true
```

**`text_delta` 到达时：**

```
1. if inThinkBlock && !needsQuotePrefix:
     stream.append("\n")   // 上段 think 没以 \n 收尾，关闭 blockquote
2. inThinkBlock = false
3. needsQuotePrefix = true
4. stream.append(delta)
5. needLineBreak = !delta.endsWith("\n")
```

非 think/text 事件到达时（`tool_execution_start` 等）：行为不变，`inThinkBlock` 自然过渡。

### think 块内部逐字符处理

`thinking_delta` 不走 `replace` 或 `split`，而是逐字符处理。这样保证 chunk 边界不会产生冗余 `>` 前缀：

- chunk 1: `"think\n"` → `"> think\n"`, `needsQuotePrefix = true`
- chunk 2: `"more\n"` → `"> more\n"`, `needsQuotePrefix = true`
- 拼接：`"> think\n> more\n"` — 无冗余 `>`

若用 `replace(/\n/g, "\n> ")`，chunk 1 输出 `"> think\n> "`，chunk 2 以 `needsQuotePrefix` 判断加 `"> "` → `"\n> > "` 嵌套 blockquote。

## 文件变更

### `src/feishu/streaming.ts`

- `createStreamingHandler` 闭包内新增三个状态变量
- `thinking_delta` 分支改为逐字符状态机
- `text_delta` 分支增加 blockquote 关闭逻辑
- 移除 `thinking_delta` 的 `replace` 或 `split/map` 处理

### `tests/feishu/streaming.test.ts`

新增测试用例：

| 测试 | 场景 |
|------|------|
| 多行 think 单 chunk | `"line1\nline2"` → `"> line1\n> line2"` |
| 连续 think chunk | `"a"` + `"b"` → `"> a"`, `"b"`（不重复加 `> `） |
| think 以 `\n` 开头 | `"\nmore"` → `"> \n> more"` |
| think → text（think 无 `\n`） | `"think"` + text `"ans"` → `"> think\nans"` |
| think → text（think 有 `\n`） | `"think\n"` + text `"ans\n"` → `"> think\nans\n"` |
| text → think（text 无 `\n`） | text `"ans"` + `"think"` → `"ans\n> think"` |
| text → think（text 有 `\n`） | text `"ans\n"` + `"think"` → `"ans\n> think"` |
| 连续 text | text `"a"` + text `"b"` → `"ab"`（直接拼接） |

## 关键场景验证

| 场景 | think 输入 | text 输入 | 输出 |
|------|-----------|-----------|------|
| 单段 think | `"think\n"` | — | `"> think\n"` |
| 连续 think | `"think1\n"`, `"think2\n"` | — | `"> think1\n> think2\n"` |
| think → text（无 \n） | `"think"` | `"ans"` | `"> think\nans"` |
| think → text（有 \n） | `"think\n"` | `"ans\n"` | `"> think\nans\n"` |
| text → think（无 \n） | —, `"think"` | `"ans"` | `"ans\n> think"` |
| text → think（有 \n） | —, `"think"` | `"ans\n"` | `"ans\n> think"` |
| think → think | `"a"`, `"b"` | — | `"> a"`, `"b"`（拼接为 `"> ab"`） |
| text → text | — | `"a"`, `"b"` | `"ab"` |
