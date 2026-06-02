import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  buildCard,
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
  type CardElement,
} from "./helpers.js";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface Model {
  provider: string;
  id: string;
}

export interface ModelCardOptions {
  session: AgentSession;
  availableModels: Model[];
}

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function modelKey(model: Model): string {
  return `${model.provider}/${model.id}`;
}

export async function buildModelsCard(options: ModelCardOptions): Promise<Record<string, unknown>> {
  const { session, availableModels } = options;

  const currentModel = session.model;
  const currentThink = session.thinkingLevel;

  const elements: Record<string, unknown>[] = [];

  const currentLabel = currentModel
    ? `${currentModel.provider}/${currentModel.id} · Thinking: ${currentThink}`
    : "(未选择)";
  elements.push(createMarkdownBlock(`**当前**\n${currentLabel}`));

  elements.push(createDividerBlock());
  elements.push(createMarkdownBlock("**可用 Models**"));

  for (const model of availableModels) {
    const key = modelKey(model);
    elements.push({
      tag: "action" as const,
      actions: [
        createMarkdownBlock(`\`${key}\``) as any,
        ...THINKING_LEVELS.map((level) =>
          createActionButton(
            `Think:${level}`,
            { cmd: "model", action: "select", provider: model.provider, modelId: model.id, thinkingLevel: level },
            level === currentThink ? "primary" : "default",
          ),
        ),
      ],
    });
  }

  return buildCard(createCardHeader("Model 管理", "blue"), elements as CardElement[]);
}
