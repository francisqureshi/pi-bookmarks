import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions, SessionManager, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import bookmarks from "../src/index.ts";
import { createAnchor } from "../src/anchors.ts";
import { readTranscript } from "../src/transcript.ts";
import { makeHost } from "./support.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Shortcut = { handler: (ctx: ExtensionContext) => unknown };
type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
type TerminalListener = Parameters<ExtensionContext["ui"]["onTerminalInput"]>[0];

function harness(host: ReturnType<typeof makeHost>, manager = SessionManager.inMemory()) {
  const events = new Map<string, Handler>();
  const shortcuts = new Map<string, Shortcut>();
  const commands = new Map<string, Command>();
  const statuses: (string | undefined)[] = [];
  const notices: { message: string; type: string | undefined }[] = [];
  const widgets = new Map<string, unknown>();
  const listeners = new Set<TerminalListener>();
  const unsubscribed: TerminalListener[] = [];
  let writesFail = false;
  const api = {
    on(name: string, handler: Handler) { events.set(name, handler); return () => events.delete(name); },
    registerShortcut(key: string, shortcut: Shortcut) { shortcuts.set(key, shortcut); },
    registerCommand(name: string, command: Command) { commands.set(name, command); },
    appendEntry(customType: string, data: unknown) {
      if (writesFail) throw new Error("disk write failed");
      manager.appendCustomEntry(customType, data);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "tui", hasUI: true, sessionManager: manager,
    ui: {
      setStatus(_key: string, text: string | undefined) { statuses.push(text); },
      setWidget(key: string, factory: unknown) {
        widgets.set(key, factory);
        if (typeof factory === "function") {
          const widget = Reflect.apply(factory, undefined, [host.tui, {}]);
          assert.deepEqual(widget.render(80), [], "connection widget must not render feedback");
        }
      },
      notify(message: string, type?: string) { notices.push({ message, type }); },
      onTerminalInput(listener: TerminalListener) {
        listeners.add(listener);
        return () => { unsubscribed.push(listener); listeners.delete(listener); };
      },
    },
  } as unknown as ExtensionCommandContext;
  bookmarks(api);
  const emit = (event: string) => events.get(event)?.({ type: event }, ctx);
  emit("session_start");
  return {
    manager, notices, widgets, listeners, unsubscribed, ctx, emit,
    failWrites: () => { writesFail = true; },
    press: (key: string) => shortcuts.get(key)!.handler(ctx),
    command: (args: string) => commands.get("bookmark")!.handler(args, ctx),
    assertNoStatus: () => assert.ok(statuses.every((text) => text === undefined), "no bookmark footer status"),
    assertSilent() { this.assertNoStatus(); assert.deepEqual(notices, []); },
    assertWarning(pattern: RegExp) {
      this.assertNoStatus();
      assert.match(notices.at(-1)!.message, pattern);
      assert.ok(notices.every((notice) => notice.type === "warning"));
    },
  };
}

function scrollTo(host: ReturnType<typeof makeHost>, row: number) {
  host.tui.scrollToTop();
  host.tui.scrollBy(row);
}

test("shortcuts silently save and jump without a model turn, including after reload", (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  scrollTo(host, 50);
  h.press("ctrl+alt+b");
  assert.equal(h.manager.getBranch().length, 1);
  assert.equal(h.manager.getBranch()[0].type, "custom");
  host.tui.scrollToBottom();
  h.press("ctrl+alt+j");
  assert.equal(host.tui.viewportTop, 50);
  h.emit("session_shutdown");
  assert.equal(h.widgets.get("pi-bookmarks-connection"), undefined);
  h.assertSilent();
  const reloaded = harness(host, h.manager);
  host.tui.scrollToBottom();
  reloaded.press("ctrl+alt+j");
  assert.equal(host.tui.viewportTop, 50);
  assert.equal(h.manager.getBranch().length, 1, "navigation must not append or branch history");
  reloaded.assertSilent();
});

test("unnamed commands silently save, jump, and persist clearing across reload", async (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  scrollTo(host, 33);
  await h.command("");
  host.tui.scrollToBottom();
  await h.command("jump");
  assert.equal(host.tui.viewportTop, 33);
  await h.command("clear");
  h.emit("session_shutdown");
  h.assertSilent();
  const reload = harness(host, h.manager);
  reload.assertSilent();
  host.tui.scrollToBottom(); host.tui.renderNow();
  const before = host.tui.viewportTop;
  await reload.command("jump");
  reload.assertWarning(/No bookmark/);
  assert.equal(host.tui.viewportTop, before);
  assert.equal(h.manager.getBranch().length, 2);
});

test("named marks save, jump, and clear independently of other marks and the default", async (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  for (const [name, row] of [["", 20], ["q", 40], ["r", 60]] as const) {
    scrollTo(host, row);
    await h.command(name);
  }
  host.tui.scrollToBottom();
  await h.command("jump q");
  assert.equal(host.tui.viewportTop, 40);
  await h.command("clear q");
  h.emit("session_shutdown");
  h.assertSilent();
  const reload = harness(host, h.manager);
  await reload.command("jump r");
  assert.equal(host.tui.viewportTop, 60);
  await reload.command("jump");
  assert.equal(host.tui.viewportTop, 20);
  reload.assertSilent();
  await reload.command("jump q");
  reload.assertWarning(/Mark 'q' is not set/);
  assert.equal(host.tui.viewportTop, 20);
  assert.equal(h.manager.getBranch().length, 4);
});

test("version 1 persisted bookmark migrates into a version 2 snapshot without losing the default", async (t) => {
  const host = makeHost();
  t.after(host.stop);
  scrollTo(host, 25);
  const snapshot = readTranscript(host.tui);
  const anchor = createAnchor(snapshot.lines, snapshot.topRow);
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry("pi-bookmarks", { version: 1, anchor });
  const h = harness(host, manager);
  host.tui.scrollToBottom();
  await h.command("jump");
  assert.equal(host.tui.viewportTop, 25);
  assert.equal(manager.getBranch().length, 1, "loading and jumping do not rewrite legacy data");
  scrollTo(host, 55);
  await h.command("q");
  const entry = manager.getBranch().at(-1)!;
  assert.equal(entry.type, "custom");
  if (entry.type !== "custom") throw new Error("Expected persisted snapshot");
  const data = entry.data as { version: number; marks: Record<string, unknown> };
  assert.equal(data.version, 2);
  assert.deepEqual(Object.keys(data.marks).sort(), ["default", "q"]);
  assert.deepEqual(data.marks.default, anchor);
  h.emit("session_shutdown");
  h.assertSilent();
  const reload = harness(host, manager);
  await reload.command("jump");
  assert.equal(host.tui.viewportTop, 25);
  await reload.command("jump q");
  assert.equal(host.tui.viewportTop, 55);
  reload.assertSilent();
});

test("branch navigation restores full snapshots relative to the active branch", async (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  scrollTo(host, 25); await h.command("");
  scrollTo(host, 40); await h.command("q");
  const first = h.manager.getLeafId()!;
  scrollTo(host, 60); await h.command("q");
  await h.command("clear");
  const second = h.manager.getLeafId()!;
  h.manager.branch(first); h.emit("session_tree");
  await h.command("jump");
  assert.equal(host.tui.viewportTop, 25);
  await h.command("jump q");
  assert.equal(host.tui.viewportTop, 40);
  h.assertSilent();
  h.manager.branch(second); h.emit("session_tree");
  await h.command("jump q");
  assert.equal(host.tui.viewportTop, 60);
  await h.command("jump");
  h.assertWarning(/No bookmark/);
  h.manager.resetLeaf(); h.emit("session_tree");
  await h.command("jump q");
  h.assertWarning(/Mark 'q' is not set/);
});

test("failed saves and clears warn without replacing the last successful state", async (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  scrollTo(host, 35); await h.command("q");
  h.failWrites();
  scrollTo(host, 45); await h.command("q");
  h.assertWarning(/disk write failed/);
  await h.command("clear q");
  h.assertWarning(/disk write failed/);
  assert.equal(h.notices.length, 2);
  host.tui.scrollToBottom(); await h.command("jump q");
  assert.equal(host.tui.viewportTop, 35);
  assert.equal(h.notices.length, 2, "successful jump remains silent after a failure");
  assert.equal(h.manager.getBranch().length, 1);
  h.emit("session_shutdown");
  const reload = harness(host, h.manager);
  host.tui.scrollToBottom(); await reload.command("jump q");
  assert.equal(host.tui.viewportTop, 35);
  reload.assertSilent();
});

test("missing content warns without moving the viewport", (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  scrollTo(host, 35); h.press("ctrl+alt+b");
  h.assertSilent();
  host.content.setText("replacement unrelated transcript content ".repeat(400));
  host.tui.scrollToBottom(); host.tui.renderNow();
  const before = host.tui.viewportTop;
  h.press("ctrl+alt+j");
  h.assertWarning(/missing/i);
  assert.equal(host.tui.viewportTop, before);
});

test("malformed persisted snapshots cannot revive older bookmarks", async (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  scrollTo(host, 30); h.press("ctrl+alt+b");
  await h.command("q");
  h.manager.appendCustomEntry("pi-bookmarks", { version: 2, marks: { q: {} } });
  h.emit("session_tree");
  h.assertSilent();
  h.press("ctrl+alt+j");
  h.assertWarning(/No bookmark/);
  await h.command("jump q");
  h.assertWarning(/Mark 'q' is not set/);
  assert.equal(host.tui.viewportTop, 30);
});

test("invalid commands warn without writing session state", async (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  for (const args of ["Q", "jump qq", "clear q r"]) {
    await h.command(args);
    h.assertWarning(/Usage:/);
  }
  assert.equal(h.notices.length, 3);
  assert.equal(h.manager.getBranch().length, 0);
});

test("terminal listener is replaced on double startup and removed exactly once on shutdown", (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  assert.equal(h.listeners.size, 1);
  const first = [...h.listeners][0]!;
  h.emit("session_start");
  assert.equal(h.listeners.size, 1);
  assert.equal(h.listeners.has(first), false);
  assert.deepEqual(h.unsubscribed, [first]);
  const second = [...h.listeners][0]!;
  h.emit("session_shutdown");
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.unsubscribed, [first, second]);
  assert.equal(h.widgets.get("pi-bookmarks-connection"), undefined);
  h.emit("session_shutdown");
  assert.deepEqual(h.unsubscribed, [first, second]);
  h.assertSilent();
});

test("non-TUI clients receive only a warning, with no session writes or input listener", (t) => {
  const host = makeHost();
  t.after(host.stop);
  const h = harness(host);
  h.ctx.mode = "rpc";
  h.emit("session_start"); h.press("ctrl+alt+b");
  h.assertWarning(/fullscreen terminal UI/);
  assert.equal(h.manager.getBranch().length, 0);
  assert.equal(h.listeners.size, 0);
});

test("Pi's real extension loader accepts the TypeScript entry point", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const path = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const loaded = await discoverAndLoadExtensions([path], root, `${root}/test/nonexistent-agent-dir`);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.ok(loaded.extensions[0].commands.has("bookmark"));
  assert.ok(loaded.extensions[0].shortcuts.has("ctrl+alt+b"));
});
