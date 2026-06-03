# update-skills Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a dev-only script that downloads Feishu AI skills via well-known protocol and replaces the local `skills/` directory.

**Architecture:** A single Node.js `.mjs` script that probes well-known endpoints, parses the index, and downloads skill files atomically (temp dir → replace). Uses Node.js 18+ built-in `fetch` and `fs` — zero dependencies.

**Tech Stack:** Node.js (`.mjs`), built-in `fetch`, `fs/promises`, `path`

---

### Task 1: Create `scripts/update-skills.mjs`

**Files:**
- Create: `scripts/update-skills.mjs`

- [ ] **Step 1: Write the script**

```mjs
#!/usr/bin/env node

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WELL_KNOWN_PATHS = [
  "/.well-known/skills/index.json",
  "/.well-known/agent-skills/index.json",
];

const SKILLS_DIR = resolve(SCRIPT_DIR, "..", "skills");
const TMP_DIR = resolve(SCRIPT_DIR, "..", "skills.tmp");
const CACHE_FILE = resolve(SCRIPT_DIR, "..", ".skills-cache.json");

const FEISHU_ORIGIN = "https://open.feishu.cn";

async function probeEndpoint() {
  for (const path of WELL_KNOWN_PATHS) {
    const url = `${FEISHU_ORIGIN}${path}`;
    const resp = await fetch(url);
    if (resp.ok) {
      return { endpoint: path, index: await resp.json() };
    }
  }
  throw new Error(
    `All well-known endpoints returned non-200:\n${WELL_KNOWN_PATHS.map((p) => `  ${FEISHU_ORIGIN}${p}`).join("\n")}`,
  );
}

function getFileUrl(endpoint, skillName, file) {
  const baseDir = endpoint.replace(/\/[^/]+$/, "");
  return `${FEISHU_ORIGIN}${baseDir}/${skillName}/${file}`;
}

async function downloadFile(url, destPath) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const dir = destPath.substring(0, destPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(destPath, Buffer.from(await resp.arrayBuffer()));
}

async function main() {
  console.log("Probing well-known endpoints...");
  const { endpoint, index } = await probeEndpoint();
  console.log(`Using endpoint: ${endpoint} (${index.skills.length} skills)`);

  console.log("Downloading skills...");
  await mkdir(TMP_DIR, { recursive: true });

  for (const skill of index.skills) {
    const skillDir = resolve(TMP_DIR, skill.name);
    console.log(`  ${skill.name}`);
    for (const file of skill.files) {
      const url = getFileUrl(endpoint, skill.name, file);
      const dest = resolve(skillDir, file);
      try {
        await downloadFile(url, dest);
      } catch (err) {
        console.warn(`    ⚠ failed to download ${url}: ${err.message}`);
      }
    }
  }

  console.log("Replacing skills/ directory...");
  await rm(SKILLS_DIR, { recursive: true, force: true }).catch(() => {});
  await rename(TMP_DIR, SKILLS_DIR);

  await writeFile(
    CACHE_FILE,
    JSON.stringify(
      { endpoint, updatedAt: new Date().toISOString() },
      null,
      2,
    ),
  );

  console.log("Done.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

---

### Task 2: Add npm script to `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add update-skills script**

```json
"update-skills": "node scripts/update-skills.mjs"
```

Insert after the `"test:watch"` line, before `"prepare"`.

- [ ] **Step 2: Verify the script runs**

```bash
npm run update-skills
```

Expected: downloads all skills to `skills/`, no errors. Run `ls skills/` to verify 25+ skill directories exist.
