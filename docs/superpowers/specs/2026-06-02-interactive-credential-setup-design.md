# Interactive Credential Setup Design

## Overview

When `pi-feishu` runs without Feishu credentials from any source (CLI args, config file, env vars), instead of throwing an error, prompt the user interactively and persist credentials to the default config location.

## Design

### Entry Flow Change (`src/index.ts`)

```
main()
  ├── loadConfig() → success → continue
  └── loadConfig() → throws (no credentials)
        └── interactive prompt → save → retry
```

Add `promptIfMissing()` wrapper:

```
try {
  feishuConfig = loadConfig({appId, appSecret, config, cwd});
} catch {
  console.error("未找到飞书凭证，请输入：");
  feishuConfig = await promptAndSaveCredentials();
}
```

### Interactive Prompt (`src/config.ts`)

New exported function `promptAndSaveCredentials()`:

```
readline question "Feishu App ID: "     → appId
readline question "Feishu App Secret: " → appSecret
mkdir -p ~/.pi/agent/
writeFileSync ~/.pi/agent/feishu.json  ← {appId, appSecret}
console.error("Credentials saved to ~/.pi/agent/feishu.json")
return {appId, appSecret}
```

### File Changes

| File | Change |
|---|---|
| `src/config.ts` | Add `promptAndSaveCredentials()` export |
| `src/index.ts` | Wrap `loadConfig` in try/catch, call prompt on failure |
| `tests/config.test.ts` | Add test for prompt save path |

### Edge Cases

- If `writeFileSync` fails (permissions), the error propagates up to `main()` and kills the process with a message
- Ctrl+C during prompt → process exits normally via default SIGINT handler
- Empty input → saved as empty string → `loadConfig` on next run will fail (file exists but invalid), user deletes file or runs again to re-prompt
- Already have a config file → `loadConfig` succeeds, prompt never reached
