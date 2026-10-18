import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnchor, resolveAnchor, isContentAnchor } from "../src/anchors.ts";

const words = Array.from({ length: 180 }, (_, i) => `word${i.toString().padStart(3, "0")}`);
const content = words.join("");
const wrap = (text: string, width: number): string[] => text.match(new RegExp(`.{1,${width}}`, "gu")) ?? [];

test("reflow and whitespace padding preserve the containing row", () => {
  const lines = wrap(content, 35);
  const anchor = createAnchor(lines, 9);
  const reflowed = wrap(content, 53).map(line => `  ${Array.from(line).join(" \t")}  `);
  assert.equal(resolveAnchor(reflowed, anchor), Math.floor(315 / 53));
  assert.equal(resolveAnchor(lines, anchor), 9);
});

test("leading blank rows are captured and subtracted after mapping", () => {
  const lines = wrap(content, 35);
  lines.splice(9, 0, "", " \t ");
  const anchor = createAnchor(lines, 9);
  assert.equal(anchor.blankRows, 2);
  assert.equal(resolveAnchor(lines, anchor), 9);
  assert.equal(resolveAnchor(wrap(content, 53), anchor), Math.floor(315 / 53));
  const atStart = createAnchor(["", " ", content], 0);
  assert.equal(resolveAnchor([content], atStart), 0);
});

test("surrounding context disambiguates identical forward text", () => {
  const repeated = "repeated-forward-text-".repeat(20);
  const lines = ["first-context-".repeat(20), repeated, "second-context-".repeat(20), repeated];
  const anchor = createAnchor(lines, 3);
  assert.equal(resolveAnchor(lines, anchor), 3);
});

test("exact duplicate context is ambiguous, including during capture", () => {
  const lines = wrap(content, 35);
  const anchor = createAnchor(lines, 9);
  assert.throws(() => resolveAnchor([...lines, ...lines], anchor), /ambiguous/i);
  assert.throws(() => createAnchor([...lines, ...lines], 9), /ambiguous/i);
});

test("missing context never falls back to the old position", () => {
  const lines = wrap(content, 35);
  const anchor = createAnchor(lines, 9);
  assert.throws(() => resolveAnchor(lines.map(() => "unrelated replacement output"), anchor), /missing/i);
  assert.throws(() => resolveAnchor([], anchor), /missing/i);
  // Even a unique unchanged forward context is insufficient when before changed.
  const changed = [...lines];
  changed[8] = "changed preceding context";
  assert.throws(() => resolveAnchor(changed, anchor), /missing/i);
});

test("inserted output before the captured context shifts the destination", () => {
  const lines = wrap(content, 35);
  const anchor = createAnchor(lines, 9);
  assert.equal(resolveAnchor(["new header", "another header", ...lines], anchor), 11);
});

test("appending output does not invalidate a short forward context", () => {
  const lines = wrap(content, 35);
  const anchor = createAnchor(lines, lines.length - 1);
  assert.equal(resolveAnchor([...lines, "newly appended output"], anchor), lines.length - 1);
});

test("end boundaries use backward context and retain trailing blanks", () => {
  const lines = wrap(content, 35);
  const end = createAnchor(lines, lines.length);
  assert.equal(end.after, "");
  assert.equal(resolveAnchor(lines, end), lines.length);
  assert.equal(resolveAnchor([...lines, "appended"], end), lines.length);
  const trailing = [...lines, "", "  "];
  const anchor = createAnchor(trailing, lines.length);
  assert.equal(anchor.blankRows, 2);
  assert.equal(resolveAnchor(trailing, anchor), lines.length);
  const reflowed = [...wrap(content, 53), "", "  "];
  assert.equal(resolveAnchor(reflowed, anchor), reflowed.length - 2);
});

test("tiny content and invalid positions are refused", () => {
  for (const lines of [[], [""], ["tiny"], [" ", "\t"], ["x".repeat(31)]]) {
    assert.throws(() => createAnchor(lines, 0), /stable text/i);
  }
  for (const row of [-1, 0.5, NaN, Infinity, 2]) {
    assert.throws(() => createAnchor([content], row), /viewport row/i);
  }
  assert.equal(resolveAnchor([content.slice(0, 32)], createAnchor([content.slice(0, 32)], 1)), 1);
});

test("persisted anchors are validated, bounded, and round-trip", () => {
  const anchor = createAnchor(wrap(content, 35), 9);
  const restored: unknown = JSON.parse(JSON.stringify(anchor));
  assert.ok(isContentAnchor(restored));
  assert.equal(resolveAnchor(wrap(content, 35), restored), 9);
  const invalid: unknown[] = [null, undefined, [], {}, "anchor", 1,
    { ...anchor, version: 2 }, { ...anchor, version: "1" },
    { ...anchor, before: "x".repeat(161) }, { ...anchor, after: "x".repeat(241) },
    { ...anchor, before: "", after: "tiny" }, { ...anchor, before: "has space" },
    { ...anchor, after: null }, { ...anchor, before: 12 },
    ...[-1, 0.5, NaN, Infinity, 1_000_001, "2"].map(blankRows => ({ ...anchor, blankRows })),
    ...[null, "", "x".repeat(81), "😀".repeat(81)].map(preview => ({ ...anchor, preview })),
  ];
  for (const value of invalid) {
    assert.equal(isContentAnchor(value), false);
    assert.throws(() => resolveAnchor([], value as typeof anchor), /invalid content anchor/i);
  }
});

test("preview truncation does not split Unicode codepoints", () => {
  const points = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x1f600 + i));
  const text = points.join("");
  const front = createAnchor([text], 0);
  const end = createAnchor([text], 1);
  assert.equal(front.preview, points.slice(0, 80).join(""));
  assert.equal(end.preview, points.slice(-80).join(""));
  assert.ok(isContentAnchor(front));
  assert.ok(isContentAnchor(end));
});

test("terminal escapes are adapter concerns, not stripped here", () => {
  const plain = "stable unique textual content for this bookmark";
  const decorated = `\u001b[31m${plain}\u001b[0m`;
  const anchor = createAnchor([decorated], 0);
  assert.equal(resolveAnchor([decorated], anchor), 0);
  assert.throws(() => resolveAnchor([plain], anchor), /missing/i);
});
