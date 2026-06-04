import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  buildCard,
  type CardElement,
  createActionButton,
  createCardHeader,
  createDividerBlock,
  createMarkdownBlock,
} from "./helpers.js";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface Model {
  provider: string;
  id: string;
  name: string;
  input: ("text" | "image")[];
  contextWindow: number;
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

function inputLabel(input: ("text" | "image")[]): string {
  const parts: string[] = [];
  if (input.includes("text")) parts.push("📝");
  if (input.includes("image")) parts.push("🖼️");
  return parts.join(" ") || "📝";
}

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) group.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export async function buildModelsCard(
  options: ModelCardOptions,
): Promise<Record<string, unknown>> {
  const { session, availableModels } = options;
  const currentModel = session.model;
  const currentThink = session.thinkingLevel;
  const elements: CardElement[] = [];

  if (currentModel) {
    const cm = currentModel as Model;
    const thinkLabel = THINKING_LABELS[currentThink];
    const il = inputLabel(cm.input);
    const ctx = fmtContext(cm.contextWindow);
    elements.push(
      createMarkdownBlock(`📌 **当前 · ${cm.name}** (${cm.provider})`),
    );
    elements.push(
      createMarkdownBlock(`🧠 **${thinkLabel}**  ·  ${il}  ·  📏 **${ctx}**`),
    );
  } else {
    elements.push(createMarkdownBlock("📌 **当前**  (未选择)"));
  }

  elements.push(createDividerBlock());

  const grouped = groupBy(availableModels, (m) => m.provider);

  for (const [provider, models] of grouped) {
    elements.push(createMarkdownBlock(`**── ${provider} ──**`));

    for (const model of models) {
      const il = inputLabel(model.input);
      const ctx = fmtContext(model.contextWindow);
      const isCurrent =
        currentModel !== undefined &&
        model.provider === currentModel.provider &&
        model.id === currentModel.id;

      const modelLine =
        `**${model.name}**  │  ${il}  │  📏 ${ctx}` +
        (isCurrent ? "  ✓ 当前" : "");
      elements.push(createMarkdownBlock(modelLine));

      if (!isCurrent) {
        elements.push(
          createActionButton("选取", {
            cmd: "model",
            action: "select",
            provider: model.provider,
            modelId: model.id,
            thinkingLevel: currentThink,
          }),
        );
      }
    }
  }

  elements.push(createDividerBlock());
  elements.push(createMarkdownBlock("**思考级别**"));

  const currentProvider = currentModel?.provider ?? "";
  const currentModelId = currentModel?.id ?? "";

  const levelButton = (level: ThinkingLevel) => ({
    tag: "button" as const,
    text: { tag: "plain_text" as const, content: THINKING_LABELS[level] },
    type: (level === currentThink ? "primary" : "default") as
      | "primary"
      | "default",
    behaviors: [
      {
        type: "callback" as const,
        value: {
          cmd: "model",
          action: "select",
          provider: currentProvider,
          modelId: currentModelId,
          thinkingLevel: level,
        },
      },
    ],
  });

  const mid = Math.ceil(THINKING_LEVELS.length / 2);
  const rows = [THINKING_LEVELS.slice(0, mid), THINKING_LEVELS.slice(mid)];
  for (const row of rows) {
    elements.push({
      tag: "column_set",
      flex_mode: "none",
      columns: row.map((level) => ({
        tag: "column",
        width: "auto" as const,
        elements: [levelButton(level)],
      })),
    });
  }

  return buildCard(createCardHeader("Model 管理", "blue"), elements);
}
