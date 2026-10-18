import { Container, ScrollView, Text, TuiAltScreen, VStack, type Terminal, type ScrollViewScrollbar } from "@earendil-works/pi-tui";

/** In-memory terminal: no stdin access, escape output, or real screen changes. */
export class MemoryTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  onInput: (data: string) => void = () => {};
  onResize: () => void = () => {};
  start(onInput: (data: string) => void, onResize: () => void) {
    this.onInput = onInput;
    this.onResize = onResize;
  }
  stop() {}
  async drainInput() {}
  write(_data: string) {}
  moveBy(_lines: number) {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle(_title: string) {}
  setProgress(_active: boolean) {}
  setProgramStatus() {}
}

export function makeHost(options: { scrollbar?: ScrollViewScrollbar; text?: string } = {}) {
  const terminal = new MemoryTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  const content = new Text(options.text ?? sampleText(), 0, 0);
  const document = new Container();
  document.addChild(content);
  const editor = new Text("editor", 0, 0);
  const footer = new Text("footer", 0, 0);
  const scroll = new ScrollView(document, { primary: true, follow: "end", scrollbar: options.scrollbar ?? "hidden" });
  const root = new VStack([
    { component: scroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: new VStack([editor, footer]), basis: "auto", grow: 0, shrink: 1, minSize: 1 },
  ]);
  // Same public mounting convention as Pi 1.3's createChatViewport + mountInteractiveTui.
  tui.addChild(document);
  tui.addChild(editor);
  tui.addChild(footer);
  tui.setLayoutRoot(root);
  tui.start();
  tui.renderNow();
  return { terminal, tui, content, document, scroll, stop: () => tui.stop() };
}

export function sampleText(count = 120) {
  return Array.from({ length: count }, (_, i) =>
    `Message ${i.toString().padStart(4, "0")}: this is distinct transcript content with enough words to wrap at narrower terminal widths.`,
  ).join("\n");
}
