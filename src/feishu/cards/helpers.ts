export interface CardHeader {
  title: { tag: "plain_text"; content: string };
  template?: string;
}

export interface CardConfig {
  width_mode?: "fill" | "compact";
}

export interface CardColumn {
  tag: "column";
  width: "weighted" | "auto";
  weight?: number;
  elements: CardElement[];
}

export type CardElement =
  | { tag: "markdown"; content: string }
  | { tag: "hr" }
  | CardButton
  | { tag: "column_set"; flex_mode?: string; columns: CardColumn[] };

export interface CardButton {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type?: "primary" | "default" | "danger";
  behaviors: { type: "callback"; value: Record<string, unknown> }[];
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
    tag: "markdown",
    content,
  };
}

export function createActionButton(
  text: string,
  value: Record<string, unknown>,
  type: "primary" | "default" | "danger" = "default",
): CardElement {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    behaviors: [{ type: "callback", value }],
  };
}

export function createDividerBlock(): CardElement {
  return { tag: "hr" };
}

export function createNoteBlock(content: string): CardElement {
  return createMarkdownBlock(content);
}

export function buildCard(
  header: CardHeader,
  elements: CardElement[],
): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "fill" },
    header,
    body: { elements },
  };
}
