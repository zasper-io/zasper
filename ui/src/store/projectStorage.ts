/**
 * localStorage records kept per project directory. Every project served on one port shares an
 * origin and so one store; keyed by directory, opening a second project no longer overwrites what
 * the first one remembered.
 */

/** How many projects are remembered; the least recently written are dropped past it. */
const MAX_PROJECTS = 20;

/** An entry for one project, stamped so the oldest can be dropped. */
export interface ProjectEntry {
  used: number;
}

/** The parsed record under `key`, or `null` when there is none or it cannot be read. */
export function readJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // Private browsing, storage turned off, or a record that is not JSON.
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full quota, or storage turned off. Only the memory of it is lost.
  }
}

/** Whatever was stored for `directory`, without trusting its shape. */
export function projectEntry(projects: unknown, directory: string): unknown {
  if (projects === null || typeof projects !== 'object') {
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(projects, directory)
    ? (projects as Record<string, unknown>)[directory]
    : undefined;
}

/** `projects` with `directory`'s entry replaced, keeping only the most recently used. */
export function withProject<T extends ProjectEntry>(
  projects: unknown,
  directory: string,
  entry: T
): Record<string, T> {
  const others = Object.entries(
    projects !== null && typeof projects === 'object' ? (projects as Record<string, T>) : {}
  )
    .filter(([key, value]) => key !== directory && value !== null && typeof value === 'object')
    .sort(([, a], [, b]) => (Number(b.used) || 0) - (Number(a.used) || 0))
    .slice(0, MAX_PROJECTS - 1);
  return Object.fromEntries([[directory, entry], ...others]);
}
