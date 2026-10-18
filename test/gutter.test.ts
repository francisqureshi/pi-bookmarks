import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createAnchor, resolveAnchor } from "../src/anchors.ts";
import { decorateMarks, installGutter, overlayPadding, unmarkedLines } from "../src/gutter.ts";
import { readTranscript } from "../src/transcript.ts";
import { makeHost, sampleText } from "./support.ts";

const raw = sampleText(20).split("\n").map((line) => ` ${line} `);

test("overlay uses only an existing blank first cell, with no added columns", () => {
  for (const line of [" padded text", "  more padding", " \u4e16\u754c", " e\u0301", " \u{1f642}"]) {
    const result = overlayPadding(line, "q");
    assert.equal(result, `q${line.slice(1)}`);
    assert.equal(visibleWidth(result), visibleWidth(line));
  }
  for (const line of ["no padding", "", "\tindented", "\u4e16text", "\u{1f642}text"]) {
    assert.equal(overlayPadding(line, "q"), line);
  }
  for (const label of ["too long", "\u4e16", "", "\x1b[31mq", "\n"]) {
    assert.equal(overlayPadding(" content", label), " content");
  }
});

test("ANSI, hyperlinks and OSC133 prompt zones are retained in original order", () => {
  const controls = "\x1b]133;A\x07\x1b[31m\x1b]8;;https://example.com/with%20spaces\x07";
  const suffix = "the text\x1b]8;;\x07\x1b[0m";
  const source = `${controls} ${suffix}`;
  assert.equal(overlayPadding(source, "q"), `${controls}q${suffix}`);
  assert.ok(overlayPadding(source, "q").startsWith("\x1b]133;A\x07"));
});

test("named, unnamed, and multiple marks decorate without changing raw anchors", () => {
  const q = createAnchor(raw, 4);
  const a = createAnchor(raw, 8);
  const marks = new Map([["q", q], ["default", a]]);
  const display = decorateMarks(raw, marks);
  assert.ok(display[4].startsWith("q"));
  assert.ok(display[8].startsWith("•"));
  assert.deepEqual(unmarkedLines(display), raw);
  assert.equal(resolveAnchor(unmarkedLines(display), q), 4);
  marks.set("b", q);
  assert.ok(decorateMarks(raw, marks)[4].startsWith("*"));
  assert.equal(display.length, raw.length);
  assert.ok(display.every((line, i) => visibleWidth(line) === visibleWidth(raw[i])));
});

test("missing, ambiguous, invalid, or unpadded marks are skipped silently", () => {
  const anchor = createAnchor(raw, 4);
  assert.equal(decorateMarks(raw, new Map()), raw);
  assert.equal(decorateMarks([...raw, ...raw], new Map([["q", anchor]])).some((line) => line.startsWith("q")), false);
  assert.equal(decorateMarks([" unrelated output"], new Map([["q", anchor]]))[0], " unrelated output");
  const unpadded = raw.map((line) => line.slice(1));
  assert.deepEqual(decorateMarks(unpadded, new Map([["q", anchor]])), unpadded);
  assert.equal(decorateMarks(raw, new Map([["invalid name", anchor]])), raw);
});

for (const scrollbar of ["hidden", "auto", "always"] as const) {
  test(`real ${scrollbar} layout shows mark while snapshots remain unmarked`, (t) => {
    const host = makeHost({ scrollbar, padding: 1 }); t.after(host.stop);
    host.tui.scrollToTop(); host.tui.scrollBy(40);
    const before = readTranscript(host.tui);
    const anchor = createAnchor(before.lines, before.topRow);
    const marks = new Map([["q", anchor]]);
    const cleanup = installGutter(host.tui, () => marks); t.after(cleanup);
    const decorated = readTranscript(host.tui);
    assert.ok(stripTerminalSequences(host.tui.getScreenLines()[0]).startsWith("q"));
    assert.deepEqual(decorated.lines, before.lines, "annotations must not contaminate text anchors");
    assert.equal(resolveAnchor(decorated.lines, anchor), 40);
    host.tui.scrollToBottom();
    const latest = readTranscript(host.tui);
    host.tui.scrollBy(resolveAnchor(latest.lines, anchor) - host.tui.viewportTop);
    assert.equal(readTranscript(host.tui).topRow, 40);
    assert.ok(stripTerminalSequences(host.tui.getScreenLines()[0]).startsWith("q"));
  });
}

test("markers re-anchor after resize without narrowing the document", (t) => {
  const host = makeHost({ padding: 1 }); t.after(host.stop);
  host.tui.scrollToTop(); host.tui.scrollBy(40);
  const saved = readTranscript(host.tui);
  const anchor = createAnchor(saved.lines, saved.topRow);
  const cleanup = installGutter(host.tui, () => new Map([["q", anchor]])); t.after(cleanup);
  host.terminal.columns = 47; host.terminal.onResize();
  const snapshot = readTranscript(host.tui);
  const row = resolveAnchor(snapshot.lines, anchor);
  assert.notEqual(row, saved.topRow);
  host.tui.scrollBy(row - host.tui.viewportTop);
  readTranscript(host.tui);
  assert.ok(stripTerminalSequences(host.tui.getScreenLines()[0]).startsWith("q"));
  cleanup();
  const without = readTranscript(host.tui);
  assert.deepEqual(snapshot.lines, without.lines);
});

test("cleanup restores the exact render descriptor, including after a snapshot", (t) => {
  const host = makeHost({ padding: 1 }); t.after(host.stop);
  const descriptor = Object.getOwnPropertyDescriptor(host.document, "render");
  const original = host.document.render;
  const anchor = createAnchor(readTranscript(host.tui).lines, host.tui.viewportTop);
  const cleanup = installGutter(host.tui, () => new Map([["q", anchor]]));
  readTranscript(host.tui);
  assert.notEqual(host.document.render, original);
  cleanup(); cleanup();
  assert.equal(host.document.render, original);
  assert.deepEqual(Object.getOwnPropertyDescriptor(host.document, "render"), descriptor);
});

test("cache invalidates for mark changes and clearing, without mutating source arrays", (t) => {
  const host = makeHost({ padding: 1 }); t.after(host.stop);
  const source = readTranscript(host.tui).lines;
  const anchor = createAnchor(source, 40);
  const marks = new Map([["q", anchor]]);
  const cleanup = installGutter(host.tui, () => marks); t.after(cleanup);
  const first = host.document.render(80);
  assert.equal(host.document.render(80), first, "unchanged renders reuse annotation output");
  marks.set("a", anchor);
  const multi = host.document.render(80);
  assert.notEqual(first, multi);
  assert.ok(multi[40].startsWith("*"));
  assert.ok(source[40].startsWith(" "));
  marks.clear();
  assert.ok(host.document.render(80)[40].startsWith(" "));
});

test("later wrappers are not clobbered and deactivated gutter hooks become inert", (t) => {
  const host = makeHost({ padding: 1 }); t.after(host.stop);
  const anchor = createAnchor(readTranscript(host.tui).lines, 40);
  const cleanup = installGutter(host.tui, () => new Map([["q", anchor]]));
  const gutter = host.document.render;
  const wrapper = (width: number) => gutter(width);
  host.document.render = wrapper;
  assert.ok(host.document.render(80)[40].startsWith("q"));
  cleanup();
  assert.equal(host.document.render, wrapper);
  assert.ok(host.document.render(80)[40].startsWith(" "));
});
