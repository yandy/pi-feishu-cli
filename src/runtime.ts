import { isAbsolute, resolve as nodeResolvePath } from "node:path";
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent";
import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionAPI,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getFeishuContext } from "./feishu/context.js";

function isLocalPath(value: string): boolean {
  const trimmed = value.trim();
  if (
    trimmed.startsWith("npm:") ||
    trimmed.startsWith("git:") ||
    trimmed.startsWith("github:") ||
    trimmed.startsWith("http:") ||
    trimmed.startsWith("https:") ||
    trimmed.startsWith("ssh:")
  ) {
    return false;
  }
  return true;
}

function resolvePath(input: string, baseDir: string): string {
  return isAbsolute(input)
    ? nodeResolvePath(input)
    : nodeResolvePath(baseDir, input);
}

export interface InitRuntimeOptions {
  cwd: string;
  agentDir?: string;
  piArgs?: PiArgs;
  sessionManager?: SessionManager;
}

export interface InitRuntimeResult {
  runtime: AgentSessionRuntime;
}

export async function initRuntime(
  options: InitRuntimeOptions,
): Promise<InitRuntimeResult> {
  const cwd = nodeResolvePath(options.cwd);
  const agentDir = options.agentDir ?? getAgentDir();

  const parsed = options.piArgs;

  function resolveCLIPaths(paths?: string[]): string[] | undefined {
    if (!paths || paths.length === 0) return undefined;
    return paths.map((p) => (isLocalPath(p) ? resolvePath(p, cwd) : p));
  }

  const additionalSkillPaths = [
    ...(parsed?.skills ? (resolveCLIPaths(parsed.skills) ?? []) : []),
  ];

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      extensionFlagValues: parsed?.unknownFlags,
      resourceLoaderOptions: {
        additionalSkillPaths,
        additionalExtensionPaths: resolveCLIPaths(parsed?.extensions),
        additionalPromptTemplatePaths: resolveCLIPaths(parsed?.promptTemplates),
        additionalThemePaths: resolveCLIPaths(parsed?.themes),
        noExtensions: parsed?.noExtensions,
        noSkills: parsed?.noSkills,
        noPromptTemplates: parsed?.noPromptTemplates,
        noThemes: parsed?.noThemes,
        noContextFiles: parsed?.noContextFiles,
        systemPrompt: parsed?.systemPrompt,
        appendSystemPrompt: parsed?.appendSystemPrompt,
        extensionFactories: [
          (pi: ExtensionAPI) => {
            pi.registerTool({
              name: "send_file_to_chat",
              label: "发送文件到飞书聊天",
              description:
                "发送本地文件到当前的飞书聊天窗口。仅当处于飞书对话环境中时才可使用。",
              promptGuidelines: [
                "当你生成了需要交付给用户的文件时（如 Word文档 .docx、图片 .png/.jpg、PDF .pdf、Excel表格 .xlsx 等），请主动调用 send_file_to_chat 工具将文件发送到聊天窗口。",
                "此工具只能发送位于当前工作目录（或子目录）中的文件。如果文件在 /tmp 等其他位置，先用 bash 工具将其复制或移动到当前目录下。",
                "发送前确认文件已成功创建且路径正确。",
                "文件名应能清楚表达文件内容。",
              ],
              parameters: Type.Object({
                filePath: Type.String({ description: "要发送的本地文件路径" }),
                fileName: Type.Optional(
                  Type.String({
                    description:
                      "显示给用户的文件名，不传则用文件路径中的文件名",
                  }),
                ),
              }),
              async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
                const ctx = getFeishuContext();
                if (!ctx) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: "当前不在飞书对话中，无法发送文件。请在飞书聊天中直接请求发送。如果需要在 TUI 终端中查看文件，请直接告知文件路径。",
                      },
                    ],
                    details: {},
                  };
                }
                try {
                  await ctx.channel.sendFile(
                    ctx.chatId,
                    params.filePath,
                    params.fileName,
                  );
                  return {
                    content: [
                      {
                        type: "text",
                        text: `文件 "${params.fileName ?? params.filePath}" 已发送到飞书聊天窗口。`,
                      },
                    ],
                    details: {},
                  };
                } catch (err) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: `文件发送失败: ${err instanceof Error ? err.message : String(err)}`,
                      },
                    ],
                    details: {},
                  };
                }
              },
            });
          },
        ],
      },
    });
    const sessionToolOptions: {
      tools?: string[];
      excludeTools?: string[];
      noTools?: "all" | "builtin";
    } = {};
    if (parsed?.noTools) {
      sessionToolOptions.noTools = "all";
    } else if (parsed?.noBuiltinTools) {
      sessionToolOptions.noTools = "builtin";
    }
    if (parsed?.tools) {
      sessionToolOptions.tools = [...parsed.tools];
    }
    if (parsed?.excludeTools) {
      sessionToolOptions.excludeTools = [...parsed.excludeTools];
    }
    const sessionResult = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      ...sessionToolOptions,
    });
    const userOverrodeTools =
      Boolean(parsed?.tools) ||
      Boolean(parsed?.noTools) ||
      Boolean(parsed?.noBuiltinTools);
    if (!userOverrodeTools) {
      sessionResult.session.setActiveToolsByName([
        ...new Set([
          ...sessionResult.session.getActiveToolNames(),
          "grep",
          "find",
          "ls",
        ]),
      ]);
    }
    return {
      ...sessionResult,
      services,
      diagnostics: services.diagnostics,
    };
  };

  const sm = options.sessionManager ?? SessionManager.create(cwd);
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: sm.getCwd(),
    agentDir,
    sessionManager: sm,
  });

  return { runtime };
}
