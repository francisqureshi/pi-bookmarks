import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { createVimMarkInput, isIdleVimNormal } from "../src/vim-input.ts";
import { makeHost } from "./support.ts";

type VimEditor = CustomEditor & { getMode(): string; setClipboardMirrorPolicy(policy: "never"): void };
type Constructor = new (...args: ConstructorParameters<typeof CustomEditor>) => VimEditor;
const jiti = createJiti(import.meta.url);
const { ModalEditor } = await jiti.import<{ ModalEditor: Constructor }>(
  fileURLToPath(new URL("../node_modules/pi-vim/index.ts", import.meta.url)),
);
const identity = (text: string) => text;
const theme = {
  borderColor: identity,
  selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity },
};

function setup() {
  const host = makeHost();
  const editor = new ModalEditor(host.tui, theme, new KeybindingsManager());
  editor.setClipboardMirrorPolicy("never");
  const actions: [string, string][] = [];
  let focused: unknown = editor;
  let endCalls = 0;
  const input = createVimMarkInput(() => focused, (action, name) => actions.push([action, name]), () => { endCalls++; });
  const send = (data: string) => {
    const result = input.handleInput(data);
    if (!result?.consume) editor.handleInput(data);
    return result;
  };
  const type = (text: string) => { for (const key of text) send(key); };
  const normal = () => { send("\x1b"); assert.equal(editor.getMode(), "normal"); };
  return { host, editor, input, actions, send, type, normal, endCalls: () => endCalls, focus: (next: unknown) => { focused = next; } };
}

test("real pi-vim normal mode accepts two-key named marks without editing", (t) => {
  const h = setup(); t.after(h.host.stop);
  h.editor.setText("an untouched prompt"); h.normal();
  const cursor = h.editor.getCursor();
  assert.equal(isIdleVimNormal(h.editor), true);
  h.type("mq'qma'a");
  assert.deepEqual(h.actions, [["set", "q"], ["jump", "q"], ["set", "a"], ["jump", "a"]]);
  assert.equal(h.editor.getText(), "an untouched prompt");
  assert.deepEqual(h.editor.getCursor(), cursor);
});

test("insert and both visual modes never activate marks", (t) => {
  const h = setup(); t.after(h.host.stop);
  h.type("mq'q");
  assert.equal(h.editor.getText(), "mq'q");
  h.normal(); h.type("vmq'q"); h.send("\x1b");
  h.type("Vma'a"); h.send("\x1b");
  assert.deepEqual(h.actions, []);
});

test("EX remains normal in public getMode but its input is not intercepted", (t) => {
  const h = setup(); t.after(h.host.stop);
  h.normal(); h.type(":bookmark mq'q");
  assert.equal(h.editor.getMode(), "normal");
  assert.equal(isIdleVimNormal(h.editor), false);
  assert.deepEqual(h.actions, []);
  h.send("\x1b");
  assert.equal(isIdleVimNormal(h.editor), true);
  h.type("mq");
  assert.deepEqual(h.actions, [["set", "q"]]);
});

for (const sequence of ["fmq", "tmq", "f'q", "rma", "dmq", "cmq", "ymq", "2mq", "gmq", "di'q"]) {
  test(`pending Vim command ${JSON.stringify(sequence)} owns its arguments`, (t) => {
    const h = setup(); t.after(h.host.stop);
    h.editor.setText("a 'quoted' m word with many characters"); h.normal();
    h.type(sequence);
    assert.deepEqual(h.actions, []);
  });
}

test("pasted text and multi-character chunks cannot create marks", (t) => {
  const h = setup(); t.after(h.host.stop); h.normal();
  h.send("mq"); h.send("'q");
  h.send("\x1b[200~mq'q\x1b[201~");
  h.send("\x1b[200~"); h.type("mq'q"); h.send("\x1b[201~");
  assert.deepEqual(h.actions, []);
  assert.equal(h.editor.getMode(), "normal");
});

test("Escape cancels the prefix without reaching Pi's abort key", (t) => {
  const h = setup(); t.after(h.host.stop); h.normal();
  assert.deepEqual(h.send("m"), { consume: true });
  assert.deepEqual(h.send("\x1b"), { consume: true });
  h.type("q");
  assert.deepEqual(h.actions, []);
});

test("focus, mode, and explicit resets cancel pending prefixes", (t) => {
  const h = setup(); t.after(h.host.stop); h.normal();
  h.type("m"); h.focus({}); h.type("q"); h.focus(h.editor);
  h.type("m"); h.editor.handleInput("i"); h.type("q");
  assert.equal(h.editor.getText(), "q");
  h.normal(); h.type("m"); h.input.reset(); h.type("q");
  assert.deepEqual(h.actions, []);
});

test("Kitty printable keys work and releases/repeats do not complete prefixes", (t) => {
  const h = setup(); t.after(h.host.stop); h.normal();
  h.send("\x1b[109u");
  h.send("\x1b[109;1:2u");
  h.send("\x1b[109;1:3u");
  h.send("\x1b[113u");
  h.send("\x1b[39u"); h.send("\x1b[113u");
  assert.deepEqual(h.actions, [["set", "q"], ["jump", "q"]]);
  assert.equal(h.editor.getText(), "", "intercepted key repeats must not leak into the prompt");
});

test("prefix and mark-name repeats stay consumed until their releases", (t) => {
  const h = setup(); t.after(h.host.stop);
  h.editor.setText("prompt"); h.normal();
  h.send("\x1b[109u"); h.send("\x1b[109;1:2u"); h.send("\x1b[113u");
  h.send("\x1b[113;1:2u"); h.send("\x1b[109;1:2u");
  assert.equal(h.editor.getText(), "prompt");
  assert.deepEqual(h.actions, [["set", "q"]]);
  h.send("\x1b[109;1:3u"); h.send("\x1b[113;1:3u");
  h.send("\x1b[109u"); h.send("\x1b[113u");
  assert.deepEqual(h.actions, [["set", "q"], ["set", "q"]]);
  assert.equal(h.editor.getText(), "prompt");
});

test("unknown editor shapes fail open without swallowing typing", (t) => {
  const h = setup(); t.after(h.host.stop); h.normal();
  for (const candidate of [null, {}, { getMode: () => "normal" }, { getMode: () => { throw new Error("bad editor"); } }]) {
    h.focus(candidate);
    assert.equal(h.input.handleInput("m"), undefined);
    assert.equal(h.input.handleInput("q"), undefined);
  }
  assert.deepEqual(h.actions, []);
});

test("normal-mode Shift+G goes to transcript end without editing the prompt", (t) => {
  const h = setup(); t.after(h.host.stop);
  h.editor.setText("untouched prompt"); h.normal();
  const cursor = h.editor.getCursor();
  assert.deepEqual(h.send("G"), { consume: true });
  assert.equal(h.endCalls(), 1);
  assert.equal(h.editor.getText(), "untouched prompt");
  assert.deepEqual(h.editor.getCursor(), cursor);
});

test("capital G remains typing in insert and does not steal visual, EX, or pending commands", (t) => {
  const h = setup(); t.after(h.host.stop);
  h.type("G");
  assert.equal(h.editor.getText(), "G");
  h.normal(); h.type("vG"); h.send("\x1b");
  h.type(":someG"); h.send("\x1b");
  for (const command of ["fG", "rG", "2G", "gG", "dG"]) {
    h.type(command); h.send("\x1b");
  }
  assert.equal(h.endCalls(), 0);
});

test("Kitty Shift+G variants and captured repeats preserve prompt contents", (t) => {
  const h = setup(); t.after(h.host.stop);
  h.editor.setText("prompt"); h.normal();
  for (const press of ["\x1b[71u", "\x1b[103;2u", "\x1b[103:71;2u"]) h.send(press);
  h.send("\x1b[103:71;2:2u"); h.send("\x1b[103:71;2:3u");
  assert.equal(h.endCalls(), 3);
  assert.equal(h.editor.getText(), "prompt");
});
