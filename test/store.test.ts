import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentAnchor } from "../src/anchors.ts";
import { isMarkName, restoreMarks, serializeMarks } from "../src/store.ts";

const anchor: ContentAnchor = Object.freeze({
  version: 1, before: "", after: "abcdefghijklmnopqrstuvwxyz0123456789", blankRows: 0, preview: "first",
});
const second: ContentAnchor = Object.freeze({ ...anchor, preview: "second" });
const entry = (data: unknown) => ({ type: "custom", customType: "pi-bookmarks", data });
const snapshot = (marks: Record<string, ContentAnchor>) => entry({ version: 2, marks });

test("mark names are default or exactly one lowercase ASCII letter", () => {
  for (const name of ["default", ..."abcdefghijklmnopqrstuvwxyz"]) assert.equal(isMarkName(name), true);
  for (const name of ["", "A", "ab", "Default", "__proto__", "constructor", "é", "a\n"]) {
    assert.equal(isMarkName(name), false);
  }
});

test("migrates v1 save and clear as whole snapshots, including after v2", () => {
  const saved = entry({ version: 1, anchor });
  assert.deepEqual(restoreMarks([saved]), new Map([["default", anchor]]));
  assert.deepEqual(restoreMarks([saved, entry({ version: 1, anchor: null })]), new Map());
  assert.deepEqual(restoreMarks([snapshot({ a: second }), saved]), new Map([["default", anchor]]));
  assert.deepEqual(restoreMarks([snapshot({ a: second }), entry({ version: 1, anchor: null })]), new Map());
});

test("named snapshots replace all marks, allow removing one, and allow clearing all", () => {
  const initial = snapshot({ default: anchor, a: second });
  assert.deepEqual(restoreMarks([initial]), new Map([["default", anchor], ["a", second]]));
  assert.deepEqual(restoreMarks([initial, snapshot({ a: second })]), new Map([["a", second]]));
  assert.deepEqual(restoreMarks([initial, snapshot({ b: anchor })]), new Map([["b", anchor]]));
  assert.deepEqual(restoreMarks([initial, snapshot({})]), new Map());
});

test("invalid newer persistence clears instead of reviving older marks", () => {
  const invalid: unknown[] = [
    null, undefined, [], "bad", {}, { marks: {} }, { version: 3, marks: {} },
    { version: 2 }, { version: 2, marks: [] }, { version: 2, marks: null },
    { version: 2, marks: {}, extra: true }, { version: 1, anchor, extra: true },
    { version: 1, anchor: {} }, { version: 2, marks: { a: anchor, b: {} } },
    { version: 2, marks: { A: anchor } }, { version: 2, marks: { constructor: anchor } },
    { version: 2, marks: JSON.parse(`{"__proto__":${JSON.stringify(anchor)}}`) },
    { version: 2, marks: Object.create({ a: anchor }) },
    Object.create({ version: 2, marks: { a: anchor } }),
    { version: 2, marks: { [Symbol("a")]: anchor } },
  ];
  for (const data of invalid) {
    assert.deepEqual(restoreMarks([snapshot({ default: anchor }), entry(data)]), new Map());
  }
});

test("only matching custom entries in the supplied branch count", () => {
  assert.deepEqual(restoreMarks([]), new Map());
  assert.deepEqual(restoreMarks([
    snapshot({ a: anchor }),
    { type: "message", customType: "pi-bookmarks", data: null },
    { type: "custom", customType: "another-extension", data: null },
  ]), new Map([["a", anchor]]));
});

test("serialization is prototype-safe, pure, and survives JSON round-trip", () => {
  const marks = new Map([["default", anchor], ["a", second]]);
  const before = [...marks];
  const saved = serializeMarks(marks);
  assert.equal(saved.version, 2);
  assert.equal(Object.getPrototypeOf(saved.marks), null);
  assert.deepEqual([...marks], before);
  assert.deepEqual(restoreMarks([entry(JSON.parse(JSON.stringify(saved)))]), marks);
  delete saved.marks.a;
  assert.deepEqual([...marks], before);
  assert.deepEqual(restoreMarks([entry(serializeMarks(new Map()))]), new Map());
});

test("all 27 names fit in a snapshot", () => {
  const marks = new Map(["default", ..."abcdefghijklmnopqrstuvwxyz"].map(name => [name, anchor]));
  assert.equal(marks.size, 27);
  assert.deepEqual(restoreMarks([entry(serializeMarks(marks))]), marks);
});

test("serialization rejects invalid names and anchors without mutating input", () => {
  for (const name of ["__proto__", "A", "aa", "constructor", ""]) {
    const marks = new Map([[name, anchor]]);
    assert.throws(() => serializeMarks(marks), /invalid/);
    assert.deepEqual([...marks], [[name, anchor]]);
  }
  const invalid = { ...anchor, after: "short" };
  assert.throws(() => serializeMarks(new Map([["a", invalid]])), /invalid/);
});
