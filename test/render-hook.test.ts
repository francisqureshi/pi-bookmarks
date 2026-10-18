import assert from "node:assert/strict";
import { test } from "node:test";
import { readTranscript } from "../src/transcript.ts";
import { makeHost } from "./support.ts";

test("observing layout width restores the document's exact render descriptor", (t) => {
  const host = makeHost({ scrollbar: "always" });
  t.after(host.stop);
  const before = Object.getOwnPropertyDescriptor(host.document, "render");
  const original = host.document.render;
  const snapshot = readTranscript(host.tui);
  assert.ok(snapshot.lines.length);
  assert.equal(host.document.render, original);
  assert.deepEqual(Object.getOwnPropertyDescriptor(host.document, "render"), before);
});

test("an exception during layout observation leaves no render hook installed", (t) => {
  const host = makeHost();
  t.after(host.stop);
  const descriptor = Object.getOwnPropertyDescriptor(host.document, "render");
  const documentRender = host.document.render;
  const tuiRender = host.tui.render;
  host.tui.render = () => { throw new Error("simulated layout failure"); };
  try {
    assert.throws(() => readTranscript(host.tui), /simulated layout failure/);
    assert.equal(host.document.render, documentRender);
    assert.deepEqual(Object.getOwnPropertyDescriptor(host.document, "render"), descriptor);
  } finally {
    host.tui.render = tuiRender;
  }
});
