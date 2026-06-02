# `--no-bundle-feishu-skills` 参数设计

## 概述

为 `pi-feishu-cli` 增加一个 `--no-bundle-feishu-skills` 参数，控制是否将项目 `skills/` 目录下的 skill 加载到 session 中。

## 优先级链

环境变量 < 配置文件 < CLI 参数

| 来源 | 键 |
|---|---|
| 环境变量 | `FEISHU_NO_BUNDLE_SKILLS=1` |
| feishu.json | `"noBundleFeishuSkills": true` |
| CLI 参数 | `--no-bundle-feishu-skills` |

## 改动文件

| 文件 | 改动 |
|---|---|
| `cli.ts` | `CliArgs` + `parseArgs()` 解析 `--no-bundle-feishu-skills` + help 文本 |
| `src/types.ts` | `FeishuConfig` 增加 `noBundleFeishuSkills?: boolean` |
| `src/config.ts` | `loadConfig()` 从 env/file/cli 合并该字段 |
| `src/index.ts` | `MainOptions` 增加字段，透传到 `initRuntime()` |
| `src/runtime.ts` | `InitRuntimeOptions` 增加字段，条件调用 `loadSkillsFromDir()` |
| `README.md` | 更新用法和参数说明 |

## 行为

- 默认 `false`，正常加载 `packageRoot/skills/` 下的所有 skill
- 为 `true` 时，完全跳过 `loadSkillsFromDir()`，不添加任何项目 skill
