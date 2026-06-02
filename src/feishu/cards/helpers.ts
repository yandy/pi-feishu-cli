export interface CardHeader {
  title: { tag: "plain_text"; content: string };
  template?: string;
}

export interface CardConfig {
  wide_screen_mode?: boolean;
}

export type CardElement =
  | { tag: "div"; text?: { tag: "lark_md"; content: string } }
  | { tag: "hr" }
  | { tag: "action"; actions: CardButton[] }
  | { tag: "note"; elements: { tag: "plain_text"; content: string }[] };

export interface CardButton {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type?: "primary" | "default" | "danger";
  value: Record<string, unknown>;
}

export function createCardHeader(title: string, template?: string): CardHeader {
  const header: CardHeader = {
    title: { tag: "plain_text", content: title },
  };
  if (template !== undefined) header.template = template;
  return header;
}

export function createMarkdownBlock(content: string): CardElement {
  return {
    tag: "div",
    text: { tag: "lark_md", content },
  };
}

export function createActionButton(
  text: string,
  value: Record<string, unknown>,
  type: "primary" | "default" | "danger" = "default",
): CardButton {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    value,
  };
}

export function createDividerBlock(): CardElement {
  return { tag: "hr" };
}

export function createNoteBlock(content: string): CardElement {
  return {
    tag: "note",
    elements: [{ tag: "plain_text", content }],
  };
}

export function buildCard(
  header: CardHeader,
  elements: CardElement[],
): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header,
    elements,
  };
}
