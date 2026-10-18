import { isContentAnchor, type ContentAnchor } from "./anchors.ts";

export type MarkName = string;
export type Marks = ReadonlyMap<string, ContentAnchor>;
export interface BookmarkState {
  version: 2;
  marks: Record<string, ContentAnchor>;
}

type Entry = Readonly<{ type: string; customType?: string; data?: unknown }>;

export function isMarkName(name: string): boolean {
  return name === "default" || /^[a-z]$/.test(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function decode(data: unknown): Map<string, ContentAnchor> {
  const marks = new Map<string, ContentAnchor>();
  if (!isRecord(data)) return marks;
  const keys = Reflect.ownKeys(data);
  if (keys.length !== 2 || !keys.includes("version")) return marks;
  if (data.version === 1 && keys.includes("anchor")) {
    if (isContentAnchor(data.anchor)) marks.set("default", data.anchor);
  } else if (data.version === 2 && keys.includes("marks") && isRecord(data.marks)) {
    const names = Reflect.ownKeys(data.marks);
    if (names.length > 27) return marks;
    for (const name of names) {
      if (typeof name !== "string" || !isMarkName(name) || !isContentAnchor(data.marks[name])) {
        return new Map();
      }
      marks.set(name, data.marks[name]);
    }
  }
  return marks;
}

// Branch selection belongs to the caller. Each matching entry is a full snapshot,
// including malformed snapshots: never fall back to an older saved bookmark.
export function restoreMarks(entries: readonly Entry[]): Map<string, ContentAnchor> {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type === "custom" && entry.customType === "pi-bookmarks") return decode(entry.data);
  }
  return new Map();
}

export function serializeMarks(marks: Marks): BookmarkState {
  const saved: Record<string, ContentAnchor> = Object.create(null);
  for (const [name, anchor] of marks) {
    if (typeof name !== "string" || !isMarkName(name) || !isContentAnchor(anchor)) {
      throw new Error("Cannot save bookmarks: invalid mark name or content anchor.");
    }
    saved[name] = anchor;
  }
  return { version: 2, marks: saved };
}
