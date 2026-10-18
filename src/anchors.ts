export interface ContentAnchor {
  version: 1;
  before: string;
  after: string;
  blankRows: number;
  preview: string;
}

const BEFORE = 160;
const AFTER = 240;
const MIN_CONTEXT = 32;
const MAX_BLANK_ROWS = 1_000_000;
const PREVIEW_POINTS = 80;

// Inputs are already stripped of terminal escape sequences by the adapter.
// Removing all whitespace makes matching independent of wrapping and padding.
function canonicalize(lines: readonly string[]) {
  const starts: number[] = [];
  const parts: string[] = [];
  let length = 0;
  for (const line of lines) {
    starts.push(length);
    const part = line.replace(/\s/gu, "");
    parts.push(part);
    length += part.length;
  }
  return { text: parts.join(""), starts, parts };
}

export function isContentAnchor(value: unknown): value is ContentAnchor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>;
  return a.version === 1
    && typeof a.before === "string" && a.before.length <= BEFORE
    && typeof a.after === "string" && a.after.length <= AFTER
    && a.before.length + a.after.length >= MIN_CONTEXT
    && !/\s/u.test(a.before) && !/\s/u.test(a.after)
    && typeof a.blankRows === "number" && Number.isSafeInteger(a.blankRows)
    && a.blankRows >= 0 && a.blankRows <= MAX_BLANK_ROWS
    && typeof a.preview === "string" && a.preview.length > 0
    && a.preview.length <= PREVIEW_POINTS * 2
    && Array.from(a.preview).length <= PREVIEW_POINTS;
}

export function createAnchor(lines: readonly string[], topRow: number): ContentAnchor {
  // The one-past-last row represents the document-end boundary.
  if (!Number.isSafeInteger(topRow) || topRow < 0 || topRow > lines.length) {
    throw new Error("Cannot bookmark: the viewport row is outside the document.");
  }
  const { text, starts, parts } = canonicalize(lines);
  const offset = starts[topRow] ?? text.length;
  let blankRows = 0;
  while (topRow + blankRows < parts.length && parts[topRow + blankRows] === "") blankRows++;
  if (blankRows > MAX_BLANK_ROWS) {
    throw new Error("Cannot bookmark: too many blank rows at the viewport top.");
  }
  const before = text.slice(Math.max(0, offset - BEFORE), offset);
  const after = text.slice(offset, offset + AFTER);
  if (before.length + after.length < MIN_CONTEXT) {
    throw new Error("Cannot bookmark: not enough stable text near the viewport top.");
  }
  // Keep word spacing in the footer; only the matching context is canonical.
  // Slice codepoints, not UTF-16 units, for user-visible metadata.
  const visibleText = (after ? lines.slice(topRow + blankRows) : lines.slice(0, topRow))
    .join(" ").replace(/\s+/gu, " ").trim();
  const points = Array.from(visibleText);
  const preview = (after ? points.slice(0, PREVIEW_POINTS) : points.slice(-PREVIEW_POINTS)).join("");
  const anchor: ContentAnchor = { version: 1, before, after, blankRows, preview };
  // Do not create a bookmark that is already ambiguous in the current output.
  resolveAnchor(lines, anchor);
  return anchor;
}

export function resolveAnchor(lines: readonly string[], anchor: ContentAnchor): number {
  return createAnchorResolver(lines)(anchor);
}

/** Share one canonical document index when resolving multiple gutter marks. */
export function createAnchorResolver(lines: readonly string[]): (anchor: ContentAnchor) => number {
  const { text, starts, parts } = canonicalize(lines);
  return (anchor) => {
    if (!isContentAnchor(anchor)) throw new Error("Cannot restore bookmark: invalid content anchor.");
    // Both sides must match exactly. Changes to captured context deliberately fail
    // closed; there is no forward-only or position-based fallback. Text outside
    // this bounded context can change freely, including newly appended output.
    const context = anchor.before + anchor.after;
    const match = text.indexOf(context);
    if (match < 0) throw new Error("Bookmark content is missing from the current output.");
    if (text.indexOf(context, match + 1) >= 0) {
      throw new Error("Bookmark content is ambiguous in the current output.");
    }
    const offset = match + anchor.before.length;
    // At end-of-document there is no containing row: use the end boundary.
    // Otherwise skip zero-length rows and choose the row containing the offset,
    // not merely the first row with the same start (which might be blank).
    let row = lines.length;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i]! <= offset && offset < starts[i]! + parts[i]!.length) {
        row = i;
        break;
      }
    }
    // Preserve preceding blank rows only while they actually exist. Reflow or
    // tool expansion may remove them; never compensate by landing on other text.
    let blanks = 0;
    while (blanks < anchor.blankRows && row - blanks > 0 && parts[row - blanks - 1] === "") blanks++;
    return row - blanks;
  };
}
