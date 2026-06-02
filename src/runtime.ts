import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type AgentSessionRuntime,
  createSyntheticSourceInfo,
  type Skill,
  type ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface InitRuntimeOptions {
  cwd: string;
  agentDir?: string;
  packageRoot?: string;
}

export interface InitRuntimeResult {
  runtime: AgentSessionRuntime;
}

function loadSkillsFromDir(skillsDir: string): Skill[] {
  const skills: Skill[] = [];
  try { statSync(skillsDir); } catch { return skills; }

  for (const entry of readdirSync(skillsDir)) {
    const fullPath = join(skillsDir, entry);
    const stat = statSync(fullPath);
    if (!stat.isDirectory()) continue;
    const skillMd = join(fullPath, "SKILL.md");
    try { statSync(skillMd); } catch { continue; }
    skills.push({
      name: entry,
      description: `Skill from ${entry}`,
      filePath: skillMd,
      baseDir: fullPath,
      sourceInfo: createSyntheticSourceInfo(skillMd, {
        source: "project",
        scope: "project",
        origin: "top-level",
        baseDir: fullPath,
      }),
      disableModelInvocation: false,
    });
  }
  return skills;
}

export async function initRuntime(options: InitRuntimeOptions): Promise<InitRuntimeResult> {
  const cwd = resolve(options.cwd);
  const agentDir = options.agentDir ?? getAgentDir();

  const packageRoot = options.packageRoot ?? cwd;
  const skillsDir = join(packageRoot, "skills");
  const customSkills = loadSkillsFromDir(skillsDir);

  const skillsOverride = (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => ({
    skills: [...current.skills, ...customSkills],
    diagnostics: current.diagnostics,
  });

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: runtimeCwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      resourceLoaderOptions: { skillsOverride },
    });
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd),
  });

  return { runtime };
}
