import assert from "node:assert/strict";
import { test } from "node:test";
import { Text, TuiMainScreen } from "@earendil-works/pi-tui";
import { createAnchor, resolveAnchor } from "../src/anchors.ts";
import { readTranscript } from "../src/transcript.ts";
import { makeHost, MemoryTerminal, sampleText } from "./support.ts";

for (const scrollbar of ["hidden", "auto", "always"] as const) {
  test(`read and restore real fullscreen output with ${scrollbar} scrollbar`, (t) => {
    const host = makeHost({ scrollbar });
    t.after(host.stop);
    host.tui.scrollToTop();
    host.tui.scrollBy(57);
    const saved = readTranscript(host.tui);
    assert.equal(saved.topRow, 57);
    const anchor = createAnchor(saved.lines, saved.topRow);
    host.tui.scrollToBottom();
    host.content.setText(`${sampleText()}\n${sampleText(30)}`);
    host.tui.requestRender();
    const latest = readTranscript(host.tui);
    const row = resolveAnchor(latest.lines, anchor);
    latest.renderer.scrollBy(row - latest.renderer.viewportTop);
    assert.equal(readTranscript(host.tui).topRow, saved.topRow);
    assert.equal(host.tui.isFollowingOutput, false);
  });
}

test("content anchor survives real Text reflow and inserted earlier content", (t) => {
  const host = makeHost();
  t.after(host.stop);
  host.tui.scrollToTop();
  host.tui.scrollBy(61);
  const saved = readTranscript(host.tui);
  const anchor = createAnchor(saved.lines, saved.topRow);
  host.tui.scrollToBottom();
  host.content.setText(`A completely new header before the old transcript.\n${sampleText()}`);
  host.terminal.columns = 43;
  host.terminal.onResize();
  const resized = readTranscript(host.tui);
  const row = resolveAnchor(resized.lines, anchor);
  assert.notEqual(row, saved.topRow);
  host.tui.scrollBy(row - host.tui.viewportTop);
  const returned = readTranscript(host.tui);
  assert.equal(returned.topRow, row);
  assert.ok(returned.lines.slice(row).join("").replace(/\s/g, "").includes(anchor.after));
});

test("missing or ambiguous content never moves the viewport", (t) => {
  const host = makeHost();
  t.after(host.stop);
  host.tui.scrollToTop();
  host.tui.scrollBy(50);
  const saved = readTranscript(host.tui);
  const anchor = createAnchor(saved.lines, saved.topRow);
  host.tui.scrollToBottom();
  host.content.setText(`${sampleText()}\n${sampleText()}`);
  const repeated = readTranscript(host.tui);
  const position = repeated.topRow;
  assert.throws(() => resolveAnchor(repeated.lines, anchor), /ambiguous/i);
  assert.equal(host.tui.viewportTop, position);
  host.content.setText("entirely unrelated output ".repeat(300));
  const replaced = readTranscript(host.tui);
  assert.throws(() => resolveAnchor(replaced.lines, anchor), /missing/i);
  assert.equal(host.tui.viewportTop, replaced.topRow);
});

test("regular mode, missing renderer, and open overlays are refused", (t) => {
  const regular = new TuiMainScreen(new MemoryTerminal());
  assert.throws(() => readTranscript(regular), /fullscreen/i);
  assert.throws(() => readTranscript(undefined), /fullscreen/i);
  const host = makeHost();
  t.after(host.stop);
  const overlay = host.tui.showOverlay(new Text("dialog", 0, 0));
  assert.throws(() => readTranscript(host.tui), /close the open dialog/i);
  overlay.hide();
  assert.ok(readTranscript(host.tui).lines.length);
});

test("unrecognized component mounting fails closed", (t) => {
  const host = makeHost();
  t.after(host.stop);
  const actualDocument = host.tui.children[0];
  host.tui.children[0] = new Text("not the transcript", 0, 0);
  assert.throws(() => readTranscript(host.tui), /cannot (verify|determine)/i);
  host.tui.children[0] = actualDocument;
  assert.ok(readTranscript(host.tui).lines.length);
});
