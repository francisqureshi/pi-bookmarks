# pi-bookmarks

Silent, content-anchored bookmarks for Pi's fullscreen transcript. Save the top visible line and jump back later, even after resizing or reloading.

## Vim marks

With [`pi-vim`](https://github.com/lajarre/pi-vim) installed:

1. Press **Esc** to enter **NORMAL** mode.
2. Scroll your target line to the **top of the transcript**.
3. Type **`mq`** to save it as mark **q**.
4. Scroll elsewhere, then type **`'q`** to return.

These are sequential keystrokes, without spaces. Use any lowercase name **a–z**: `ma` / `'a`, `mb` / `'b`, etc. Saving the same name replaces only that mark. Marks belong to the active session branch.

**No footer or success notifications.** A saved mark appears in the existing left padding: `q` for mark q, `•` for the unnamed bookmark, or `*` when several marks share a row. It overlays a verified blank cell, so no column is added and wrapping does not change. Lines without blank left padding are left untouched; their bookmarks still work. Missing or ambiguous content produces a warning instead of a guessed jump.

The mark sequences apply only to an idle normal-mode editor. Insert typing, visual selections, EX commands, pending operators/find/replace/counts, and bracketed paste retain their normal behavior. Escape cancels an incomplete mark sequence. Unsupported mark names cancel the prefix and pass that key through normally.

This bookmarks the **transcript**, not a position in your prompt. **Shift+G (`G`) in idle NORMAL mode** jumps to the transcript end and follows live output, without deleting marks. Capital `G` still types normally in INSERT mode; counted and pending Vim commands keep their existing meaning. Pi's **Ctrl+End** remains an alternative.

## Without Vim

The original shortcuts still operate on a separate **unnamed bookmark**:

- **Ctrl+Alt+B**: save the top visible line.
- **Ctrl+Alt+J**: return to it.

Saving a named mark does not replace the unnamed bookmark, or vice versa. Existing bookmarks from version 0.1 migrate to the unnamed slot automatically.

## Commands

| Command | Action |
| --- | --- |
| `/bookmark` | Save the unnamed bookmark |
| `/bookmark jump` | Return to the unnamed bookmark |
| `/bookmark clear` | Remove the unnamed bookmark |
| `/bookmark q` | Save named mark q |
| `/bookmark jump q` | Return to mark q |
| `/bookmark clear q` | Remove mark q without deleting other marks |

The commands also work through pi-vim's EX bridge: `:bookmark q`, `:bookmark jump q`, etc. Navigation never makes a model request or changes the conversation's active branch.

## Try without installing

Tested with **Pi 1.3.0**, **pi-vim 0.14.2**, and Node 24; requires Node 22.19+ and fullscreen mode.

From this repository:

```sh
pi --tui-mode fullscreen -e ./src/index.ts
```

Or use an absolute path from another project:

```sh
pi --tui-mode fullscreen -e /path/to/pi-bookmarks/src/index.ts
```

Pi supplies the runtime dependencies. pi-vim is optional and installed separately; `npm install` is needed only for development. Both extension load orders are tested.

## Install from GitHub

```sh
pi install git:github.com/francisqureshi/pi-bookmarks
```

Run `/reload` afterward. For Vim mark sequences, also install `pi-vim` with `pi install npm:pi-vim`.

## Install from a local checkout

Enable a local checkout in your personal Pi configuration:

```sh
pi install /path/to/pi-bookmarks
# Optional, for mq / 'q:
pi install npm:pi-vim
```

Run `/reload` in an existing Pi session afterward. For project-only installation, run `pi install --local /path/to/pi-bookmarks` from that project.

The shipped example extension named `bookmark.ts` also registers `/bookmark`. Do not load both bookmark extensions together.

## How anchors work

Bookmarks store bounded text immediately before and after the target line, not terminal row numbers. Matching ignores ANSI styling and whitespace introduced by wrapping. The combined context must occur exactly once in the currently rendered transcript.

- **Resize:** resolves the content again and scrolls to the row containing the original line's starting text. The new wrapped row may begin slightly before that text.
- **More output:** does not invalidate an unchanged anchor.
- **Reload/resume:** custom session entries restore marks from the active branch. Bookmark metadata is not sent to the model.
- **Changed or hidden content:** if surrounding text changes, a tool result collapses, compaction removes content from the visible transcript, or context is duplicated, navigation refuses with a warning. There is no old-row-number fallback.
- **Blank lines:** anchors the following text and preserves preceding blank rows where they still exist.

Prefer completed, stable text: a mark in changing streamed output may stop matching. Matching is deliberately conservative.

### Compatibility boundaries

**Transcript layout:** the adapter uses public `TuiAltScreen` scroll methods, but Pi has no dedicated transcript-text API. It relies on Pi 1.3's convention that the first public TUI child is the transcript document. It briefly observes that document's public `render()` method during a synchronous layout render to obtain the actual content width, restores the exact method descriptor in `finally`, and verifies the result against the visible screen. Hidden, auto, and always-visible scrollbars are tested.

**Vim input:** pi-vim exposes `getMode()` but not whether a normal-mode command is pending; EX also reports normal mode. The compatibility adapter therefore makes strictly read-only checks of pi-vim 0.14.2's known pending-state fields before intercepting keys. Missing or unexpected fields disable interception and leave input untouched. It does not replace the editor, modify pi-vim, or depend on package load order. Different editor wrappers or future pi-vim versions may require an adapter update; shortcuts and commands remain alternatives. The gutter uses an owned document-render wrapper that is removed on shutdown/reload; anchor matching always receives unmarked source lines.

Regular terminal scrollback, RPC, and print mode do not support navigation. Open dialogs must be closed first.

## Development

```sh
npm install
npm run check
```

Tests cover anchor resolution, persistence/migration/branches, silent success, renderer/scrollbars, real pi-vim modal input (including paste, counts, and Kitty key events), and Pi's TypeScript extension loader.

Optional end-to-end tests on POSIX (requires Pi on `PATH` and `uv`):

```sh
uv run --with pyte python test/pty-smoke.py
uv run --with pyte python test/pty-smoke.py --vim
uv run --with pyte python test/pty-smoke.py --vim-first
```

These launch real Pi processes in pseudo-terminals with disposable configuration and synthetic transcripts. They exercise shortcuts or two independent named marks, visible left-padding indicators, insert-mode safety, Shift+G, resizing, `/reload`, and persistence without model requests or personal configuration changes.

- `src/anchors.ts`: content-anchor creation and resolution.
- `src/transcript.ts`: fullscreen transcript adapter.
- `src/gutter.ts`: source-preserving left-padding indicators.
- `src/store.ts`: branch snapshots and legacy migration.
- `src/vim-input.ts`: guarded normal-mode mark sequences.
- `src/index.ts`: commands, shortcuts, and lifecycle wiring.
