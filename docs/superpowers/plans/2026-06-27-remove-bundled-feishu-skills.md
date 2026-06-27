# Remove Bundled Feishu Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the built-in Feishu skills from `pi-feishu-cli` and clean up all related code, configuration, scripts, tests, and documentation. Keep the Pi agent's native `--skill` custom skill-loading capability unchanged.

**Architecture:** This is a feature-removal refactor. We delete the bundled `skills/` directory and `scripts/update-skills.mjs`, strip the `noBundleFeishuSkills` option from the CLI/config/type pipeline, remove the automatic `packageRoot/skills` loading in `src/runtime.ts`, update the affected tests, and refresh `README.md` and `package.json` so they no longer reference the removed feature. The Pi agent's own `--skill` and `--no-skills` flags remain untouched.

**Tech Stack:** TypeScript, Node.js, Vitest, Biome, `@earendil-works/pi-coding-agent`

## Global Constraints

- This project uses `npm` for scripts and package management.
- Source code lives in `src/` and `cli.ts`; tests mirror `src/` under `tests/`.
- The package is published with `files: ["dist/", "skills/"]` in `package.json`; this list must be updated.
- The bundled `skills/` directory must be entirely removed; no partial retention.
- User-provided skill loading via Pi agent's `--skill <path>` flag must continue to work.
- All verification commands must pass before any task is considered complete: `npm run typecheck`, `npm run check`, `npm test`.
- Each task commit should be atomic and focused on one deliverable.

---

### Task 1: Remove bundled skill artifacts

**Files:**
- Delete: `skills/` (entire directory)
- Delete: `scripts/update-skills.mjs`
- Delete: `scripts/` directory if it becomes empty after the above deletion
- Modify: `package.json`

**Interfaces:**
- Consumes: None (this is the first cleanup task)
- Produces: `package.json` no longer has `update-skills` script, and `skills/` is removed from `files`

- [ ] **Step 1: Delete the bundled skills directory**

```bash
rm -rf skills
```

- [ ] **Step 2: Delete the update-skills script**

```bash
rm scripts/update-skills.mjs
```

- [ ] **Step 3: Remove `scripts/` directory if it is now empty**

```bash
rmdir scripts 2>/dev/null || echo "scripts/ still contains other files"
```

- [ ] **Step 4: Update `package.json`**

Remove the `update-skills` script from the `scripts` block and remove `"skills/"` from the `files` array. If `scripts/` was removed, also remove `"scripts/"` from `files`.

Before:
```json
"scripts": {
  "dev": "tsc --watch",
  "build": "tsc",
  "typecheck": "tsc --noEmit",
  "check": "biome check --write",
  "test": "vitest run",
  "test:watch": "vitest",
  "update-skills": "node scripts/update-skills.mjs",
  "prepare": "npm run build"
},
"files": [
  "dist/",
  "skills/"
]
```

After:
```json
"scripts": {
  "dev": "tsc --watch",
  "build": "tsc",
  "typecheck": "tsc --noEmit",
  "check": "biome check --write",
  "test": "vitest run",
  "test:watch": "vitest",
  "prepare": "npm run build"
},
"files": [
  "dist/"
]
```

- [ ] **Step 5: Run verification**

```bash
npm run typecheck
npm run check
npm test
```

Expected: all pass. `npm run check` may surface pre-existing lint warnings; it should not fail or exit with an error.

- [ ] **Step 6: Commit**

```bash
git add package.json
if [ ! -d scripts ]; then git add scripts; fi
git add skills
git commit -m "feat: remove bundled skills directory and update-skills script"
```

---

### Task 2: Remove `noBundleFeishuSkills` from the CLI/config/type/runtime pipeline

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/runtime.ts`
- Modify: `src/index.ts`
- Modify: `cli.ts`

**Interfaces:**
- Consumes: None; this task removes a cross-cutting option
- Produces: `FeishuConfig` no longer has `noBundleFeishuSkills`; `loadConfig` no longer parses it; `initRuntime` no longer accepts it; `main` no longer passes it; the CLI no longer parses `--no-bundle-feishu-skills`

- [ ] **Step 1: Update `src/types.ts`**

Remove the `noBundleFeishuSkills` field from `FeishuConfig`.

Before:
```typescript
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  botName?: string;
  noBundleFeishuSkills?: boolean;
}
```

After:
```typescript
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  botName?: string;
}
```

- [ ] **Step 2: Update `src/config.ts`**

Remove the option from `ConfigOptions`, from `loadFileConfig`, and from the returned config object.

Remove from `ConfigOptions`:
```typescript
export interface ConfigOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
}
```

Remove from `loadFileConfig` return:
```typescript
return {
  appId: parsed.appId,
  appSecret: parsed.appSecret,
  ...(parsed.botName ? { botName: parsed.botName } : {}),
};
```

Remove `FEISHU_NO_BUNDLE_SKILLS` parsing and the `noBundleFeishuSkills` resolution logic from `loadConfig`. The final return should be:
```typescript
return {
  appId,
  appSecret,
  botName: fileConfig?.botName ?? envConfig.botName,
};
```

- [ ] **Step 3: Update `src/runtime.ts`**

Remove `noBundleFeishuSkills` from `InitRuntimeOptions`, remove the `skillsDir`/`noBundle` variables, and remove the automatic bundled-skills loading while keeping user-provided `--skill` paths.

Before (around the relevant lines):
```typescript
export interface InitRuntimeOptions {
  cwd: string;
  agentDir?: string;
  packageRoot?: string;
  noBundleFeishuSkills?: boolean;
  piArgs?: PiArgs;
  sessionManager?: SessionManager;
}
```

After:
```typescript
export interface InitRuntimeOptions {
  cwd: string;
  agentDir?: string;
  packageRoot?: string;
  piArgs?: PiArgs;
  sessionManager?: SessionManager;
}
```

Before:
```typescript
  const packageRoot = options.packageRoot ?? cwd;
  const noBundle = options.noBundleFeishuSkills ?? false;
  const skillsDir = join(packageRoot, "skills");
```

After:
```typescript
  const packageRoot = options.packageRoot ?? cwd;
```

Before:
```typescript
  const baseSkillPaths = noBundle ? [] : [skillsDir];
  const additionalSkillPaths = [
    ...(parsed?.noSkills ? [] : baseSkillPaths),
    ...(parsed?.skills ? (resolveCLIPaths(parsed.skills) ?? []) : []),
  ];
```

After:
```typescript
  const additionalSkillPaths = [
    ...(parsed?.skills ? (resolveCLIPaths(parsed.skills) ?? []) : []),
  ];
```

Note: `packageRoot` is now only used for the `packageRoot` variable itself (it may become unused). If TypeScript reports it as unused, remove the `const packageRoot = ...` line entirely. However, be careful: the variable is currently used for `skillsDir`. If removing `skillsDir` leaves `packageRoot` unused, delete the `packageRoot` line too.

- [ ] **Step 4: Update `src/index.ts`**

Remove `noBundleFeishuSkills` from `MainOptions` and from the `initRuntime` call.

Before:
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
  piArgs?: PiArgs;
}
```

After:
```typescript
export interface MainOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
  logLevel?: string;
  packageRoot?: string;
  botName?: string;
  piArgs?: PiArgs;
}
```

Before:
```typescript
  const { runtime } = await initRuntime({
    cwd,
    packageRoot: options.packageRoot,
    noBundleFeishuSkills: feishuConfig.noBundleFeishuSkills,
    piArgs: parsed,
    sessionManager,
  });
```

After:
```typescript
  const { runtime } = await initRuntime({
    cwd,
    packageRoot: options.packageRoot,
    piArgs: parsed,
    sessionManager,
  });
```

- [ ] **Step 5: Update `cli.ts`**

Remove `noBundleFeishuSkills` from `CliArgs`, from the `--no-bundle-feishu-skills` branch in `parseArgs`, from `printHelp`, and from the `main(...)` call.

Before:
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

After:
```typescript
interface CliArgs {
  appId?: string;
  appSecret?: string;
  config?: string;
  logLevel?: string;
  botName?: string;
}
```

Remove this entire branch from `parseArgs`:
```typescript
      case "--no-bundle-feishu-skills":
        consumed.add(i);
        result.noBundleFeishuSkills = true;
        break;
```

Remove this line from `printHelp`:
```
  --no-bundle-feishu-skills  Skip loading project skills/ directory
```

Remove `noBundleFeishuSkills: cliArgs.noBundleFeishuSkills` from the `main(...)` call.

- [ ] **Step 6: Run verification**

```bash
npm run typecheck
npm run check
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/config.ts src/runtime.ts src/index.ts cli.ts
git commit -m "feat: remove noBundleFeishuSkills option from CLI, config, types and runtime"
```

---

### Task 3: Update tests

**Files:**
- Modify: `tests/cli.test.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/runtime.test.ts`

**Interfaces:**
- Consumes: Task 2 changes (the `noBundleFeishuSkills` option and bundled-skills loading no longer exist)
- Produces: Tests reflect the removed feature and continue to verify the preserved Pi-agent skill loading behavior

- [ ] **Step 1: Update `tests/cli.test.ts`**

Remove the test case `handles --no-bundle-feishu-skills flag`. The file should end with only the remaining three tests.

- [ ] **Step 2: Update `tests/config.test.ts`**

Remove the two tests that reference `noBundleFeishuSkills`:
- `reads noBundleFeishuSkills from FEISHU_NO_BUNDLE_SKILLS env var`
- `config file noBundleFeishuSkills overrides env var`

- [ ] **Step 3: Update `tests/runtime.test.ts`**

Remove the three tests that exercise the bundled-skills loading mechanism:
- `skips loading bundled skills when noBundleFeishuSkills is true`
- `loads bundled skills when noBundleFeishuSkills is false`
- `loads skills from additionalSkillPaths when packageRoot is set`

Keep the following tests:
- `creates a runtime with sessionManager`
- `enables grep, find, ls tools by default`
- `respects piArgs.noSkills to disable skill loading`
- `loads tools registered by -e extension`
- `respects explicit piArgs.tools allowlist`

- [ ] **Step 4: Run verification**

```bash
npm run typecheck
npm test
```

Expected: tests pass, including the remaining skill-loading tests.

- [ ] **Step 5: Commit**

```bash
git add tests/cli.test.ts tests/config.test.ts tests/runtime.test.ts
git commit -m "test: remove tests for bundled Feishu skills"
```

---

### Task 4: Update README and other documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1–3 (feature is removed)
- Produces: README no longer documents bundled skills, `update-skills`, or `--no-bundle-feishu-skills`

- [ ] **Step 1: Remove the `Skills` section**

Delete the entire `## Skills` section and its contents from `README.md`.

- [ ] **Step 2: Remove CLI option `--no-bundle-feishu-skills`**

Remove the row from the CLI parameters table:
```markdown
| `--no-bundle-feishu-skills` | — | 跳过加载项目 `skills/` 目录 |
```

- [ ] **Step 3: Remove environment variable `FEISHU_NO_BUNDLE_SKILLS`**

Remove the row from the environment variables table:
```markdown
| 3（最低） | 环境变量 | `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BOT_NAME`、`FEISHU_NO_BUNDLE_SKILLS` |
```

Update the row to list only the remaining variables:
```markdown
| 3（最低） | 环境变量 | `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BOT_NAME` |
```

- [ ] **Step 4: Remove `noBundleFeishuSkills` from sample config**

Update the config JSON sample from:
```json
{ "appId": "cli_xxx", "appSecret": "xxx", "botName": "My Bot", "noBundleFeishuSkills": true }
```

To:
```json
{ "appId": "cli_xxx", "appSecret": "xxx", "botName": "My Bot" }
```

- [ ] **Step 5: Remove `npm run update-skills` from development section**

Delete the line from the development commands:
```markdown
npm run update-skills
```

- [ ] **Step 6: Remove bundled-skills mentions from architecture section**

If the architecture section still mentions the `skills/` directory or bundled skills, remove those references. Do not remove the `--skill` option in the PI Agent Options section, because that belongs to Pi agent's native capability.

- [ ] **Step 7: Run verification**

```bash
npm test
```

Expected: tests still pass (README changes do not affect code tests, but verify nothing broke).

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: remove bundled skills documentation from README"
```

---

### Task 5: Final cleanup and verification

**Files:**
- Any remaining files with stale references

**Interfaces:**
- Consumes: Tasks 1–4
- Produces: A clean branch with no stale references to the removed feature

- [ ] **Step 1: Search for stale references**

```bash
grep -R "noBundleFeishuSkills" --include="*.ts" --include="*.js" --include="*.mjs" --include="*.json" --include="*.md" . || true
grep -R "bundle-feishu-skills" --include="*.ts" --include="*.js" --include="*.mjs" --include="*.json" --include="*.md" . || true
grep -R "update-skills" --include="*.ts" --include="*.js" --include="*.mjs" --include="*.json" --include="*.md" . || true
grep -R "\.skills-cache" --include="*.ts" --include="*.js" --include="*.mjs" --include="*.json" --include="*.md" . || true
```

Expected: no matches (or only matches in `node_modules/` and `dist/`, which are generated/ignored and should be ignored). If any matches appear in source files, fix them before proceeding.

- [ ] **Step 2: Rebuild distribution**

```bash
npm run build
```

Expected: `dist/` is regenerated. Verify it does not contain a `skills/` directory:
```bash
ls dist/skills 2>/dev/null && echo "ERROR: dist/skills still exists" || echo "OK: dist/skills not present"
```

- [ ] **Step 3: Run full verification suite**

```bash
npm run typecheck
npm run check
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 4: Commit any generated distribution changes**

```bash
git add dist
git commit -m "chore: rebuild dist after removing bundled skills"
```

- [ ] **Step 5: Report completion**

Mark all tasks complete and hand off to the final whole-branch review.

---

## Self-Review

- **Spec coverage:** Every `[REMOVED]` item in the spec has a corresponding task in this plan.
- **Placeholder scan:** No TODOs or TBDs remain in the plan.
- **Type consistency:** The `FeishuConfig` interface, `loadConfig`, `initRuntime`, `MainOptions`, `CliArgs`, and `runtime.ts` are all updated in the same task (Task 2) to avoid intermediate type errors.
- **Task independence:** Tasks 1 and 2 are independent; Task 3 depends on Task 2; Task 4 depends on Tasks 1–3; Task 5 is the final verification.
- **Verification:** Each task ends with the required verification commands.
