import { sliceByColumn, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { createAnchorResolver, type ContentAnchor } from "./anchors.ts";

// Rendering annotations never become content anchors. Keep the original frame
// separate instead of trying to strip mark letters out of arbitrary text.
const rawFrames = new WeakMap<string[], string[]>();
export const unmarkedLines = (lines: string[]): string[] => rawFrames.get(lines) ?? lines;

/** Replace only a literal first-column space, preserving all leading controls. */
export function overlayPadding(line: string, label: string): string {
  if (visibleWidth(label) !== 1 || /[\x00-\x1f\x7f]/.test(label)) return line;
  const prefix = sliceByColumn(line, 0, 1, true);
  if (!prefix.endsWith(" ") || stripTerminalSequences(prefix) !== " " || !line.startsWith(prefix)) return line;
  return prefix.slice(0, -1) + label + line.slice(prefix.length);
}

/** One existing column, no width reservation, and no rewriting source content. */
export function decorateMarks(lines: string[], marks: ReadonlyMap<string, ContentAnchor>): string[] {
  if (marks.size === 0) return lines;
  const resolve = createAnchorResolver(lines.map(stripTerminalSequences));
  const labels = new Map<number, string[]>();
  for (const [name, anchor] of marks) {
    if (name !== "default" && !/^[a-z]$/.test(name)) continue;
    try {
      const row = resolve(anchor);
      const atRow = labels.get(row) ?? [];
      atRow.push(name === "default" ? "•" : name);
      labels.set(row, atRow);
    } catch {
      // Missing/ambiguous marks are not rendered. Only explicit jump attempts
      // warn; streaming output must never generate a notification every frame.
    }
  }
  let decorated: string[] | undefined;
  for (const [row, names] of labels) {
    const source = lines[row];
    if (source === undefined) continue;
    const line = overlayPadding(source, names.length === 1 ? names[0] : "*");
    if (line !== source) {
      decorated ??= lines.slice();
      decorated[row] = line;
    }
  }
  if (decorated) rawFrames.set(decorated, lines);
  return decorated ?? lines;
}

/**
 * Pi's first document child is the same compatibility seam as readTranscript.
 * The hook is owned by this connection and removed on reload/shutdown. A later
 * wrapper is never overwritten: deactivation makes our retained hook inert.
 */
export function installGutter(tui: TUI, getMarks: () => ReadonlyMap<string, ContentAnchor>): () => void {
  const document = tui.children[0];
  if (!document) return () => {};
  const original = document.render;
  const descriptor = Object.getOwnPropertyDescriptor(document, "render");
  let active = true;
  let cache: { source: string[]; marks: Map<string, ContentAnchor>; width: number; display: string[] } | undefined;
  const render = (width: number): string[] => {
    const source = unmarkedLines(original.call(document, width));
    if (!active || tui.mode !== "fullscreen") return source;
    const marks = getMarks();
    if (cache && cache.width === width && cache.marks.size === marks.size &&
      [...marks].every(([name, anchor]) => cache!.marks.get(name) === anchor) &&
      cache.source.length === source.length && cache.source.every((line, i) => line === source[i])) {
      return cache.display;
    }
    const display = decorateMarks(source, marks);
    cache = { source: source.slice(), marks: new Map(marks), width, display };
    return display;
  };
  try {
    Object.defineProperty(document, "render", { configurable: true, writable: true, value: render });
  } catch {
    return () => {}; // An immutable/unsupported document still supports shortcuts.
  }
  tui.requestRender();
  return () => {
    if (!active) return;
    active = false;
    cache = undefined;
    if (document.render === render) {
      if (descriptor) Object.defineProperty(document, "render", descriptor);
      else Reflect.deleteProperty(document, "render");
    }
    tui.requestRender();
  };
}
