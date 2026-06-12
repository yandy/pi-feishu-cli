import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { buildDialogCard } from "./cards/dialog.js";
import { getFeishuContext } from "./context.js";

interface PendingDialog {
  resolve: (value: string | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
  headerTitle: string;
  headerTemplate: string;
}

const pendingDialogs = new Map<string, PendingDialog>();

export function resolveFeishuDialog(
  value: Record<string, unknown>,
): { choice: string; headerTitle: string; headerTemplate: string } | undefined {
  const dialogId = value.dialog_id as string | undefined;
  const choice = value.dialog_choice as string | undefined;
  if (!dialogId) return;
  const dialog = pendingDialogs.get(dialogId);
  if (dialog) {
    pendingDialogs.delete(dialogId);
    clearTimeout(dialog.timer);
    dialog.resolve(choice);
    return {
      choice: choice ?? "",
      headerTitle: dialog.headerTitle,
      headerTemplate: dialog.headerTemplate,
    };
  }
}

export function createFeishuUIContext(): ExtensionUIContext {
  return {
    async confirm(title, message, opts) {
      const fullMessage = message ? `${title}\n\n${message}` : title;
      const result = await this.select(fullMessage, ["是", "否"], opts);
      return result === "是";
    },

    async select(title, options, opts) {
      const ctx = getFeishuContext();
      if (!ctx) return options[0];

      const dialogId = crypto.randomUUID();
      const { card, headerTitle, headerTemplate } = buildDialogCard(
        title,
        options,
        dialogId,
      );

      return new Promise<string | undefined>((resolve) => {
        const timeout = opts?.timeout ?? 60000;
        const timer = setTimeout(() => {
          pendingDialogs.delete(dialogId);
          resolve(undefined);
        }, timeout);

        pendingDialogs.set(dialogId, {
          resolve,
          timer,
          headerTitle,
          headerTemplate,
        });

        if (opts?.signal) {
          if (opts.signal.aborted) {
            pendingDialogs.delete(dialogId);
            clearTimeout(timer);
            resolve(undefined);
            return;
          }
          opts.signal.addEventListener(
            "abort",
            () => {
              pendingDialogs.delete(dialogId);
              clearTimeout(timer);
              resolve(undefined);
            },
            { once: true },
          );
        }
        ctx.channel.send(ctx.chatId, { card }).catch(() => {});
      });
    },

    async input(_title, _placeholder, _opts) {
      // input() via Feishu chat requires capturing the user's next text message,
      // which needs a per-message one-shot listener that's not yet implemented.
      return undefined;
    },

    notify(message, type) {
      const ctx = getFeishuContext();
      if (ctx) {
        const prefix = type === "error" ? "❌" : type === "warning" ? "⚠️" : "ℹ️";
        ctx.channel
          .send(ctx.chatId, { text: `${prefix} ${message}` })
          .catch(() => {});
      }
    },

    onTerminalInput() {
      return () => {};
    },
    setStatus() {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    async custom() {
      return undefined as never;
    },
    pasteToEditor() {},
    setEditorText() {},
    getEditorText() {
      return "";
    },
    async editor() {
      return undefined;
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() {
      return undefined;
    },
    get theme() {
      return {} as any;
    },
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false, error: "Not available in feishu mode" };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };
}
