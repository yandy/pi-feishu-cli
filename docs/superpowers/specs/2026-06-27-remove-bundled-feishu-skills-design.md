# Remove Bundled Feishu Skills

## Goal

Remove the built-in Feishu skills from `pi-feishu-cli` and clean up all related code, configuration, scripts, tests, and documentation. Keep the Pi agent's native `--skill` custom skill-loading capability unchanged.

## Motivation

The project currently ships 26 bundled Lark API skills under `skills/` and an `npm run update-skills` script to refresh them from Feishu's well-known endpoint. These built-in skills are no longer desired as part of the CLI package. We want to eliminate them entirely to reduce package size, remove dead maintenance surface, and avoid confusion between bundled skills and user-provided skills.

## Scope

### What will be removed

- `skills/` directory (all 26 bundled Lark API skills)
- `scripts/update-skills.mjs` (and `scripts/` directory if it becomes empty)
- `.skills-cache.json` if present
- `--no-bundle-feishu-skills` CLI flag in `cli.ts`
- `FEISHU_NO_BUNDLE_SKILLS` environment variable support
- `noBundleFeishuSkills` field in JSON config file
- `noBundleFeishuSkills` field in `FeishuConfig` type
- Automatic `packageRoot/skills` loading logic in `src/runtime.ts`
- Related test cases in `tests/cli.test.ts`, `tests/config.test.ts`, and `tests/runtime.test.ts`
- Skills-related sections in `README.md`
- `update-skills` npm script and `skills/` entry from `package.json` files/scripts

### What will be preserved

- Pi agent's native `--skill <path>` flag for users to load custom skills.
- Pi agent's `--no-skills` flag to disable all skill discovery.
- Extension and tool registration (e.g., `send_file_to_chat`).
- All Feishu bot / TUI functionality unrelated to bundled skills.

## Design

### Code changes

1. `package.json`
   - Remove `"update-skills": "node scripts/update-skills.mjs"` from `scripts`.
   - Remove `"skills/"` from `files`.
   - Remove `"scripts/"` from `files` if the `scripts/` directory is removed.

2. `cli.ts`
   - Remove `noBundleFeishuSkills?: boolean` from `CliArgs`.
   - Remove the `--no-bundle-feishu-skills` branch in `parseArgs`.
   - Remove the flag from `printHelp()`.
   - Remove `noBundleFeishuSkills: cliArgs.noBundleFeishuSkills` from the `main(...)` call.

3. `src/types.ts`
   - Remove `noBundleFeishuSkills?: boolean` from `FeishuConfig`.

4. `src/config.ts`
   - Remove `noBundleFeishuSkills` from `ConfigOptions`.
   - Remove `FEISHU_NO_BUNDLE_SKILLS` environment variable parsing.
   - Remove `noBundleFeishuSkills` field parsing from `loadFileConfig`.
   - Remove `noBundleFeishuSkills` resolution logic from `loadConfig` return value.

5. `src/index.ts`
   - Remove `noBundleFeishuSkills?: boolean` from `MainOptions`.
   - Remove `noBundleFeishuSkills: feishuConfig.noBundleFeishuSkills` from the `initRuntime(...)` call.

6. `src/runtime.ts`
   - Remove `noBundleFeishuSkills?: boolean` from `InitRuntimeOptions`.
   - Remove `const noBundle = ...` and `const skillsDir = ...`.
   - Remove `baseSkillPaths` and the automatic `packageRoot/skills` loading.
   - Keep `additionalSkillPaths` as `[...(parsed?.skills ? resolveCLIPaths(parsed.skills) : [])]` so that user-provided `--skill` paths still work.

### Test changes

1. `tests/cli.test.ts`
   - Remove the `handles --no-bundle-feishu-skills flag` test case.

2. `tests/config.test.ts`
   - Remove `reads noBundleFeishuSkills from FEISHU_NO_BUNDLE_SKILLS env var`.
   - Remove `config file noBundleFeishuSkills overrides env var`.

3. `tests/runtime.test.ts`
   - Remove `skips loading bundled skills when noBundleFeishuSkills is true`.
   - Remove `loads bundled skills when noBundleFeishuSkills is false`.
   - Remove `loads skills from additionalSkillPaths when packageRoot is set` (this tested the bundled-skills directory mechanism).
   - Keep `respects piArgs.noSkills to disable skill loading` and extension/tool tests, as they verify Pi agent native behavior.

### Documentation changes

1. `README.md`
   - Remove `Skills` section.
   - Remove `npm run update-skills` from the development section.
   - Remove `--no-bundle-feishu-skills` from the CLI options table.
   - Remove `FEISHU_NO_BUNDLE_SKILLS` from the environment variables table.
   - Remove `noBundleFeishuSkills` from the sample config JSON.
   - Remove any mentions of bundled skills in the architecture section.

## Verification

After the changes, run:

- `npm run typecheck` — TypeScript compilation with no errors.
- `npm run check` — Biome formatting and linting passes.
- `npm test` — All Vitest tests pass.
- `npm run build` — Rebuild `dist/` and verify it does not contain `skills/` content.
- Grep for `noBundleFeishuSkills`, `bundle-feishu-skills`, `update-skills`, `\.skills-cache`, and `skills/` to confirm no stale references remain.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `scripts/` might contain other files | Inspect directory before removing it; only remove if it becomes empty. |
| `README.md` or other docs may have indirect references | Run a global search for `skills`, `bundle`, `noBundle` after code changes. |
| Existing users with `noBundleFeishuSkills` in config or scripts | This is a breaking change. Since we are removing the feature entirely, the field will simply be ignored; document it in the release notes. |
| Dist folder still contains stale `skills/` content | Run `npm run build` and verify the output. |

## Decision

Proceed with this removal and cleanup as specified.
