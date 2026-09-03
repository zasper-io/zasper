// Project-relative paths, as the server writes and reads them: '/'-separated, no leading slash, and
// '' for the project root. Kept at the top of src/ because both the stores and the panels need them.

/** A parent directory and a name as the API wants them: the root is '', not '/'. */
export function joinPath(parentDir: string, name: string): string {
  return parentDir === '' ? name : `${parentDir}/${name}`;
}

/** The directory a path sits in, '' for anything at the root. */
export function parentDirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** The last segment of a path. */
export function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Whether `path` is `folder` itself or something inside it. */
export function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + '/');
}

/** `path` after `oldPath` was renamed to `newPath`, or null if the rename does not reach it. */
export function rewritePath(path: string, oldPath: string, newPath: string): string | null {
  if (path === oldPath) {
    return newPath;
  }
  if (path.startsWith(oldPath + '/')) {
    return newPath + path.slice(oldPath.length);
  }
  return null;
}
