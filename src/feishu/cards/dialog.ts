import type { CardElement } from "./helpers.js";
import {
  buildCard,
  createActionButton,
  createCardHeader,
  createDividerBlock,
  createMarkdownBlock,
} from "./helpers.js";

const MAX_HEADER_CHARS = 20;
const MAX_BUTTON_TEXT = 40;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 2) + "..";
}

export function buildDialogCard(
  title: string,
  options: string[],
  dialogId: string,
): { card: Record<string, unknown>; headerTitle: string; headerTemplate: string } {
  const headerTitle = truncate(title.replace(/\n/g, ""), MAX_HEADER_CHARS);
  const headerTemplate = "red";

  const elements: CardElement[] = [
    createMarkdownBlock(title.replace(/\n/g, "\n\n")),
    createDividerBlock(),
  ];
  for (const option of options) {
    elements.push(
      createActionButton(
        truncate(option, MAX_BUTTON_TEXT),
        {
          cmd: "feishu_dialog",
          dialog_id: dialogId,
          dialog_choice: option,
        },
        "default",
      ),
    );
  }

  const card = buildCard(
    createCardHeader(headerTitle, headerTemplate),
    elements,
  );

  return { card, headerTitle, headerTemplate };
}

export function buildDialogResultCard(
  headerTitle: string,
  headerTemplate: string,
  choice: string,
): Record<string, unknown> {
  return buildCard(
    createCardHeader(headerTitle, headerTemplate),
    [createMarkdownBlock(`已选择: **${choice}**`)],
  );
}
