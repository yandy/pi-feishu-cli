# pi-feishu-cli 重构 TDD 计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development + superpowers:subagent-driven-development

**Goal:** 按 TDD (RED→GREEN→REFACTOR) 顺序重构 pi-feishu-cli：poller.ts → consumer.ts + messaging.ts，源码重组到 `src/im/`，删 flag/废弃字段。

**TDD 原则:** 每个模块的生产代码必须有一个先于它的失败测试。没有例外。

**RED** → 写测试（指向新路径），验证失败（模块未找到或行为不匹配）
**GREEN** → 写最小实现代码
**REFACTOR** → 清理代码（保持测试通过）

---

### Task 1-3 (TDD): 基础模块 — paths, logger, types

**RED — 写测试**

`tests/im/paths.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { FEISHU_IM_DIR, PID_FILE, LOG_FILE, CONFIG_FILE, REGISTRY_FILE } from "../src/im/paths.js";

describe("paths", () => {
  it("FEISHU_IM_DIR points to .pi/agent/feishu-im", () => {
    expect(FEISHU_IM_DIR).toContain(".pi/agent/feishu-im");
  });

  it("PID_FILE is under FEISHU_IM_DIR", () => {
    expect(PID_FILE).toContain(FEISHU_IM_DIR);
    expect(PID_FILE).toContain("daemon.pid");
  });

  it("all paths are strings", () => {
    expect(typeof FEISHU_IM_DIR).toBe("string");
    expect(typeof PID_FILE).toBe("string");
    expect(typeof LOG_FILE).toBe("string");
    expect(typeof CONFIG_FILE).toBe("string");
    expect(typeof REGISTRY_FILE).toBe("string");
  });
});
```

`tests/im/logger.test.ts`:
```typescript
import { describe, it, expect, afterEach } from "vitest";
import { unlinkSync, existsSync, readFileSync } from "node:fs";
import { LOG_FILE } from "../src/im/paths.js";

describe("logger", () => {
  afterEach(() => {
    try { unlinkSync(LOG_FILE); } catch {}
  });

  it("writes log entries with ISO timestamps", async () => {
    await import("../src/im/logger.js");
    // require dynamic import to test after module loaded
  });
});
```

Wait — logger.ts is write-only so testing it without side effects is tricky. A cleaner approach: test the log format by checking file content after calling log().

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { unlinkSync, existsSync, readFileSync } from "node:fs";
import { LOG_FILE } from "../src/im/paths.js";

describe("logger", () => {
  afterEach(() => {
    try { unlinkSync(LOG_FILE); } catch {}
  });

  it("appends message to log file with ISO timestamp", () => {
    const { unlinkSync, existsSync, readFileSync } = await import("node:fs");
    const { log } = await import("../src/im/logger.js");
    
    log("test message");
    
    expect(existsSync(LOG_FILE)).toBe(true);
    const content = readFileSync(LOG_FILE, "utf-8");
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).toContain("test message");
  });
});
```

`tests/im/types.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import type { FeishuImConfig, FeishuEvent, SessionInfo, ChatSessions, Registry, DaemonStatus } from "../src/im/types.js";

describe("type definitions", () => {
  it("FeishuImConfig has correct shape", () => {
    const config: FeishuImConfig = { strategy: "mention" };
    expect(config.strategy).toBe("mention");
    expect(config.model).toBeUndefined();
    expect(config.botName).toBeUndefined();
  });

  it("FeishuEvent has all fields", () => {
    const event: FeishuEvent = {
      type: "im.message.receive_v1",
      chat_id: "oc_xxx",
      chat_type: "p2p",
      content: "hello",
      message_id: "om_xxx",
      message_type: "text",
      sender_id: "ou_xxx",
      create_time: "1700000000",
      event_id: "ev_xxx",
      timestamp: "1700000001",
      raw: {},
    };
    expect(event.chat_id).toBe("oc_xxx");
    expect(event.content).toBe("hello");
  });
});
```

### Task 4-7 (TDD): 数据层 — config, session-registry, cards

**RED — 更新测试到新路径和接口**

`tests/config.test.ts` → 改为 import `../src/im/config.js`，测试新接口（无 pollInterval，无 autoStart，支持 botName）

`tests/session-registry.test.ts` → 改为 import `../src/im/session-registry.js`

`tests/cards.test.ts` → 改为 import `../src/im/cards.js`，测试新卡片 JSON 结构（无 `card` 包裹层）

`tests/renderer.test.ts` → 改为 import `../src/im/renderer.js`

### Task 8-11 (TDD): 通信层 — bot, messaging, consumer

**RED — 写新测试/更新测试**

`tests/bot.test.ts` → 改为 import `../src/im/bot.js`（保持用例不变）

`tests/messaging.test.ts` → 新增，mock child_process.execFile

`tests/consumer.test.ts` → 新增，mock child_process.spawn

### Task 12-14 (TDD): 核心 — processor, daemon, extension

**RED — 写新测试**

`tests/processor.test.ts` → 用 registerFauxProvider + SessionManager.inMemory

`tests/daemon.test.ts` → 整合测试（可选，最小覆盖）

`tests/extension.test.ts` → mock spawn + fs

### Task 15: 验证

- [ ] tsc --noEmit 通过
- [ ] vitest run 全部通过
- [ ] git status 确认代码结构正确

### Task 16: 提交

```bash
git add -A && git commit -m "refactor: TDD impl with src/im/ layout"
```
