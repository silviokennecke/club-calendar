/**
 * Recently used assignments (target groups per club, extras and badges per calendar) for ordering
 * the suggestions of the event form: the first id is the most recently used. Per user in
 * localStorage; every access is guarded and falls back to memory (private mode, blocked).
 */
export const RECENT_PREFIX = "cc:recent:v1:";
export const RECENT_MAX = 30;

export type RecentKind = "targetGroups" | "features" | "properties";
type Scoped = Record<string, string[]>;
export type RecentSelections = Record<RecentKind, Scoped>;

const KINDS: RecentKind[] = ["targetGroups", "features", "properties"];
const memory = new Map<string, string>();

const empty = (): RecentSelections => ({ targetGroups: {}, features: {}, properties: {} });

function parse(raw: string | null | undefined): RecentSelections {
  const out = empty();
  if (!raw) return out;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return out;
    for (const kind of KINDS) {
      const scoped = (data as Record<string, unknown>)[kind];
      if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) continue;
      for (const [scope, ids] of Object.entries(scoped)) {
        if (Array.isArray(ids) && ids.every((i) => typeof i === "string")) {
          out[kind][scope] = (ids as string[]).slice(0, RECENT_MAX);
        }
      }
    }
  } catch {
    /* corrupt data counts as empty */
  }
  return out;
}

function load(userId: string): RecentSelections {
  const key = RECENT_PREFIX + userId;
  try {
    const raw = window.localStorage.getItem(key);
    return parse(raw ?? memory.get(key));
  } catch {
    return parse(memory.get(key));
  }
}

function save(userId: string, data: RecentSelections): void {
  const key = RECENT_PREFIX + userId;
  const json = JSON.stringify(data);
  memory.set(key, json);
  try {
    window.localStorage.setItem(key, json);
  } catch {
    /* works with the in-memory copy */
  }
}

export function getRecentIds(userId: string, kind: RecentKind, scopeId: string): string[] {
  return load(userId)[kind][scopeId] ?? [];
}

/** `ids` in selection order: the one added last becomes the most recent. */
export function recordRecent(
  userId: string,
  kind: RecentKind,
  scopeId: string,
  ids: string[],
): void {
  if (ids.length === 0) return;
  const data = load(userId);
  const added = [...new Set(ids)].reverse();
  const rest = (data[kind][scopeId] ?? []).filter((id) => !added.includes(id));
  data[kind][scopeId] = [...added, ...rest].slice(0, RECENT_MAX);
  save(userId, data);
}

/** Removes the data of all users (`keepUserId`: of all users but this one). */
export function clearRecent(keepUserId?: string): void {
  const keep = keepUserId ? RECENT_PREFIX + keepUserId : null;
  for (const key of [...memory.keys()]) if (key !== keep) memory.delete(key);
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(RECENT_PREFIX) && key !== keep) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}
