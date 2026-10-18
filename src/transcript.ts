import { TuiAltScreen, sliceByColumn, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { unmarkedLines } from "./gutter.ts";

export interface TranscriptSnapshot {
  renderer: TuiAltScreen;
  lines: string[];
  topRow: number;
}

/**
 * Pi 1.3 mounts the transcript document as its first public TUI child. That is
 * not a dedicated extension API: isolate the convention and verify the screen.
 * Observe the document's public render call during a synchronous layout render
 * to learn the real content width (including reserved scrollbar space). Guessing
 * from short visible lines can produce incorrect offscreen row coordinates.
 */
export function readTranscript(tui: TUI | undefined): TranscriptSnapshot {
  if (!(tui instanceof TuiAltScreen) || tui.mode !== "fullscreen") {
    throw new Error("Bookmarks require Pi's fullscreen mode.");
  }
  if (tui.hasOverlay()) throw new Error("Close the open dialog before using a bookmark.");

  tui.renderNow();
  const document = tui.children[0];
  if (!document) throw new Error("Pi's transcript document is not available yet.");

  const width = tui.terminal.columns;
  const observed = new Map<number, string[]>();
  const original = document.render;
  const descriptor = Object.getOwnPropertyDescriptor(document, "render");
  // No persistent hook: restore the exact property descriptor even on failure.
  Object.defineProperty(document, "render", {
    configurable: true,
    value(contentWidth: number) {
      const lines = original.call(document, contentWidth);
      observed.set(contentWidth, lines);
      return lines;
    },
  });
  try {
    tui.render(width);
  } finally {
    if (descriptor) Object.defineProperty(document, "render", descriptor);
    else Reflect.deleteProperty(document, "render");
  }
  if (observed.size !== 1) {
    throw new Error("Cannot determine Pi's transcript wrapping reliably; no bookmark navigation was attempted.");
  }
  const rendered = observed.values().next().value;
  if (!rendered) throw new Error("Pi's transcript document is not available yet.");
  const topRow = tui.viewportTop;
  const screen = tui.getScreenLines();
  // Auto scrollbars overlay the final column; ignore it during verification.
  const comparable = (line: string) =>
    stripTerminalSequences(sliceByColumn(line, 0, Math.max(1, width - 1))).trimEnd();
  let score = 0;
  while (
    score < screen.length && topRow + score < rendered.length &&
    comparable(rendered[topRow + score]) === comparable(screen[score])
  ) score++;
  const matchedText = rendered.slice(topRow, topRow + score).map(comparable).join("").trim();
  if (score < Math.min(3, rendered.length - topRow) || score === 0 || !matchedText) {
    throw new Error("Cannot verify Pi's visible transcript layout; no bookmark navigation was attempted.");
  }
  return { renderer: tui, lines: unmarkedLines(rendered).map(stripTerminalSequences), topRow };
}
