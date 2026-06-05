import { join, resolve } from "node:path";
import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export interface InitRuntimeOptions {
  cwd: string;
  agentDir?: string;
  packageRoot?: string;
  noBundleFeishuSkills?: boolean;
}

export interface InitRuntimeResult {
  runtime: AgentSessionRuntime;
}

export async function initRuntime(
  options: InitRuntimeOptions,
): Promise<InitRuntimeResult> {
  const cwd = resolve(options.cwd);
  const agentDir = options.agentDir ?? getAgentDir();

  const packageRoot = options.packageRoot ?? cwd;
  const noBundle = options.noBundleFeishuSkills ?? false;
  const skillsDir = join(packageRoot, "skills");
  const additionalSkillPaths = noBundle ? [] : [skillsDir];

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      resourceLoaderOptions: { additionalSkillPaths },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      })),
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
