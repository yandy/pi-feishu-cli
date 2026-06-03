import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  buildCard,
  type CardElement,
  createCardHeader,
  createDividerBlock,
  createMarkdownBlock,
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

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhigh",
};

function modelKey(model: Model): string {
  return `${model.provider}/${model.id}`;
}

export async function buildModelsCard(
  options: ModelCardOptions,
): Promise<Record<string, unknown>> {
  const { session, availableModels } = options;

  const currentModel = session.model;
  const currentThink = session.thinkingLevel;

  const elements: CardElement[] = [];

  const currentLabel = currentModel
    ? `${currentModel.provider}/${currentModel.id} · ${THINKING_LABELS[currentThink]}`
    : "(未选择)";
  elements.push(createMarkdownBlock("**当前**"));
  elements.push(createMarkdownBlock(currentLabel));

  elements.push(createDividerBlock());
  elements.push(createMarkdownBlock("**可用 Models**"));

  for (const model of availableModels) {
    const key = modelKey(model);
    elements.push(createDividerBlock());
    elements.push(createMarkdownBlock(`**${key}**`));
    for (const level of THINKING_LEVELS) {
      elements.push({
        tag: "button",
        text: { tag: "plain_text", content: THINKING_LABELS[level] },
        type: (level === currentThink ? "primary" : "default") as
          | "primary"
          | "default",
        behaviors: [
          {
            type: "callback",
            value: {
              cmd: "model",
              action: "select",
              provider: model.provider,
              modelId: model.id,
              thinkingLevel: level,
            },
          },
        ],
      });
    }
  }

  return buildCard(createCardHeader("Model 管理", "blue"), elements);
}
