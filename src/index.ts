import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen, type TUI } from "@earendil-works/pi-tui";
import { createAnchor, resolveAnchor, type ContentAnchor } from "./anchors.ts";
import { isMarkName, restoreMarks, serializeMarks } from "./store.ts";
import { installGutter } from "./gutter.ts";
import { readTranscript } from "./transcript.ts";
import { createVimMarkInput } from "./vim-input.ts";

const STATE_KEY = "pi-bookmarks";
const WIDGET_KEY = "pi-bookmarks-connection";
const USAGE = "Usage: /bookmark [a-z], /bookmark jump [a-z], /bookmark clear [a-z]";
type Action = "set" | "jump" | "clear";

export default function bookmarks(pi: ExtensionAPI): void {
  let tui: TUI | undefined;
  let marks = new Map<string, ContentAnchor>();
  let unsubscribe: (() => void) | undefined;
  let resetVimInput: (() => void) | undefined;
  let removeGutter: (() => void) | undefined;

  const restore = (ctx: ExtensionContext) => {
    marks = restoreMarks(ctx.sessionManager.getBranch());
    resetVimInput?.();
    tui?.requestRender();
  };

  const save = (next: Map<string, ContentAnchor>) => {
    // Change local state only after successful persistence.
    pi.appendEntry(STATE_KEY, serializeMarks(next));
    marks = next;
    tui?.requestRender();
  };

  const run = (ctx: ExtensionContext, action: Action, name = "default") => {
    try {
      if (ctx.mode !== "tui") throw new Error("Bookmarks require Pi's fullscreen terminal UI.");
      if (!isMarkName(name)) throw new Error("Mark names must be a single lowercase letter (a-z).");
      if (action === "clear") {
        const next = new Map(marks);
        next.delete(name);
        save(next);
        return;
      }
      const anchor = marks.get(name);
      if (action === "jump" && !anchor) {
        throw new Error(name === "default"
          ? "No bookmark on this branch. Scroll to a line and press Ctrl+Alt+B."
          : `Mark '${name}' is not set on this branch.`);
      }
      const snapshot = readTranscript(tui);
      if (action === "set") {
        const next = new Map(marks);
        next.set(name, createAnchor(snapshot.lines, snapshot.topRow));
        save(next);
      } else if (anchor) {
        const row = resolveAnchor(snapshot.lines, anchor);
        snapshot.renderer.scrollBy(row - snapshot.renderer.viewportTop);
        snapshot.renderer.renderNow();
      }
      // No footer, widget text, or success notice; only the in-transcript mark.
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
    }
  };

  pi.on("session_start", (_event, ctx) => {
    unsubscribe?.();
    unsubscribe = undefined;
    resetVimInput?.();
    resetVimInput = undefined;
    removeGutter?.();
    removeGutter = undefined;
    tui = undefined;
    restore(ctx);
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_KEY, (activeTui) => {
      tui = activeTui;
      const cleanup = installGutter(activeTui, () => marks);
      removeGutter = cleanup;
      return { render: () => [], invalidate: () => {}, dispose: cleanup };
    });
    const input = createVimMarkInput(
      () => tui instanceof TuiAltScreen && !tui.hasOverlay() ? tui.getFocusedComponent() : undefined,
      (action, name) => run(ctx, action, name),
      () => {
        if (tui instanceof TuiAltScreen) {
          tui.scrollToBottom();
          tui.renderNow();
        }
      },
    );
    resetVimInput = input.reset;
    unsubscribe = ctx.ui.onTerminalInput(input.handleInput);
  });
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    unsubscribe?.();
    unsubscribe = undefined;
    resetVimInput?.();
    resetVimInput = undefined;
    removeGutter?.();
    removeGutter = undefined;
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
    tui = undefined;
    marks = new Map();
  });

  pi.registerShortcut("ctrl+alt+b", {
    description: "Bookmark the top visible transcript line",
    handler: (ctx) => { resetVimInput?.(); run(ctx, "set"); },
  });
  pi.registerShortcut("ctrl+alt+j", {
    description: "Jump to the unnamed transcript bookmark",
    handler: (ctx) => { resetVimInput?.(); run(ctx, "jump"); },
  });
  pi.registerCommand("bookmark", {
    description: "Save [a-z], jump [a-z], or clear [a-z]; omit the name for the unnamed bookmark",
    getArgumentCompletions: (prefix) => {
      const names = [...marks.keys()].filter((name) => name !== "default").sort();
      return ["jump", "clear", ...names, ...names.map((name) => `jump ${name}`), ...names.map((name) => `clear ${name}`)]
        .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      resetVimInput?.();
      const words = args.trim().split(/\s+/).filter(Boolean);
      const first = words[0];
      const action: Action = first === "jump" || first === "clear" ? first : "set";
      if (action !== "set") words.shift();
      if (words.length > 1 || (words[0] !== undefined && !isMarkName(words[0]))) {
        if (ctx.hasUI) ctx.ui.notify(USAGE, "warning");
        return;
      }
      run(ctx, action, words[0]);
    },
  });
}
