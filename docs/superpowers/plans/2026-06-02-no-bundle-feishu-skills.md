# `--no-bundle-feishu-skills` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--no-bundle-feishu-skills` CLI flag (with env var and config file support) to skip loading project `skills/` directory.

**Architecture:** Follow existing priority chain pattern (env < config < cli). Add `noBundleFeishuSkills` field through the existing flow: `FeishuConfig` → `ConfigOptions` → `loadConfig` merge → `MainOptions` → `initRuntime()` → conditional `loadSkillsFromDir()`.

**Tech Stack:** TypeScript, Node.js, vitest, `@earendil-works/pi-coding-agent`

---

### Task 1: Config layer — FeishuConfig + loadConfig merge

**Files:**
- Modify: `src/types.ts:1-5`
- Modify: `src/config.ts:7-12`, `src/config.ts:42-73`
- Test: `tests/config.test.ts`

- [ ] **Write failing test: env var sets noBundleFeishuSkills**

```typescript
// tests/config.test.ts — add inside describe("loadConfig")
it("reads noBundleFeishuSkills from FEISHU_NO_BUNDLE_SKILLS env var", () => {
  const prev = process.env.FEISHU_NO_BUNDLE_SKILLS;
  process.env.FEISHU_NO_BUNDLE_SKILLS = "true";
  try {
    const cfg = loadConfig({ appId: "x", appSecret: "x" });
    expect(cfg.noBundleFeishuSkills).toBe(true);
  } finally {
    process.env.FEISHU_NO_BUNDLE_SKILLS = prev;
  }
});

it("reads noBundleFeishuSkills from config file", () => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    join(tmpDir, "feishu.json"),
    JSON.stringify({ appId: "file-id", appSecret: "file-secret", noBundleFeishuSkills: true }),
  );
  try {
    const cfg = loadConfig({ config: join(tmpDir, "feishu.json") });
    expect(cfg.noBundleFeishuSkills).toBe(true);
  } finally {
    cleanup();
  }
});

it("config file noBundleFeishuSkills overrides env var", () => {
  const prev = process.env.FEISHU_NO_BUNDLE_SKILLS;
  process.env.FEISHU_NO_BUNDLE_SKILLS = "true";
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "feishu.json"),
      JSON.stringify({ appId: "file-id", appSecret: "file-secret", noBundleFeishuSkills: false }),
    );
    const cfg = loadConfig({ config: join(tmpDir, "feishu.json") });
    expect(cfg.noBundleFeishuSkills).toBe(false);
  } finally {
    process.env.FEISHU_NO_BUNDLE_SKILLS = prev;
    cleanup();
  }
});

it("CLI noBundleFeishuSkills overrides config file", () => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    join(tmpDir, "feishu.json"),
    JSON.stringify({ appId: "file-id", appSecret: "file-secret", noBundleFeishuSkills: true }),
  );
  const cfg = loadConfig({
    config: join(tmpDir, "feishu.json"),
    noBundleFeishuSkills: false,
  });
  expect(cfg.noBundleFeishuSkills).toBe(false);
  cleanup();
});
```

- [ ] **Run tests to verify failures**

Run: `npx vitest run tests/config.test.ts --reporter=verbose`
Expected: 4 new tests FAIL with `noBundleFeishuSkills` not in return type

- [ ] **Add field to FeishuConfig** (`src/types.ts`)

```typescript
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  botName?: string;
  noBundleFeishuSkills?: boolean;
}
```

- [ ] **Add field to ConfigOptions** (`src/config.ts`)

```typescript
export interface ConfigOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
  noBundleFeishuSkills?: boolean;
}
```

- [ ] **Add merge logic in loadConfig** (`src/config.ts`)

Add after the `cliConfig` block and before the credential check, then replace the return:

```typescript
  const cliNoBundle = options.noBundleFeishuSkills;
  const envNoBundle = process.env.FEISHU_NO_BUNDLE_SKILLS === "1" || process.env.FEISHU_NO_BUNDLE_SKILLS === "true";
  const fileNoBundle = fileConfig?.noBundleFeishuSkills;

  return {
    appId,
    appSecret,
    botName: fileConfig?.botName ?? envConfig.botName,
    noBundleFeishuSkills: cliNoBundle ?? fileNoBundle ?? envNoBundle,
  };
```

- [ ] **Run tests to verify pass**

Run: `npx vitest run tests/config.test.ts --reporter=verbose`
Expected: all tests PASS

- [ ] **Commit**

```bash
git add src/types.ts src/config.ts tests/config.test.ts
git commit -m "feat: add noBundleFeishuSkills to config layer with env/file/cli priority"
```

---

### Task 2: Runtime — conditional skill loading

**Files:**
- Modify: `src/runtime.ts:16-20`, `src/runtime.ts:53-85`
- Test: `tests/runtime.test.ts`

- [ ] **Write failing test: noBundleFeishuSkills=true skips skill loading**

```typescript
// tests/runtime.test.ts — add inside describe("initRuntime")
it("skips loading bundled skills when noBundleFeishuSkills is true", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
  try {
    const skillPath = join(tmpDir, "skills", "test-skill", "SKILL.md");
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, "# Test Skill\n");

    const cwd = process.cwd();
    const result = await initRuntime({ cwd, packageRoot: tmpDir, noBundleFeishuSkills: true });

    const loaded = result.runtime.services.resourceLoader.getSkills();
    const skillNames = loaded.skills.map(s => s.name);
    expect(skillNames).not.toContain("test-skill");
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
}, 30000);

it("loads bundled skills when noBundleFeishuSkills is false", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
  try {
    const skillPath = join(tmpDir, "skills", "test-skill", "SKILL.md");
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, "# Test Skill\n");

    const cwd = process.cwd();
    const result = await initRuntime({ cwd, packageRoot: tmpDir, noBundleFeishuSkills: false });

    const loaded = result.runtime.services.resourceLoader.getSkills();
    const skillNames = loaded.skills.map(s => s.name);
    expect(skillNames).toContain("test-skill");
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
}, 30000);
```

- [ ] **Run tests to verify failures**

Run: `npx vitest run tests/runtime.test.ts --reporter=verbose`
Expected: 2 new tests FAIL (`noBundleFeishuSkills` not in `InitRuntimeOptions`)

- [ ] **Add field to InitRuntimeOptions** (`src/runtime.ts`)

```typescript
export interface InitRuntimeOptions {
  cwd: string;
  agentDir?: string;
  packageRoot?: string;
  noBundleFeishuSkills?: boolean;
}
```

- [ ] **Skip loadSkillsFromDir when flag is true** (`src/runtime.ts`)

Replace:
```typescript
  const packageRoot = options.packageRoot ?? cwd;
  const skillsDir = join(packageRoot, "skills");
  const customSkills = loadSkillsFromDir(skillsDir);
```

With:
```typescript
  const packageRoot = options.packageRoot ?? cwd;
  const noBundle = options.noBundleFeishuSkills ?? false;
  const skillsDir = join(packageRoot, "skills");
  const customSkills = noBundle ? [] : loadSkillsFromDir(skillsDir);
```

- [ ] **Run tests to verify pass**

Run: `npx vitest run tests/runtime.test.ts --reporter=verbose`
Expected: all tests PASS

- [ ] **Commit**

```bash
git add src/runtime.ts tests/runtime.test.ts
git commit -m "feat: skip skill loading when noBundleFeishuSkills is true"
```

---

### Task 3: CLI arg parsing

**Files:**
- Modify: `cli.ts`

- [ ] **Add noBundleFeishuSkills to CliArgs**

```typescript
interface CliArgs {
  appId?: string;
  appSecret?: string;
  config?: string;
  logLevel?: string;
  botName?: string;
  noBundleFeishuSkills?: boolean;
}
```

- [ ] **Add case in parseArgs**

Before `case "--help"`:

```typescript
      case "--no-bundle-feishu-skills":
        result.noBundleFeishuSkills = true;
        break;
```

- [ ] **Update help text**

Add line:
```
  --no-bundle-feishu-skills  Skip loading project skills/ directory
```

- [ ] **Run existing tests to confirm nothing broken**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Commit**

```bash
git add cli.ts
git commit -m "feat: add --no-bundle-feishu-skills CLI argument"
```

---

### Task 4: MainOptions pass-through

**Files:**
- Modify: `src/index.ts`

- [ ] **Add noBundleFeishuSkills to MainOptions**

```typescript
export interface MainOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
  logLevel?: string;
  packageRoot?: string;
  botName?: string;
  noBundleFeishuSkills?: boolean;
}
```

- [ ] **Pass to loadConfig** — add `noBundleFeishuSkills: options.noBundleFeishuSkills` in the loadConfig call

- [ ] **Pass to initRuntime** — add `noBundleFeishuSkills: feishuConfig.noBundleFeishuSkills` in the initRuntime call

- [ ] **Run existing tests**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Commit**

```bash
git add src/index.ts
git commit -m "feat: pass noBundleFeishuSkills from CLI to runtime"
```

---

### Task 5: Update README

**Files:**
- Modify: `README.md`

- [ ] **Add to CLI Arguments table**: row `| --no-bundle-feishu-skills | — | Skip loading project skills/ directory |`

- [ ] **Add to Configuration priority**: row `| — | Env var | FEISHU_NO_BUNDLE_SKILLS=1 |`

- [ ] **Update config file example**: add `"noBundleFeishuSkills": true`

- [ ] **Commit**

```bash
git add README.md
git commit -m "docs: document --no-bundle-feishu-skills flag"
```
