# Remove Bundled Feishu Skills

## Goal

Remove the built-in Feishu skills from `pi-feishu-cli` and clean up all related code, configuration, scripts, tests, and documentation. Keep the Pi agent's native `--skill` custom skill-loading capability unchanged.

## Motivation

The project currently ships 26 bundled Lark API skills under `skills/` and an `npm run update-skills` script to refresh them from Feishu's well-known endpoint. These built-in skills are no longer desired as part of the CLI package. We want to eliminate them entirely to reduce package size, remove dead maintenance surface, and avoid confusion between bundled skills and user-provided skills.

## Scope

### What will be removed

- `[REMOVED]` `skills/` directory (all 26 bundled Lark API skills)
- `[REMOVED]` `scripts/update-skills.mjs` (and `scripts/` directory if it becomes empty)
- `[REMOVED]` `.skills-cache.json` if present
- `[REMOVED]` `--no-bundle-feishu-skills` CLI flag in `cli.ts`
- `[REMOVED]` `FEISHU_NO_BUNDLE_SKILLS` environment variable support
- `[REMOVED]` `noBundleFeishuSkills` field in JSON config file
- `[REMOVED]` `noBundleFeishuSkills` field in `FeishuConfig` type
- `[REMOVED]` Automatic `packageRoot/skills` loading logic in `src/runtime.ts`
- `[REMOVED]` Related test cases in `tests/cli.test.ts`, `tests/config.test.ts`, and `tests/runtime.test.ts`
- `[REMOVED]` Skills-related sections in `README.md`
- `[REMOVED]` `update-skills` npm script and `skills/` entry from `package.json` files/scripts

### What will be preserved

- `[PRESERVED]` Pi agent's native `--skill <path>` flag for users to load custom skills.
- `[PRESERVED]` Pi agent's `--no-skills` flag to disable all skill discovery.
- `[PRESERVED]` Extension and tool registration (e.g., `send_file_to_chat`).
- `[PRESERVED]` All Feishu bot / TUI functionality unrelated to bundled skills.

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

## Documentation changes

> **Note:** `README.md` is the main user-facing document that needs to be updated after the removal. Any content that previously described or advertised the built-in skills is now stale and should be removed or marked as removed.

### 1. README.md updates (善后工作)

The following sections/entries in `README.md` are related to the built-in Feishu skills and should be cleaned up:

- `[REMOVED]` Remove the `Skills` section entirely.
- `[REMOVED]` Remove `npm run update-skills` from the development section.
- `[REMOVED]` Remove `--no-bundle-feishu-skills` from the CLI options table.
- `[REMOVED]` Remove `FEISHU_NO_BUNDLE_SKILLS` from the environment variables table.
- `[REMOVED]` Remove `noBundleFeishuSkills` from the sample config JSON.
- `[REMOVED]` Remove any mentions of bundled skills in the architecture section.
- `[PRESERVED]` Keep the description of the `--skill` option in the "PI Agent Options" section, since user-provided custom skills still work through the Pi agent.
- `[PRESERVED]` Keep the general description of skills in the context of Pi agent native loading if it exists, but remove any wording that implies skills are bundled with this package.

### 2. Other documentation

- `[REMOVED]` Remove any `docs/` or other markdown files that reference `update-skills`, the bundled `skills/` directory, or `--no-bundle-feishu-skills`.
- `[REMOVED]` Update `RELEASE.md` if it mentions bundled skills or update-skills; if not, no change is needed.
- `[REMOVED]` Update `AGENTS.md` if it contains any project-specific guidance about bundled skills; otherwise leave as-is.

## Spec markers

Items marked with `[REMOVED]` above are being deleted as part of this change. Items marked with `[PRESERVED]` are kept because they relate to the Pi agent's native skill-loading capability, not the bundled skills being removed.

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
