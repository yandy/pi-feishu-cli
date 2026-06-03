# update-skills 脚本设计

## 目标

创建一个开发用脚本 `update-skills`，通过 well-known 协议从飞书开放平台下载 AI skills 到本地 `skills/` 目录。

## 实现方式

纯 Node.js `.mjs` 脚本，零额外依赖，通过 `npm run update-skills` 运行。

## 文件结构

```
pi-feishu-cli/
├── scripts/
│   └── update-skills.mjs       # 新增脚本
├── .skills-cache.json           # 新增，记录 endpoint 元信息
└── package.json                 # 加 "update-skills" script
```

## 核心流程

1. 探测 well-known endpoint：按优先级尝试 `/.well-known/skills/index.json` → `/.well-known/agent-skills/index.json`，首个返回 200 的作为 endpoint
2. 解析 index.json，获取 `skills[]` 列表，每个 skill 包含 `name`、`files` 等字段
3. 将 skills 下载到临时目录 `skills.tmp/`（避免中途失败破坏现有目录）
4. 删除本地 `skills/` 目录，将 `skills.tmp/` 重命名为 `skills/`
5. 写入 `.skills-cache.json` 记录 endpoint 和更新时间

## 下载规则

- 对每个 skill，根据其 `files` 数组下载文件到 `skills/{name}/{file}`
- 文件 URL 解析：以 endpoint 的目录为 base，拼接相对路径
  - 例如 endpoint `https://open.feishu.cn/.well-known/skills/index.json`
  - skill "lark-im" 的 SKILL.md → `https://open.feishu.cn/.well-known/skills/lark-im/SKILL.md`
  - references 文件同理

## 错误处理

- 所有 well-known 路径 404 → 报错退出，不删除已有 skills/
- 单个 skill 文件下载失败 → 打印警告，继续下一个
- 写入 `.skills-cache.json` 失败 → 打印警告，不影响结果

## 兼容性

- 支持 `/.well-known/skills/` 和 `/.well-known/agent-skills/` 两种路径
- 使用 Node.js 18+ 内置 `fetch` API，无需额外依赖
