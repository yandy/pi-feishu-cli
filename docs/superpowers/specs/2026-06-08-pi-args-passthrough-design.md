# pi-feishu CLI 参数转发

**日期**: 2026-06-08
**状态**: 待实现

## 背景

`pi-feishu` 是 `pi` CLI 的飞书集成版本，在 `pi` 的基础上增加了飞书 Bot 连接、消息处理和卡片交互能力。

当前 `pi-feishu` 只解析自己的参数（`--app-id`, `--app-secret` 等），不支持 `pi` 原生的 CLI 参数（如 `--model`, `--continue`, `--thinking` 等，以及扩展注册的 CLI flag）。用户希望 `pi-feishu` 在解析完飞书参数后，剩余参数能透传给 `pi` 的参数处理流程。

## 目标

```
pi-feishu --app-id xxx --model claude-sonnet "do something"
          └─────────────┘ └──────────────────────────┘
              飞书参数              透传给 pi
```

使 `pi-feishu` 成为 `pi` CLI 参数的严格超集。

## 方案

保持现有架构（`cli.ts` → `src/index.ts:main()` → `initRuntime()` → `InteractiveMode`），在三个文件中增加参数转发：

### 数据流

```
process.argv
  │
  ├─ cli.ts: 两阶段解析
  │    阶段1: 标记飞书参数位置 → cliArgs + remainingArgs[]
  │    阶段2: pi.parseArgs(remainingArgs) → PiArgs
  │
  ├─ src/runtime.ts: initRuntime(piArgs)
  │    └─ createAgentSessionServices({
  │         extensionFlagValues: piArgs.unknownFlags,  // → 扩展 CLI flag
  │         resourceLoaderOptions: {                    // → --extension, --no-skills 等
  │           additionalExtensionPaths,
  │           noExtensions, noSkills, noPromptTemplates, noThemes,
  │           noContextFiles, systemPrompt, appendSystemPrompt,
  │         }
  │       })
  │
  └─ src/index.ts: main(piArgs)
       ├─ createSessionManager(piArgs)  // --continue → continueRecent / --session → open / ...
       ├─ resolveCliModel(piArgs)       // --model, --provider
       ├─ runtime.session.setThinkingLevel()  // --thinking
       ├─ buildInitialMessage(piArgs)   // @files + 位置参数
       └─ InteractiveMode({ initialMessage, initialMessages, verbose })
```

### 变更点

1. **`cli.ts`** — 重写 `parseArgs()` 为两阶段解析，标记已消耗参数索引，过滤出 `remainingArgs`，用 `pi.parseArgs()` 解析
2. **`src/runtime.ts`** — `InitRuntimeOptions` 新增 `piArgs` 和 `sessionManager` 字段，透传至 `createAgentSessionServices`
3. **`src/index.ts`** — `MainOptions` 新增 `piArgs` 字段，增加 session 选择、model/thinking 设置、initialMessage 构建逻辑

### Session 选择逻辑

移除原有的 `resumeMostRecentSession()` 调用，统一由 pi 参数控制 session 选择：

| 条件 | SessionManager 来源 | 说明 |
|------|-------------------|------|
| 无 session flag（默认） | `SessionManager.create(cwd)` | 创建新 session |
| `--continue`, `-c` | `SessionManager.continueRecent(cwd)` | 继续最近 session |
| `--session <path/id>` | `SessionManager.open(path)` | 打开指定 session |
| `--session-id <id>` | `SessionManager.create(cwd, undefined, { id })` | 使用指定 ID |
| `--fork <path/id>` | `SessionManager.forkFrom(path, cwd)` | fork session |
| `--no-session` | `SessionManager.inMemory(cwd)` | 临时 session |

### 不变量

- `src/feishu/` 目录所有代码不变
- `src/config.ts` 飞书配置加载不变
- Session 切换（`/sessions` 卡片）仍通过 `runtime.switchSession()` 操作
- `send_file_to_chat` 扩展工具注册不变

### Deep Import

从 `@earendil-works/pi-coding-agent` 的 dist 路径导入内部模块（非公开 API）：

| 导入 | 来源 |
|------|------|
| `parseArgs`, `Args` | `dist/cli/args.js` |
| `buildInitialMessage` | `dist/cli/initial-message.js` |
| `processFileArguments` | `dist/cli/file-processor.js` |
| `resolveCliModel` | `dist/core/model-resolver.js` |
| `resolvePath`, `isLocalPath` | `dist/utils/paths.js` |

## 支持范围

### 支持的 pi 参数

| 参数 | 作用 | 实现位置 |
|------|------|----------|
| `--continue`, `-c` | 继续最近 session | `src/index.ts: createSessionManager()` |
| `--session <path/id>` | 打开指定 session | 同上 |
| `--session-id <id>` | 指定 session ID | 同上 |
| `--fork <path/id>` | fork session | 同上 |
| `--model <pattern>` | 指定模型 | `src/index.ts: resolveCliModel()` |
| `--provider <name>` | 配合 --model 使用 | 同上 |
| `--thinking <level>` | 思维链级别 | `src/index.ts: setThinkingLevel()` |
| `--verbose` | 强制详细启动 | `InteractiveMode({ verbose })` |
| `--extension <path>`, `-e` | 额外扩展路径 | `src/runtime.ts: resourceLoaderOptions` |
| `--no-extensions`, `-ne` | 禁用扩展发现 | 同上 |
| `--skill <path>` | 额外 skill 路径 | 同上 |
| `--no-skills`, `-ns` | 禁用 skill 发现 | 同上 |
| `--prompt-template <path>` | prompt 模板路径 | 同上 |
| `--no-prompt-templates`, `-np` | 禁用 prompt 模板 | 同上 |
| `--theme <path>` | theme 路径 | 同上 |
| `--no-themes` | 禁用 theme 发现 | 同上 |
| `--no-context-files`, `-nc` | 禁用上下文文件 | 同上 |
| `--system-prompt <text>` | 系统提示词 | 同上 |
| `--append-system-prompt <text>` | 追加系统提示词 | 同上 |
| `--no-session` | 临时 session | `src/index.ts: createSessionManager()` |
| `--<ext-flag>` | 扩展注册的 CLI flag | `src/runtime.ts: extensionFlagValues` |
| `@files` | 文件参数 | `buildInitialMessageFromPiArgs()` |
| 位置参数 | 初始消息 | `InteractiveMode({ initialMessage })` |

### 不支持的 pi 参数（非交互模式相关）

`--print`、`-p`、`--mode`、`--export`、`--list-models`、`--version`、`--help`（pi 的 help）、`--resume`（需要 TUI session picker）

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Deep import 在 pi 升级后路径变化 | 固定在 pi 0.77.x 版本；后续可要求 pi 导出 parseArgs |
| `resolveCliModel` 可能在无可用模型时报错 | 捕获诊断信息，仅 warning 不阻塞启动 |
| `--session` 路径解析失败 | 降级为创建新 session |
