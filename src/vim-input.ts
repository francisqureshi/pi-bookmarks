import { decodeKittyPrintable, isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";

export type VimMarkAction = "set" | "jump";

/**
 * pi-vim 0.14.2 exposes getMode(), but EX is a substate of normal and there is
 * no public idle-command accessor. These read-only runtime checks deliberately
 * require its known idle shape; unknown editors/versions pass through unchanged.
 * No editor methods, factories, or pending states are modified.
 */
export function isIdleVimNormal(editor: unknown): editor is object {
  if (typeof editor !== "object" || editor === null) return false;
  try {
    const state = editor as Record<string, unknown>;
    if (typeof state.getMode !== "function" || state.getMode.call(editor) !== "normal") return false;
    const idle: Record<string, unknown> = {
      pendingMotion: null,
      pendingTextObject: null,
      pendingOperator: null,
      pendingExCommand: null,
      repeatRecording: null,
      prefixCount: "",
      operatorCount: "",
      pendingGCount: "",
      pendingG: false,
      pendingReplace: false,
      replayingRepeat: false,
      acceptingBracketedPasteInExCommand: false,
      pendingEscWhileAcceptingBracketedPasteInExCommand: false,
      discardingPasteAfterNewlineInExCommand: false,
      discardingBracketedPasteInNormalMode: false,
      pendingEscWhileDiscardingBracketedPasteInNormalMode: false,
    };
    return Object.entries(idle).every(([key, value]) => state[key] === value) && state.isInPaste !== true;
  } catch {
    return false;
  }
}

/** Exactly two typed keys, never a substring of pasted or batched text. */
export function createVimMarkInput(
  getEditor: () => unknown,
  perform: (action: VimMarkAction, name: string) => void,
) {
  let pending: { editor: object; action: VimMarkAction } | undefined;
  let intercepted: { editor: object; keys: Set<string> } | undefined;
  const reset = () => { pending = undefined; intercepted = undefined; };
  const remember = (editor: object, char: string) => {
    if (intercepted?.editor !== editor) intercepted = { editor, keys: new Set() };
    intercepted.keys.add(char);
  };

  const handleInput = (data: string): { consume: true } | undefined => {
    const editor = getEditor();
    if (!isIdleVimNormal(editor)) {
      reset();
      return;
    }
    if ((pending && pending.editor !== editor) || (intercepted && intercepted.editor !== editor)) reset();
    const char = decodeKittyPrintable(data) ?? (data.length === 1 ? data : undefined);
    // A captured key's repeat/release belongs to us too. Forwarding its Kitty
    // sequence can insert text through pi-vim's underlying editor fallback.
    if (isKeyRelease(data)) {
      if (char && intercepted?.keys.delete(char)) return { consume: true };
      return;
    }
    if (isKeyRepeat(data)) {
      return char && intercepted?.keys.has(char) ? { consume: true } : undefined;
    }
    if (char) intercepted?.keys.delete(char); // Fresh press, not a held-key repeat.
    if (pending) {
      const action = pending.action;
      pending = undefined;
      if (char && /^[a-z]$/.test(char)) {
        remember(editor, char);
        perform(action, char);
        return { consume: true };
      }
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+[")) return { consume: true };
      // Invalid names and non-text keys cancel our prefix, then retain their
      // usual meaning. In particular, never consume a paste or a control key.
      return;
    }
    if (char === "m" || char === "'") {
      remember(editor, char);
      pending = { editor, action: char === "m" ? "set" : "jump" };
      return { consume: true };
    }
  };
  return { handleInput, reset };
}
