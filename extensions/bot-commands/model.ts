import {
  createCardHeader,
  createMarkdownBlock,
  createNoteBlock,
  buildCard,
  type FeishuCardElement,
  type FeishuSelectOption,
} from "../feishu-card.js";

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
}

export interface ModelAction {
  cmd: "model";
  action: "select";
  modelProvider: string;
  modelId: string;
}

export function buildModelCard(
  availableModels: ModelInfo[],
  currentModel: { provider: string; id: string } | undefined,
): Record<string, unknown> {
  const elements: FeishuCardElement[] = [];

  const currentLabel = currentModel
    ? `**当前模型：** ${currentModel.id}`
    : "**当前模型：** 未设置";
  elements.push(createMarkdownBlock(currentLabel));

  if (availableModels.length === 0) {
    elements.push(createMarkdownBlock("暂无可用模型"));
  } else {
    const options: FeishuSelectOption[] = availableModels.map((m) => {
      const action: ModelAction = {
        cmd: "model",
        action: "select",
        modelProvider: m.provider,
        modelId: m.id,
      };
      return {
        text: { tag: "plain_text", content: `${m.name} (${m.provider})` },
        value: JSON.stringify(action),
      };
    });

    let initialOption: string | undefined;
    if (currentModel) {
      const currentAction: ModelAction = {
        cmd: "model",
        action: "select",
        modelProvider: currentModel.provider,
        modelId: currentModel.id,
      };
      initialOption = JSON.stringify(currentAction);
    }

    elements.push({
      tag: "select_static",
      placeholder: { tag: "plain_text", content: "选择模型" },
      options,
      ...(initialOption !== undefined ? { initial_option: initialOption } : {}),
    } as FeishuCardElement);
  }

  elements.push(
    createNoteBlock("选择模型后自动切换。切换仅对当前飞书群绑定的会话生效。"),
  );

  return buildCard(createCardHeader("模型切换", "blue"), elements, {
    wide_screen_mode: true,
  });
}

export async function handleModelAction(
  action: ModelAction,
  ctx: {
    switchSession: (path: string) => Promise<void>;
    modelRegistry: { find: (provider: string, id: string) => unknown };
  },
  registry: Record<string, string>,
  chatId: string,
  setModel: (model: unknown) => Promise<boolean>,
): Promise<boolean> {
  const sessionPath = registry[chatId];
  if (sessionPath) {
    await ctx.switchSession(sessionPath);
  }

  const model = ctx.modelRegistry.find(action.modelProvider, action.modelId);
  if (model) {
    return await setModel(model);
  }
  return false;
}
