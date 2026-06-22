# Fix pi Extension Config: Global + Project Merge — Design

## 背景

pi extension 的配置文件有两种级别。当前只加载第一个找到的文件，需改为双文件加载+合并。

## 设计决策

### 方案：双文件合并 + CONFIG_DIR_NAME + getAgentDir

**范围**：`src/config.ts` + `tests/config.test.ts`

**变更点**：

1. 依赖升级：`@earendil-works/pi-coding-agent` → `^0.79.9`
2. 导入 `CONFIG_DIR_NAME`（新增）和 `getAgentDir`（已有）替换硬编码路径
3. 替换硬编码：
   - `.pi` → `CONFIG_DIR_NAME`（默认 `.pi`，由 `piConfig.configDir` 覆盖）
   - `~/.pi/agent` → `getAgentDir()`（由 `PI_CODING_AGENT_DIR` 环境变量覆盖）
4. 改为双文件加载+合并：全局配置为 base，项目配置字段覆盖同名字段
5. `DEFAULT_SAVE_PATH` 改用 `getAgentDir()`

**优先级链不变**：CLI args > 项目配置 > 全局配置 > 环境变量

**合并示例**：
```
全局:  { appId: "g-id", botName: "GBot" }
项目:  { appSecret: "p-secret", botName: "PBot" }
结果:  { appId: "g-id", appSecret: "p-secret", botName: "PBot" }
```

### 实现方法：TDD

1. 先写测试用例（验证合并、覆盖、缺失文件容错）
2. 确认测试失败
3. 实现代码使测试通过
4. 验证所有已有测试仍然通过
