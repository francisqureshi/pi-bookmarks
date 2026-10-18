import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnchor, resolveAnchor } from "../src/anchors.ts";
import { readTranscript } from "../src/transcript.ts";
import { makeHost } from "./support.ts";

test("short visible lines cannot disguise offscreen wrapping with a reserved scrollbar", (t) => {
  const headers = Array.from({ length: 30 }, (_, i) => `Short header ${i}`);
  const body = Array.from({ length: 100 }, (_, i) => `${i.toString().padStart(4, "0")}: ${"abcdefghij".repeat(8)}`.slice(0, 80));
  const host = makeHost({ scrollbar: "always", text: [...headers, ...body].join("\n") });
  t.after(host.stop);
  host.tui.scrollToTop(); host.tui.scrollBy(80);
  const saved = readTranscript(host.tui);
  const anchor = createAnchor(saved.lines, saved.topRow);
  host.tui.scrollToTop();
  const atTop = readTranscript(host.tui);
  const actual = host.document.render(host.scroll.getContentWidth(host.terminal.columns));
  assert.equal(atTop.lines.length, actual.length);
  assert.equal(resolveAnchor(atTop.lines, anchor), 80);
});
