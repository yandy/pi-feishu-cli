export interface FeishuCardHeader {
  title: { tag: "plain_text"; content: string };
  template?: string;
}

export interface FeishuCardConfig {
  wide_screen_mode?: boolean;
}

export type FeishuCardElement =
  | { tag: "div"; text?: { tag: "lark_md"; content: string }; fields?: unknown[] }
  | { tag: "hr" }
  | { tag: "actions"; actions: FeishuButtonElement[] }
  | { tag: "note"; elements: { tag: "plain_text"; content: string }[] }
  | { tag: "select_static"; placeholder: { tag: "plain_text"; content: string }; options: { text: { tag: "plain_text"; content: string }; value: string }[]; initial_option?: string };

export interface FeishuButtonElement {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type?: "primary" | "default" | "danger";
  value: Record<string, unknown>;
}

export interface FeishuSelectOption {
  text: { tag: "plain_text"; content: string };
  value: string;
}

export function createCardHeader(title: string, template?: string): FeishuCardHeader {
  const header: FeishuCardHeader = {
    title: { tag: "plain_text", content: title },
  };
  if (template !== undefined) {
    header.template = template;
  }
  return header;
}

export function createMarkdownBlock(content: string): FeishuCardElement {
  return {
    tag: "div",
    text: { tag: "lark_md", content },
  };
}

export function createActionButton(
  text: string,
  value: Record<string, unknown>,
  type: "primary" | "default" | "danger" = "default",
): FeishuButtonElement {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    value,
  };
}

export function createSelectMenu(
  placeholder: string,
  options: FeishuSelectOption[],
  initialOption?: string,
): FeishuCardElement {
  const menu: FeishuCardElement = {
    tag: "select_static",
    placeholder: { tag: "plain_text", content: placeholder },
    options,
  };
  if (initialOption !== undefined) {
    (menu as Record<string, unknown>)["initial_option"] = initialOption;
  }
  return menu;
}

export function createDividerBlock(): FeishuCardElement {
  return { tag: "hr" };
}

export function createNoteBlock(content: string): FeishuCardElement {
  return {
    tag: "note",
    elements: [{ tag: "plain_text", content }],
  };
}

export function buildCard(
  header: FeishuCardHeader,
  elements: FeishuCardElement[],
  config?: FeishuCardConfig,
): Record<string, unknown> {
  return {
    config: config ?? { wide_screen_mode: true },
    header,
    elements,
  };
}
