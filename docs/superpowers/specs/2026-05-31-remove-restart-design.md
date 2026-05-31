# Remove `/feishu-im restart` Subcommand

## 问题

`/feishu-im restart` 子命令功能上等价于 `stop` + `start`，增加了维护负担且很少使用。去掉它简化用户入口。

## 改动

| 文件 | 改动 |
|------|------|
| `extensions/index.ts:378-406` | 删除 `case "restart"` |
| `extensions/index.ts:142` | description 中去掉 restart |
| `extensions/index.ts:445` | help 中去掉 restart |
| `extensions/index.ts:3` | import 中去掉 `rmSync, unlinkSync` |
| `README.md:20` | 删 restart 行 |
| `tests/extensions/index.test.ts:129` | 去掉 restart dispatch 测试 |
| `.pi/TODO` | 删 item 0 |
